import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { evaluateShelterPolicy } from '../shelters/shelter-policy';
import type {
  AdminReviewDecisionDto,
  QueueKind,
} from './admin-review.dto';

/**
 * Admin review service (SAFETY-POLICY.md 3, Gate E; SECURITY.md 6).
 *
 * - The review queue surfaces unverified state: quarantined/received alerts
 *   and places with shelter profiles that are not VERIFIED. It organises
 *   human review; it never asserts safety.
 *
 * - Every decision writes an immutable AdminReviewDecision row (audit
 *   trail). State changes follow only the minimum the decision implies:
 *   SHELTER_VERIFIED requires a verifying authority AND an ISO verification
 *   date (both written as evidence on the ShelterProfile and the parent
 *   Place). Without either, the request is rejected 422-style: a shelter is
 *   never verified on proximity alone (backend/src/shelters/shelter-policy.ts,
 *   Gate E). SHELTER_STALE and rejections change no state: stale display is
 *   a label computed by the display layer from dates, not a stored claim.
 *
 * - Audit mapping: REVIEW_APPROVED -> ALERT_PUBLISHED (the approval
 *   publishes the alert), SHELTER_VERIFIED -> SHELTER_VERIFIED, shelter
 *   rejections/stale -> SHELTER_REJECTED, non-shelter rejections ->
 *   ALERT_UPDATED (state changed without publishing; the constant set has
 *   no "review rejected" action, SECURITY.md 6).
 */

export type DecisionOutcome =
  | 'REVIEW_APPROVED'
  | 'REVIEW_REJECTED'
  | 'SHELTER_VERIFIED'
  | 'SHELTER_STALE';

export interface AlertQueueItem {
  alert: {
    id: string;
    externalRef: string | null;
    status: string;
    headline: string;
    issuer: string | null;
    issuedAt: string | null;
    createdAt: string;
  };
  /** RawSourceRecord provenance (ADR-007), null when the alert has no record. */
  provenance: {
    sourceUrl: string | null;
    payloadHash: string | null;
    fetchedAt: string | null;
  } | null;
  /** Source DataProvider key, null when unresolvable. */
  providerKey: string | null;
}

export interface PlaceQueueItem {
  place: {
    id: string;
    name: string;
    kind: string;
    verification: string;
  };
  shelter: {
    id: string;
    verification: string;
    inspectAuthority: string | null;
    inspectionDate: string | null;
  };
}

export interface DecideResult {
  decisionId: string;
  decision: DecisionOutcome;
  targetKind: string;
  targetId: string;
  auditAction: string;
}

/** Quarantined/received is the review surface: ADR-007 quarantine-by-default. */
const QUEUE_STATUSES: ('QUARANTINED' | 'RECEIVED')[] = ['QUARANTINED', 'RECEIVED'];

const QUEUE_TAKE = 200;

