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

// ---------------------------------------------------------------------------
// Phase 2: identity, provider registry, audit trail and admin review.
// References: SECURITY.md 2 and 6, DATA-SOURCES.md 2, SAFETY-POLICY.md 3.
// ---------------------------------------------------------------------------

/**
 * RBAC role of an account.
 *
 * MUST stay in sync with the Prisma `Role` enum
 * (backend/prisma/schema.prisma); backend/test/rbac.spec.ts asserts the
 * backend's copy matches. This package is dependency-free, so the sync is
 * a reviewed invariant, not a compile-time one.
 */
export type Role = 'PUBLIC' | 'REVIEWER' | 'OPERATOR' | 'ADMIN';

/**
 * Public account shape returned by the auth endpoints. Never contains
 * credential material (backend/src/auth/auth.service.ts).
 */
export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  displayName: string | null;
}

/** Token pair plus the public user, returned by login and refresh. */
export interface AuthTokens {
  accessToken: string;
  /** Opaque refresh token; only its hash is stored server-side. */
  refreshToken: string;
  user: PublicUser;
}

/**
 * Body for POST /auth/register. The API lowercases the email and creates a
 * PUBLIC account; password is 12-128 chars, displayName up to 120 chars.
 */
export interface AuthRegisterInput {
  email: string;
  displayName?: string;
  password: string;
}

/** Registry row returned by GET /providers; no credential material. */
export interface ProviderView {
  key: string;
  name: string;
  docUrl: string | null;
  category: string;
  license: string | null;
  attribution: string | null;
  enabled: boolean;
  freshnessPolicyHours: number | null;
  /** ISO 8601 timestamp of the last seed, null when never seeded. */
  lastSeededAt: string | null;
}

/**
 * Body for POST /providers and for seed rows
 * (backend/src/providers/providers.dto.ts). The key is the upsert
 * identity: an existing provider with the same key is updated in place.
 */
export interface ProviderUpsertInput {
  /**
   * Stable provider identifier, 2-63 chars, lowercase kebab-case:
   * /^[a-z0-9][a-z0-9-]{1,62}$/.
   */
  key: string;
  /** Display name, 2-200 chars. */
  name: string;
  /** Official documentation URL. */
  docUrl: string;
  /** Optional category, up to 100 chars (API default: 'alerts'). */
  category?: string;
  /** Optional license note, up to 500 chars. */
  license?: string;
  /** Optional attribution note, up to 500 chars. */
  attribution?: string;
  /** Optional enablement flag (API default: false; re-seeding never flips it). */
  enabled?: boolean;
  /** Maximum data age in whole hours before stale, 1-240 (SAFETY-POLICY.md 8). */
  freshnessPolicyHours?: number;
}

/** Result of POST /providers/seed. */
export interface SeedResult {
  /** Provider keys upserted in this run, in seed order. */
  seededKeys: string[];
  /** ISO 8601 timestamp applied to every seeded row. */
  lastSeededAt: string;
}

/**
 * One row of the admin audit trail (GET /admin/audit, SECURITY.md 6).
 * Actions come from a closed canonical set (backend AUDIT_ACTIONS):
 * ALERT_PUBLISHED, ALERT_UPDATED, ALERT_CANCELLED, SHELTER_VERIFIED,
 * SHELTER_REJECTED, PROVIDER_CHANGED, USER_ROLE_CHANGED, SESSION_REVOKED,
 * SESSION_REFRESHED, GUIDE_REVIEWED, GUIDE_APPROVED, GUIDE_PUBLISHED,
 * GUIDE_RETIRED, GUIDE_UPDATED.
 */
export interface AuditEventView {
  id: string;
  /** null for system-driven actions (e.g. provider ingestion). */
  actorUserId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  /** Free-text detail, capped at 2000 chars by the API; preserved verbatim. */
  detail: string | null;
  /** ISO 8601. */
  createdAt: string;
}

/** Kinds of the admin review queue (GET /admin/review/queue). */
export type ReviewQueueKind = 'alerts' | 'places';

/** Kinds of a review decision target (POST /admin/review/decide). */
export type ReviewTargetKind = 'alert' | 'place' | 'shelter';

