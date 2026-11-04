import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { evaluateFreshness, FreshnessResult } from '../common/freshness';

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
   * Lists alerts with pagination and explicit freshness labels.
   * Stale/expired alerts are surfaced, never hidden as live.
   */
  async list(query: AlertListQuery) {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));

    const where: Prisma.AlertWhereInput = {};
    if (query.status) {
      where.status = query.status as Prisma.AlertWhereInput['status'];
    }
    if (query.verification) {
      where.verification = query.verification as Prisma.AlertWhereInput['verification'];
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
}

function toAlertResponse(r: AlertRecord): AlertResponse {
  const freshness = evaluateFreshness({
    updatedAt: r.publishedAt ?? r.issuedAt,
    expiresAt: r.expiresAt,
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
