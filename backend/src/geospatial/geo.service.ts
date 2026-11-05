import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  resolveVerificationLabel,
  ShelterProfileVerification,
  VerificationLabel,
} from '../shelters/shelter-policy';

/**
 * Radius search input. `radiusMeters` is clamped to [100, 500_000] and
 * `limit` to [1, 200] inside `nearby` - the service is the boundary; a
 * controller head re-validates its own inputs too.
 */
export interface NearbyQuery {
  lat: number;
  lng: number;
  radiusMeters: number;
  kind?: string;
  limit: number;
}

/**
 * One place row returned by `nearby`. `distanceMeters` is a geodetic metre
 * value (geography type, ADR-004). Trust-model fields are passed through
 * verbatim so callers render verification and freshness; nearby is never
 * 'safe' (ADR-006). `verificationLabel` is the read-path display label
 * computed by the shelter policy (SAFETY-POLICY.md 8): it downgrades a stored
 * VERIFIED place to STALE/EXPIRED/INCOMPLETE when the evidence is no longer
 * current, so a lapsed shelter can never be surfaced as verified.
 */
export interface PlaceGeoRow {
  id: string;
  name: string;
  kind: string;
  verification: string;
  operationalStatus: string | null;
  operationalEvidence: string | null;
  staleSince: string | null;
  lat: number | null;
  lng: number | null;
  distanceMeters: number;
  /** The display label the read path must show (never fabricates VERIFIED). */
  verificationLabel: VerificationLabel;
  /** Human-readable reasons the label is not plain VERIFIED (empty when it is). */
  verificationLabelReasons: string[];
}

/** The raw PostGIS SELECT shape, before the verification label is annotated. */
interface PlaceGeoRowBase {
  id: string;
  name: string;
  kind: string;
  verification: string;
  operationalStatus: string | null;
  operationalEvidence: string | null;
  staleSince: string | null;
  lat: number | null;
  lng: number | null;
  distanceMeters: number;
}