/** Closed set of review decision outcomes (SAFETY-POLICY.md 3). */
export type ReviewDecision =
  | 'REVIEW_APPROVED'
  | 'REVIEW_REJECTED'
  | 'SHELTER_VERIFIED'
  | 'SHELTER_STALE';

/**
 * Body for POST /admin/review/decide.
 *
 * SHELTER_VERIFIED additionally requires `authority` and an ISO 8601
 * `verificationDate`; the API rejects the decision before any state change
 * (shelter-policy.ts, Gate E) - a shelter is never verified on proximity
 * alone.
 */
export interface ReviewDecisionInput {
  target: {
    kind: ReviewTargetKind;
    /** Target id, up to 64 chars. */
    id: string;
  };
  decision: ReviewDecision;
  /** Optional rationale, up to 2000 chars. */
  rationale?: string;
  /** Verifying authority, up to 300 chars; required for SHELTER_VERIFIED. */
  authority?: string;
  /** ISO 8601 date; required for SHELTER_VERIFIED. */
  verificationDate?: string;
}

/** Recorded outcome of a review decision, with the audit action it raised. */
export interface ReviewDecisionResult {
  decisionId: string;
  decision: ReviewDecision;
  targetKind: string;
  targetId: string;
  /** Canonical audit action recorded for this decision (SECURITY.md 6). */
  auditAction: string;
}

/**
 * Alert review queue item: a QUARANTINED or RECEIVED alert carrying
 * source-record provenance (ADR-007) and the source provider key, null
 * when unresolvable.
 */
export interface AlertQueueItem {
  alert: {
    id: string;
    externalRef: string | null;
    status: string;
    headline: string;
    issuer: string | null;
    issuedAt: string | null;
    createdAt: string;
  };
  /** RawSourceRecord provenance, null when the alert has no source record. */
  provenance: {
    sourceUrl: string | null;
    payloadHash: string | null;
    fetchedAt: string | null;
  } | null;
  /** Source DataProvider key, null when unresolvable. */
  providerKey: string | null;
}

/**
 * Place review queue item: a shelter profile that is not VERIFIED, joined
 * to its place. The queue organises human review; it never asserts safety.
 */
export interface PlaceQueueItem {
  place: {
    id: string;
    name: string;
    kind: string;
    verification: string;
  };
  shelter: {
    id: string;
    verification: string;
    inspectAuthority: string | null;
    inspectionDate: string | null;
  };
}

// ---------------------------------------------------------------------------
// Phase 3: durable alert detail (GET /alerts/:id).
// ADR-005 (alert revision history) + ADR-007 (immutable source-record
// provenance); SAFETY-POLICY.md 8 (explicit freshness, never stale-as-live).
// ---------------------------------------------------------------------------

