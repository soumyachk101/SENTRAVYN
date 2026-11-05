import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_FRESHNESS_POLICY_HOURS,
  evaluateFreshness,
  FreshnessResult,
} from '../common/freshness';

/**
 * The alert states the public list may surface by default, and the only states
 * a caller may explicitly request via ?status= (SAFETY-POLICY.md 7;
 * DATA-SOURCES.md integration stage 6; ADR-007 quarantine-by-default).
 *
 * A VALIDATED alert is a schema-valid record from an explicitly-enabled,
 * legally-reviewed provider (the registry ships disabled by default), so it is
 * public-safe. SAFETY-POLICY.md 7 forbids public publication of *malformed or
 * suspicious* records, which are held in QUARANTINED for human review — and the
 * pipeline intermediates RECEIVED/PARSED are never written to the Alert row by
 * the current ingest path. PUBLISHED is the reviewer-published state; UPDATED,
 * EXPIRED and CANCELLED are lifecycle advances / de-escalations, and showing a
 * cancellation or expiry can never present an unsafe instruction as active.
 *
 * The complement of this set (RECEIVED, PARSED, QUARANTINED) is never
 * surfaced to the public list.
 */
export const PUBLIC_ALERT_STATUSES = [
  'VALIDATED',
  'PUBLISHED',
  'UPDATED',
  'EXPIRED',
  'CANCELLED',
] as const;

export interface AlertListQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  verification?: string;
}

export interface AlertResponse {
  id: string;
  externalRef: string | null;
  status: string;
  verification: string;
  informationClass: string;
  headline: string;
  issuer: string | null;
  severity: string | null;
  urgency: string | null;
  certainty: string | null;
  issuedAt: string | null;
  effectiveAt: string | null;
  expiresAt: string | null;
  publishedAt: string | null;
  freshness: FreshnessResult;
  createdAt: string;
  updatedAt: string;
}

/** One alert revision (ADR-005 update/cancel history). */
export interface AlertRevisionView {
  revision: number;
  status: string;
  body: string | null;
  /** ISO 8601. */
  createdAt: string;
}

/**
 * Source provenance of an alert (ADR-007 quarantine-by-default, immutable
 * RawSourceRecord). `providerKey` is null when the underlying DataProvider
 * row was deleted; the nested `provider` carries the registry row's display
 * fields, or null in that case.
 */
export interface AlertProvenanceView {
  sourceRecordId: string;
  sourceUrl: string | null;
  payloadHash: string;
  /** ISO 8601. */
  fetchedAt: string;
  providerKey: string | null;
  provider: {
    name: string;
    docUrl: string | null;
    license: string | null;
    attribution: string | null;
    enabled: boolean;
    freshnessPolicyHours: number | null;
  } | null;
}

/**
 * Single-alert detail payload: the alert itself, its revision history and
 * its source provenance (SAFETY-POLICY.md 8 freshness, ADR-007 provenance).
 */
export interface AlertDetail {
  alert: AlertResponse;
  /** Revision history in ascending revision order. */
  revisions: AlertRevisionView[];
  /** null when the alert has no source record. */
  provenance: AlertProvenanceView | null;
}

