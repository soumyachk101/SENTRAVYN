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
  /**
   * Records a user-submitted place evidence row (POST /places/:id/evidence).
   * The submission is stored and audited (SAFETY-POLICY.md section 9) but it
   * NEVER mutates place/shelter verification state.
   */
  PLACE_EVIDENCE_ADDED: 'PLACE_EVIDENCE_ADDED',
  PROVIDER_CHANGED: 'PROVIDER_CHANGED',
  USER_ROLE_CHANGED: 'USER_ROLE_CHANGED',
  SESSION_REVOKED: 'SESSION_REVOKED',
  /** Records a refresh-token rotation (new hash + fresh expiry on an in-flight session). */
  SESSION_REFRESHED: 'SESSION_REFRESHED',
  /**
   * A safety guide entered IN_REVIEW: a named reviewer/authority recorded
   * and lastReviewedAt stamped (SAFETY-POLICY.md 10). Detail carries the
   * from/to state, reviewer, authority, review date and version.
   */
  GUIDE_REVIEWED: 'GUIDE_REVIEWED',
  /**
   * A safety guide cleared the completeness gate and moved
   * IN_REVIEW -> APPROVED: reviewer + authority + a non-empty references
   * array + hazardType are all present.
   */
  GUIDE_APPROVED: 'GUIDE_APPROVED',
  /**
   * An approved safety guide moved APPROVED -> PUBLISHED and became
   * visible on the public surface (SAFETY-POLICY.md 10).
   */
  GUIDE_PUBLISHED: 'GUIDE_PUBLISHED',
  /**
   * A published safety guide moved PUBLISHED -> RETIRED and dropped out of
   * the public surface; content is surfaced as retired, never silently
   * hidden (SAFETY-POLICY.md 8).
   */
  GUIDE_RETIRED: 'GUIDE_RETIRED',
  /**
   * Privileged content writes on a safety guide: create (DRAFT, v1 + first
   * revision), new revision (version bump), or a RETIRED -> DRAFT reopen.
   */
  GUIDE_UPDATED: 'GUIDE_UPDATED',
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