/** One alert revision (ADR-005 update/cancel history). */
export interface AlertRevisionView {
  revision: number;
  status: string;
  body: string | null;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

/**
 * Source provenance of an alert (ADR-007). `providerKey` is null when the
 * underlying DataProvider row was deleted; the nested `provider` carries the
 * registry row's display fields, or null in that case.
 */
export interface AlertProvenanceView {
  sourceRecordId: string;
  sourceUrl: string | null;
  payloadHash: string;
  /** ISO 8601 timestamp. */
  fetchedAt: string;
  providerKey: string | null;
  provider: {
    name: string;
    docUrl: string | null;
    license: string | null;
    attribution: string | null;
    enabled: boolean;
    freshnessPolicyHours: number | null;
  } | null;
}

/**
 * Single-alert detail payload (GET /alerts/:id): the alert itself, its
 * revision history in ascending revision order and its source provenance.
 * Mirrors backend/src/alerts/alerts.service.ts (AlertDetail); freshness uses
 * the source provider's freshnessPolicyHours, falling back to the default
 * when unresolvable (SAFETY-POLICY.md 8).
 */
export interface AlertDetail {
  alert: Alert;
  revisions: AlertRevisionView[];
  /** null when the alert has no source record. */
  provenance: AlertProvenanceView | null;
}

// ---------------------------------------------------------------------------
// Phase 4: places API (public). Mirrors backend/src/places/places.service.ts
// (a1) response shapes and backend/src/shelters/shelter-policy.ts
// (VerificationLabel) so surfaces assert on the real contract; `kind` is a
// free string on the backend (schema comment: "hospital", "shelter", ...).
//
// GET /places has two modes:
//   - Radius mode (both lat + lng): items are PlaceListItemNear (nearest
//     first, each with distanceMeters + the distanceIsCalculation disclosure),
//     and a coverageNote only when the search is empty. No pagination.
//   - Default mode (no coordinates): items are PlaceListItemListed (the full
//     record) with a pagination envelope. Distance fields are absent.
// ---------------------------------------------------------------------------

/**
 * Read-path display label for a place (ADR-018). Computed on read, never
 * stored: a stored VERIFIED place downgrades to STALE / EXPIRED / INCOMPLETE
 * when its shelter evidence is no longer current, so a lapsed shelter can
 * never be shown as VERIFIED. Surfaces must render the label as TEXT, not
 * colour alone (DESIGN.md 3).
 */
export type VerificationLabel =
  | 'UNVERIFIED'
  | 'REVIEWED'
  | 'VERIFIED'
  | 'STALE'
  | 'EXPIRED'
  | 'INCOMPLETE';

/**
 * The fields common to every place row, in either /places mode. `kind` is a
 * free string; trust attributes are passed through verbatim so surfaces
 * render verification and staleness (a listing is never a "safe" claim).
 */
export interface PlaceListItemBase {
  id: string;
  name: string;
  kind: string;
  /** Stored place verification: UNVERIFIED / REVIEWED / VERIFIED. */
  verification: string;
  operationalStatus: string | null;
  operationalEvidence: string | null;
  /** ISO 8601; set when the place is flagged stale. */
  staleSince: string | null;
  lat: number | null;
  lng: number | null;
  /** The computed display label the surface must show. */
  verificationLabel: VerificationLabel;
  /** Human-readable reasons the label is not plain VERIFIED (empty when it is). */
  verificationLabelReasons: string[];
}

/** A radius-mode row: geodetic distance + the mandatory calculation disclosure. */
export interface PlaceListItemNear extends PlaceListItemBase {
  /** Geodetic metres from the search centre (geography type, ADR-004). */
  distanceMeters: number;
  /** Literal true: distance is a derived calculation, never a recommendation. */
  distanceIsCalculation: true;
}

/** A default-mode row: the full place record (no distance fields). */
export interface PlaceListItemListed extends PlaceListItemBase {
  sourceAuthority: string | null;
  accessibility: string | null;
  capacityNote: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
}

/** One /places row: either a radius row or a full-record row. */
export type PlaceListItem = PlaceListItemNear | PlaceListItemListed;

/**
 * The /places envelope. Radius mode omits `pagination` and carries
 * `coverageNote` when empty; default mode carries `pagination` and omits
 * `coverageNote`. Distance is a calculation, never a safety recommendation
 * (PRODUCT-SPEC.md 5).
 */
export interface PlacesListResponse {
  items: PlaceListItem[];
  /** Default mode only: { page, pageSize, total }. Absent in radius mode. */
  pagination?: { page: number; pageSize: number; total: number };
  /** The fixed coverage disclosure; present only when a radius search is empty. */
  coverageNote?: string;
}

/**
 * A convenience row type for surfaces that consume radius-mode results: the
 * base fields plus an optional distance. (The API radius row is
 * PlaceListItemNear, which is assignable to this.)
 */
export interface PlaceGeoRow extends PlaceListItemBase {
  distanceMeters?: number | null;
  distanceIsCalculation?: boolean;
}

/** One shelter profile inside a place detail (verification, inspection, expiry). */
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
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
}

/** One user-submitted evidence view (untrusted user data; asserts nothing). */
export interface PlaceEvidenceView {
  id: string;
  claim: string;
  sourceUrl: string | null;
  recordedByUserId: string | null;
  /** ISO 8601. */
  createdAt: string;
}

/**
 * Full place detail: GET /places/:id. Carries the place record (the full
 * listed shape), its shelter profiles, its user-submitted evidence, and the
 * computed verification label plus the reasons it is (or is not) VERIFIED.
 */
