import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationRepository } from './notification.repository';
import { NotificationQueueService } from './queue.service';
import type { NotificationJobPayload } from './types';
import { PUSH_CHANNELS } from './types';

/**
 * Alert publication trigger (Phase 6; ARCHITECTURE.md 6, steps 2-5).
 *
 * One entry point every publication path goes through — admin
 * REVIEW_APPROVED and ingest UPDATED — so "enqueue exactly one deduped job"
 * holds by construction:
 *
 *   1. validate: the canonical alert row must exist (the caller persists it
 *      first — step 2 of the pipeline is upstream of this class).
 *   2. enqueue ONE idempotent BullMQ job keyed by
 *      `alert:<id>:<nextStatus>`: re-triggering the same status transition
 *      while a job is pending/running returns the existing job (BullMQ
 *      jobId dedup) and no second job is created.
 *   3. record the durable push channel rows (PENDING, or DROPPED with the
 *      reason when the queue is unreachable).
 *   4. optional live socket fan-out via the `onPublished` hook, bound to the
 *      gateway when a realtime port is configured. The socket is the fast
 *      path, never the source of truth: the durable rows + cursor sync
 *      recover any missed live event (ARCHITECTURE.md 6: do not rely on
 *      WebSockets as the sole delivery channel).
 *
 * Failures degrade honestly: a Redis outage means the job is not enqueued
 * and the push rows are marked DROPPED (never SENT), while the PUBLISHED
 * state itself was already committed by the caller. No fabricated delivery.
 */
export interface PublishOutcome {
  alertId: string;
  nextStatus: 'PUBLISHED' | 'UPDATED';
  dedupKey: string;
  /** True when a job with this dedup key was already queued. */
  deduped: boolean;
  /** True when the job was added or was found already queued. */
  enqueued: boolean;
  error?: string;
}

@Injectable()
export class PublishService {
  private readonly logger = new Logger(PublishService.name);

  /**
   * Optional live fan-out hook, bound by the gateway bootstrap when a
   * realtime port is configured. Invoked after the durable enqueue + channel
   * rows are written, so a socket miss can never make the durable record
   * missing.
   */
  onPublished: ((job: NotificationJobPayload) => Promise<unknown> | unknown) | null =
    null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly repo: NotificationRepository,
    private readonly queue: NotificationQueueService,
  ) {}

  /**
   * Publish one alert transition.
   *
   * @param alertId canonical alert id (row must exist).
   * @param nextStatus the status the alert has just moved to.
   */
  async publish(
    alertId: string,
    nextStatus: 'PUBLISHED' | 'UPDATED',
  ): Promise<PublishOutcome> {
    const alert = await this.prisma.alert.findUnique({
      where: { id: alertId },
      select: {
        id: true,
        headline: true,
        severity: true,
        urgency: true,
        issuer: true,
        issuedAt: true,
        status: true,
      },
    });
    if (!alert) {
      throw new Error(`alert ${alertId} does not exist; cannot publish`);
    }

    const dedupKey = `alert:${alertId}:${nextStatus}`;
    const job: NotificationJobPayload = {
      alertId,
      nextStatus,
      dedupKey,
      headline: alert.headline,
      severity: alert.severity,
      urgency: alert.urgency,
      issuer: alert.issuer,
      channels: PUSH_CHANNELS,
      issuedAt: alert.issuedAt?.toISOString() ?? null,
    };

    // Idempotent enqueue: a repeat of the same transition while the first
    // job is still queued/active returns the existing job.
    const enqueue = await this.queue.add(job);

    // Durable channel rows: PENDING when the worker owns delivery, DROPPED
    // with a reason when the queue was unreachable.
    const ensured = await this.repo.ensureChannelRows(job);
    for (const channelId of ensured.notificationIds) {
      const row = await this.repo.getById(channelId);
      if (!row) continue;
      if (enqueue.enqueued) {
        await this.repo.recordAttempt(
          channelId,
          'PENDING',
          {
            delivered: false,
            unavailable: false,
            error: enqueue.deduped
              ? 'job already queued for this dedup key'
              : `job enqueued (${job.dedupKey})`,
          },
        );
      } else {
        await this.repo.recordAttempt(channelId, 'DROPPED', {
          delivered: false,
          unavailable: true,
          error: enqueue.error ?? 'notification queue unavailable',
        });
      }
    }

    this.logger.log(
      `published ${job.dedupKey} enqueued=${enqueue.enqueued} deduped=${enqueue.deduped}`,
    );

    // Live fan-out (fire-and-forget; the durable rows are the record).
    if (this.onPublished) {
      const fn = this.onPublished;
      void Promise.resolve()
        .then(() => fn(job))
        .catch((err: unknown) => {
          this.logger.error(
            `live broadcast for ${job.dedupKey} failed: ${String(err)}`,
          );
        });
    }

    return {
      alertId,
      nextStatus,
      dedupKey,
      deduped: enqueue.deduped,
      enqueued: enqueue.enqueued,
      error: enqueue.enqueued ? undefined : (enqueue.error ?? undefined),
    };
  }
}