/** The columns AlertsService reads, independent of the generated Prisma model. */
interface AlertRecord {
  id: string;
  externalRef: string | null;
  status: string;
  verification: string;
  informationClass: string;
  headline: string;
  issuer: string | null;
  severity: string | null;
  urgency: string | null;
  certainty: string | null;
  issuedAt: Date | null;
  effectiveAt: Date | null;
  expiresAt: Date | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AlertsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lists public alerts with pagination and explicit freshness labels.
   *
   * By default only public-safe states (PUBLISHED, CANCELLED, EXPIRED — see
   * PUBLIC_ALERT_STATUSES) are returned, so quarantined and unreviewed
   * records never surface to the public list (ADR-007 quarantine-by-default).
   * Stale/expired alerts are surfaced, never hidden as live: freshness is
   * computed per row and returned in the payload.
   */
  async list(query: AlertListQuery) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));

    const where: Prisma.AlertWhereInput = {};
    if (query.status) {
      // An explicit status must be one of the public-safe states: a caller may
      // narrow the public list but may never use ?status= to surface a
      // quarantined/unreviewed record.
      if (!(PUBLIC_ALERT_STATUSES as readonly string[]).includes(query.status)) {
        throw new BadRequestException(
          `status must be one of: ${PUBLIC_ALERT_STATUSES.join(', ')}`,
        );
      }
      where.status = query.status as Prisma.AlertWhereInput['status'];
    } else {
      where.status = { in: [...PUBLIC_ALERT_STATUSES] };
    }
    if (query.verification) {
      where.verification =
        query.verification as Prisma.AlertWhereInput['verification'];
    }

    const [total, items] = await this.prisma.$transaction([
      this.prisma.alert.count({ where }),
      this.prisma.alert.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const data = (items as unknown as AlertRecord[]).map(toAlertResponse);
    return { items: data, pagination: { page, pageSize, total } };
  }

  async getOne(id: string): Promise<AlertResponse | null> {
    const alert = await this.prisma.alert.findUnique({ where: { id } });
    if (!alert) return null;
    return toAlertResponse(alert as unknown as AlertRecord);
  }

  /**
   * Single-alert detail: the alert, its revision history (ADR-005) and its
   * source-record provenance (ADR-007).
   *
   * Freshness uses the source provider's freshness policy: the alert's
   * source record points at the owning DataProvider row, whose
   * `freshnessPolicyHours` is passed to evaluateFreshness. Fallback to
   * DEFAULT_FRESHNESS_POLICY_HOURS happens when the alert has no source
   * record, the provider row was deleted, or the row has no policy set -
   * never throwing, since a deleted registry row must not break the read.
   */
  async getDetail(id: string): Promise<AlertDetail | null> {
    const alert = await this.prisma.alert.findUnique({
      where: { id },
      select: {
        id: true,
        externalRef: true,
        status: true,
        verification: true,
        informationClass: true,
        headline: true,
        issuer: true,
        severity: true,
        urgency: true,
        certainty: true,
        issuedAt: true,
        effectiveAt: true,
        expiresAt: true,
        publishedAt: true,
        createdAt: true,
        updatedAt: true,
        sourceRecord: {
          select: {
            id: true,
            providerId: true,
            sourceUrl: true,
            payloadHash: true,
            fetchedAt: true,
          },
        },
      },
    });
    if (!alert) return null;

    const { sourceRecord, ...base } = alert;

    // Independent reads: provider lookup (only when a source record exists)
    // and the full revision history, in ascending revision order.
    const [provider, revisions] = await Promise.all([
      sourceRecord
        ? this.prisma.dataProvider.findUnique({
            where: { id: sourceRecord.providerId },
          })
        : Promise.resolve(null),
      this.prisma.alertRevision.findMany({
        where: { alertId: id },
        orderBy: { revision: 'asc' },
      }),
    ]);

    const policyHours =
      provider?.freshnessPolicyHours ?? DEFAULT_FRESHNESS_POLICY_HOURS;
    const response = toAlertResponse(
      base as unknown as AlertRecord,
      policyHours,
    );

    const provenance: AlertProvenanceView | null = sourceRecord
      ? {
          sourceRecordId: sourceRecord.id,
          sourceUrl: sourceRecord.sourceUrl,
          payloadHash: sourceRecord.payloadHash,
          fetchedAt: sourceRecord.fetchedAt.toISOString(),
          providerKey: provider?.key ?? null,
          provider: provider
            ? {
                name: provider.name,
                docUrl: provider.docUrl,
                license: provider.license,
                attribution: provider.attribution,
                enabled: provider.enabled,
                freshnessPolicyHours: provider.freshnessPolicyHours,
              }
            : null,
        }
      : null;

    return {
      alert: response,
      revisions: revisions.map((r) => ({
        revision: r.revision,
        status: r.status,
        body: r.body,
        createdAt: r.createdAt.toISOString(),
      })),
      provenance,
    };
  }
}

function toAlertResponse(r: AlertRecord, policyHours?: number): AlertResponse {
  const freshness = evaluateFreshness({
    updatedAt: r.publishedAt ?? r.issuedAt,
    expiresAt: r.expiresAt,
    policyHours,
  });
  return {
    id: r.id,
    externalRef: r.externalRef,
    status: r.status,
    verification: r.verification,
    informationClass: r.informationClass,
    headline: r.headline,
    issuer: r.issuer,
    severity: r.severity,
    urgency: r.urgency,
    certainty: r.certainty,
    issuedAt: r.issuedAt?.toISOString() ?? null,
    effectiveAt: r.effectiveAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    freshness,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
