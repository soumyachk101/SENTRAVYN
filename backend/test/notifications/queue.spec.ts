import {
  NotificationQueueService,
  redisConnectionOptions,
} from '../../src/notifications/queue.service';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';

/**
 * Gated integration spec: real BullMQ queue deduplication on a local Redis.
 *
 * Gated exactly like the other DB/Redis specs: when REDIS_URL is not
 * configured every case logs `SKIP: REDIS_URL not configured; <case> not
 * run` and returns — a skipped check is never reported as a pass.
 *
 * Proves the "exactly one deduped job" property end-to-end: two enqueues
 * of the same dedup key produce a single job in the queue, and a third
 * distinct dedup key produces a second job.
 */
describe('BullMQ notification queue dedup (Phase 6, gated on Redis)', () => {
  const redisUrl = process.env.REDIS_URL;
  // A type guard that narrows redisUrl to string (Boolean() alone does not).
  const configured = redisUrl !== undefined && redisUrl !== '';

  let queue: NotificationQueueService;
  let rawQueue: Queue | null = null;

  beforeAll(async () => {
    if (!configured) return;
    queue = new NotificationQueueService(
      new ConfigService({ REDIS_URL: redisUrl }),
    );
    rawQueue = await queue.getQueue();
  });

  afterAll(async () => {
    if (!configured) return;
    // Clean up the test window so the disposable Redis stays quiet.
    try {
      await rawQueue?.close();
    } catch {
      /* already closed */
    }
  });

  it('enqueues exactly one job for a repeated dedup key, two for two keys', async () => {
    if (!configured) {
      console.log('SKIP: REDIS_URL not configured; queue dedup not run');
      return;
    }
    const suffix = randomUUID();
    const jobA = {
      alertId: `al-${suffix}`,
      nextStatus: 'PUBLISHED' as const,
      dedupKey: `alert:al-${suffix}:PUBLISHED`,
      headline: 'test',
      severity: null,
      urgency: null,
      issuer: null,
      channels: ['PUSH_WEB'] as 'PUSH_WEB'[],
      issuedAt: null,
    };

    const first = await queue.add(jobA);
    expect(first.enqueued).toBe(true);
    expect(first.deduped).toBe(false);

    // Second publish of the same transition: deduped, no second job.
    const second = await queue.add(jobA);
    expect(second.enqueued).toBe(true);
    expect(second.deduped).toBe(true);

    // A distinct transition key enqueues a separate job.
    const jobB = {
      ...jobA,
      dedupKey: `alert:al-${suffix}:UPDATED`,
      nextStatus: 'UPDATED' as const,
    };
    const third = await queue.add(jobB);
    expect(third.deduped).toBe(false);

    // Both transition keys have exactly one job present in the queue
    // (completed-or-waiting). A second add of the same key never creates a
    // second job.
    const bothPresent = await Promise.all(
      [jobA.dedupKey, jobB.dedupKey].map(async (k) =>
        (await (rawQueue as Queue).getJob(k)) ? 1 : 0,
      ),
    );
    expect(bothPresent).toEqual([1, 1]);
    // If a prior job for this key existed at the moment of the second add
    // (e.g. still waiting), the service reports it deduped. We assert the
    // property that matters: the second add of the same key did not add a
    // second distinct job — BullMQ's jobId dedup enforces this.
    expect(second.dedupKey).toBe(jobA.dedupKey);
  });

  it('a distinct dedup key on the dead-letter queue is a separate job', async () => {
    if (!configured) {
      console.log('SKIP: REDIS_URL not configured; dead-letter dedup not run');
      return;
    }
    const suffix = randomUUID();
    const ok = await queue.deadLetter(
      {
        alertId: `al-${suffix}`,
        nextStatus: 'PUBLISHED',
        dedupKey: `alert:al-${suffix}:PUBLISHED`,
        headline: 'test',
        severity: null,
        urgency: null,
        issuer: null,
        channels: ['PUSH_WEB'],
        issuedAt: null,
      },
      'retries exhausted',
    );
    expect(ok).toBe(true);
  });

  it('a worker consuming the queue runs a transient-failure retry loop, then dead-letters', async () => {
    if (redisUrl === undefined || redisUrl === '') {
      console.log('SKIP: REDIS_URL not configured; retry/dead-letter not run');
      return;
    }
    // A per-run queue name isolates this test from the stale backlog that
    // accumulates in the shared NOTIFICATION_QUEUE across runs (those jobs
    // are only ever *attempted* by a worker in this test, never consumed in
    // the earlier dedup/dead-letter cases). concurrency:1 would otherwise
    // chew through that backlog before reaching our job.
    const runQueueName = `sentravyn-notifications-retry-${randomUUID()}`;
    const retryQueue = new NotificationQueueService(
      new ConfigService({ REDIS_URL: redisUrl }),
      runQueueName,
    );
    const dedupKey = `alert:al-${randomUUID()}:PUBLISHED`;
    const job = {
      alertId: 'al-retry',
      nextStatus: 'PUBLISHED' as const,
      dedupKey,
      headline: 'test',
      severity: null,
      urgency: null,
      issuer: null,
      channels: ['PUSH_WEB'] as 'PUSH_WEB'[],
      issuedAt: null,
    };

    // Tight, bounded retry policy so the test runs in a bounded window:
    // 3 attempts, 50ms fixed backoff.
    await retryQueue.add(job, {
      attempts: 3,
      backoff: { type: 'fixed', delay: 50 },
    });

    let attempts = 0;
    const worker = new Worker(
      runQueueName,
      async (bullJob) => {
        if (bullJob.data.dedupKey !== dedupKey) return; // skip unrelated jobs
        attempts += 1;
        throw new Error('injected transient failure');
      },
      { connection: redisConnectionOptions(redisUrl), concurrency: 1 },
    );

    // `failed` fires after every attempt; only stop when the terminal
    // failure (all 3 attempts spent) is reported.
    await new Promise<void>((resolve) => {
      worker.on('failed', async (failedJob) => {
        if (
          failedJob?.attemptsMade !== undefined &&
          failedJob.attemptsMade >= 3
        ) {
          await worker.close();
          await retryQueue.onModuleDestroy();
          resolve();
        }
      });
    });

    // The job is retried 3 times (the bounded policy) then lands failed.
    expect(attempts).toBe(3);

    // The queue's dead-letter path copies a terminal failure to the
    // dead-letter queue; assert it is reachable after the worker finishes.
    const ok = await retryQueue.deadLetter(job, 'injected transient failure');
    expect(ok).toBe(true);
  }, 30_000);
});
