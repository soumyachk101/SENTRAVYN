/**
 * SENTRAVYN shared contracts.
 *
 * These types encode the product's trust rules so that every surface (web,
 * admin, mobile, backend) agrees on what "verified", "stale" and "official"
 * mean. Changing a trust-related type here is a safety-relevant change.
 *
 * References: PRODUCT-SPEC.md 6-7, SAFETY-POLICY.md 2-3 and 8.
 */

/** Information class of any displayed item (SAFETY-POLICY.md 2). */
export const INFORMATION_CLASSES = [
  'OFFICIAL_SOURCE',
  'SENTRAVYN_SUMMARY',
  'THIRD_PARTY',
  'USER_SUBMISSION',
  'DERIVED_CALCULATION',
  'UNVERIFIED_OR_STALE',
] as const;
export type InformationClass = (typeof INFORMATION_CLASSES)[number];

/** Freshness state of a record (SAFETY-POLICY.md 8). */
export const FRESHNESS_STATES = ['fresh', 'stale', 'expired', 'unknown'] as const;
export type FreshnessState = (typeof FRESHNESS_STATES)[number];

/** Verification state of a place (PRODUCT-SPEC.md 6). */
export const PLACE_VERIFICATION_STATES = ['UNVERIFIED', 'REVIEWED', 'VERIFIED'] as const;
export type PlaceVerification = (typeof PLACE_VERIFICATION_STATES)[number];

/** Verification state of a shelter. A shelter may only be VERIFIED when the
 *  required evidence and an authorised approval are both present
 *  (SAFETY-POLICY.md 3). */
export const SHELTER_VERIFICATION_STATES = [
  'UNVERIFIED',
  'EVIDENCE_REVIEW',
  'VERIFIED',
] as const;
export type ShelterVerification = (typeof SHELTER_VERIFICATION_STATES)[number];

export interface Freshness {
  state: FreshnessState;
  ageMinutes: number | null;
  expiresAt: string | null;
  policyHours: number;
}

export interface Alert {
  id: string;
  externalRef: string | null;
  status: string;
  verification: string;
  informationClass: InformationClass;
  headline: string;
  issuer: string | null;
  severity: string | null;
  urgency: string | null;
  certainty: string | null;
  issuedAt: string | null;
  effectiveAt: string | null;
  expiresAt: string | null;
  publishedAt: string | null;
  freshness: Freshness;
  createdAt: string;
  updatedAt: string;
}

export interface Paginated<T> {
  items: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

/**
 * Place trust attributes are deliberately separate: existence, authority,
 * operational status, accessibility and shelter classification are distinct
 * claims requiring distinct evidence (PRODUCT-SPEC.md 6).
 */
export interface Place {
  id: string;
  name: string;
  kind: string;
  verification: PlaceVerification;
  sourceAuthority: string | null;
  operationalStatus: string | null;
  operationalEvidence: string | null;
  accessibility: string | null;
  capacityNote: string | null;
  staleSince: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * The API never returns a "safe" boolean. Distance is a calculation, not a
 * safety recommendation (PRODUCT-SPEC.md 5).
 */
export interface PlaceDistance {
  place: Place;
  distanceMeters: number;
  distanceIsCalculation: true;
}

export const API_BASE_PATH = '/api/v1' as const;
