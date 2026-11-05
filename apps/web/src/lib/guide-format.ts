/**
 * Formatting helpers for the public guide surface (Phase 5).
 *
 * Pure and SSR-safe (they only read ISO strings / numbers passed in), so
 * both the index and detail pages can call them during render. Dates are
 * rendered in the viewer's locale — the API is the source of truth for
 * the *value*; the display formatting is a presentational concern.
 */

export function formatGuideDate(iso: string | null | undefined): string {
  if (!iso) return "n/a";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "n/a";
  return new Date(parsed).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatGuideDateTime(iso: string | null | undefined): string {
  if (!iso) return "n/a";
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return "n/a";
  return new Date(parsed).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Human-readable hazard code, e.g. "SEVERE_WEATHER" -> "Severe weather". */
export function humanizeHazard(code: string): string {
  return code
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
