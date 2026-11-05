import type {
  Alert,
  AlertDetail,
  AlertQueueItem,
  ApproveGuideInput,
  AuditEventView,
  AuthTokens,
  AuthRegisterInput,
  CreateGuideInput,
  GuideDetail,
  GuideListParams,
  Paginated,
  PaginatedGuideView,
  PlaceQueueItem,
  ProviderUpsertInput,
  ProviderView,
  PublicUser,
  PublishGuideInput,
  ReviewDecisionInput,
  ReviewDecisionResult,
  ReviewGuideInput,
  RetireGuideInput,
  ReviewQueueKind,
  SeedResult,
  UpdateGuideInput,
} from '@sentravyn/shared-types';
import type { LoginInput } from './auth';
import { createAuthClient } from './auth';
import { createAuditClient } from './audit';
import { createGuidesClient } from './guides';
import { createProvidersClient, type ProvidersSeedInput } from './providers';
import { createReviewClient } from './review';
import {
  createRequester,
  type Requester,
  type SentravynRequestOptions,
} from './http';

export { ApiError } from './api-error';
export { createAuthClient, type LoginInput, type AuthClient } from './auth';
export {
  createProvidersClient,
  type ProvidersSeedInput,
  type ProvidersClient,
} from './providers';
export {
  createAuditClient,
  type AuditListParams,
  type AuditClient,
} from './audit';
export { createReviewClient, type ReviewClient } from './review';
export {
  createGuidesClient,
  type GuidesClient,
} from './guides';
export {
  createRequester,
  type Requester,
  type RequestOptions,
  type SentravynRequestOptions,
} from './http';

/**
 * Typed REST client for the SENTRAVYN API.
 *
 * This is an information-and-preparedness platform. Every alert the client
 * returns carries a freshness label; the API, not the client, decides a
 * record is fresh/stale/expired (SAFETY-POLICY.md 8).
 *
 * The client is dependency-free: plain fetch against the global prefix
 * /api/v1, no token storage. Phase 2 access-token methods take the stored
 * Bearer token per call; network failures reject with the fetch error,
 * non-2xx responses reject with ApiError (status + parsed body).
 */

export interface ListAlertsParams {
  page?: number;
  pageSize?: number;
  status?: string;
  verification?: string;
}

export class SentravynApiClient {
  private readonly requester: Requester;

  constructor(options: SentravynRequestOptions) {
    this.requester = createRequester(options);
  }

  // ------------------------------------------------------------------ Phase 1

