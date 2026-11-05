/**
 * Phase 6 notification domain types (docs/ROADMAP.md Phase 6; ARCHITECTURE.md 6).
 *
 * These mirror the Prisma `NotificationChannel` / `NotificationStatus` enums
 * without importing the generated client into the type surface, so the
 * worker entrypoint and the push adapters share one canonical set.
 */

/** Mirrors Prisma `NotificationChannel`. */
export type NotificationChannel =
  'WEBSOCKET' | 'PUSH_WEB' | 'PUSH_FCM' | 'PUSH_APNS';

/** Mirrors Prisma `NotificationStatus`. */
export type NotificationStatus =
  'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED' | 'DROPPED';

/** Every push channel that the durable BullMQ worker is responsible for. */
export const PUSH_CHANNELS: NotificationChannel[] = [
  'PUSH_WEB',
  'PUSH_FCM',
  'PUSH_APNS',
];

/** The live channel, delivered by the Socket.IO gateway (not the worker). */
export const WEBSOCKET_CHANNEL: NotificationChannel = 'WEBSOCKET';

/**
 * Payload of one idempotent notification job. A single job covers one
 * alert status transition fanned out to the push channels; the `dedupKey`
 * is stable across retries of the same transition (`alert:<id>:<status>`)
 * so BullMQ jobId deduplication + the repository's dedup-key lookup both
 * prevent duplicate work.
 */
export interface NotificationJobPayload {
  /** Alert id being published. */
  alertId: string;
  /** Status the alert has just moved to (PUBLISHED / UPDATED). */
  nextStatus: 'PUBLISHED' | 'UPDATED';
  /** Stable dedup key: `alert:<alertId>:<nextStatus>`. */
  dedupKey: string;
  /** Headline, for push payloads (short, user-facing; no source PII). */
  headline: string;
  severity: string | null;
  urgency: string | null;
  issuer: string | null;
  /** Channels this job should fan out to (push channels only). */
  channels: NotificationChannel[];
  /** ISO 8601 issued time, carried through for push payloads. */
  issuedAt: string | null;
}

/** Result of a single push-channel delivery attempt. */
export interface DeliveryResult {
  /** True when the provider accepted the message as delivered. */
  delivered: boolean;
  /** True when the channel is not configured / cannot be reached at all. */
  unavailable: boolean;
  /** Provider receipt / message id when available (never a credential). */
  receipt?: string;
  /** Human-safe error summary. Never contains provider secrets. */
  error?: string;
}

/**
 * A push adapter is provider-agnostic and credential-gated. With no provider
 * credentials present it MUST return `unavailable: true` and never report a
 * delivery that did not happen (SAFETY-POLICY / ARCHITECTURE 6: no fabricated
 * delivery). Adapters must never log provider credentials.
 */
export interface PushAdapter {
  /** The channel this adapter delivers on. */
  channel: NotificationChannel;
  /**
   * Deliver one notification on this channel. Must not throw for
   * configuration problems; report them via the returned result.
   */
  send(job: NotificationJobPayload): Promise<DeliveryResult>;
  /**
   * Whether this adapter is configured enough to attempt delivery. A false
   * value short-circuits to `unavailable` without a network call.
   */
  isConfigured(): boolean;
}

/** A durable sync page returned by the gateway / REST sync endpoints. */
export interface SyncItem {
  alertId: string;
  revision: number;
  status: string;
  headline: string;
  severity: string | null;
  urgency: string | null;
  issuer: string | null;
  issuedAt: string | null;
  /** Stable identity of this revision row (the sync cursor token itself is
   * `SyncResult.nextCursor`, an encoded (createdAt, alertId, revision) key). */
  cursor: string;
  /** ISO 8601 revision creation time. */
  createdAt: string;
}

export interface SyncResult {
  /** True when the requested cursor was a known revision row. */
  cursorKnown: boolean;
  items: SyncItem[];
  /** Id of the last returned revision, or null when the list is empty. */
  nextCursor: string | null;
  /** True when more revisions remain after this page. */
  hasMore: boolean;
}
