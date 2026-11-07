import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  Logger,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export const IS_PUBLIC = 'isPublic';

interface AccessTokenPayload {
  sub: string;
  role: string;
  email: string;
}

interface AuthRequest {
  user?: { id: string; role: string; email: string };
  get(header: string): string | undefined;
}

/**
 * Lightweight Bearer-token guard for protected routes. Verifies the access
 * token via JwtService.verifyAsync (secret AUTH_JWT_SECRET, resolved per
 * request so a missing secret fails closed) and populates
 * request.user = { id, role, email }. Malformed, expired or unsigned tokens
 * are rejected with 401 without distinguishing the reason (SECURITY.md 2).
 *
 * Applied per-route via @UseGuards; register/login/refresh/logout stay
 * public and are not guarded. The global RolesGuard wiring can set @Public()
 * on routes it must not authenticate. Fail-closed: with AUTH_JWT_SECRET unset
 * the guard returns 500, never an open route (SECURITY.md 3).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthRequest>();
    const header = request.get('authorization');
    if (!header || !header.startsWith('Bearer ')) {
      throw new UnauthorizedException('Invalid or missing access token');
    }
    const token = header.slice('Bearer '.length).trim();
    const secret = this.config.get<string>('AUTH_JWT_SECRET');
    // Fail closed: no configured secret, no verification. AUTH_JWT_SECRET
    // must be a random 256-bit value (32 random bytes, hex/base64).
    if (!secret) {
      // Client sees a generic 500; the config detail stays in server logs (SECURITY.md 3).
      logger.warn(
        'AUTH_JWT_SECRET is not configured; refusing to verify access tokens',
      );
      throw new InternalServerErrorException('Authentication is misconfigured');
    }
    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync(token, { secret });
    } catch {
      throw new UnauthorizedException('Invalid or missing access token');
    }
    if (!payload || typeof payload.sub !== 'string') {
      throw new UnauthorizedException('Invalid or missing access token');
    }
    request.user = {
      id: payload.sub,
      role: payload.role,
      email: payload.email,
    };
    return true;
  }
}

const logger = new Logger(JwtAuthGuard.name);

/** Marks a route as reachable without an access token. */
export function Public() {
  return SetMetadata(IS_PUBLIC, true);
}