  listAlerts(params: ListAlertsParams = {}): Promise<Paginated<Alert>> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    if (params.status) query.set('status', params.status);
    if (params.verification) query.set('verification', params.verification);
    const qs = query.toString();
    return this.requester.request<Paginated<Alert>>(
      'GET',
      qs ? `/api/v1/alerts?${qs}` : '/api/v1/alerts',
    );
  }

  /**
   * GET /alerts/:id - the alert with its revision history and source
   * provenance, returned as the AlertDetail envelope ({ alert, revisions,
   * provenance }). Use `getAlertDetail`, not a bare-Alert shape: the route
   * returns the envelope, and asserting the bare shape would mislead callers
   * (alert.id would read undefined). The superseded Phase 1 `getAlert` was
   * removed for this reason.
   */
  getAlertDetail(id: string): Promise<AlertDetail> {
    return this.requester.request<AlertDetail>(
      'GET',
      `/api/v1/alerts/${encodeURIComponent(id)}`,
    );
  }

  /**
   * API metadata and disclaimer. Surfaces must display this, since SENTRAVYN
   * is not an operational emergency service (README.md "Important").
   */
  meta(): Promise<{
    name: string;
    version: string;
    environment: string;
    disclaimer: string;
    safetyRules: string[];
  }> {
    return this.requester.request<{
      name: string;
      version: string;
      environment: string;
      disclaimer: string;
      safetyRules: string[];
    }>('GET', '/api/v1/meta');
  }

  // ------------------------------------------------------------------ Phase 2

  /**
   * POST /auth/register. Creates a PUBLIC account; rejects 409 when the
   * email is already in use.
   */
  authRegister(input: AuthRegisterInput): Promise<PublicUser> {
    return createAuthClient(this.requester).register(input);
  }

  /** POST /auth/login. Returns a fresh access + refresh token pair. */
  authLogin(input: LoginInput): Promise<AuthTokens> {
    return createAuthClient(this.requester).login(input);
  }

  /** POST /auth/refresh. Rotates the refresh token; new token pair. */
  authRefresh(refreshToken: string): Promise<AuthTokens> {
    return createAuthClient(this.requester).refresh(refreshToken);
  }

  /** POST /auth/logout. Revokes the backing session; idempotent. */
  authLogout(refreshToken: string): Promise<void> {
    return createAuthClient(this.requester).logout(refreshToken);
  }

  /** GET /auth/me. Current user for the supplied Bearer access token. */
  authMe(accessToken: string): Promise<PublicUser> {
    return createAuthClient(this.requester).me(accessToken);
  }

  /** GET /admin/audit (ADMIN). Query: limit 1-200, entity filter. */
  auditList(
    params: { limit?: number; entity?: string },
    accessToken: string,
  ): Promise<AuditEventView[]> {
    return createAuditClient(this.requester).list(params, accessToken);
  }

  /** GET /providers (any authenticated role). */
  providersList(accessToken: string): Promise<ProviderView[]> {
    return createProvidersClient(this.requester).list(accessToken);
  }

  /** POST /providers (ADMIN). Upserts one provider by key. */
  providersUpsert(
    input: ProviderUpsertInput,
    accessToken: string,
  ): Promise<ProviderView> {
    return createProvidersClient(this.requester).upsert(input, accessToken);
  }

  /** POST /providers/seed (ADMIN). Idempotent; omitted input seeds fixtures. */
  providersSeed(
    input: ProvidersSeedInput | undefined,
    accessToken: string,
  ): Promise<SeedResult> {
    return createProvidersClient(this.requester).seed(input, accessToken);
  }

  /**
   * PATCH /providers/:key/enable or :key/disable (ADMIN). The `enabled` flag
   * selects the split route, keeping the intent in the URL and the audit.
   */
  providersSetEnabled(
    key: string,
    enabled: boolean,
    accessToken: string,
  ): Promise<ProviderView> {
    return createProvidersClient(this.requester).setEnabled(
      key,
      enabled,
      accessToken,
    );
  }

  /** GET /admin/review/queue (REVIEWER and above). 'alerts' | 'places'. */
  reviewQueue(
    kind: ReviewQueueKind,
    accessToken: string,
  ): Promise<AlertQueueItem[] | PlaceQueueItem[]> {
    return createReviewClient(this.requester).queue(kind, accessToken);
  }

  /** POST /admin/review/decide (REVIEWER and above). */
  reviewDecide(
    input: ReviewDecisionInput,
    accessToken: string,
  ): Promise<ReviewDecisionResult> {
    return createReviewClient(this.requester).decide(input, accessToken);
  }

  // ------------------------------------------------------------------ Phase 5

  /**
   * GET /guides (public). Only APPROVED/PUBLISHED guides are exposed; each
   * view carries the computed freshness label (SAFETY-POLICY.md 8).
   */
  guidesList(params: GuideListParams = {}): Promise<PaginatedGuideView> {
    return createGuidesClient(this.requester).list(params);
  }

  /** GET /guides/:id (public): the PUBLISHED current version + revisions. */
  guidesOne(id: string): Promise<GuideDetail> {
    return createGuidesClient(this.requester).one(id);
  }

  /** POST /admin/guides (REVIEWER and above): DRAFT at version 1. */
  guidesCreate(
    input: CreateGuideInput,
    accessToken: string,
  ): Promise<GuideDetail> {
    return createGuidesClient(this.requester).create(input, accessToken);
  }

  /** PATCH /admin/guides/:id: new revision + version bump. */
  guidesUpdate(
    id: string,
    input: UpdateGuideInput,
    accessToken: string,
  ): Promise<GuideDetail> {
    return createGuidesClient(this.requester).update(id, input, accessToken);
  }

  /** POST /admin/guides/:id/review: DRAFT -> IN_REVIEW. */
  guidesReview(
    id: string,
    input: ReviewGuideInput,
    accessToken: string,
  ): Promise<GuideDetail> {
    return createGuidesClient(this.requester).review(id, input, accessToken);
  }

  /** POST /admin/guides/:id/approve: IN_REVIEW -> APPROVED (completeness gate). */
  guidesApprove(
    id: string,
    input: ApproveGuideInput,
    accessToken: string,
  ): Promise<GuideDetail> {
    return createGuidesClient(this.requester).approve(id, input, accessToken);
  }

  /** POST /admin/guides/:id/publish: APPROVED -> PUBLISHED. */
  guidesPublish(
    id: string,
    input: PublishGuideInput,
    accessToken: string,
  ): Promise<GuideDetail> {
    return createGuidesClient(this.requester).publish(id, input, accessToken);
  }

  /** POST /admin/guides/:id/retire: PUBLISHED -> RETIRED. */
  guidesRetire(
    id: string,
    input: RetireGuideInput,
    accessToken: string,
  ): Promise<GuideDetail> {
    return createGuidesClient(this.requester).retire(id, input, accessToken);
  }

  /** POST /admin/guides/:id/reopen: RETIRED -> DRAFT. */
  guidesReopen(id: string, accessToken: string): Promise<GuideDetail> {
    return createGuidesClient(this.requester).reopen(id, accessToken);
  }
}
