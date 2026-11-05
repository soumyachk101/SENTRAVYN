import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
 * 'safe' (ADR-006).
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

    if (kind !== undefined && kind !== '') {
      // Bind order (source order of the ${...} interpolations):
      // lng, lat, radiusMeters, kind, limit. ST_MakePoint(x = lng, y = lat).
      return this.prisma.$queryRaw<PlaceGeoRow[]>`
        SELECT p."id", p."name", p."kind", p."verification", p."operationalStatus",
               p."operationalEvidence", p."staleSince"::text, p."lat", p."lng",
               ST_Distance(p."location", ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS "distanceMeters"
        FROM "Place" p
        WHERE p."location" IS NOT NULL
          AND ST_DWithin(p."location", ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radiusMeters})
          AND p."kind" = ${kind}
        ORDER BY "distanceMeters" ASC
        LIMIT ${limit}
      `;
    }

    // Bind order (source order of the ${...} interpolations):
    // lng, lat, radiusMeters, limit.
    return this.prisma.$queryRaw<PlaceGeoRow[]>`
      SELECT p."id", p."name", p."kind", p."verification", p."operationalStatus",
             p."operationalEvidence", p."staleSince"::text, p."lat", p."lng",
             ST_Distance(p."location", ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS "distanceMeters"
      FROM "Place" p
      WHERE p."location" IS NOT NULL
        AND ST_DWithin(p."location", ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography, ${radiusMeters})
      ORDER BY "distanceMeters" ASC
      LIMIT ${limit}
    `;
  }

  /**
   * Updates the editable lat/lng columns and the derived PostGIS location
   * atomically (ADR-004: lat/lng remain the source of truth, location is the
   * derived index column). Returns true when the place existed, false when
   * the id was unknown. Both statements run in one $transaction.
   */
  async updatePlaceLocation(
    placeId: string,
    lat: number,
    lng: number,
  ): Promise<boolean> {
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
