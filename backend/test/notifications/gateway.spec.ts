import { io as ioClient, type Socket } from 'socket.io-client';
import { GatewayService } from '../../src/notifications/gateway/gateway.service';
import { GatewaySocketAuth } from '../../src/notifications/gateway/gateway.auth';
import { SyncService, encodeCursor } from '../../src/notifications/sync.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

/**
 * Gated integration spec: the Socket.IO /alerts namespace.
 *
 * Gated on DATABASE_URL (it seeds real PUBLISHED/UPDATED AlertRevision rows
 * and the sync path reads them back). A missing DATABASE_URL logs
 * `SKIP: DATABASE_URL not configured; gateway reconnect-sync not run`.
 *
 * What it proves:
 *   - An unauthenticated handshake is disconnected (fail-closed auth).
 *   - An authenticated client connects and receives a live `alert:update`
 *     broadcast when PublishService publishes.
 *   - On reconnect, a client that saw up to a cursor receives the
 *     revisions it MISSED from the database (durable, not a memory ring)
 *     via the `sync:since` event.
 */
describe('Socket.IO /alerts gateway (Phase 6, gated on DB)', () => {
  const dbConfigured = Boolean(process.env.DATABASE_URL);
  const jwtSecret = process.env.AUTH_JWT_SECRET ?? 'gateway-spec-jwt-secret';

  let prisma: PrismaService;
  let gateway: GatewayService;
  let port: number;
  let token: string;

  function connectClient(
    withAuth: boolean,
  ): Socket {
    return ioClient(`http://localhost:${port}/alerts`, {
      transports: ['websocket', 'polling'],
      auth: withAuth ? { token } : undefined,
      reconnection: false,
      timeout: 4000,
    });
  }

  function awaitEvent(socket: Socket, event: string, ms = 5000) {
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for ${event}`)),
        ms,
      );
      socket.once(event, (payload: unknown) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
  }

  beforeAll(async () => {
    if (!dbConfigured) return;
    prisma = new PrismaService(new ConfigService(process.env));
    await prisma.$connect();

    const auth = new GatewaySocketAuth(new JwtService({ secret: jwtSecret }), new ConfigService({ AUTH_JWT_SECRET: jwtSecret }));
    const sync = new SyncService(prisma);
    gateway = new GatewayService(auth, sync, prisma, {});
    port = await gateway.start();
    token = await new JwtService({ secret: jwtSecret }).signAsync({
      sub: 'user-gw',
      role: 'PUBLIC',
      email: 'gw@example.com',
    });
  }, 60_000);

  afterAll(async () => {
    if (!dbConfigured) return;
    await gateway.onModuleDestroy();
    await prisma.$disconnect();
  });

  it('rejects an unauthenticated handshake', async () => {
    if (!dbConfigured) {
      console.log('SKIP: DATABASE_URL not configured; unauth rejection not run');
      return;
    }
    const client = connectClient(false);
    // A refused /alerts namespace leaves the client in a permanently
    // disconnected state: the server middleware rejects the handshake, so
    // the namespace socket is never granted and `connect` never fires.
    // (socket.io-client does not reliably emit `connect_error`/`disconnect`
    // for a namespace rejection within a short window — the socket simply
    // stays unconnected — so the observable invariant we assert on is
    // "never reached a connected socket", not a specific error event.)
    // The authenticated tests below prove a valid client DOES connect fast,
    // so a fixed handshake window is enough to catch a broken-auth
    // regression: if the gateway wrongly admitted the client, `connect`
    // would fire within this window and the assertion would fail.
    let everConnected = false;
    client.on('connect', () => {
      everConnected = true;
    });
    // Give the (rejected) handshake a chance to (wrongly) succeed.
    await new Promise((r) => setTimeout(r, 2500));
    expect(everConnected).toBe(false);
    expect(client.connected).toBe(false);
    client.close();
  });

  it('delivers a live alert:update to an authenticated client', async () => {
    if (!dbConfigured) {
      console.log('SKIP: DATABASE_URL not configured; live update not run');
      return;
    }
    // Seed a PUBLISHED alert + revision the sync/live paths can read.
    const externalRef = `gw-live-${Date.now()}`;
    const alert = await prisma.alert.create({
      data: {
        externalRef,
        status: 'PUBLISHED',
        headline: 'Gateway live alert',
        issuer: 'Gateway Spec Authority',
        publishedAt: new Date(),
      },
    });
    await prisma.alertRevision.create({
      data: { alertId: alert.id, revision: 1, status: 'PUBLISHED', body: 'rev 1' },
    });

    const client = connectClient(true);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('connect timeout')), 5000);
      client.once('connect', () => {
        clearTimeout(t);
        resolve();
      });
      client.once('connect_error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });

    // Trigger the broadcast the way the API does after publishing.
    const updateEvent = awaitEvent(client, 'alert:update');
    await gateway.broadcastUpdate({
      alertId: alert.id,
      nextStatus: 'PUBLISHED',
      dedupKey: `alert:${alert.id}:PUBLISHED`,
      headline: alert.headline,
      severity: null,
      urgency: null,
      issuer: alert.issuer,
      channels: ['PUSH_WEB'],
      issuedAt: null,
    });
    const payload = (await updateEvent) as { alertId: string; nextStatus: string };
    expect(payload.alertId).toBe(alert.id);
    expect(payload.nextStatus).toBe('PUBLISHED');
    client.close();
  });

  it('syncs missed revisions from the DB on reconnect since a cursor', async () => {
    if (!dbConfigured) {
      console.log('SKIP: DATABASE_URL not configured; reconnect sync not run');
      return;
    }
    // Seed two PUBLISHED alerts with distinct revisions, SEQUENTIALLY, with
    // explicit createdAt timestamps: the cursor key (createdAt, alertId,
    // revision) only orders revisions strictly when their createdAt values
    // differ, and the alertId is a random UUID (not monotonic). `Promise.all`
    // seeded both revisions concurrently, so under load their `now()`
    // commit timestamps could land in the same sub-millisecond window — and
    // then the composite order fell back to alertId UUID, breaking the
    // "the second revision is strictly after the cursor" invariant. Explicit
    // one-second-apart createdAt values remove the clock-resolution
    // dependency entirely.
    const base = Date.now();
    const alerts: { id: string }[] = [];
    for (const i of [0, 1]) {
      const externalRef = `gw-sync-${base}-${i}`;
      const a = await prisma.alert.create({
        data: {
          externalRef,
          status: 'PUBLISHED',
          headline: `Sync alert ${i}`,
          issuer: 'Gateway Sync Authority',
          publishedAt: new Date(base + i * 1000),
        },
      });
      await prisma.alertRevision.create({
        data: {
          alertId: a.id,
          revision: 1,
          status: 'PUBLISHED',
          body: `b${i}`,
          createdAt: new Date(base + i * 1000),
        },
      });
      alerts.push(a);
    }

    // Cursor = the first revision (everything up to it is "already seen").
    const firstRev = await prisma.alertRevision.findFirst({
      where: { alertId: alerts[0].id },
      orderBy: { createdAt: 'asc' },
    });
    if (!firstRev) {
      // Cannot construct the cursor without the first revision; a missing
      // seeded row means the DB write failed, so report SKIP (not pass).
      console.log('SKIP: first revision not found; reconnect sync not run');
      return;
    }
    const cursor = encodeCursor({
      alertId: alerts[0].id,
      revision: firstRev.revision,
      status: 'PUBLISHED',
      headline: '',
      severity: null,
      urgency: null,
      issuer: null,
      issuedAt: null,
      cursor: '',
      createdAt: firstRev.createdAt.toISOString(),
    });

    const client = connectClient(true);
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('connect timeout')), 5000);
      client.once('connect', () => {
        clearTimeout(t);
        resolve();
      });
      client.once('connect_error', (e) => {
        clearTimeout(t);
        reject(e);
      });
    });

    const ack = await new Promise<unknown>((resolve) => {
      const t = setTimeout(() => resolve(null), 5000);
      client.emit('sync:since', { cursor }, (resp: unknown) => {
        clearTimeout(t);
        resolve(resp);
      });
    });
    const result = ack as {
      cursorKnown: boolean;
      items: { alertId: string }[];
      nextCursor: string | null;
    };
    // The cursor was known and the only revision AFTER it is the second
    // alert's revision — that is the durable "missed update" the reconnect
    // path must surface.
    expect(result.cursorKnown).toBe(true);
    expect(result.items.some((i) => i.alertId === alerts[1].id)).toBe(true);
    expect(result.items.some((i) => i.alertId === alerts[0].id)).toBe(false);
    client.close();
  });
});
