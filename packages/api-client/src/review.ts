import type {
  AlertQueueItem,
  PlaceQueueItem,
  ReviewDecisionInput,
  ReviewDecisionResult,
  ReviewQueueKind,
} from '@sentravyn/shared-types';
import type { Requester } from './http';

/**
 * Admin review endpoints (backend/src/admin/admin-review.controller.ts).
 *
 * REVIEWER, OPERATOR and ADMIN only; requests from lesser roles reject 403.
 * The queue organises human review and never asserts safety (SAFETY-POLICY.md 3).
 */
export interface ReviewClient {
  /**
   * GET /admin/review/queue. 'alerts' returns quarantined/received alerts
   * with provenance; 'places' returns shelter profiles that are not VERIFIED.
   */
  queue(kind: ReviewQueueKind, accessToken: string): Promise<AlertQueueItem[] | PlaceQueueItem[]>;

  /**
   * POST /admin/review/decide. SHELTER_VERIFIED additionally requires
   * authority and an ISO verificationDate in the input (Gate E); a missing
   * value rejects 400 with a policy-specific message.
   */
  decide(input: ReviewDecisionInput, accessToken: string): Promise<ReviewDecisionResult>;
}

export function createReviewClient(req: Requester): ReviewClient {
  return {
    queue: (kind, accessToken) =>
      req.requestAuthed<AlertQueueItem[] | PlaceQueueItem[]>(
        'GET',
        `/api/v1/admin/review/queue?kind=${encodeURIComponent(kind)}`,
        accessToken,
      ),
    decide: (input, accessToken) =>
      req.requestAuthed<ReviewDecisionResult>('POST', '/api/v1/admin/review/decide', accessToken, {
        headers: { 'content-type': 'application/json' },
        // JSON.stringify omits undefined rationale/authority/verificationDate,
        // matching the DTO's optional fields under forbidNonWhitelisted.
        body: JSON.stringify(input),
      }),
  };
}
