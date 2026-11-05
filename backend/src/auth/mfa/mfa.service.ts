import {
  Injectable,
  Logger,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'crypto';
import * as otplib from 'otplib';
import { Role } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AUDIT_ACTIONS } from '../../audit/audit.service';

/**
 * TOTP / recovery-code MFA for SENTRAVYN accounts (docs/SECURITY.md section 2:
 * "MFA required for privileged administrators").
 *
 * Design (smallest coherent change, fails closed on corruption):
 *  - TOTP is RFC 6238 via otplib (a maintained library, no mongoose dependency).
 *  - The base32 TOTP seed is stored on User.mfaSecret. It MUST be reversible
 *    (otplib re-derives codes from it), so it is stored plain — it is
 *    sensitive seed material but cannot be one-way hashed without losing the
 *    ability to verify. This mirrors how authenticator providers store the
 *    seed. It is never returned by any API shape except the one-time
 *    `/auth/mfa/setup` response that lets the user enrol.
 *  - The 8 recovery codes are single-use. Only their sha256 hex is stored
 *    (User.mfaRecoveryCodes); a DB leak therefore exposes no usable code. A
 *    used code is removed from the array.
 *  - Fail closed: when mfaEnabled is true but mfaSecret is missing or not a
 *    valid base32 seed, verification throws (never falls back to
 *    password-only). This is the "MFA enabled but secret corrupt" case.
 *
 * Roles: OPERATOR and ADMIN are "privileged" — login for these roles is
 * gated behind the TOTP step once the account is enrolled. PUBLIC and REVIEWER
 * can enrol MFA optionally (setup/verify) but are never blocked from logging in.
 *
 * Token issuance (the full access+refresh pair on successful privileged
 * login step 2) stays in AuthService; this service only verifies the second
 * factor and returns the verified subject so the caller can issue tokens.
 */

const TOTP_PERIOD_SECONDS = 30;
const TOTP_DIGITS = 6;
/** Symmetric epoch tolerance for TOTP verification (absorbs device drift). */
const TOTP_EPOCH_TOLERANCE_SECONDS = 30;
const RECOVERY_CODE_COUNT = 8;
/** A pending MFA temp token is valid for 5 minutes. */
const MFA_TEMP_TOKEN_TTL_SECONDS = 5 * 60;

/** Roles that must complete TOTP at login once MFA is enrolled. */
const PRIVILEGED_ROLES: readonly Role[] = ['OPERATOR', 'ADMIN'];

export interface MfaSetupResult {
  /** Base32 TOTP seed, shown once so the user can enrol an authenticator. */
  secret: string;
  /** otpauth:// URI for authenticator apps (scannable-equivalent). */
  uri: string;
  /**
   * The 8 single-use recovery codes, shown ONCE. They are stored only as
   * sha256 hex from this point; the plaintext is never retrievable again.
   */
  recoveryCodes: string[];
  /** False until verifyMfa confirms a valid code and flips the flag on. */
  mfaEnabled: false;
}

export interface MfaVerifyResult {
  mfaEnabled: true;
  /** How many single-use recovery codes remain. */
  recoveryCodesRemaining: number;
}

export interface MfaStatus {
  mfaEnabled: boolean;
  /** Remaining single-use recovery codes; never the seed or the codes. */
  recoveryCodesRemaining: number;
}

/** The prisma row shape MfaService reads/writes (User MFA columns). */
interface MfaUserRecord {
  id: string;
  role: Role;
  email: string;
  mfaSecret: string | null;
  mfaEnabled: boolean;
  mfaRecoveryCodes: string[];
}

