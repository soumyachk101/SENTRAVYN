import {
  SentravynApiClient,
  type PlacesNearbyParams,
} from "@sentravyn/api-client";
import type { PlaceGeoRow } from "@sentravyn/shared-types";

/**
 * Web-side place-discovery client (Phase 4). Thin wrapper over the shared
 * @sentravyn/api-client `places` module so the map surface asserts on the
 * real contract (backend/src/places, Phase 4). The base URL matches the
 * existing web auth client (apps/web/src/lib/api.ts): NEXT_PUBLIC_API_BASE_URL,
 * default http://localhost:4000. The api-client namespaces routes under
 * /api/v1, so the base is the API root, not .../api/v1.
 *
 * No geolocation is used anywhere: the caller supplies the centre manually
 * (ADR-017 / SECURITY.md 5).
 */

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";

let client: SentravynApiClient | null = null;
function apiClient(): SentravynApiClient {
  if (client === null) {
    client = new SentravynApiClient({ baseUrl: API_BASE });
  }
  return client;
}

export interface PlaceSearchResult {
  /** The rows the UI renders. Empty when there are no places in range. */
  items: PlaceGeoRow[];
  /**
   * True when the result set hit the API's limit cap (radius mode is
   * limit-based, not paginated), so more places may exist beyond the ones
   * shown.
   */
  moreAvailable: boolean;
  /** The API's fixed coverage note when the radius search is empty, else null. */
  coverageNote: string | null;
  /** When the fetch succeeded, the timestamp it reflects (ISO). */
  fetchedAt: string;
}

const API_RADIUS_LIMIT = 200;

/**
 * Places within `radiusMeters` of an explicit centre. This is a manual,
 * radius-based query — it never uses the device's location. The caller is
 * responsible for the loading/error/offline/stale states; this function
 * only performs the request and shapes the success result.
 */
export async function searchPlacesNear(
  center: { lat: number; lng: number },
  radiusMeters: number,
  kind: string | undefined,
): Promise<PlaceSearchResult> {
  const params: PlacesNearbyParams = {
    ...center,
    radiusMeters,
    kind,
    limit: API_RADIUS_LIMIT,
  };
  const result = await apiClient().placesNearby(params);
  const items: PlaceGeoRow[] = result.items ?? [];
  return {
    items,
    moreAvailable: items.length >= API_RADIUS_LIMIT,
    coverageNote: result.coverageNote ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

/** A single place's full detail (PlaceDetail). 404s for an unknown id. */
export function getPlaceDetail(id: string) {
  return apiClient().placeDetail(id);
}
