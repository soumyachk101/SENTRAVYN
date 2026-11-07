/**
 * Map helpers for the Phase 4 place-discovery surface (apps/web).
 *
 * Tile policy (docs/DATA-SOURCES.md §3, ADR-017): OpenStreetMap standard
 * raster tiles are a DEV-ONLY provider. ODbL applies and attribution is
 * MANDATORY; production-scale usage is pending a terms review, so this page
 * states that plainly in the UI and never claims a production tile host.
 * No geolocation is used anywhere: the centre is always chosen manually
 * (a coordinate pair or a search centre the user types), never from the
 * device (ADR-017 / SECURITY.md 5).
 *
 * These helpers are pure so they are unit-testable in jsdom without a
 * WebGL canvas. MapLibre itself is initialised only in a guarded effect in
 * the component.
 */
import type { PlaceGeoRow, VerificationLabel } from '@sentravyn/shared-types';

/** OpenStreetMap standard raster tiles (DEV ONLY — see module doc). */
export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
/** ODbL attribution is mandatory and rendered in the UI (not just the map). */
export const OSM_ATTRIBUTION =
  'Map data © OpenStreetMap contributors, ODbL (dev-only tiles; production pending terms review)';
/** The dev-only notice the UI must show next to the attribution. */
export const DEV_ONLY_TILE_NOTICE =
  'Development tile provider. Production-scale OSM usage is pending a terms review.';

/**
 * A discovery category. `kind` values on the backend are free strings; the
 * known ones map to a labelled category and a muted, non-neon accent colour
 * (DESIGN.md 3). Unknown kinds fall to "Other" so a new kind can never be
 * dropped silently.
 */
export interface PlaceCategory {
  id: string;
  label: string;
  /** CSS colour token value (muted, semantic; never the only signal). */
  color: string;
  /** The backend kind strings this category covers. */
  kinds: string[];
}

/** Muted accent values reused from the design tokens (no neon). */
export const PLACE_CATEGORIES: PlaceCategory[] = [
  {
    id: 'hospital',
    label: 'Hospitals',
    color: '#a13a34',
    kinds: ['hospital', 'medical', 'emergency_care'],
  },
  {
    id: 'clinic',
    label: 'Clinics',
    color: '#4a6b82',
    kinds: ['clinic', 'doctor', 'pharmacy'],
  },
  {
    id: 'shelter',
    label: 'Shelters',
    color: '#4e7d5a',
    kinds: ['shelter', 'emergency_shelter'],
  },
  {
    id: 'fire',
    label: 'Fire services',
    color: '#b07d2b',
    kinds: ['fire_station', 'fire'],
  },
  {
    id: 'police',
    label: 'Police',
    color: '#55606c',
    kinds: ['police_station', 'police'],
  },
  {
    id: 'relief',
    label: 'Relief points',
    color: '#8a7d6b',
    kinds: ['relief', 'relief_point', 'distribution_point'],
  },
];

const OTHER_CATEGORY: PlaceCategory = {
  id: 'other',
  label: 'Other services',
  color: '#aab3bf',
  kinds: [],
};

/** Every category the UI shows in the legend (known + Other). */
export const LEGEND_CATEGORIES: PlaceCategory[] = [
  ...PLACE_CATEGORIES,
  OTHER_CATEGORY,
];

/** Maps a place's free-string kind to its category. */
export function categoryForKind(kind: string): PlaceCategory {
  const normalized = kind.trim().toLowerCase();
  return (
    PLACE_CATEGORIES.find((c) =>
      c.kinds.some((k) => k.toLowerCase() === normalized),
    ) ?? OTHER_CATEGORY
  );
}

/**
 * The display verification label, rendered as TEXT. Colour is never the only
 * signal (DESIGN.md 3 / SAFETY-POLICY.md 8): each state has a distinct,
 * human-readable word. The API is authoritative for STALE/EXPIRED/INCOMPLETE
 * (computed on read); this is purely a presentation mapping.
 */