export interface PlaceDetail {
  place: PlaceListItemListed;
  /**
   * The place's computed display label, carried at the top level so a
   * surface can render the chip without re-deriving it from the record.
   */
  verificationLabel: VerificationLabel;
  verificationLabelReasons: string[];
  shelterProfiles: ShelterProfileView[];
  evidence: PlaceEvidenceView[];
}

// ---------------------------------------------------------------------------
// Phase 7: family safety (consent-based, SECURITY.md 5). These view shapes
// mirror backend/src/family-safety/family-safety.service.ts; `active` is a
// computed read-time flag, never a stored value.
// ---------------------------------------------------------------------------

/** GET/POST/PATCH /family/contacts — the user's own emergency contacts. */
export interface EmergencyContactView {
  id: string;
  name: string;
  relation: string | null;
  phone: string | null;
  /** Explicit consent for SENTRAVYN to contact/reference this person. */
  consent: boolean;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
}

/** Input for POST /family/contacts. */
export interface EmergencyContactInput {
  name: string;
  relation?: string;
  phone?: string;
  consent?: boolean;
}

/** Partial update for PATCH /family/contacts/:id (owner-scoped). */
export type EmergencyContactPatch = Partial<EmergencyContactInput>;

/** A consent-based location share (Phase 7, SECURITY.md 5). */
export interface LocationShareView {
  id: string;
  /** Who may see the location. */
  recipient: string;
  /** Why (explicit consent scope). */
  purpose: string;
  /** Whether precise coordinates are allowed for this share. */
  preciseConsent: boolean;
  /** Coarse last-known position (~km), never precise; null when not shared yet. */
  lastKnownLat: number | null;
  lastKnownLng: number | null;
  /** ISO 8601. */
  lastKnownAt: string | null;
  /** ISO 8601; the share is never open-ended. */
  expiresAt: string;
  revoked: boolean;
  /** ISO 8601. */
  revokedAt: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** Computed at read time: consented, not revoked, not expired. Never stored. */
  active: boolean;
}

/**
 * Input for POST /family/location-shares. Explicit consent: recipient +
 * purpose + a bounded expiresAt are required. A coarse position may be
 * recorded; precise coordinates are never accepted (server rounds to ~km).
 */
export interface LocationShareInput {
  recipient: string;
  purpose: string;
  /** ISO 8601; must outlive creation. */
  expiresAt: string;
  preciseConsent?: boolean;
  /** Coarse decimal degree strings, ~km precision. */
  lastKnownLat?: string;
  lastKnownLng?: string;
}

/** The user's household preparedness plan (their own data, not live claims). */
export interface HouseholdPlanView {
  id: string;
  meetingPoint: string | null;
  meetingPointNote: string | null;
  kitChecklist: { label: string; done: boolean }[];
  petConsiderations: string | null;
  /** ISO 8601. */
  createdAt: string;
  /** ISO 8601. */
  updatedAt: string;
}

/** Input for PUT /family/household-plan (owner-scoped upsert). */
export interface HouseholdPlanInput {
  meetingPoint?: string;
  meetingPointNote?: string;
  kitChecklist?: { label: string; done: boolean }[];
  petConsiderations?: string;
}

// Phase 5: reviewed safety-guides workflow.
// SAFETY-POLICY.md 5, 8, 10; PRODUCT-SPEC.md 5; backend/src/guides.
// Every guide view carries a computed freshness label (fresh/stale/unknown)
// and the approval state verbatim, so surfaces can never present a stale or
// unpublished guide as current (SAFETY-POLICY.md 8, 2).
// ---------------------------------------------------------------------------

/** Closed set of guide approval states; mirrors the Prisma enum. */
export const GUIDE_APPROVAL_STATES = [
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'PUBLISHED',
  'RETIRED',
] as const;
export type GuideApprovalState = (typeof GUIDE_APPROVAL_STATES)[number];

/**
 * The closed hazard categories a guide applies to (PRODUCT-SPEC.md 4).
 * Guidance is hazard-specific and independently reviewed; it is never reused
 * across types (SAFETY-POLICY.md 5).
 */
