import type {
  ApproveGuideInput,
  CreateGuideInput,
  GuideDetail,
  GuideListParams,
  PaginatedGuideView,
  PublishGuideInput,
  ReviewGuideInput,
  RetireGuideInput,
  UpdateGuideInput,
} from '@sentravyn/shared-types';
import type { Requester } from './http';

/**
 * Safety-guide endpoints (Phase 5; SAFETY-POLICY.md 5, 8, 10).
 *
 * Public reads (list, one) surface only APPROVED/PUBLISHED guides and carry
 * the computed freshness label; the admin mutations are REVIEWER/OPERATOR/
 * ADMIN only and each writes an audit row (SECURITY.md 6).
 *
 * The public methods take no token; the admin methods take the stored
 * Bearer access token per call, matching the existing authed modules.
 */
export interface GuidesClient {
  /** GET /guides — public listing, paginated and filterable. */
  list(params?: GuideListParams): Promise<PaginatedGuideView>;
  /** GET /guides/:id — one public guide (current version + revisions). */
  one(id: string): Promise<GuideDetail>;
  /** POST /admin/guides — create a DRAFT at version 1. */
  create(input: CreateGuideInput, accessToken: string): Promise<GuideDetail>;
  /** PATCH /admin/guides/:id — new revision + version bump. */
  update(
    id: string,
    input: UpdateGuideInput,
    accessToken: string,
  ): Promise<GuideDetail>;
  /** POST /admin/guides/:id/review — DRAFT -> IN_REVIEW. */
  review(
    id: string,
    input: ReviewGuideInput,
    accessToken: string,
  ): Promise<GuideDetail>;
  /** POST /admin/guides/:id/approve — IN_REVIEW -> APPROVED (completeness gate). */
  approve(
    id: string,
    input: ApproveGuideInput,
    accessToken: string,
  ): Promise<GuideDetail>;
  /** POST /admin/guides/:id/publish — APPROVED -> PUBLISHED. */
  publish(
    id: string,
    input: PublishGuideInput,
    accessToken: string,
  ): Promise<GuideDetail>;
  /** POST /admin/guides/:id/retire — PUBLISHED -> RETIRED. */
  retire(
    id: string,
    input: RetireGuideInput,
    accessToken: string,
  ): Promise<GuideDetail>;
  /** POST /admin/guides/:id/reopen — RETIRED -> DRAFT (new review cycle). */
  reopen(id: string, accessToken: string): Promise<GuideDetail>;
}

function buildListPath(params: GuideListParams | undefined): string {
  if (!params) return '/api/v1/guides';
  const query = new URLSearchParams();
  if (params.page !== undefined) query.set('page', String(params.page));
  if (params.pageSize !== undefined)
    query.set('pageSize', String(params.pageSize));
  if (params.hazardType) query.set('hazardType', params.hazardType);
  if (params.approval) query.set('approval', params.approval);
  if (params.language) query.set('language', params.language);
  if (params.stale !== undefined) query.set('stale', String(params.stale));
  const qs = query.toString();
  return qs !== '' ? `/api/v1/guides?${qs}` : '/api/v1/guides';
}

export function createGuidesClient(req: Requester): GuidesClient {
  const jsonHeaders = { 'content-type': 'application/json' } as const;
  return {
    list: (params) => req.request<PaginatedGuideView>('GET', buildListPath(params)),
    one: (id) =>
      req.request<GuideDetail>(
        'GET',
        `/api/v1/guides/${encodeURIComponent(id)}`,
      ),
    create: (input, accessToken) =>
      req.requestAuthed<GuideDetail>(
        'POST',
        '/api/v1/admin/guides',
        accessToken,
        { headers: jsonHeaders, body: JSON.stringify(input) },
      ),
    update: (id, input, accessToken) =>
      req.requestAuthed<GuideDetail>(
        'PATCH',
        `/api/v1/admin/guides/${encodeURIComponent(id)}`,
        accessToken,
        { headers: jsonHeaders, body: JSON.stringify(input) },
      ),
    review: (id, input, accessToken) =>
      req.requestAuthed<GuideDetail>(
        'POST',
        `/api/v1/admin/guides/${encodeURIComponent(id)}/review`,
        accessToken,
        { headers: jsonHeaders, body: JSON.stringify(input) },
      ),
    approve: (id, input, accessToken) =>
      req.requestAuthed<GuideDetail>(
        'POST',
        `/api/v1/admin/guides/${encodeURIComponent(id)}/approve`,
        accessToken,
        { headers: jsonHeaders, body: JSON.stringify(input) },
      ),
    publish: (id, input, accessToken) =>
      req.requestAuthed<GuideDetail>(
        'POST',
        `/api/v1/admin/guides/${encodeURIComponent(id)}/publish`,
        accessToken,
        { headers: jsonHeaders, body: JSON.stringify(input) },
      ),
    retire: (id, input, accessToken) =>
      req.requestAuthed<GuideDetail>(
        'POST',
        `/api/v1/admin/guides/${encodeURIComponent(id)}/retire`,
        accessToken,
        { headers: jsonHeaders, body: JSON.stringify(input) },
      ),
    reopen: (id, accessToken) =>
      req.requestAuthed<GuideDetail>(
        'POST',
        `/api/v1/admin/guides/${encodeURIComponent(id)}/reopen`,
        accessToken,
        { headers: jsonHeaders, body: JSON.stringify({}) },
      ),
  };
}
