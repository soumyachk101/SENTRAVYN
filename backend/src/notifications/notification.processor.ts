import { Injectable, Logger } from '@nestjs/common';
import type { NotificationJobPayload } from './types';
import type { NotificationRepository } from './notification.repository';
import type { PushAdapterRegistry } from './push/push-adapters';

/**
 * Outcome of processing one notification job.
 *
 * `terminal` is true when the channel set reached a final state (all
 * delivered, or a terminal failure the queue should not retry). A terminal
 * FAILED result is the dead-letter signal: the queue moves the job to the
 * failed queue and the row lands on DROPPED, so a broken provider never
 * spins the retry loop forever.
 */
export interface JobOutcome {
  /** All push channels reported delivered. */
  delivered: boolean;
  /** A channel hit a terminal failure that must not be retried. */
  terminal: boolean;
  /** Per-channel status after this attempt, for logging / audits. */
  statuses: Record<string, string>;
  /** True when at least one channel could not be reached at all. */
  anyUnavailable: boolean;
}

/**
 * Core notification job processor (Phase 6; ARCHITECTURE.md 6).
 *
 * The single code path both consumers share:
 *   - the standalone BullMQ worker (worker/worker.main.ts)
 *   - in-process "exactly one deduped job" unit tests
 *
 * It is a plain class (no Nest decorator) so the worker process can build
 * it directly without a Nest application, and so tests can drive it with a
 * fake repository + fake adapters. Dependency injection happens at the
 * composition root, not in the processor.
 *
 * Per job:
 *   1. Ensure the PENDING channel rows exist for this dedup key (idempotent
 *      — a retry of the same revision reuses the rows, never duplicates).
 *   2. For each channel: resolve-or-create row, run the adapter, record the
 *      attempt + the post-attempt status.
 *   3. Unavailable channels (no credentials / no audience) are terminal and
 *      marked DROPPED — a missing credential must never read as a delivery.
 *   4. A transient failure on a channel leaves it FAILED and the job
 *      terminal only when no retry budget remains (the queue decides).
 */
export class NotificationProcessor {
  constructor(
    private readonly repo: NotificationRepository,
    private readonly adapters: PushAdapterRegistry,
    private readonly logger?: Logger,
  ) {}

  /** Number of times a channel may fail before we stop retrying it. */
  static readonly MAX_RETRIES = 3;

  async process(
    job: NotificationJobPayload,
    retryBudgetLeft: number = NotificationProcessor.MAX_RETRIES,
  ): Promise<JobOutcome> {
    const ensured = await this.repo.ensureChannelRows(job);
    const rows = ensured.notificationIds.length
      ? await this.repo.rowsForDedupKey(job.dedupKey, job.alertId)
      : [];

    const statuses: Record<string, string> = {};
    let delivered = true;
    let anyUnavailable = false;
    let terminalFailure = false;

    for (const row of rows) {
      // A channel already DELIVERED by an earlier attempt of this dedup key
      // is final: skip it so a partial retry never re-sends (ARCHITECTURE 6
      // "avoid duplicate notifications during retries").
      if (row.status === 'DELIVERED') {
        statuses[row.channel] = 'DELIVERED';
        continue;
      }
      // A channel already DROPPED (unavailable / terminal) is also final.
      // It counts as terminal so a queue re-run of this job cannot loop:
      // every channel reaches a final state (DELIVERED or DROPPED) and the
      // outcome reports terminal=true, letting the worker complete the job.
      if (row.status === 'DROPPED') {
        statuses[row.channel] = 'DROPPED';
        delivered = false;
        anyUnavailable = true;
        terminalFailure = true;
        continue;
      }

      const adapter = this.adapters.forChannel(row.channel);
      if (!adapter) {
        // Unknown channel: we cannot deliver it. Mark terminal DROPPED so
        // the job does not loop on a channel that has no adapter.
        await this.repo.recordAttempt(row.id, 'DROPPED', {
          delivered: false,
          unavailable: false,
          error: `no adapter registered for channel ${row.channel}`,
        });
        statuses[row.channel] = 'DROPPED';
        delivered = false;
        terminalFailure = true;
        continue;
      }

      const result = await adapter.send(job);

      if (result.unavailable) {
        // No credentials / no audience: terminal, and never a delivery.
        await this.repo.recordAttempt(row.id, 'DROPPED', result);
        statuses[row.channel] = 'DROPPED';
        anyUnavailable = true;
        delivered = false;
        terminalFailure = true;
        continue;
      }

      if (result.delivered) {
        await this.repo.recordAttempt(row.id, 'DELIVERED', result);
        statuses[row.channel] = 'DELIVERED';
        continue;
      }

      // Transient failure. Retry if the queue still has budget; otherwise
      // the channel is terminal DROPPED (dead-lettered at the queue level).
      if (retryBudgetLeft > 0) {
        await this.repo.recordAttempt(row.id, 'FAILED', result);
        statuses[row.channel] = 'FAILED';
        delivered = false;
        continue;
      }
      await this.repo.recordAttempt(row.id, 'DROPPED', result);
      statuses[row.channel] = 'DROPPED';
      delivered = false;
      terminalFailure = true;
    }

    this.logger?.log(
      `processed ${job.dedupKey}: delivered=${delivered} terminal=${terminalFailure} ${JSON.stringify(statuses)}`,
    );

    return {
      delivered,
      // terminal when every channel reached a final state (delivered,
      // unavailable/dropped, or a failure with no retry left).
      terminal: delivered || terminalFailure,
      statuses,
      anyUnavailable,
    };
  }
}

/**
 * Nest-injectable wrapper so the API process can also run the processor
 * in-process when it wants to (e.g. an admin "replay" action). Delegates
 * entirely to the shared NotificationProcessor.
 */
@Injectable()
export class InjectableNotificationProcessor extends NotificationProcessor {
  constructor(
    repo: NotificationRepository,
    adapters: PushAdapterRegistry,
  ) {
    super(repo, adapters, new Logger(InjectableNotificationProcessor.name));
  }
}
