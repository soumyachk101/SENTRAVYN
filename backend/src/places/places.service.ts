import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { GeoService } from '../geospatial/geo.service';
import {
  resolveVerificationLabel,
  ShelterProfileVerification,
  VerificationLabel,
} from '../shelters/shelter-policy';
import type { PlacesListQuery, PlaceEvidenceInput } from './places.dto';

/**
 * Places API service (Phase 4 place discovery; ROADMAP Phase 4).
 *
 * Read path:
 * - Radius mode (lat + lng supplied) delegates the spatial query to
 *   GeoService.nearby (PostGIS ST_DWithin/ST_Distance on the derived
 *   geography column, ADR-004), which already clamps the radius to
 *   [100, 500_000] and the limit to [1, 200], and returns rows annotated
 *   with the read-path verification label. This service adds the
 *   `distanceIsCalculation: true` disclosure literal (SAFETY-POLICY.md 2:
 *   distance is a calculation, never a safe-reachability claim) and the
 *   fixed coverage note on an empty radius.
 * - Default mode is a simple paginated listing; shelter profiles for the
 *   page are fetched in one bounded query and the label is computed by the
 *   same pure, unit-tested resolveVerificationLabel (shelter-policy.ts,
 *   read path; ADR-018) - labels are never re-derived here.
 *
 * Write path (shelter evidence workflow, SAFETY-POLICY.md section 9):
 * `addEvidence` stores a user-submitted PlaceEvidence row and records a
 * PLACE_EVIDENCE_ADDED audit event. A submission is untrusted user data:
 * it NEVER mutates Place.verification or ShelterProfile.verification (or
 * any operational state). A map listing plus user submissions does not
 * establish that a place is open, safe or operational (PRODUCT-SPEC.md 6).
 */

/** Radius used when a caller omits `radiusMeters` in radius mode. */
export const DEFAULT_NEARBY_RADIUS_METERS = 1000;

/**
 * The fixed coverage disclosure, rendered when a radius search finds no
 * place with a known location in range (SAFETY-POLICY.md sections 1 and 6;
 * PHASE-4-PLAN: "no softened variant").
 */
export const COVERAGE_NOTE =
  'a map listing is not proof that a place is open, safe or operational';

/** Fields common to every place-list row, in either mode. */
export interface PlaceListItemBase {
  id: string;
  name: string;
  kind: string;
  /** Stored place state (UNVERIFIED / REVIEWED / VERIFIED). */
  verification: string;
  operationalStatus: string | null;
  operationalEvidence: string | null;
  /** ISO 8601, null when the place is not flagged stale. */
  staleSince: string | null;
  lat: number | null;
  lng: number | null;
  /**
   * Read-path display label (UNVERIFIED / REVIEWED / VERIFIED / STALE /
   * EXPIRED / INCOMPLETE), computed by resolveVerificationLabel - it
   * downgrades a stored VERIFIED place when the shelter evidence has
   * lapsed (SAFETY-POLICY.md 8), so a lapsed shelter can never surface
   * as verified.
   */
  verificationLabel: VerificationLabel;
  /** Human-readable reasons the label is not plain VERIFIED (empty when it is). */
  verificationLabelReasons: string[];
}

