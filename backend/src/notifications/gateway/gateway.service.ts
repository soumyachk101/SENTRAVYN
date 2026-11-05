import {
  Injectable,
  Logger,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import {
  createServer,
  type Server as HttpServer,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  Server as IoServer,
  type Socket,
} from 'socket.io';
import { GatewaySocketAuth } from './gateway.auth';
import { SyncService } from '../sync.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { NotificationJobPayload, SyncItem } from '../types';

/** Live event names for the /alerts namespace (ARCHITECTURE.md 6). */
const EVENT_UPDATE = 'alert:update';
const EVENT_SYNC_SINCE = 'sync:since';

/**
 * Live alert gateway (Phase 6; ARCHITECTURE.md 6 step 4).
 *
 * Attaches a Socket.IO server to its own HTTP port
 * (REALTIME_PORT, default 4100) with a single `/alerts` namespace.
 *
 * - Every connection is JWT-authenticated (GatewaySocketAuth, same secret
 *   policy as the REST guard). Unauthenticated handshakes are closed.
 * - `alert:update`: when PublishService publishes a revision, the gateway
 *   pushes the compact update to every connected socket. The socket
 *   delivery is *fire-and-forget*: the durable record (Notification row)
 *   is written by PublishService regardless of who is connected, so a
 *   missed live event is always recoverable through the cursor sync below.
 * - `sync:since`: reconnect / catch-up path. The client sends the last
 *   cursor it saw (an opaque SyncService token) or null for "latest tail".
 *   The gateway reads updates from the database (durable, not a memory
 *   ring) and replies with the missed revisions + the new cursor.
 *
 * The gateway never fabricates a delivery: a push to zero connected sockets
 * still records the durable row, and the cursor sync always reflects the DB.
 */
export interface GatewayOptions {
  port?: number;
}

/**
 * DI token for the gateway options. The param is an optional plain object
 * (a runtime `Object` paramtype reads as the unresolvable `Object` token
 * under Nest DI), so the module registers this string token with a
 * default value; manual construction (tests) keeps working via the
 * positional default.
 */
export const GATEWAY_OPTIONS = 'GATEWAY_OPTIONS';

@Injectable()
export class GatewayService implements OnModuleDestroy {
  private readonly logger = new Logger(GatewayService.name);
  private io: IoServer | null = null;
  private http: HttpServer | null = null;
  private boundPort: number | null = null;
  private readonly socketsByUser = new Map<string, Set<Socket>>();

  constructor(
    private readonly auth: GatewaySocketAuth,
    private readonly sync: SyncService,
    private readonly prisma: PrismaService,
    @Inject(GATEWAY_OPTIONS)
    private readonly options: GatewayOptions = {},
  ) {}

  /** True when the gateway is live on a port. */
  get isRunning(): boolean {
    return this.io !== null;
  }

  /**
   * Start the gateway. Called explicitly by the worker/API entrypoints so
   * tests can opt in to a port and assert on the socket surface. When
   * REALTIME_PORT is unset the gateway is not started and live fan-out is
   * a no-op while the durable path stays intact.
   *
   * @returns the bound port (0-based port is resolved to the actual port).
   */
  async start(): Promise<number> {
    if (this.io) return this.boundPort ?? 0;
    const port = this.options.port ?? Number(process.env.REALTIME_PORT ?? 4100);
    const http = createServer();
    const io = new IoServer(http, {
      cors: {
        // The origin allowlist mirrors the REST CORS policy: same
        // WEB_BASE_URL, credentials false (SECURITY.md 3).
        origin: process.env.WEB_BASE_URL ? process.env.WEB_BASE_URL.split(',') : false,
        credentials: false,
      },
      serveClient: false, // no browser client needed for our API clients
      pingTimeout: 20_000,
      pingInterval: 10_000,
    });
    this.http = http;
    this.io = io;

    const namespace = io.of('/alerts');
    namespace.use(async (socket, next) => {
      const user = await this.auth.authenticate(
        GatewaySocketAuth.tokenFromHandshake({
          auth: socket.handshake.auth as { token?: unknown },
          headers: socket.handshake.headers as Record<string, unknown>,
        }),
      );
      if (!user) {
        this.logger.debug('rejected unauthenticated /alerts handshake');
        socket.disconnect(true);
        return;
      }
      socket.data.userId = user.userId;
      socket.data.role = user.role;
      this.trackSocket(user.userId, socket);
      next();
    });

    namespace.on('connection', (socket) => {
      socket.on(EVENT_SYNC_SINCE, async (payload: unknown, ack?: (r: unknown) => void) => {
        const cursor =
          typeof payload === 'string' || payload === null
            ? payload
            : typeof payload === 'object' && payload !== null && 'cursor' in payload
              ? (payload as { cursor?: unknown }).cursor
              : null;
        const cursorStr =
          typeof cursor === 'string' && cursor.length > 0 ? cursor : null;
        try {
          const result = await this.sync.since(cursorStr);
          const out = this.mapSyncResult(result.items);
          if (ack) ack({ ...result, items: out });
        } catch (err) {
          this.logger.error(`sync:since failed: ${String(err)}`);
          if (ack) ack({ error: 'sync failed', items: [] });
        }
      });

      socket.on('disconnect', () => {
        const uid = socket.data.userId as string;
        this.untrackSocket(uid, socket);
      });
    });

    const bound = await new Promise<number>((resolve, reject) => {
      http.once('error', reject);
      http.listen(port, () => {
        http.off('error', reject);
        const addr = http.address() as AddressInfo;
        this.logger.log(
          `realtime gateway listening on ${addr.address}:${addr.port}`,
        );
        resolve(addr.port);
      });
    });
    this.boundPort = bound;
    return bound;
  }

  /**
   * Live fan-out for a freshly published revision (called by the API after
   * PublishService.publish). Emits to all connected sockets; the durable
   * record has already been written, so 0 recipients is not a failure.
   */
  async broadcastUpdate(job: NotificationJobPayload): Promise<number> {
    if (!this.io) {
      // Gateway not started (no REALTIME_PORT): the durable rows still
      // exist and the cursor sync will serve them. Report 0 live recipients.
      return 0;
    }
    const payload = await this.payloadFor(job);
    const ns = this.io.of('/alerts');
    ns.emit(EVENT_UPDATE, payload);
    return this.socketCount();
  }

  /** Build the compact, credential-free live payload for one transition. */
  private async payloadFor(job: NotificationJobPayload): Promise<Record<string, unknown>> {
    const alert = await this.prisma.alert.findUnique({
      where: { id: job.alertId },
      select: {
        id: true,
        headline: true,
        severity: true,
        urgency: true,
        issuer: true,
        issuedAt: true,
        publishedAt: true,
        status: true,
        externalRef: true,
      },
    });
    return {
      type: EVENT_UPDATE,
      alertId: job.alertId,
      nextStatus: job.nextStatus,
      headline: job.headline,
      ...(alert
        ? {
            severity: alert.severity,
            urgency: alert.urgency,
            issuer: alert.issuer,
            issuedAt: alert.issuedAt?.toISOString() ?? null,
            publishedAt: alert.publishedAt?.toISOString() ?? null,
            externalRef: alert.externalRef,
          }
        : {}),
      receivedAt: new Date().toISOString(),
    };
  }

  private mapSyncResult(items: SyncItem[]): Record<string, unknown>[] {
    return items.map((item) => ({ ...item }));
  }

  // Per-user socket tracking so a future role-scoped fan-out can target the
  // right sockets; today the /alerts namespace is broadcast-only.
  private trackSocket(userId: string, socket: Socket): void {
    let set = this.socketsByUser.get(userId);
    if (!set) {
      set = new Set();
      this.socketsByUser.set(userId, set);
    }
    set.add(socket);
  }

  private untrackSocket(userId: string, socket: Socket): void {
    const set = this.socketsByUser.get(userId);
    if (set) {
      set.delete(socket);
      if (set.size === 0) this.socketsByUser.delete(userId);
    }
  }

  /** Connected socket count in the /alerts namespace. */
  socketCount(): number {
    return this.io ? this.io.of('/alerts').sockets.size : 0;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.io) {
      await this.io.close();
      this.io = null;
    }
    if (this.http) {
      await new Promise<void>((resolve) => this.http!.close(() => resolve()));
      this.http = null;
    }
    this.boundPort = null;
  }
}
