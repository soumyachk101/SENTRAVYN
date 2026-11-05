/**
 * SENTRAVYN notification worker entrypoint (Phase 6; ARCHITECTURE.md 6 + 9).
 *
 * A standalone BullMQ worker process — intentionally NOT a Nest application.
 * It builds the same pipeline classes the API uses
 * (NotificationRepository, NotificationProcessor, the push-adapter registry)
 * and consumes the notification queue with bounded retries and a dead-letter
 * path, so the API and the worker stay separate deployables that can scale
 * independently (ARCHITECTURE.md 9: separate BullMQ worker containers).
 *
 * Env:
 *   REDIS_URL    required — the queue + dead-letter broker (fail closed).
 *   DATABASE_URL required — durable Notification/NotificationAttempt rows.
 *   FCM_* / APNS_* / WEB_PUSH_VAPID_* optional provider credentials; without
 *   them the affected channels are marked unavailable (DROPPED), never sent.
 *
 * Retry / dead-letter policy (ARCHITECTURE.md 6 "bounded retries",
 * "dead-letter on terminal failure"):
 *   - Queue defaultJobOptions carry attempts = NOTIFICATION_MAX_ATTEMPTS with
 *     bounded exponential backoff (2000ms doubling).
 *   - A transient channel failure with retry budget left rethrows so BullMQ
 *     retries the whole idempotent job (dedup key = alert:<id>:<nextStatus>).
 *   - On the final attempt the processor marks the channel rows DROPPED
 *     (the durable dead-letter of record, with attempt trails).
 *   - Infrastructure failures (throwing before/around the processor, e.g. a
 *     Prisma outage) that exhaust attempts are additionally copied to the
 *     dead-letter queue so operators can inspect/replay them.
 *
 * Run: pnpm --filter @sentravyn/backend worker:start
 */
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../src/prisma/prisma.service';
import { NotificationRepository } from '../src/notifications/notification.repository';
import { NotificationProcessor } from '../src/notifications/notification.processor';
import { buildPushAdapters } from '../src/notifications/push/push-adapters';
import {
  NOTIFICATION_DEAD_QUEUE,
  NOTIFICATION_MAX_ATTEMPTS,
  NOTIFICATION_QUEUE,
  redisConnectionOptions,
} from '../src/notifications/queue.service';
import type { NotificationJobPayload } from '../src/notifications/types';

const logger = new Logger('SENTRAVYN-NOTIF-WORKER');

function failClosed(message: string): never {
  logger.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  const config = new ConfigService(process.env as Record<string, string>);
  const redisUrl = config.get<string>('REDIS_URL');
  const databaseUrl = config.get<string>('DATABASE_URL');
  if (!redisUrl) failClosed('REDIS_URL is required for the notification worker');
  if (!databaseUrl) failClosed('DATABASE_URL is required for the notification worker');

  // The worker opens its own Redis + Prisma clients, deliberately not
  // sharing the API process's (separate process, separate lifecycles).
  const prisma = new PrismaService(config);
  await prisma.$connect();
  logger.log('worker connected to Postgres');

  const repo = new NotificationRepository(prisma);
  const adapters = buildPushAdapters(config);
  const processor = new NotificationProcessor(repo, adapters, logger);

  const worker = new Worker<NotificationJobPayload>(
    NOTIFICATION_QUEUE,
    async (job) => {
      const dedupKey = job.data.dedupKey;
      // On the final attempt (budget left = 0) transient failures are
      // terminal DROPPED instead of looping; earlier attempts rethrow so
      // BullMQ retries with the configured exponential backoff.
      const budgetLeft = NOTIFICATION_MAX_ATTEMPTS - 1 - (job.attemptsMade ?? 0);
      const outcome = await processor.process(job.data, Math.max(0, budgetLeft));
      logger.log(
        `job ${dedupKey} attempt=${(job.attemptsMade ?? 0) + 1} delivered=${outcome.delivered} terminal=${outcome.terminal}`,
      );
      if (!outcome.delivered && !outcome.terminal) {
        throw new Error(
          `transient failure on ${dedupKey}: ${JSON.stringify(outcome.statuses)}`,
        );
      }
    },
    { connection: redisConnectionOptions(redisUrl) },
  );

  worker.on('failed', async (job, err) => {
    logger.warn(
      `job ${job?.id ?? 'unknown'} failed (${job?.attemptsMade ?? 0}/${NOTIFICATION_MAX_ATTEMPTS}): ${String(err)}`,
    );
    // Dead-letter only when every retry budget is spent.
    if (job && job.attemptsMade >= NOTIFICATION_MAX_ATTEMPTS) {
      const dead = new Queue(NOTIFICATION_DEAD_QUEUE, {
        connection: redisConnectionOptions(redisUrl),
      });
      try {
        await dead.add(
          'dead-letter',
          { ...job.data, failReason: String(err), deadAt: new Date().toISOString() },
          { jobId: `${job.data.dedupKey}:dead` },
        );
        logger.warn(`dead-lettered ${job.data.dedupKey}`);
      } catch (deadErr) {
        logger.error(
          `dead-letter enqueue failed for ${job.data.dedupKey}: ${String(deadErr)}`,
        );
      } finally {
        await dead.close();
      }
    }
  });

  worker.on('error', (err) => {
    logger.error(`worker error: ${String(err)}`);
  });

  logger.log(
    `notification worker consuming ${NOTIFICATION_QUEUE} ` +
      `(dead-letter: ${NOTIFICATION_DEAD_QUEUE}, max attempts: ${NOTIFICATION_MAX_ATTEMPTS})`,
  );

  // Graceful shutdown: drain the worker, close the DB client. The process
  // stays alive on the worker's open Redis handles (not on a blocking
  // call); it only exits via a signal handler below.
  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`received ${signal}, shutting down`);
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

void main().catch((err) => failClosed(String(err)));