/** A row of the default (paginated) mode listing: the full place record. */
export interface PlaceListItemListed extends PlaceListItemBase {
  sourceAuthority: string | null;
  accessibility: string | null;
  capacityNote: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A row of the radius mode: nearest-first, with the distance disclosure. */
export interface PlaceListItemNear extends PlaceListItemBase {
  /**
   * Geodetic metres from the search centre (geography type, ADR-004).
   * A derived calculation, never a recommendation.
   */
  distanceMeters: number;
  /** Literal true: consumers must not read distance as safety (SAFETY-POLICY.md 2). */
  distanceIsCalculation: true;
}

export type PlaceListItem = PlaceListItemListed | PlaceListItemNear;

export interface PlacesListResponse {
  items: PlaceListItem[];
  /** Present in default mode; absent in radius mode (limit-based, not paged). */
  pagination?: { page: number; pageSize: number; total: number };
  /** The fixed coverage note; present only when a radius mode search is empty. */
  coverageNote?: string;
}

/** One shelter profile view (the detail payload). */
export interface ShelterProfileView {
  id: string;
  classification: string | null;
  hazardApplicability: string[];
  capacity: string | null;
  inspectAuthority: string | null;
  /** ISO 8601. */
  inspectionDate: string | null;
  /** UNVERIFIED / EVIDENCE_REVIEW / VERIFIED. */
  verification: string;
  /** ISO 8601. */
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One user-submitted evidence view. `claim` is untrusted user data,
 * preserved verbatim; it carries INFORMATION class USER_SUBMISSION
 * semantics (SAFETY-POLICY.md section 9) and asserts nothing about the
 * place being open, safe or operational.
 */
export interface PlaceEvidenceView {
  id: string;
  claim: string;
  sourceUrl: string | null;
  recordedByUserId: string | null;
  /** ISO 8601. */
  createdAt: string;
}

/** The place detail payload: the record, its profiles, its evidence, and the label. */
export interface PlaceDetail {
  place: PlaceListItemListed;
  verificationLabel: VerificationLabel;
  verificationLabelReasons: string[];
  shelterProfiles: ShelterProfileView[];
  evidence: PlaceEvidenceView[];
}

/**
 * The selected place row (before mapping), as returned by the detail
 * query. Kept as a plain shape so the mapper is independent of the
 * generated Prisma model (mirrors AlertsService's AlertRecord pattern).
 */
interface PlaceDetailRow {
  id: string;
  name: string;
  kind: string;
  verification: string;
  sourceAuthority: string | null;
  operationalStatus: string | null;
  operationalEvidence: string | null;
  accessibility: string | null;
  capacityNote: string | null;
  staleSince: Date | null;
  lat: number | null;
  lng: number | null;
  createdAt: Date;
  updatedAt: Date;
  shelters: Array<{
    id: string;
    classification: string | null;
    hazardApplicability: string[];
    capacity: string | null;
    inspectAuthority: string | null;
    inspectionDate: Date | null;
    verification: string;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  evidence: Array<{
    id: string;
    claim: string;
    sourceUrl: string | null;
    recordedByUserId: string | null;
    createdAt: Date;
  }>;
}

@Injectable()
export class PlacesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
    private readonly audit: AuditService,
  ) {}

  /**
   * GET /places.
   *
   * Radius mode when BOTH lat and lng are present: delegates to
   * GeoService.nearby (radius/limit clamped there) and annotates each row
   * with the distance disclosure. A half-supplied coordinate pair is a
   * client error (400), not a silent default. In radius mode the kind
   * filter and limit refine the search; page/pageSize are not used.
   *
   * Default mode otherwise: a simple paginated listing (page >= 1,
   * pageSize clamped to [1, 100] like the alerts list), optionally
   * narrowed by kind. Each row carries the read-path verification label,
   * computed from one bounded shelter-profile query for the whole page
   * (mirrors the GeoService annotation pattern: the page is capped, so
   * the profile lookup is capped with it - no row fan-out).
   *
   * Distance fields are absent from default-mode rows: no coordinates
   * supplied means no distance is claimed or calculated.
   */
  async list(query: PlacesListQuery): Promise<PlacesListResponse> {
    const hasLat = query.lat !== undefined;
    const hasLng = query.lng !== undefined;
    if (hasLat !== hasLng) {
      throw new BadRequestException(
        'lat and lng must be supplied together for radius mode',
      );
    }

    if (hasLat && hasLng) {
      const rows = await this.geo.nearby({
        lat: query.lat as number,
        lng: query.lng as number,
        radiusMeters: query.radiusMeters ?? DEFAULT_NEARBY_RADIUS_METERS,
        limit: query.limit ?? 200,
        kind: query.kind,
      });
      const items = rows.map(
        (row): PlaceListItemNear => ({
          ...row,
          // Literal disclosure: distance is a derived calculation, never a
          // safe-reachability recommendation (SAFETY-POLICY.md section 2).
          distanceIsCalculation: true,
        }),
      );
      return {
        items,
        ...(items.length === 0 ? { coverageNote: COVERAGE_NOTE } : {}),
      };
    }

    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));

