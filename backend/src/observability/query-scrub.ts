/**
 * Location query-parameter scrubbing for structured logs (SECURITY.md 5).
 *
 * Precise location must never reach ordinary logs. The sanitizer below
 * drops any query key that carries (potentially precise) location data
 * before a log line is written; only a redaction count is exposed, never
 * the values.
 */

/**
 * Query-parameter keys that carry (potentially precise) location data.
 * These keys are scrubbed from structured request-log lines before
 * anything is written (the values are dropped entirely, not redacted).
 */
export const LOCATION_QUERY_KEYS = [
  'lat',
  'latlng',
  'latitude',
  'lng',
  'lon',
  'longitude',
  'latlon',
  'location',
  'geolocation',
  'coordinate',
  'coordinates',
  'position',
  'point',
  'geohash',
  'bbox',
  'bounds',
  'center',
  'centerlat',
  'centerlng',
  'centerlon',
  'radius',
  'geocode',
  'geocoding',
] as const;

/** Compiled set for O(n) lookups; matching is case-insensitive. */
export const LOCATION_QUERY_KEY_SET: ReadonlySet<string> = new Set(
  LOCATION_QUERY_KEYS.map((k) => k.toLowerCase()),
);

export interface SanitizeResult {
  /** The query with location keys removed, as a URL string (no leading ?). */
  query: string;
  /** Number of keys dropped. Only a count is exposed, never the values. */
  redactedCount: number;
}

/**
 * Strips location-bearing query parameters. The original values are
 * discarded (never logged, never redacted-in-place). Returns a query
 * string without the leading '?'; an empty string when nothing remains.
 */
export function sanitizeQueryParams(
  rawQuery: string | undefined,
): SanitizeResult {
  if (!rawQuery || rawQuery.length === 0) {
    return { query: '', redactedCount: 0 };
  }
  let redactedCount = 0;
  const kept: string[] = [];
  for (const pair of rawQuery.split('&')) {
    if (pair.length === 0) continue;
    const eq = pair.indexOf('=');
    const rawKey = eq === -1 ? pair : pair.slice(0, eq);
    const key = decodeURIComponent(rawKey).toLowerCase();
    if (LOCATION_QUERY_KEY_SET.has(key)) {
      redactedCount += 1;
      continue;
    }
    kept.push(pair);
  }
  return {
    query: kept.join('&'),
    redactedCount,
  };
}