export interface VerificationChip {
  label: string;
  /** CSS colour token value (muted). */
  color: string;
  /** Whether this state asserts no safety (informational only). */
  assertsSafety: boolean;
  /** A short, plain-language explanation for screen readers / detail views. */
  meaning: string;
}

export function verificationChip(label: VerificationLabel): VerificationChip {
  switch (label) {
    case 'VERIFIED':
      return {
        label: 'Verified',
        color: '#4e7d5a',
        assertsSafety: false, // "verified" is a review state, not a safety claim
        meaning:
          'Reviewed and verified against evidence; re-validated on schedule.',
      };
    case 'REVIEWED':
      return {
        label: 'Reviewed',
        color: '#4a6b82',
        assertsSafety: false,
        meaning: 'Reviewed but not yet verified against full evidence.',
      };
    case 'UNVERIFIED':
      return {
        label: 'Unverified',
        color: '#aab3bf',
        assertsSafety: false,
        meaning:
          'Listed from a source; not verified. A listing is not proof it is open or safe.',
      };
    case 'STALE':
      return {
        label: 'Stale',
        color: '#b07d2b',
        assertsSafety: false,
        meaning:
          'Information is older than the revalidation window; treat as possibly out of date.',
      };
    case 'EXPIRED':
      return {
        label: 'Expired',
        color: '#a13a34',
        assertsSafety: false,
        meaning:
          'The record has passed its explicit expiry and is not current.',
      };
    case 'INCOMPLETE':
      return {
        label: 'Incomplete',
        color: '#b07d2b',
        assertsSafety: false,
        meaning:
          'Verification evidence is incomplete; the safety claim is not confirmed.',
      };
  }
}

/**
 * Distance is always presented as a CALCULATION, never a safety
 * recommendation (PRODUCT-SPEC.md 5). The tilde signals an estimate; the
 * suffix states the limit explicitly.
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `~${Math.round(meters)} m`;
  }
  const km = meters / 1000;
  const rounded = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
  return `~${rounded} km`;
}

/** The mandatory "calculation, not a safety recommendation" line. */
export const DISTANCE_DISCLAIMER = 'a calculation, not a safety recommendation';

/** A GeoJSON FeatureCollection of places that have known coordinates. */
export type PlaceGeoJSON = {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    properties: {
      id: string;
      name: string;
      kind: string;
      categoryId: string;
      verificationLabel: VerificationLabel;
      distanceMeters: number | null;
    };
    geometry: { type: 'Point'; coordinates: [number, number] };
  }[];
};

/** Converts API place rows into a MapLibre-compatible GeoJSON. */
export function toPlaceGeoJSON(rows: PlaceGeoRow[]): PlaceGeoJSON {
  const features = rows
    .filter((r) => r.lat !== null && r.lng !== null)
    .map((r) => ({
      type: 'Feature' as const,
      properties: {
        id: r.id,
        name: r.name,
        kind: r.kind,
        categoryId: categoryForKind(r.kind).id,
        verificationLabel: r.verificationLabel,
        distanceMeters: r.distanceMeters ?? null,
      },
      geometry: {
        type: 'Point' as const,
        // GeoJSON Point coordinate order is [lng, lat] as a 2-tuple.
        coordinates: [r.lng as number, r.lat as number] as [number, number],
      },
    }));
  return { type: 'FeatureCollection', features };
}

/**
 * Radius-mode query params for the places api-client. Radius is clamped to
 * the API's [100, 500000] m range; limit to the API's cap of 200.
 */
export function radiusParams(
  lat: number,
  lng: number,
  radiusMeters: number,
  kind: string | undefined,
  limit = 200,
) {
  const clamped = Math.min(500_000, Math.max(100, radiusMeters));
  return {
    lat,
    lng,
    radiusMeters: clamped,
    kind: kind && kind !== 'all' ? kind : undefined,
    limit,
  };
}
