import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuditListQuery } from './audit.controller';

/**
 * Canonical audit action names (SAFETY-POLICY.md: every security-relevant
 * mutation leaves a traceable record). Values equal their keys so existing
 * call sites can reference AUDIT_ACTIONS.ALERT_PUBLISHED instead of
 * hardcoding strings.
 */
export const AUDIT_ACTIONS = {
  ALERT_PUBLISHED: 'ALERT_PUBLISHED',
  ALERT_UPDATED: 'ALERT_UPDATED',
  ALERT_CANCELLED: 'ALERT_CANCELLED',
  SHELTER_VERIFIED: 'SHELTER_VERIFIED',
  SHELTER_REJECTED: 'SHELTER_REJECTED',
  PROVIDER_CHANGED: 'PROVIDER_CHANGED',
  USER_ROLE_CHANGED: 'USER_ROLE_CHANGED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  /** Records a refresh-token rotation (new hash + fresh expiry on an in-flight session). */
  SESSION_REFRESHED: 'SESSION_REFRESHED',
  /** Credential-compromise path: every active session for a user is revoked. */
  SESSION_REVOKED_ALL: 'SESSION_REVOKED_ALL',
  /** MFA: a TOTP seed + 8 single-use recovery codes were issued to an account. */
  MFA_SETUP: 'MFA_SETUP',
  /** MFA: enrolment confirmed (valid TOTP/recovery code); privileged login now gated. */
  MFA_ENABLED: 'MFA_ENABLED',
  /** MFA: a valid second factor was accepted during the privileged login step 2. */
  MFA_VERIFIED: 'MFA_VERIFIED',
  /** MFA: an account's MFA was disabled (user-initiated, requires a valid code). */
  MFA_DISABLED: 'MFA_DISABLED',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

const DETAIL_MAX_LENGTH = 2000;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Records one audit event. `actorUserId` may be null for system-driven
   * actions (e.g. provider ingestion); `detail` is capped, never elided.
   */
  async record(
    actorUserId: string | null,
    action: string,
    entity: string,
    entityId: string | null,
    detail?: string,
  ): Promise<void> {
    await this.prisma.auditEvent.create({
      data: {
        actorUserId,
        action,
        entity,
        entityId,
        detail: this.sanitize(detail),
      },
    });
  }

  /**
   * Returns the most recent audit events, newest first, optionally filtered
   * by entity. Default page size 100, capped at 200 (DTO validation).
   */
  async list(query: AuditListQuery) {
    const limit = Math.min(200, Math.max(1, Number(query.limit ?? 100)));
    const where: Prisma.AuditEventWhereInput = {};
    if (query.entity) {
      where.entity = query.entity;
    }
    return this.prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Caps detail at 2000 chars so an oversized field cannot bloat the log
   * row. Deliberately strips nothing else: audit detail may contain user
   * submissions that must be preserved verbatim for forensics.
   */
  private sanitize(detail: string | undefined): string | null {
    if (detail === undefined) {
      return null;
    }
    return detail.length > DETAIL_MAX_LENGTH
      ? detail.slice(0, DETAIL_MAX_LENGTH)
      : detail;
  }
}