@Injectable()
export class GeoService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Places with a known location within `radiusMeters` of (lat, lng), nearest
   * first. Places whose PostGIS location is NULL are excluded: an unknown
   * location never ranks as 'near'.
   *
   * Both variants use Prisma tagged-template `$queryRaw`: ${...}
   * interpolations are bound as positional parameters in source order, so no
   * user input is ever concatenated into the SQL text (ADR-004). The `kind`
   * filter is a separate tagged query, not a dynamically built SQL string.
   */
  async nearby(query: NearbyQuery): Promise<PlaceGeoRow[]> {
    const radiusMeters = clamp(query.radiusMeters, 100, 500_000);
    const limit = clamp(query.limit, 1, 200);
    const { lat, lng, kind } = query;

    const rows =
      kind !== undefined && kind !== ''
        ? await this.nearbyWithKind({ lat, lng, radiusMeters, kind, limit })
        : await this.nearbyAnyKind({ lat, lng, radiusMeters, limit });

    return this.annotateVerificationLabels(rows);
  }

  /**
   * Radius search filtered by place kind.
   *
   * Bind order (source order of the ${...} interpolations):
   * lng, lat, radiusMeters, kind, limit. ST_MakePoint(x = lng, y = lat).
   */
  private async nearbyWithKind(q: {
    lat: number;
    lng: number;
    radiusMeters: number;
    kind: string;
    limit: number;
  }): Promise<PlaceGeoRowBase[]> {
    return this.prisma.$queryRaw<PlaceGeoRowBase[]>`
      SELECT p."id", p."name", p."kind", p."verification", p."operationalStatus",
             p."operationalEvidence", p."staleSince"::text, p."lat", p."lng",
             ST_Distance(p."location", ST_SetSRID(ST_MakePoint(${q.lng}, ${q.lat}), 4326)::geography) AS "distanceMeters"
      FROM "Place" p
      WHERE p."location" IS NOT NULL
        AND ST_DWithin(p."location", ST_SetSRID(ST_MakePoint(${q.lng}, ${q.lat}), 4326)::geography, ${q.radiusMeters})
        AND p."kind" = ${q.kind}
      ORDER BY "distanceMeters" ASC
      LIMIT ${q.limit}
    `;
  }

  /**
   * Radius search across all place kinds.
   *
   * Bind order (source order of the ${...} interpolations):
   * lng, lat, radiusMeters, limit.
   */
  private async nearbyAnyKind(q: {
    lat: number;
    lng: number;
    radiusMeters: number;
    limit: number;
  }): Promise<PlaceGeoRowBase[]> {
    return this.prisma.$queryRaw<PlaceGeoRowBase[]>`
      SELECT p."id", p."name", p."kind", p."verification", p."operationalStatus",
             p."operationalEvidence", p."staleSince"::text, p."lat", p."lng",
             ST_Distance(p."location", ST_SetSRID(ST_MakePoint(${q.lng}, ${q.lat}), 4326)::geography) AS "distanceMeters"
      FROM "Place" p
      WHERE p."location" IS NOT NULL
        AND ST_DWithin(p."location", ST_SetSRID(ST_MakePoint(${q.lng}, ${q.lat}), 4326)::geography, ${q.radiusMeters})
      ORDER BY "distanceMeters" ASC
      LIMIT ${q.limit}
    `;
  }

  /**
   * Annotates each place row with the read-path verification label.
   *
   * The stored Place.verification is never trusted on its own for a verified
   * place: a VERIFIED place whose shelter evidence has lapsed must be shown
   * as STALE / EXPIRED / INCOMPLETE (SAFETY-POLICY.md 8, Gate E). The label
   * is computed by the pure, unit-tested resolveVerificationLabel from the
   * shelter policy module.
   *
   * Shelter profiles for the returned places are fetched in one bounded query
   * (the result set is already capped at `limit` <= 200), so no row fan-out
   * and no unbounded query is introduced.
   */
  private async annotateVerificationLabels(
    rows: PlaceGeoRowBase[],
  ): Promise<PlaceGeoRow[]> {
    if (rows.length === 0) return [];

    const placeIds = rows.map((r) => r.id);
    const profiles = await this.prisma.shelterProfile.findMany({
      where: { placeId: { in: placeIds } },
      select: {
        placeId: true,
        verification: true,
        inspectionDate: true,
        expiresAt: true,
      },
    });

    const profilesByPlace = new Map<string, ShelterProfileVerification[]>();
    for (const p of profiles) {
      const list = profilesByPlace.get(p.placeId) ?? [];
      list.push({
        verification: p.verification,
        inspectionDate: p.inspectionDate?.toISOString() ?? null,
        expiresAt: p.expiresAt?.toISOString() ?? null,
      });
      profilesByPlace.set(p.placeId, list);
    }

    return rows.map((r) => {
      const resolved = resolveVerificationLabel({
        placeVerification: r.verification,
        staleSince: r.staleSince,
        shelterProfiles: profilesByPlace.get(r.id) ?? [],
      });
      return {
        ...r,
        verificationLabel: resolved.label,
        verificationLabelReasons: resolved.reasons,
      };
    });
  }

  /**
   * Updates the editable lat/lng columns and the derived PostGIS location
   * atomically (ADR-004: lat/lng remain the source of truth, location is the
   * derived index column). Returns true when the place existed, false when
   * the id was unknown. Both statements run in one $transaction.
   */
  async updatePlaceLocation(placeId: string, lat: number, lng: number): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.place.updateMany({
        where: { id: placeId },
        data: { lat, lng },
      });
      // Bind order (source order of the ${...} interpolations):
      // lng, lat, placeId. ST_MakePoint(x = lng, y = lat).
      await tx.$queryRaw`
        UPDATE "Place"
        SET "location" = ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography
        WHERE "id" = ${placeId}
      `;
      return count > 0;
    });
  }

  /**
   * Fills any missing location from the staged lat/lng columns. Idempotent:
   * only rows where location IS NULL and both coordinates are present are
   * touched, so rerunning it changes nothing. Returns the number of rows
   * backfilled.
   */
  async backfillLocations(): Promise<number> {
    const result = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "Place"
      SET "location" = ST_SetSRID(ST_MakePoint("lng", "lat"), 4326)::geography
      WHERE "location" IS NULL
        AND "lat" IS NOT NULL
        AND "lng" IS NOT NULL
      RETURNING "id"
    `;
    return result.length;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
