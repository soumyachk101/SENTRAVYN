import {
  SentravynApiClient,
  type ListAlertsParams,
} from '@sentravyn/api-client';
import type {
  Alert,
  AlertDetail,
  InformationClass,
  Paginated,
} from '@sentravyn/shared-types';
import { recordLocalSync } from '@/lib/pwa';

/**
 * Web-side public alerts consumer (Phase 3). Thin wrapper over the shared
 * @sentravyn/api-client `listAlerts` / `getAlertDetail` methods so the alerts
 * surface asserts on the real contract (backend/src/alerts, Phase 1/3).
 *
 * The base URL matches the existing web consumers (apps/web/src/lib/api.ts and
 * apps/web/src/lib/places-client.ts): NEXT_PUBLIC_API_BASE_URL, default
 * http://localhost:4000. The api-client namespaces routes under /api/v1, so
 * the base is the API root, not .../api/v1.
 *
 * Safety rules this surface enforces at the data layer:
 * - Only public-safe alert statuses are ever listed (the API returns
 *   VALIDATED/PUBLISHED/UPDATED/EXPIRED/CANCELLED and rejects anything else —
 *   SAFETY-POLICY.md 7, ADR-007 quarantine-by-default).
 * - Freshness is returned by the API per row (SAFETY-POLICY.md 8); this
 *   module only maps it to display labels, it never recomputes or softens
 *   it. Stale/expired/unknown are all surfaced, never hidden as live.
 * - No geolocation is involved anywhere: the list is a plain public query.
 */

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

let client: SentravynApiClient | null = null;
function apiClient(): SentravynApiClient {
  if (client === null) {
    client = new SentravynApiClient({ baseUrl: API_BASE });
  }
  return client;
}

/**
 * Public alert list (GET /api/v1/alerts). The server returns only
 * public-safe statuses by default; `params.status` may narrow further but
 * must stay within the public-safe set or the API rejects the request.
 */
export function listPublicAlerts(
  params: ListAlertsParams = {},
): Promise<Paginated<Alert>> {
  // Record the live-sync timestamp so the PWA "last synced" state is real
  // (Phase 6): a successful public fetch is the sync the banner reports.
  // recordLocalSync is a no-op on the server / without localStorage.
  return apiClient()
    .listAlerts(params)
    .then((page) => {
      recordLocalSync();
      return page;
    });
}

/**
 * Single alert with its revision history and source provenance
 * (GET /api/v1/alerts/:id, the AlertDetail envelope).
 */
export function getPublicAlertDetail(id: string): Promise<AlertDetail> {
  // Same live-sync recording as the list: the detail fetch is a sync too.
  return apiClient()
    .getAlertDetail(id)
    .then((detail) => {
      recordLocalSync();
      return detail;
    });
}

/**
 * Information-class display labels (SAFETY-POLICY.md 2: every displayed
 * item must be distinguishable by class; a summary must never visually
 * imply it is an official order).
 */
export const INFORMATION_CLASS_LABELS: Record<InformationClass, string> = {
  OFFICIAL_SOURCE: 'Official source content',
  SENTRAVYN_SUMMARY: 'SENTRAVYN-reviewed summary (not an official order)',
  THIRD_PARTY: 'Third-party data',
  USER_SUBMISSION: 'User submission (unverified)',
  DERIVED_CALCULATION: 'Derived calculation',
  UNVERIFIED_OR_STALE: 'Unverified or stale information',
};

/**
 * Freshness display labels (SAFETY-POLICY.md 8: last-updated timestamps and
 * stale labels; stale information is never presented as current). The value
 * is the API's computed freshness.state — the client only maps it to text.
 */
export const FRESHNESS_LABELS: Record<Alert['freshness']['state'], string> = {
  fresh: 'Fresh',
  stale: 'Stale — information may no longer be current',
  expired: 'Expired — information is no longer current',
  unknown: 'Freshness unknown — no last-update time on record',
};