    const where: Prisma.PlaceWhereInput = {};
    if (query.kind !== undefined && query.kind !== '') {
      where.kind = query.kind;
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.place.count({ where }),
      this.prisma.place.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const items = await this.toListItemListed(rows);
    return { items, pagination: { page, pageSize, total } };
  }

  /**
   * GET /places/:id. Returns null for an unknown id so the controller can
   * answer 404 (the same pattern as AlertsService.getDetail).
   *
   * One query fetches the place with its shelter profiles and evidence;
   * the label is computed by resolveVerificationLabel from the place state,
   * its stale flag and its profiles - a stored VERIFIED with lapsed shelter
   * evidence is downgraded to EXPIRED/STALE/INCOMPLETE, never shown live.
   */
  async detail(id: string): Promise<PlaceDetail | null> {
    const row = (await this.prisma.place.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        kind: true,
        verification: true,
        sourceAuthority: true,
        operationalStatus: true,
        operationalEvidence: true,
        accessibility: true,
        capacityNote: true,
        staleSince: true,
        lat: true,
        lng: true,
        createdAt: true,
        updatedAt: true,
        shelters: {
          select: {
            id: true,
            classification: true,
            hazardApplicability: true,
            capacity: true,
            inspectAuthority: true,
            inspectionDate: true,
            verification: true,
            expiresAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        evidence: {
          select: {
            id: true,
            claim: true,
            sourceUrl: true,
            recordedByUserId: true,
            createdAt: true,
          },
        },
      },
    })) as unknown as PlaceDetailRow | null;

    if (!row) return null;

