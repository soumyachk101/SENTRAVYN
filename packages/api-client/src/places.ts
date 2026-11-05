import type {
  Paginated,
  PlaceDetail,
  PlaceGeoRow,
  PlacesRadiusResult,
} from '@sentravyn/shared-types';
import type { Requester } from './http';

/**
 * Places discovery endpoints (Phase 4, ADR-016/017/018): the public REST
 * surface GET /api/v1/places and GET /api/v1/places/:id.
 *
 * Contract notes (asserted against the route where it is available; the
 * route is built in parallel, so a 404 during development means the
 * backend half of Phase 4 is not yet merged — the UI must then render its
 * error state, not fabricate data):
 *
 * - GET /places is PUBLIC; no token. Query: kind?, lat?, lng?,
 *   radiusMeters? (server clamps 100..500000), limit? (capped 200).
 *   Radius mode (lat+lng present) -> { items, pagination }; list mode
 *   (no lat/lng) -> Paginated<PlaceGeoRow> with distance fields
 *   null/absent. Every row carries verificationLabel (the computed
 *   read-path label, ADR-018) and its reasons.
 * - Distance is a calculation, never a safety recommendation
 *   (PRODUCT-SPEC.md 5): surfaces must say so.
 * - GET /places/:id -> PlaceDetail (place + shelters + evidence + the
 *   computed label), 404 for an unknown id.
 */
export interface PlacesListParams {
  kind?: string;
  /** Optional page/pageSize in list mode; the API applies its own caps. */
  page?: number;
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

export interface PlacesClient {
  /**
   * GET /places (list mode, public). Returns the API's paginated envelope;
   * `distanceMeters` is absent/null on these rows.
   */
  list(params?: PlacesListParams): Promise<Paginated<PlaceGeoRow>>;

  /**
   * GET /places?lat=&lng= (radius mode, public). Places with a known
   * location within the radius, nearest first, each with distanceMeters.
   */
  nearby(params: PlacesNearbyParams): Promise<PlacesRadiusResult>;

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
    if (p.radiusMeters !== undefined) q.set('radiusMeters', String(p.radiusMeters));
    if (p.kind) q.set('kind', p.kind);
    if (p.limit) q.set('limit', String(p.limit));
    return `?${q.toString()}`;
  }

  return {
    list: (params) =>
      req.request<Paginated<PlaceGeoRow>>(
        'GET',
        `/api/v1/places${buildListQuery(params ?? {})}`,
      ),
    nearby: (params) =>
      req.request<PlacesRadiusResult>(
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
