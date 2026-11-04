import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { AUDIT_ACTIONS } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Precomputed bcrypt hash of a fixed dummy string. Used when an account does
 * not exist so that login always pays one bcrypt comparison, equalizing both
 * code paths and resisting account-existence enumeration via timing
 * (SECURITY.md 2).
 */
const DUMMY_BCRYPT_HASH =
  '$2b$12$JdKNc/8SpYg7HYtNG5rhaO4.M64a8EvTVcSa5xOIMh4OwANsmEpRa';

const BCRYPT_COST = 12;
const ACCESS_TTL_SECONDS = 15 * 60; // 15-minute access tokens
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30-day refresh tokens

/**
 * The Prisma row shape this service reads/writes. The generated client is
 * updated as the schema head lands, so column names are defined here and
 * kept in sync with docs (Session: tokenHash unique, revokedAt, expiresAt,
 * userId FK).
 */
interface UserRecord {
  id: string;
  email: string;
  displayName: string | null;
  role: Role;
  passwordHash: string;
}

interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  revokedAt: Date | null;
  expiresAt: Date;
}

/** Public shape returned by auth endpoints. Never includes passwordHash. */
export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  displayName: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Creates a PUBLIC user. Emails are lowercased so uniqueness is
   * case-insensitive regardless of input casing.
   */
  async register(
    email: string,
    displayName: string | null,
    password: string,
  ): Promise<PublicUser> {
    const normalized = email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (existing) {
      throw new ConflictException('Email already in use');
    }
    const user = await this.prisma.user.create({
      data: {
        email: normalized,
        displayName,
        role: 'PUBLIC',
        passwordHash: await bcrypt.hash(password, BCRYPT_COST),
      },
    });
    return toPublicUser(user as unknown as UserRecord);
  }

  /**
   * Validates credentials and issues a token pair.
   *
   * The bcrypt compare always runs (against a dummy hash when the account
   * does not exist) so response time does not leak account existence. Error
   * text is deliberately the same for missing account and wrong password
   * (SECURITY.md 2).
   */
  async login(email: string, password: string): Promise<AuthTokens> {
    const normalized = email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email: normalized } });
    const hash = user?.passwordHash ?? DUMMY_BCRYPT_HASH;
    const matches = await bcrypt.compare(password, hash);
    if (!user || !matches) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.issueTokens(user as unknown as UserRecord);
  }

  /**
   * Rotates a refresh token: the session row is updated in place with a new
   * tokenHash and a fresh 30-day expiry. In-place rotation is replay-safe:
   * the old hash is overwritten, so presenting the previous refresh token
   * finds no row and fails with the same generic error as any invalid
   * token.
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const session = await this.findSession(refreshToken);
    // Revoked, expired, and unknown tokens are indistinguishable on purpose.
    if (!session || session.revokedAt !== null || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = await this.prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const nextRefreshToken = randomRefreshToken();
    try {
      // Conditional on the CURRENT hash: if a concurrent refresh already
      // rotated this row, the where clause matches nothing and Prisma throws
      // P2025, so two rotations can never both succeed.
      await this.prisma.session.update({
        where: { tokenHash: session.tokenHash },
        data: {
          tokenHash: sha256Hex(nextRefreshToken),
          expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        },
      });
    } catch (error) {
      // Best-effort revocation; log only the session id, never token material.
      const logger = new Logger(AuthService.name);
      logger.warn(`refresh rotation conflict, revoking session ${session.id}: ${String(error)}`);
      await this.prisma.session
        .update({ where: { id: session.id }, data: { revokedAt: new Date() } })
        .catch(() => undefined);
      throw new UnauthorizedException('Invalid refresh token');
    }
    // Written directly via prisma.auditEvent because AuditModule already
    // imports AuthModule, so injecting AuditService would be circular.
    await this.writeAudit(session.userId, AUDIT_ACTIONS.SESSION_REFRESHED, 'session', session.id, 'rotation');
    const accessToken = await this.signAccessToken(user as unknown as UserRecord);
    return {
      accessToken,
      refreshToken: nextRefreshToken,
      user: toPublicUser(user as unknown as UserRecord),
    };
  }

  /** Revokes the session backing this refresh token. Idempotent. */
  async logout(refreshToken: string): Promise<void> {
    const session = await this.findSession(refreshToken);
    if (!session || session.revokedAt !== null) {
      return;
    }
    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    await this.writeAudit(session.userId, AUDIT_ACTIONS.SESSION_REVOKED, 'session', session.id, 'logout');
  }

  /** Writes an audit row directly via Prisma (AuditService would be circular). */
  private writeAudit(
    actorUserId: string | null,
    action: string,
    entity: string,
    entityId: string | null,
    detail?: string,
  ): Promise<unknown> {
    return this.prisma.auditEvent.create({
      data: { actorUserId, action, entity, entityId, detail: detail ?? null },
    });
  }

  /** Loads the public shape for the authenticated subject. */
  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Invalid access token');
    }
    return toPublicUser(user as unknown as UserRecord);
  }

  // ------------------------------------------------------------------ private

  private findSession(refreshToken: string): Promise<SessionRecord | null> {
    return this.prisma.session
      .findUnique({ where: { tokenHash: sha256Hex(refreshToken) } })
      .then((row) => row as unknown as SessionRecord | null);
  }

  private async issueTokens(user: UserRecord): Promise<AuthTokens> {
    // Sign first, fail fast: if the secret is unset we must not persist an
    // orphan session row we cannot issue a matching access token for.
    const accessToken = await this.signAccessToken(user);
    const refreshToken = await this.createSession(user.id);
    return { accessToken, refreshToken, user: toPublicUser(user) };
  }

  /** Signs a 15-minute access token. Fails closed when the secret is unset. */
  private async signAccessToken(user: UserRecord): Promise<string> {
    // AUTH_JWT_SECRET must be a random 256-bit value (e.g. 32 random bytes,
    // hex or base64 encoded). It is never committed or logged.
    const secret = this.config.get<string>('AUTH_JWT_SECRET');
    if (!secret) {
      throw new Error('AUTH_JWT_SECRET is not configured');
    }
    return this.jwt.signAsync(
      { sub: user.id, role: user.role, email: user.email },
      { secret, expiresIn: ACCESS_TTL_SECONDS },
    );
  }

  /** Creates a 30-day refresh session; only the sha256 hash is stored. */
  private async createSession(userId: string): Promise<string> {
    const refreshToken = randomRefreshToken();
    await this.prisma.session.create({
      data: {
        userId,
        tokenHash: sha256Hex(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });
    return refreshToken;
  }
}

/** Opaque 256-bit hex refresh token (32 random bytes). */
function randomRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function toPublicUser(user: UserRecord): PublicUser {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: user.displayName,
  };
}
