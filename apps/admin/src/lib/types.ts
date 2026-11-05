/**
 * Typed shapes for the Phase 2 admin API (backend, /api/v1).
 *
 * These mirror the backend contract directly so this app never depends on
 * in-flight shared packages. Strict TS throughout: no `any`.
 */

export type Role = 'PUBLIC' | 'REVIEWER' | 'OPERATOR' | 'ADMIN';

/** Public (non-PII) user shape returned by the auth endpoints. */
export interface PublicUser {
  id: string;
  email: string;
  role: Role;
  displayName: string | null;
}

export interface AuthTokenPair {
  accessToken: string;
  /** 64-hex opaque token; treated as a secret, never displayed. */
  refreshToken: string;
  user: PublicUser;
}

/**
 * Returned by POST /auth/login instead of a token pair when the account is a
 * privileged role (OPERATOR/ADMIN) with MFA enrolled: a short-lived pending
 * token (5 minutes) plus the number of single-use recovery codes left.
 * POST /auth/mfa/complete exchanges it plus a TOTP/recovery code for a full
 * token pair (SECURITY.md section 2).
 */
export interface MfaPendingLogin {
  mfaPending: true;
  mfaTempToken: string;
  recoveryCodesRemaining: number;
}

export type LoginResponse = AuthTokenPair | MfaPendingLogin;

export function isMfaPending(
  response: LoginResponse,
): response is MfaPendingLogin {
  return (response as MfaPendingLogin).mfaPending === true;
}

export interface MfaSetupResult {
  /** Base32 TOTP seed, shown once. */
  secret: string;
  /** otpauth:// URI for authenticator apps. */
  uri: string;
  /** 8 single-use recovery codes, shown once; only their hashes persist. */
  recoveryCodes: string[];
  mfaEnabled: false;
}

export interface MfaStatusView {
  mfaEnabled: boolean;
  recoveryCodesRemaining: number;
}

export interface MfaVerifyResult {
  mfaEnabled: true;
  recoveryCodesRemaining: number;
}

/** Session metadata (GET /auth/sessions); never carries token material. */
export interface SessionView {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  expiresAt: string;
}

/** Provider registry view (GET /providers; no credential material). */
export interface ProviderView {
  key: string;
  name: string;
  docUrl: string | null;
  category: string;
  license: string | null;
  attribution: string | null;
  enabled: boolean;
  freshnessPolicyHours: number | null;
  /** ISO timestamp, or null when the provider has never been seeded. */
  lastSeededAt: string | null;
}

export interface ProviderUpsertInput {
  /** Kebab-case, 2-63 chars. */
  key: string;
  name: string;
  docUrl: string;
  category?: string;
  license?: string;
  attribution?: string;
  enabled?: boolean;
  freshnessPolicyHours?: number;
}

export interface SeedResult {
  seededKeys: string[];
  lastSeededAt: string;
}

export type QueueKind = 'alerts' | 'places';

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
  /** Source-record provenance, null when the alert has no raw record. */
  provenance: {
    sourceUrl: string | null;
    payloadHash: string | null;
    fetchedAt: string | null;
  } | null;
  /** Source provider key, null when unresolvable. */
  providerKey: string | null;
}

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

export type Decision =
  'REVIEW_APPROVED' | 'REVIEW_REJECTED' | 'SHELTER_VERIFIED' | 'SHELTER_STALE';

export type TargetKind = 'alert' | 'place' | 'shelter';

export interface DecideInput {
  target: {
    kind: TargetKind;
    id: string;
  };
  decision: Decision;
  rationale?: string;
  /** Required together with verificationDate for SHELTER_VERIFIED. */
  authority?: string;
  /** ISO date string; required for SHELTER_VERIFIED. */
  verificationDate?: string;
}

export interface DecideResult {
  decisionId: string;
  decision: Decision;
  targetKind: string;
  targetId: string;
  auditAction: string;
}

export interface AuditEvent {
  id: string;
  actorUserId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  /** JSON string payload, capped server-side; may be null. */
  detail: string | null;
  createdAt: string;
}

export interface AuditQuery {
  limit?: number;
  entity?: string;
}

/** Raised when an API error carries a human-readable message. */
export class ApiError extends Error {
  readonly status: number;
  /** API error body (400/403 etc.), shown verbatim where the spec says so. */
  readonly body: string;

  constructor(status: number, message: string, body: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/* ------------------------------------------------------------------------ */
/* Phase 5: safety-guide workflow (GET /guides, /admin/guides + sub-routes). */
/* Mirrors packages/shared-types and backend/src/guides; admin lib types are */
/* self-contained, so the contract is duplicated verbatim here.              */
/* ------------------------------------------------------------------------ */

export type GuideApprovalState =
  'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'RETIRED';

export type GuideFreshness = 'fresh' | 'stale' | 'unknown';

export interface GuideRevisionView {
  revision: number;
  body: string;
  /** ISO 8601. */
  createdAt: string;
}

export interface GuideView {
  id: string;
  hazardType: string;
  jurisdiction: string | null;
  language: string;
  author: string | null;
  reviewer: string | null;
  authority: string | null;
  approval: GuideApprovalState;
  version: number;
  /** ISO 8601; null when the guide has never been reviewed. */
  lastReviewedAt: string | null;
  references: string[];
  /** Body of the current revision; null if none was written. */
  body: string | null;
  freshness: GuideFreshness;
  createdAt: string;
  updatedAt: string;
}

export interface GuideDetail extends GuideView {
  revisions: GuideRevisionView[];
}

export interface GuideListQuery {
  page?: number;
  pageSize?: number;
  hazardType?: string;
  approval?: GuideApprovalState;
  language?: string;
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

export interface GuideUpdateInput {
  body?: string;
  jurisdiction?: string;
  language?: string;
  author?: string;
  reviewer?: string;
  authority?: string;
  references?: string[];
}

/** Body for POST /admin/guides (DRAFT at version 1; body is required). */
export interface GuideCreateInput {
  hazardType: string;
  /** Non-empty; a placeholder guide must say so explicitly in the body. */
  body: string;
  jurisdiction?: string;
  language?: string;
  author?: string;
  reviewer?: string;
  authority?: string;
  references?: string[];
}

export interface GuideReviewInput {
  reviewer?: string;
  authority?: string;
  /** ISO 8601; defaults to now. */
  reviewedAt?: string;
}

export interface GuideApproveInput {
  rationale?: string;
  reviewedAt?: string;
}

export interface GuidePublishInput {
  rationale?: string;
  reviewedAt?: string;
}

export interface GuideRetireInput {
  rationale?: string;
  /** ISO 8601; defaults to now. */
  retiredAt?: string;
}
