import { Injectable, Logger } from '@nestjs/common';
import type { AlertStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { SyncItem, SyncResult } from './types';

/**
 * Durable reconnect sync (Phase 6; ARCHITECTURE.md 6 step 6).
 *
 * The cursor is an opaque base64(JSON) token that encodes the client's last
 * seen position in a stable total order over the public feed:
 *
 *     (createdAt, alertId, revision)
 *
 * Prisma's default UUIDs are NOT monotonic, so we cannot order by `id`.
 * Ordering by the composite key above is deterministic: it is unique within
 * one Prisma instance (Postgres `now()` has sub-microsecond granularity,
 * and the alertId + revision tie-break the same instant). The cursor is
 * encoded into an opaque token so clients never see the internals and can
 * carry it across a reconnect / a full page refresh.
 *
 * Only revisions belonging to PUBLISHED or UPDATED alerts are synced:
 * quarantined, received, expired and cancelled state is a review concern
 * and is not pushed to the public live feed (SAFETY-POLICY: never surface
 * unverified content as live).
 */
const SYNC_STATUSES = ['PUBLISHED', 'UPDATED'] as const satisfies AlertStatus[];
const PAGE_SIZE = 100;

/** The shape one synced revision row reads back as (select projection). */
interface SyncRow {
  id: string;
  revision: number;
  status: AlertStatus;
  createdAt: Date;
  alert: {
    id: string;
    headline: string;
    severity: string | null;
    urgency: string | null;
    issuer: string | null;
    issuedAt: Date | null;
  };
}

interface CursorFields {
  c: string; // createdAt ISO string
  a: string; // alertId
  r: number; // revision
}

/** Encode a cursor from the last item the client has. */
export function encodeCursor(item: SyncItem): string {
  const fields: CursorFields = {
    c: item.createdAt,
    a: item.alertId,
    r: item.revision,
  };
  return Buffer.from(JSON.stringify(fields), 'utf8').toString('base64url');
}

/** Decode + validate a cursor token. Returns null for anything malformed. */
export function decodeCursor(cursor: string | null | undefined): CursorFields | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw) as Partial<CursorFields>;
    if (
      typeof parsed.c === 'string' &&
      !Number.isNaN(Date.parse(parsed.c)) &&
      typeof parsed.a === 'string' &&
      typeof parsed.r === 'number'
    ) {
      return { c: parsed.c, a: parsed.a, r: parsed.r };
    }
    return null;
  } catch {
    return null;
  }
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sync since a cursor.
   *
   * @param cursor an opaque cursor from a previous `nextCursor`, or null /
   *   an empty string for "from the latest tail". A malformed cursor is
   *   reported via `cursorKnown: false` and falls back to the latest page
   *   so a stale or forged client still receives current data, not an error.
   */
  async since(cursor: string | null, pageSize: number = PAGE_SIZE): Promise<SyncResult> {
    const take = Math.min(Math.max(pageSize, 1), PAGE_SIZE);

    const decoded = decodeCursor(cursor);
    if (!decoded) {
      const items = await this.latestPage(take);
      return this.toResult(cursor === null ? true : false, items, take);
    }

    // Strictly-after composite key. A cursor that points at a row that was
    // since removed/never-published still yields "everything after it".
    const rows = await this.prisma.alertRevision.findMany({
      where: {
        status: { in: SYNC_STATUSES },
        alert: { status: { in: SYNC_STATUSES } },
        OR: [
          { createdAt: { gt: new Date(decoded.c) } },
          { createdAt: new Date(decoded.c), alertId: { gt: decoded.a } },
          {
            createdAt: new Date(decoded.c),
            alertId: decoded.a,
            revision: { gt: decoded.r },
          },
        ],
      },
      orderBy: [
        { createdAt: 'asc' },
        { alertId: 'asc' },
        { revision: 'asc' },
      ],
      take,
      select: {
        id: true,
        revision: true,
        status: true,
        createdAt: true,
        alert: {
          select: {
            id: true,
            headline: true,
            severity: true,
            urgency: true,
            issuer: true,
            issuedAt: true,
          },
        },
      },
    });
    const items = (rows as unknown as SyncRow[]).map(toSyncItem);
    return this.toResult(true, items, take);
  }

  /** Latest tail of the public feed (no cursor), returned oldest-first. */
  private async latestPage(take: number) {
    const rows = await this.prisma.alertRevision.findMany({
      where: {
        status: { in: SYNC_STATUSES },
        alert: { status: { in: SYNC_STATUSES } },
      },
      orderBy: [
        { createdAt: 'desc' },
        { alertId: 'desc' },
        { revision: 'desc' },
      ],
      take,
      select: {
        id: true,
        revision: true,
        status: true,
        createdAt: true,
        alert: {
          select: {
            id: true,
            headline: true,
            severity: true,
            urgency: true,
            issuer: true,
            issuedAt: true,
          },
        },
      },
    });
    // Newest-first rows; return them oldest-first so the cursor (last item
    // id) advances monotonically across pages.
    return (rows as unknown as SyncRow[]).reverse().map(toSyncItem);
  }

  private toResult(cursorKnown: boolean, items: SyncItem[], take: number): SyncResult {
    const hasMore = items.length === take && items.length > 0;
    return {
      cursorKnown,
      items,
      nextCursor: items.length > 0 ? encodeCursor(items[items.length - 1]) : null,
      hasMore,
    };
  }
}

function toSyncItem(row: {
  id: string;
  revision: number;
  status: string;
  createdAt: Date;
  alert: {
    id: string;
    headline: string;
    severity: string | null;
    urgency: string | null;
    issuer: string | null;
    issuedAt: Date | null;
  };
}): SyncItem {
  return {
    alertId: row.alert.id,
    revision: row.revision,
    status: row.status,
    headline: row.alert.headline,
    severity: row.alert.severity,
    urgency: row.alert.urgency,
    issuer: row.alert.issuer,
    issuedAt: row.alert.issuedAt?.toISOString() ?? null,
    cursor: row.id, // row id is the *item* identifier; the *cursor* is encoded
    createdAt: row.createdAt.toISOString(),
  };
}