    // The label is resolved from the place state, its stale flag and the
    // profiles nested on the row (one query total); a stored VERIFIED with
    // lapsed shelter evidence is downgraded here, never shown live.
    const resolved = this.resolveLabel(row);
    return {
      place: this.toPlaceListItem(row, resolved),
      verificationLabel: resolved.label,
      verificationLabelReasons: resolved.reasons,
      shelterProfiles: row.shelters.map(toShelterProfileView),
      evidence: row.evidence.map(toPlaceEvidenceView),
    };
  }

  /**
   * Maps one fully-loaded place row to the default-mode list item, applying
   * a caller-resolved label. Pure: no queries. The detail path passes the
   * label it already computed from the row's nested profiles; the list path
   * passes the label resolved from its batched profile lookup.
   */
  private toPlaceListItem(
    row: Omit<PlaceDetailRow, 'shelters' | 'evidence'>,
    resolved: { label: VerificationLabel; reasons: string[] },
  ): PlaceListItemListed {
    return {
      ...this.toListItemBase(row),
      sourceAuthority: row.sourceAuthority,
      accessibility: row.accessibility,
      capacityNote: row.capacityNote,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      verificationLabel: resolved.label,
      verificationLabelReasons: resolved.reasons,
    };
  }

  /**
   * POST /places/:id/evidence (authenticated, any role).
   *
   * Creates one PlaceEvidence row for the submission and records a
   * PLACE_EVIDENCE_ADDED audit event. SAFETY-POLICY.md section 9: user
   * submissions are treated as unverified and must never change official
   * status without authorised approval - so this method writes only the
   * evidence row and the audit event. It performs NO write to
   * Place.verification, ShelterProfile.verification or operational state,
   * and the audit event names that boundary for reviewers.
   *
   * Throws NotFoundException when the place id is unknown (the controller
   * surface is 404, not 409/500).
   */
  async addEvidence(
    actorUserId: string,
    placeId: string,
    input: PlaceEvidenceInput,
  ): Promise<PlaceEvidenceView> {
    const place = await this.prisma.place.findUnique({
      where: { id: placeId },
      select: { id: true },
    });
    if (!place) {
      throw new NotFoundException('Place not found');
    }

    const created = await this.prisma.placeEvidence.create({
      data: {
        place: { connect: { id: placeId } },
        claim: input.claim,
        sourceUrl: input.sourceUrl ?? null,
        recordedByUserId: actorUserId,
      },
    });

    await this.audit.record(
      actorUserId,
      AUDIT_ACTIONS.PLACE_EVIDENCE_ADDED,
      'place',
      placeId,
      JSON.stringify({
        evidenceId: created.id,
        claim: input.claim,
        sourceUrl: input.sourceUrl ?? null,
      }),
    );

    return toPlaceEvidenceView(created);
  }

  /**
   * Maps full place rows to default-mode list items, annotating each with
   * the read-path verification label. Shelter profiles for the whole page
   * are fetched in one bounded query (the page is capped at pageSize),
   * mirroring the GeoService annotation pattern - no per-row fan-out.
   */
  private async toListItemListed(
    rows: Array<Omit<PlaceDetailRow, 'shelters' | 'evidence'>>,
  ): Promise<PlaceListItemListed[]> {
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

    const profilesByPlace = this.profilesByPlace(profiles);
    return rows.map((row) => {
      const resolved = resolveVerificationLabel({
        placeVerification: row.verification,
        staleSince: row.staleSince?.toISOString() ?? null,
        shelterProfiles: profilesByPlace.get(row.id) ?? [],
      });
      return this.toPlaceListItem(row, resolved);
    });
  }

  private toListItemBase(row: {
    id: string;
    name: string;
    kind: string;
    verification: string;
    operationalStatus: string | null;
    operationalEvidence: string | null;
    staleSince: Date | null;
    lat: number | null;
    lng: number | null;
  }): Omit<PlaceListItemBase, 'verificationLabel' | 'verificationLabelReasons'> {
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      verification: row.verification,
      operationalStatus: row.operationalStatus,
      operationalEvidence: row.operationalEvidence,
      staleSince: row.staleSince?.toISOString() ?? null,
      lat: row.lat,
      lng: row.lng,
    };
  }

  /** Label input from a detail row (its profiles are nested on the row). */
  private resolveLabel(row: PlaceDetailRow): {
    label: VerificationLabel;
    reasons: string[];
  } {
    return resolveVerificationLabel({
      placeVerification: row.verification,
      staleSince: row.staleSince?.toISOString() ?? null,
      shelterProfiles: row.shelters.map(toProfileVerification),
    });
  }

  private profilesByPlace(
    profiles: Array<{
      placeId: string;
      verification: string;
      inspectionDate: Date | null;
      expiresAt: Date | null;
    }>,
  ): Map<string, ShelterProfileVerification[]> {
    const byPlace = new Map<string, ShelterProfileVerification[]>();
    for (const p of profiles) {
      byPlace.set(p.placeId, [
        ...(byPlace.get(p.placeId) ?? []),
        toProfileVerification(p),
      ]);
    }
    return byPlace;
  }
}

function toProfileVerification(p: {
  verification: string;
  inspectionDate: Date | null;
  expiresAt: Date | null;
}): ShelterProfileVerification {
  return {
    verification: p.verification,
    inspectionDate: p.inspectionDate?.toISOString() ?? null,
    expiresAt: p.expiresAt?.toISOString() ?? null,
  };
}

function toShelterProfileView(p: PlaceDetailRow['shelters'][number]): ShelterProfileView {
  return {
    id: p.id,
    classification: p.classification,
    hazardApplicability: p.hazardApplicability,
    capacity: p.capacity,
    inspectAuthority: p.inspectAuthority,
    inspectionDate: p.inspectionDate?.toISOString() ?? null,
    verification: p.verification,
    expiresAt: p.expiresAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function toPlaceEvidenceView(e: PlaceDetailRow['evidence'][number]): PlaceEvidenceView {
  return {
    id: e.id,
    claim: e.claim,
    sourceUrl: e.sourceUrl,
    recordedByUserId: e.recordedByUserId,
    createdAt: e.createdAt.toISOString(),
  };
}