@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Begins enrolment: generates a fresh TOTP seed and 8 single-use recovery
   * codes, persists the seed + hashed codes, and returns the plaintext seed
   * and codes (shown once). The account is not fully MFA-enabled until
   * verifyMfa confirms a valid code. Errors if MFA is already enabled.
   */
  async setup(userId: string): Promise<MfaSetupResult> {
    const user = await this.loadMfaUser(userId);
    if (user.mfaEnabled) {
      throw new ConflictException('MFA is already enabled for this account');
    }
    const secret = otplib.generateSecret({ length: 20 });
    const codes = this.generateRecoveryCodes();
    const codeHashes = codes.map((c) => sha256Hex(c));
    const uri = otplib.generateURI({
      strategy: 'totp',
      issuer: 'SENTRAVYN',
      label: user.id, // label; the authed user's id is a non-secret stable label
      secret,
      period: TOTP_PERIOD_SECONDS,
      digits: TOTP_DIGITS,
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: secret, mfaRecoveryCodes: codeHashes },
    });
    await this.writeAudit(
      userId,
      AUDIT_ACTIONS.MFA_SETUP,
      'user',
      userId,
      'totp+recovery-codes',
    );
    return { secret, uri, recoveryCodes: codes, mfaEnabled: false };
  }

  /**
   * Confirms enrolment with a valid TOTP or recovery code and flips
   * mfaEnabled on. Fails closed when the seed is corrupt.
   */
  async verifyMfa(userId: string, code: string): Promise<MfaVerifyResult> {
    const user = await this.loadMfaUser(userId);
    if (!user.mfaSecret) {
      // No seed yet: setup() must run first. Distinct from the corrupt case.
      throw new UnauthorizedException('MFA is not set up for this account');
    }
    const consumed = await this.verifyCode(userId, code, user);
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaEnabled: true },
    });
    const remaining = (user.mfaRecoveryCodes?.length ?? 0) - (consumed ? 1 : 0);
    await this.writeAudit(
      userId,
      AUDIT_ACTIONS.MFA_ENABLED,
      'user',
      userId,
      consumed ? 'via-recovery-code' : 'via-totp',
    );
    return { mfaEnabled: true, recoveryCodesRemaining: Math.max(0, remaining) };
  }

  /**
   * Verifies a pending MFA token (from /auth/login) plus a valid second
   * factor, and returns the verified subject so the caller can issue tokens.
   * Fails closed when the account's MFA secret is corrupt.
   */
  async verifyPending(
    mfaTempToken: string,
    code: string,
  ): Promise<{ id: string; role: Role; email: string }> {
    const subjectId = await this.resolveMfaTempToken(mfaTempToken);
    const user = await this.loadMfaUser(subjectId);
    if (!user.mfaSecret || !user.mfaEnabled) {
      // Enabled-but-missing-secret is the corrupt case: fail closed, never
      // fall back to password-only for a privileged account.
      this.logger.warn(
        `MFA verification failed closed for user ${subjectId} (no valid MFA secret)`,
      );
      throw new UnauthorizedException('MFA is misconfigured for this account');
    }
    await this.verifyCode(subjectId, code, user); // throws on wrong code / corrupt seed
    await this.writeAudit(
      subjectId,
      AUDIT_ACTIONS.MFA_VERIFIED,
      'user',
      subjectId,
      'login',
    );
    return { id: user.id, role: user.role, email: user.email };
  }

  /**
   * Disables MFA, requiring proof of a current TOTP or a recovery code first
   * (an attacker with a stolen session but no second factor cannot disable
   * MFA). Clears the seed and recovery codes.
   */
  async disableMfa(userId: string, code: string): Promise<void> {
    const user = await this.loadMfaUser(userId);
    if (!user.mfaEnabled) {
      throw new ConflictException('MFA is not enabled for this account');
    }
    if (!user.mfaSecret) {
      // Enabled but corrupt: the user is locked out of disabling until an
      // administrator resets the secret out-of-band. Fail closed + audit.
      this.logger.warn(
        `MFA disable failed closed for user ${userId} (corrupt secret)`,
      );
      throw new UnauthorizedException('MFA is misconfigured for this account');
    }
    await this.verifyCode(userId, code, user);
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaSecret: null, mfaRecoveryCodes: [], mfaEnabled: false },
    });
    await this.writeAudit(
      userId,
      AUDIT_ACTIONS.MFA_DISABLED,
      'user',
      userId,
      'user-initiated',
    );
  }

  /** Reports MFA state without ever returning the seed or the codes. */
  async status(userId: string): Promise<MfaStatus> {
    const user = await this.loadMfaUser(userId);
    return {
      mfaEnabled: user.mfaEnabled,
      recoveryCodesRemaining: user.mfaRecoveryCodes?.length ?? 0,
    };
  }

  // ---------------------------------------------------------------- privileged login

  /** True when a role must complete TOTP at login if enrolled. */
  static isPrivilegedRole(role: Role | string): boolean {
    return PRIVILEGED_ROLES.includes(role as Role);
  }

  /** True when this user's login must now present a TOTP step. */
  requiresMfaStep(user: { role: Role; mfaEnabled: boolean }): boolean {
    return MfaService.isPrivilegedRole(user.role) && user.mfaEnabled;
  }

  /**
   * Signs a short-lived, purpose-tagged token that authorises the MFA
   * completion step after a successful privileged password check. The JWT
   * signature (AUTH_JWT_SECRET) binds it; a distinct `purpose` claim keeps it
   * from being mistaken for a normal access token.
   */
  async issuePendingToken(user: {
    id: string;
    role: Role;
    email: string;
  }): Promise<string> {
    const secret = this.config.get<string>('AUTH_JWT_SECRET');
    if (!secret) {
      throw new Error('AUTH_JWT_SECRET is not configured');
    }
    return this.jwt.sign(
      {
        sub: user.id,
        role: user.role,
        email: user.email,
        purpose: 'sentravyn-mfa',
      },
      { secret, expiresIn: MFA_TEMP_TOKEN_TTL_SECONDS },
    );
  }

  /** Verifies a pending MFA token and returns the subject id, or throws 401. */
  private async resolveMfaTempToken(mfaTempToken: string): Promise<string> {
    const secret = this.config.get<string>('AUTH_JWT_SECRET');
    if (!secret) {
      // Fail closed: a missing signing secret must never open the MFA step.
      throw new UnauthorizedException('MFA is misconfigured');
    }
    let payload: { sub?: unknown; purpose?: unknown };
    try {
      payload = await this.jwt.verifyAsync(mfaTempToken, { secret });
    } catch {
      throw new UnauthorizedException('Invalid or expired MFA pending token');
    }
    if (
      payload?.purpose !== 'sentravyn-mfa' ||
      typeof payload.sub !== 'string'
    ) {
      throw new UnauthorizedException('Invalid MFA pending token');
    }
    return payload.sub;
  }

  // ---------------------------------------------------------------- verification core

  /**
   * Verifies `code` against the user's seed. TOTP first; if that fails, the
   * single-use recovery-code set. A recovery-code match consumes it (removes
   * the hash). Throws on a wrong code and, critically, throws (fail closed)
   * when the seed is not valid base32 so a corrupt/misconfigured account
   * never silently degrades. Returns true when a recovery code was consumed.
   */
  private async verifyCode(
    userId: string,
    code: string,
    user: MfaUserRecord,
  ): Promise<boolean> {
    const normalized = code.trim().toUpperCase();
    const seed = user.mfaSecret;

    // TOTP path. otplib.verify returns { valid }; a corrupt seed THROWS
    // (Invalid Base32) — we let that propagate after logging, so the caller
    // treats it as a hard auth failure (fail closed).
    if (seed) {
      try {
        const result = await otplib.verify({
          token: normalized,
          secret: seed,
          strategy: 'totp',
          period: TOTP_PERIOD_SECONDS,
          digits: TOTP_DIGITS,
          // Symmetric epoch tolerance in seconds; absorbs authenticator clock
          // drift. A TOTP match returns { valid: true }.
          epochTolerance: TOTP_EPOCH_TOLERANCE_SECONDS,
        });
        if (result.valid) {
          return false; // TOTP match; no recovery code consumed
        }
      } catch (error) {
        // Wrong-length tokens surface here; treat as a bad code, not a fault.
        if (error instanceof Error && /Token must be/.test(error.message)) {
          return this.consumeRecoveryCode(userId, normalized, user);
        }
        this.logger.warn(
          `TOTP verification error for user ${userId}: ${String(error)}`,
        );
        throw new UnauthorizedException('Invalid MFA code');
      }
    }

    // Fall through to single-use recovery codes.
    return this.consumeRecoveryCode(userId, normalized, user);
  }

  /**
   * Matches `code` against the stored sha256 recovery-code set; on a hit,
   * removes that hash (single use) and persists. Returns whether a code was
   * consumed. Throws when no code matches (a genuinely wrong code for an
   * enrolled account).
   */
  private async consumeRecoveryCode(
    userId: string,
    code: string,
    user: MfaUserRecord,
  ): Promise<boolean> {
    const candidate = sha256Hex(code);
    const set = user.mfaRecoveryCodes ?? [];
    const index = set.indexOf(candidate);
    if (index === -1) {
      throw new UnauthorizedException('Invalid MFA code');
    }
    const next = set.filter((_, i) => i !== index);
    await this.prisma.user.update({
      where: { id: userId },
      data: { mfaRecoveryCodes: next },
    });
    return true;
  }

  // ---------------------------------------------------------------- helpers

  private async loadMfaUser(userId: string): Promise<MfaUserRecord> {
    const row = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!row) {
      throw new UnauthorizedException('Invalid MFA request subject');
    }
    return {
      id: row.id,
      role: row.role,
      email: row.email,
      mfaSecret: row.mfaSecret,
      mfaEnabled: row.mfaEnabled,
      mfaRecoveryCodes: row.mfaRecoveryCodes,
    };
  }

  /** 8 human-readable single-use codes (12 chars each, unambiguous charset). */
  private generateRecoveryCodes(): string[] {
    // Charset avoids confusable 0/O/1/l/I. Rendered as 4-4-4 grouped.
    const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    const codes: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i += 1) {
      let raw = '';
      for (let j = 0; j < 12; j += 1) {
        raw += ALPHABET[randomBytes(1)[0] % ALPHABET.length];
      }
      codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`);
    }
    return codes;
  }

  private writeAudit(
    actorUserId: string,
    action: string,
    entity: string,
    entityId: string,
    detail?: string,
  ): Promise<unknown> {
    // Written directly via prisma.auditEvent (AuditModule imports AuthModule,
    // so injecting AuditService would be circular — same pattern as login).
    return this.prisma.auditEvent.create({
      data: { actorUserId, action, entity, entityId, detail: detail ?? null },
    });
  }
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
