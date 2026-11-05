import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

/**
 * Socket.IO gateway authentication (Phase 6; SECURITY.md 2/3).
 *
 * Only tokened clients may connect: the client passes its existing REST
 * bearer access token in the handshake (either `auth.token` or an
 * `Authorization` header on the polling request) and this guard verifies it
 * with the same JwtService + AUTH_JWT_SECRET the REST JwtAuthGuard uses, so
 * the two surfaces share one credential policy. It never accepts new token
 * formats, and a missing/invalid/unverifiable token rejects the handshake
 * (401 equivalent: the socket is disconnected, reason 'unauthorized').
 *
 * Fail-closed: without AUTH_JWT_SECRET configured, every connection is
 * rejected — the gateway must never open when the secret is absent,
 * mirroring the REST guard (SECURITY.md 3).
 */
@Injectable()
export class GatewaySocketAuth {
  private readonly logger = new Logger(GatewaySocketAuth.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Verify a socket handshake. Returns the authenticated user id, or null
   * when the connection must be rejected.
   *
   * @param token the raw access token from the handshake.
   */
  async authenticate(
    token: string | undefined,
  ): Promise<{ userId: string; role: string } | null> {
    const secret = this.config.get<string>('AUTH_JWT_SECRET');
    if (!secret) {
      // Fail closed, same as JwtAuthGuard: log the config detail server-side,
      // reject client-side.
      this.logger.warn(
        'AUTH_JWT_SECRET is not configured; rejecting socket connections',
      );
      return null;
    }
    if (!token) {
      return null;
    }
    try {
      const payload = await this.jwt.verifyAsync(token, { secret });
      if (payload && typeof payload.sub === 'string') {
        return {
          userId: payload.sub,
          role: String(payload.role ?? 'PUBLIC'),
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /** Extract the token from a socket handshake (auth object or headers). */
  static tokenFromHandshake(handshake: {
    auth?: { token?: unknown };
    headers?: Record<string, unknown>;
  }): string | undefined {
    const direct = handshake.auth?.token;
    if (typeof direct === 'string' && direct.length > 0) {
      return direct;
    }
    const header = handshake.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice('Bearer '.length).trim();
    }
    return undefined;
  }

  /** Raise when a gateway route requires auth the connection lacks. */
  requireAuth(user: { id: string } | null): string {
    if (!user) {
      throw new UnauthorizedException('Socket connection is not authenticated');
    }
    return user.id;
  }
}