@Injectable()
export class AdminReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Review queue by kind.
   * - 'alerts': QUARANTINED or RECEIVED alerts with source-record provenance
   *   and source provider key.
   * - 'places': ShelterProfiles not VERIFIED, joined to their Place.
   */
  async queue(kind: QueueKind): Promise<AlertQueueItem[] | PlaceQueueItem[]> {
    if (kind === 'alerts') {
      return this.alertQueue();
    }
    if (kind === 'places') {
      return this.placeQueue();
    }
    throw new BadRequestException(`unknown queue kind: ${String(kind)}`);
  }

  /**
   * Records a review decision (actor = the authenticated user).
   *
   * SHELTER_VERIFIED without an authority and ISO verification date is
   * rejected before any write (Gate E; shelter-policy.ts).
   */
  async decide(
    user: { id: string },
    dto: AdminReviewDecisionDto,
  ): Promise<DecideResult> {
    const { kind, id } = dto.target;
    let targetFound: boolean;

    switch (kind) {
      case 'alert': {
        const alert = await this.prisma.alert.findUnique({
          where: { id },
          select: { id: true },
        });
        targetFound = alert !== null;
        break;
      }
      case 'place': {
        const place = await this.prisma.place.findUnique({
          where: { id },
          select: { id: true },
        });
        targetFound = place !== null;
        break;
      }
      case 'shelter': {
        const shelter = await this.prisma.shelterProfile.findUnique({
          where: { id },
          select: { id: true, placeId: true, classification: true },
        });
        targetFound = shelter !== null;
        if (shelter !== null && dto.decision === 'SHELTER_VERIFIED') {
          const authority = dto.authority?.trim();
          const verificationDate = dto.verificationDate?.trim();
          if (!authority || !verificationDate) {
            throw new BadRequestException(
              'SHELTER_VERIFIED requires a verifying authority and an ISO ' +
                'verification date; a shelter is never verified on proximity ' +
                'alone (shelter-policy.ts, Gate E).',
            );
          }
          const inspectionDate = new Date(verificationDate);
          if (Number.isNaN(inspectionDate.getTime())) {
            throw new BadRequestException(
              'verificationDate must be a valid ISO 8601 date string.',
            );
          }
          // Gate E (shelter-policy.ts): the full shelter policy contract must
          // pass, not just authority + date. The approver here is guaranteed
          // privileged: the controller's @Roles('REVIEWER','OPERATOR','ADMIN')
          // restricts this endpoint, so no role re-check is done in the
          // service.
          const policy = evaluateShelterPolicy({
            evidence: {
              authority,
              classification: shelter.classification,
              verificationDate,
              expiresAt: null,
              revalidationWindowDays: undefined,
            },
            approval: {
              approvedBy: user.id,
              approverPrivileged: true,
            },
            now: new Date(),
          });
          if (!policy.canDisplayAsVerified) {
            throw new BadRequestException(
              'SHELTER_VERIFIED rejected by shelter policy: ' +
                policy.reasons.join('; ') +
                ' (shelter-policy.ts, Gate E).',
            );
          }
          await this.prisma.$transaction([
            this.prisma.shelterProfile.update({
              where: { id },
              data: {
                verification: 'VERIFIED',
                inspectAuthority: authority,
                inspectionDate,
              },
            }),
            this.prisma.place.update({
              where: { id: shelter.placeId },
              data: {
                verification: 'VERIFIED',
                sourceAuthority: authority,
              },
            }),
          ]);
        }
        break;
      }
      default:
        throw new BadRequestException(`unknown target kind: ${String(kind)}`);
    }

    if (!targetFound) {
      throw new NotFoundException(
        `${kind} not found for decision: ${id}`,
      );
    }

    if (kind === 'alert' && dto.decision === 'REVIEW_APPROVED') {
      // The NotFound check above guarantees targetFound here.
      // REVIEW_APPROVED publishes the alert: the approval must flip the alert
      // row to PUBLISHED in the same transaction as the decision row, so the
      // ALERT_PUBLISHED audit event below asserts a state change that is
      // actually persisted (SAFETY-POLICY.md 3, SECURITY.md 6).
      const publishedAt = new Date();
      const transactionResult = await this.prisma.$transaction([
        this.prisma.alert.update({
          where: { id },
          data: { status: 'PUBLISHED', publishedAt },
        }),
        this.prisma.adminReviewDecision.create({
          data: {
            ...decisionTargetData(kind, id),
            decision: dto.decision,
            rationale: dto.rationale ?? null,
            actor: { connect: { id: user.id } },
          },
        }),
      ]);
      await this.audit.record(
        user.id,
        AUDIT_ACTIONS.ALERT_PUBLISHED,
        kind,
        id,
        JSON.stringify({
          decision: dto.decision,
          rationale: dto.rationale ?? null,
          authority: dto.authority ?? null,
          verificationDate: dto.verificationDate ?? null,
        }),
      );
      return {
        // The decision row is the second op of the transaction.
        decisionId: transactionResult[1].id,
        decision: dto.decision,
        targetKind: kind,
        targetId: id,
        auditAction: AUDIT_ACTIONS.ALERT_PUBLISHED,
      };
    }

    const decisionRow = await this.prisma.adminReviewDecision.create({
      data: {
        ...decisionTargetData(kind, id),
        decision: dto.decision,
        rationale: dto.rationale ?? null,
        actor: { connect: { id: user.id } },
      },
    });

    const auditAction = auditActionForDecision(dto.decision, kind);
    await this.audit.record(
      user.id,
      auditAction,
      kind,
      id,
      JSON.stringify({
        decision: dto.decision,
        rationale: dto.rationale ?? null,
        authority: dto.authority ?? null,
        verificationDate: dto.verificationDate ?? null,
      }),
    );

    return {
      decisionId: decisionRow.id,
      decision: dto.decision,
      targetKind: kind,
      targetId: id,
      auditAction,
    };
  }

  private async alertQueue(): Promise<AlertQueueItem[]> {
    const rows = await this.prisma.alert.findMany({
      where: {
        status: { in: QUEUE_STATUSES },
      },
      orderBy: { createdAt: 'desc' },
      take: QUEUE_TAKE,
      select: {
        id: true,
        externalRef: true,
        status: true,
        headline: true,
        issuer: true,
        issuedAt: true,
        createdAt: true,
        sourceRecord: {
          select: { providerId: true, sourceUrl: true, payloadHash: true, fetchedAt: true },
        },
      },
    });

    // One batched lookup for provider keys (Alert has no provider relation;
    // providerId rides on the source record).
    const providerIds = [
      ...new Set(rows.map((r) => r.sourceRecord?.providerId).filter(
        (v): v is string => typeof v === 'string',
      )),
    ];
    const providerKeyById = new Map<string, string>();
    if (providerIds.length > 0) {
      const providers = await this.prisma.dataProvider.findMany({
        where: { id: { in: providerIds } },
        select: { id: true, key: true },
      });
      for (const p of providers) {
        providerKeyById.set(p.id, p.key);
      }
    }

    return rows.map((r): AlertQueueItem => ({
      alert: {
        id: r.id,
        externalRef: r.externalRef,
        status: r.status,
        headline: r.headline,
        issuer: r.issuer,
        issuedAt: r.issuedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      },
      provenance: r.sourceRecord
        ? {
            sourceUrl: r.sourceRecord.sourceUrl,
            payloadHash: r.sourceRecord.payloadHash,
            fetchedAt: r.sourceRecord.fetchedAt.toISOString(),
          }
        : null,
      providerKey:
        r.sourceRecord?.providerId != null
          ? (providerKeyById.get(r.sourceRecord.providerId) ?? null)
          : null,
    }));
  }

  private async placeQueue(): Promise<PlaceQueueItem[]> {
    const rows = await this.prisma.shelterProfile.findMany({
      where: { verification: { not: 'VERIFIED' } },
      take: QUEUE_TAKE,
      select: {
        id: true,
        verification: true,
        inspectAuthority: true,
        inspectionDate: true,
        place: {
          select: { id: true, name: true, kind: true, verification: true },
        },
      },
    });

    return rows.map(
      (r): PlaceQueueItem => ({
        place: {
          id: r.place.id,
          name: r.place.name,
          kind: r.place.kind,
          verification: r.place.verification,
        },
        shelter: {
          id: r.id,
          verification: r.verification,
          inspectAuthority: r.inspectAuthority,
          inspectionDate: r.inspectionDate?.toISOString() ?? null,
        },
      }),
    );
  }
}

