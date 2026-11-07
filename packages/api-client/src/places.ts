import type {
  PlacesListResponse,
  PlaceDetail,
  PlaceGeoRow,
} from '@sentravyn/shared-types';
import type { Requester } from './http';

/**
 * Places discovery endpoints (Phase 4, ADR-016/017/018): the public REST
 * surface GET /api/v1/places and GET /api/v1/places/:id (backend/src/places,
 * built by a1).
 *
 * Contract notes (asserted against backend/src/places/places.service.ts; if
 * the route is not yet merged, a 404 means the API half of Phase 4 is still
 * landing — the UI must render its error state, not fabricate data):
 *
 * - GET /places is PUBLIC; no token. Query: kind?, lat?, lng?,
 *   radiusMeters? (server clamps 100..500000, default 1000 in radius mode),
 *   limit? (capped 200), page?/pageSize? (default mode only, pageSize
 *   capped 100). A half-supplied coordinate pair is a 400.
 *   Radius mode (both lat+lng) -> { items: PlaceListItemNear[],
 *   coverageNote? } with NO pagination; default mode ->
 *   { items: PlaceListItemListed[], pagination }.
 * - Distance is a calculation, never a safety recommendation
 *   (PRODUCT-SPEC.md 5): the radius rows carry `distanceIsCalculation: true`.
 * - Every row carries the computed read-path verificationLabel (ADR-018).
 * - GET /places/:id -> PlaceDetail (place + shelterProfiles + evidence +
 *   computed label + reasons), 404 for an unknown id.
 */
export interface PlacesListParams {
  kind?: string;
  /** Default mode only. */
  page?: number;
  /** Default mode only; the API caps it at 100. */
  pageSize?: number;
  limit?: number;
}

/** Radius-search around an explicit centre (no geolocation, ADR-017). */
export interface PlacesNearbyParams {
  lat: number;
  lng: number;
  radiusMeters?: number;
  kind?: string;
  limit?: number;
}

/**
 * A convenience row type for surfaces that consume radius-mode results: the
 * base fields plus an optional distance. The API's radius row
 * (PlaceListItemNear) is assignable to it.
 */
export type { PlaceGeoRow };

export interface PlacesClient {
  /**
   * GET /places (default mode, public). The paginated envelope; distance
   * fields are absent on these rows.
   */
  list(params?: PlacesListParams): Promise<PlacesListResponse>;

  /**
   * GET /places?lat=&lng= (radius mode, public). Places with a known
   * location within the radius, nearest first, each with distanceMeters +
   * distanceIsCalculation. Returns the coverageNote when empty.
   */
  nearby(params: PlacesNearbyParams): Promise<PlacesListResponse>;

  /** GET /places/:id (public). Full detail; rejects ApiError 404 when unknown. */
  detail(id: string): Promise<PlaceDetail>;
}

export function createPlacesClient(req: Requester): PlacesClient {
  function buildListQuery(p: PlacesListParams): string {
    const q = new URLSearchParams();
    if (p.kind) q.set('kind', p.kind);
    if (p.page) q.set('page', String(p.page));
    if (p.pageSize) q.set('pageSize', String(p.pageSize));
    if (p.limit) q.set('limit', String(p.limit));
    const s = q.toString();
    return s ? `?${s}` : '';
  }

  function buildNearbyQuery(p: PlacesNearbyParams): string {
    const q = new URLSearchParams();
    q.set('lat', String(p.lat));
    q.set('lng', String(p.lng));
    if (p.radiusMeters !== undefined) {
      q.set('radiusMeters', String(p.radiusMeters));
    }
    if (p.kind) q.set('kind', p.kind);
    if (p.limit) q.set('limit', String(p.limit));
    return `?${q.toString()}`;
  }

  return {
    list: (params) =>
      req.request<PlacesListResponse>(
        'GET',
        `/api/v1/places${buildListQuery(params ?? {})}`,
      ),
    nearby: (params) =>
      req.request<PlacesListResponse>(
        'GET',
        `/api/v1/places${buildNearbyQuery(params)}`,
      ),
    detail: (id) =>
      req.request<PlaceDetail>(
        'GET',
        `/api/v1/places/${encodeURIComponent(id)}`,
      ),
  };
}
