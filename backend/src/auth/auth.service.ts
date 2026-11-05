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
import { MfaService } from './mfa/mfa.service';

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

/** User row as read for MFA gating (superset of the persisted fields). */
interface UserRecordWithMfa extends UserRecord {
  mfaEnabled: boolean;
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

/**
 * A privileged login that must complete its MFA step returns no full tokens;
 * instead a short-lived pending token (valid 5 minutes) plus the required MFA
 * type. The client posts this plus a TOTP/recovery code to
 * POST /auth/mfa/complete to exchange it for the real token pair.
 */
export interface MfaPendingLogin {
  mfaPending: true;
  mfaTempToken: string;
  /** How many single-use recovery codes remain, so the UI can hint. */
  recoveryCodesRemaining: number;
}

/**
 * Public session view returned by GET /auth/sessions. Deliberately omits
 * tokenHash: the refresh-token material is a stored sha256 hash and is never
 * returned by any API surface (SECURITY.md 4).
 */
export interface SessionView {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: Date;
  /** Always null in the active-session listing; kept for shape stability. */
  revokedAt: Date | null;
  expiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly mfa: MfaService,
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
    const existing = await this.prisma.user.findUnique({
      where: { email: normalized },
    });
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
   * Validates credentials. For a non-privileged account, or a privileged
   * account that has NOT enrolled MFA, issues a full token pair. For a
   * privileged account with MFA enabled, issues only a short-lived pending
   * MFA token: the caller must complete the second factor before obtaining
   * real tokens (MFA pending contract, docs/SECURITY.md section 2).
   *
   * The bcrypt compare always runs (against a dummy hash when the account
   * does not exist) so response time does not leak account existence. Error
   * text is deliberately the same for missing account and wrong password
   * (SECURITY.md 2).
   */
  async login(
    email: string,
    password: string,
  ): Promise<AuthTokens | MfaPendingLogin> {
    const normalized = email.toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
    });
    const hash = user?.passwordHash ?? DUMMY_BCRYPT_HASH;
    const matches = await bcrypt.compare(password, hash);
    if (!user || !matches) {
      throw new UnauthorizedException('Invalid email or password');
    }
    // Privileged role + MFA enrolled: gate the second factor before issuing
    // any usable tokens. Non-privileged and MFA-unenrolled accounts flow
    // through to the full token pair (recovery of a privileged account that
    // has never enrolled MFA is possible, matching the "optional" posture).
    if (this.mfa.requiresMfaStep(user as unknown as UserRecordWithMfa)) {
      const status = await this.mfa.status(user.id);
      const mfaTempToken = await this.mfa.issuePendingToken(
        user as unknown as UserRecordWithMfa,
      );
      return {
        mfaPending: true,
        mfaTempToken,
        recoveryCodesRemaining: status.recoveryCodesRemaining,
      };
    }
    return this.issueTokens(user as unknown as UserRecord);
  }

  /**
   * Completes the privileged login MFA step: verifies the pending token plus
   * a valid second factor, then issues the full token pair for that subject.
   * Fails closed when the pending token is invalid or the account's MFA is
   * corrupt.
   */
  async completeMfaLogin(
    mfaTempToken: string,
    code: string,
  ): Promise<AuthTokens> {
    const subject = await this.mfa.verifyPending(mfaTempToken, code);
    const user = await this.prisma.user.findUnique({
      where: { id: subject.id },
    });
    if (!user) {
      throw new UnauthorizedException('Invalid MFA request subject');
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
    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
    });
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
      logger.warn(
        `refresh rotation conflict, revoking session ${session.id}: ${String(error)}`,
      );
      await this.prisma.session
        .update({ where: { id: session.id }, data: { revokedAt: new Date() } })
        .catch(() => undefined);
      throw new UnauthorizedException('Invalid refresh token');
    }
    // Written directly via prisma.auditEvent because AuditModule already
    // imports AuthModule, so injecting AuditService would be circular.
    await this.writeAudit(
      session.userId,
      AUDIT_ACTIONS.SESSION_REFRESHED,
      'session',
      session.id,
      'rotation',
    );
    const accessToken = await this.signAccessToken(
      user as unknown as UserRecord,
    );
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
    await this.writeAudit(
      session.userId,
      AUDIT_ACTIONS.SESSION_REVOKED,
      'session',
      session.id,
      'logout',
    );
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

  /**
   * Lists the caller's active sessions (unrevoked, unexpired), most recent
   * first. Only session metadata is exposed (creation/revocation/expiry,
   * captured user agent and ip) — the refresh-token hash is never returned
   * (SECURITY.md 4).
   */
  async listSessions(userId: string): Promise<SessionView[]> {
    const now = new Date();
    const sessions = await this.prisma.session.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
      // Explicit projection: tokenHash is intentionally NOT selected so the
      // stored refresh-token material never reaches a response body.
      select: {
        id: true,
        userAgent: true,
        ip: true,
        createdAt: true,
        revokedAt: true,
        expiresAt: true,
      },
    });
    return sessions as unknown as SessionView[];
  }

  /**
   * Revokes a single session by id, owned by the caller. Idempotent: a
   * missing, foreign, or already-revoked session id is a no-op, not an
   * error. Audited under SESSION_REVOKED.
   */
  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.userId !== userId || session.revokedAt !== null) {
      return;
    }
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });
    await this.writeAudit(
      userId,
      AUDIT_ACTIONS.SESSION_REVOKED,
      'session',
      sessionId,
      'revoke-session',
    );
  }

  /**
   * Credential-compromise path (SECURITY.md section 2: "Revoke sessions
   * after credential compromise"). Marks every active session for the user
   * revoked in one update, so all previously issued refresh tokens stop
   * working. The currently-presenting session is not exempt: the caller must
   * re-authenticate (a fresh session is created on the next login). Audited
   * under SESSION_REVOKED_ALL with the affected count.
   */
  async revokeAllSessions(userId: string, detail?: string): Promise<number> {
    const now = new Date();
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: now },
    });
    await this.writeAudit(
      userId,
      AUDIT_ACTIONS.SESSION_REVOKED_ALL,
      'session',
      userId,
      detail ?? `revoked ${result.count} active session(s)`,
    );
    return result.count;
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