/**
 * Maps a decision outcome to the canonical audit action. Shelter outcomes
 * map to the shelter actions; the REVIEW_APPROVED -> ALERT_PUBLISHED
 * mapping is alert-centric, which matches the constant set available to
 * the caller (SECURITY.md 6).
 */
function auditActionForDecision(
  decision: DecisionOutcome,
  targetKind: string,
): string {
  switch (decision) {
    case 'REVIEW_APPROVED':
      return AUDIT_ACTIONS.ALERT_PUBLISHED;
    case 'REVIEW_REJECTED':
      return targetKind === 'shelter'
        ? AUDIT_ACTIONS.SHELTER_REJECTED
        : AUDIT_ACTIONS.ALERT_UPDATED;
    case 'SHELTER_VERIFIED':
      return AUDIT_ACTIONS.SHELTER_VERIFIED;
    case 'SHELTER_STALE':
      return AUDIT_ACTIONS.SHELTER_REJECTED;
    default:
      return AUDIT_ACTIONS.ALERT_UPDATED;
  }
}

/**
 * The decision target as a Prisma relation connect. The target ids are plain
 * (non-unique) FK columns, so once the @relation is modelled the Prisma
 * create input takes `alert`/`place`/`shelter` connect objects, not the bare
 * scalar (Gate C referential integrity). Exactly one is set, matching the
 * decision target.
 */
function decisionTargetData(
  kind: string,
  id: string,
):
  | { alert: { connect: { id: string } } }
  | { place: { connect: { id: string } } }
  | { shelter: { connect: { id: string } } } {
  switch (kind) {
    case 'alert':
      return { alert: { connect: { id } } };
    case 'place':
      return { place: { connect: { id } } };
    case 'shelter':
      return { shelter: { connect: { id } } };
    default:
      throw new BadRequestException(`unknown target kind: ${String(kind)}`);
  }
}
