/**
 * Safety-guide display helpers for the public surface (Phase 5).
 *
 * The eight hazard categories are the PRODUCT-SPEC.md 4 set; each maps to
 * the closed HAZARD_TYPES codes the API filters on
 * (backend/src/guides/guides.dto.ts; SAFETY-POLICY.md 5: guidance is
 * hazard-specific and never reused across types). The UI filters a
 * category by requesting every code it covers and merging deterministically,
 * so the control is always exact against the server — no partial results.
 */

import {
  getGuide,
  listGuides,
  type GuideDetail,
  type GuideView,
  type PaginatedGuideView,
} from "./api";

export interface HazardCategory {
  /** Stable UI id, e.g. "nuclear-radiological". */
  id: string;
  /** Display name. */
  label: string;
  /** The hazardType codes this category covers (PRODUCT-SPEC.md 4). */
  codes: readonly string[];
}

/**
 * The eight hazard categories, in a fixed order. A single hazard type has
 * one code; a category (e.g. "Nuclear and radiological") may have several.
 */
export const HAZARD_CATEGORIES: readonly HazardCategory[] = [
  {
    id: "nuclear-radiological",
    label: "Nuclear & radiological",
    codes: ["NUCLEAR", "RADIOLOGICAL"],
  },
  {
    id: "conflict-missile",
    label: "Conflict & missile threats",
    codes: ["CONFLICT", "MISSILE"],
  },
  {
    id: "earthquake-tsunami",
    label: "Earthquakes & tsunamis",
    codes: ["EARTHQUAKE", "TSUNAMI"],
  },
  {
    id: "flood-cyclone-weather",
    label: "Floods, cyclones & severe weather",
    codes: ["FLOOD", "CYCLONE", "SEVERE_WEATHER"],
  },
  {
    id: "wildfire",
    label: "Wildfires",
    codes: ["WILDFIRE"],
  },
  {
    id: "industrial-chemical",
    label: "Industrial & chemical incidents",
    codes: ["INDUSTRIAL", "CHEMICAL"],
  },
  {
    id: "public-health",
    label: "Public-health emergencies",
    codes: ["PUBLIC_HEALTH"],
  },
  {
    id: "infrastructure-utility",
    label: "Infrastructure & utility disruptions",
    codes: ["INFRASTRUCTURE", "UTILITY"],
  },
] as const;

export function categoryById(
  id: string,
): HazardCategory | undefined {
  return HAZARD_CATEGORIES.find((c) => c.id === id);
}

const PER_CODE_PAGE_SIZE = 50;

/**
 * Lists the guides covering a hazard category: one server request per
 * hazardType code the category contains (the API filters on an exact
 * code), then a deterministic merge — dedupe by id, sort by
 * lastReviewedAt (newest first, nulls last), then by created (newest
 * first) for stable ties.
 */
export async function listGuidesByCategory(
  category: HazardCategory,
  language?: string,
): Promise<GuideView[]> {
  const perCode = await Promise.all(
    category.codes.map((code) =>
      listGuides({ hazardType: code, language, pageSize: PER_CODE_PAGE_SIZE }),
    ),
  );
  const merged = new Map<string, GuideView>();
  for (const page of perCode) {
    for (const guide of page.items) {
      merged.set(guide.id, guide);
    }
  }
  return [...merged.values()].sort(byFreshnessThenNewest);
}

/** Lists every public guide (APPROVED/PUBLISHED), optional language filter. */
export function listAllGuides(language?: string): Promise<PaginatedGuideView> {
  return listGuides({
    language,
    pageSize: PER_CODE_PAGE_SIZE,
  });
}

/**
 * Resolves a detail by id. A 404/401/403 or network failure rejects; the
 * detail is only returned for guides the public surface can read
 * (APPROVED/PUBLISHED) — DRAFT/IN_REVIEW/RETIRED 404 on GET /guides/:id.
 */
export function getGuideDetail(id: string): Promise<GuideDetail> {
  return getGuide(id);
}

function byFreshnessThenNewest(a: GuideView, b: GuideView): number {
  const atime = a.lastReviewedAt ? Date.parse(a.lastReviewedAt) : 0;
  const btime = b.lastReviewedAt ? Date.parse(b.lastReviewedAt) : 0;
  if (atime !== btime) return btime - atime;
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}
