import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  DeliveryResult,
  NotificationJobPayload,
  NotificationStatus,
} from './types';

/**
 * Durable notification state (Phase 6; ARCHITECTURE.md 6 step 7).
 *
 * Uses the existing Notification + NotificationAttempt tables — no new
 * schema. State machine for a channel row:
 *
 *   PENDING -> SENT        (provider accepted the message)
 *   SENT    -> DELIVERED   (provider reported delivery)
 *   PENDING -> FAILED      (transient provider failure, retries remain)
 *   FAILED  -> DROPPED     (terminal: retries exhausted -> dead-letter)
 *   PENDING -> DROPPED     (channel unavailable / not configured: we never
 *                           fabricated a delivery, so mark DROPPED with the
 *                           reason in the attempt row, not SENT/DELIVERED)
 *
 * Every transition appends a NotificationAttempt row (attempt number
 * increments per row). The `dedupKey` on Notification is what lets two
 * workers / a retry of the same alert revision avoid duplicate pushes: we
 * resolve-or-create the channel rows once and re-use them.
 */
@Injectable()
export class NotificationRepository {
  private readonly logger = new Logger(NotificationRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Idempotently create the set of push-channel rows for one alert revision.
   *
   * Returns the existing rows when the same (alertId, revision) was already
   * published, so re-publishing a revision or a worker re-running a job never
   * creates duplicate channel rows. The dedupKey is stable per revision, so
   * we look it up first.
   */
  async ensureChannelRows(job: NotificationJobPayload): Promise<{
    created: boolean;
    notificationIds: string[];
  }> {
    const existing = await this.prisma.notification.findMany({
      where: {
        alertId: job.alertId,
        dedupKey: job.dedupKey,
        channel: { in: job.channels },
      },
      select: { id: true, channel: true },
    });

    if (existing.length === job.channels.length) {
      // Already published this exact revision: idempotent no-op.
      return {
        created: false,
        notificationIds: existing.map((r) => r.id),
      };
    }

    const ids: string[] = [];
    // Create only the channels that do not yet have a row for this dedupKey.
    const have = new Set(existing.map((r) => r.channel));
    for (const channel of job.channels) {
      if (have.has(channel)) continue;
      const row = await this.prisma.notification.create({
        data: {
          alertId: job.alertId,
          channel,
          status: 'PENDING',
          dedupKey: job.dedupKey,
        },
      });
      ids.push(row.id);
    }
    return {
      created: true,
      notificationIds: [...existing.map((r) => r.id), ...ids],
    };
  }

  /**
   * Record one attempt and move the row to the resulting status.
   *
   * `outcome` is the post-attempt row status (SENT / DELIVERED / FAILED /
   * DROPPED). The attempt row stores the same value so a later reader can
   * reconstruct the PENDING->... trail. attempt numbers are 1-based and
   * auto-increment from the current max.
   */
  async recordAttempt(
    notificationId: string,
    outcome: NotificationStatus,
    result: DeliveryResult,
  ): Promise<void> {
    const current = await this.prisma.notification.findUnique({
      where: { id: notificationId },
      select: {
        attempts: {
          orderBy: { attempt: 'desc' },
          take: 1,
          select: { attempt: true },
        },
        receipt: true,
      },
    });
    const attempt = (current?.attempts[0]?.attempt ?? 0) + 1;
    // Keep the most recent provider receipt; only overwrite it when this
    // attempt produced a new one.
    const receipt = result.receipt ?? current?.receipt ?? null;

    await this.prisma.$transaction([
      this.prisma.notificationAttempt.create({
        data: {
          notificationId,
          attempt,
          outcome,
          error: result.error ?? null,
        },
      }),
      this.prisma.notification.update({
        where: { id: notificationId },
        data: { status: outcome, receipt },
      }),
    ]);
  }

  /**
   * Return the channel rows for one dedup key so a worker knows what to
   * (re)deliver. Used by the processor and by "exactly one deduped job"
   * tests.
   */
  async rowsForDedupKey(dedupKey: string, alertId: string): Promise<
    { id: string; channel: string; status: string; receipt: string | null }[]
  > {
    return this.prisma.notification.findMany({
      where: { dedupKey, alertId },
      select: { id: true, channel: true, status: true, receipt: true },
      orderBy: { channel: 'asc' },
    });
  }

  /** Fetch a single channel row by id. */
  async getById(id: string) {
    return this.prisma.notification.findUnique({ where: { id } });
  }
}