export const HAZARD_TYPES = [
  'NUCLEAR',
  'RADIOLOGICAL',
  'CONFLICT',
  'MISSILE',
  'EARTHQUAKE',
  'TSUNAMI',
  'FLOOD',
  'CYCLONE',
  'SEVERE_WEATHER',
  'WILDFIRE',
  'INDUSTRIAL',
  'CHEMICAL',
  'PUBLIC_HEALTH',
  'INFRASTRUCTURE',
  'UTILITY',
] as const;
export type HazardType = (typeof HAZARD_TYPES)[number];

/** Freshness label the API computes for every guide view (SAFETY-POLICY 8). */
export type GuideFreshnessState = 'fresh' | 'stale' | 'unknown';

/** One guide revision (version history; ADR-009 summary, cited). */
export interface GuideRevisionView {
  revision: number;
  body: string;
  /** ISO 8601. */
  createdAt: string;
}

/**
 * A safety guide as the public and admin surfaces see it. The body is the
 * current (version) revision's text; `references` are the authoritative
 * source links that must accompany any summary (SAFETY-POLICY.md 6, 10).
 *
 * The `summariesOnly` flag is a rendering contract, not a stored column:
 * every consumer MUST surface a "summaries only, not official instructions"
 * label next to the body. SENTRAVYN is not a substitute for official
 * emergency instructions (SAFETY-POLICY.md 1).
 */
export interface GuideView {
  id: string;
  hazardType: string;
  jurisdiction: string | null;
  language: string;
  author: string | null;
  /** Named responsible reviewer (SAFETY-POLICY.md 10). */
  reviewer: string | null;
  /** The verifying authority on record. */
  authority: string | null;
  approval: GuideApprovalState;
  /** Current version; a new revision write bumps this. */
  version: number;
  /** ISO 8601; null when the guide has never been reviewed. */
  lastReviewedAt: string | null;
  /** Authoritative source references (non-empty for published guides). */
  references: string[];
  /** Body of the current revision; null if none was written. */
  body: string | null;
  /** Computed freshness label (SAFETY-POLICY.md 8). */
  freshness: GuideFreshnessState;
  createdAt: string;
  updatedAt: string;
}

/** Guide detail: the view plus the full revision history, ascending. */
export interface GuideDetail extends GuideView {
  revisions: GuideRevisionView[];
}

/** Query params for GET /guides (public) and GET /admin/guides (admin). */
export interface GuideListParams {
  page?: number;
  pageSize?: number;
  /** Hazard category filter. */
  hazardType?: string;
  /** APPROVED/PUBLISHED only on the public surface; any state on the admin. */
  approval?: GuideApprovalState;
  /** BCP-47 style code ('en', 'de'). */
  language?: string;
  /**
   * Stale flag: true = only guides whose lastReviewedAt is at or beyond the
   * review window; false = only guides within the window. A null review date
   * matches neither (it is 'unknown', not 'stale').
   */
  stale?: boolean;
}

export interface PaginatedGuideView {
  items: GuideView[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

/** Body for POST /guides (admin; creates a DRAFT at version 1). */
export interface CreateGuideInput {
  hazardType: string;
  /** Non-empty; a placeholder guide must say so explicitly in the body. */
  body: string;
  jurisdiction?: string;
  language?: string;
  author?: string;
  reviewer?: string;
  authority?: string;
  /** Authoritative source references; publication requires at least one. */
  references?: string[];
}

/** Body for PATCH /guides/:id (admin; writes a new revision + version bump). */
export interface UpdateGuideInput {
  body?: string;
  jurisdiction?: string;
  language?: string;
  author?: string;
  reviewer?: string;
  authority?: string;
  references?: string[];
}

/** Body for POST /guides/:id/review. */
export interface ReviewGuideInput {
  reviewer?: string;
  authority?: string;
  /** ISO 8601; defaults to now. */
  reviewedAt?: string;
}

/** Body for POST /guides/:id/approve. */
export interface ApproveGuideInput {
  rationale?: string;
  reviewedAt?: string;
}

/** Body for POST /guides/:id/publish. */
export interface PublishGuideInput {
  rationale?: string;
  reviewedAt?: string;
}

/** Body for POST /guides/:id/retire. */
export interface RetireGuideInput {
  rationale?: string;
  /** ISO 8601; defaults to now. */
  retiredAt?: string;
}
