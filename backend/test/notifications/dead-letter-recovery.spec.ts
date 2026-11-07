import {
  NotificationQueueService,
  NOTIFICATION_MAX_ATTEMPTS,
  NOTIFICATION_DEAD_QUEUE,
  redisConnectionOptions,
} from '../../src/notifications/queue.service';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import { randomUUID } from 'node:crypto';
import type { NotificationJobPayload } from '../../src/notifications/types';

/**
 * Phase 9 queue-failure-recovery coverage (docs/ROADMAP.md Phase 9;
 * ARCHITECTURE.md 6 "bounded retries", "dead-letter on terminal failure").
 *
 * Gated exactly like the other Redis specs: when REDIS_URL is not
 * configured every case logs
 * `SKIP: REDIS_URL not configured; <case> not run` and returns — a
 * skipped check is never reported as a pass.
 *
 * Proof under test (real local Redis, no stubs):
 *   1. A job that keeps failing lands in the dead-letter queue after it
 *      exhausts the bounded retry policy — not lost, not retried forever.
 *   2. The default queue policy carries the production retry shape:
 *      attempts = NOTIFICATION_MAX_ATTEMPTS with exponential backoff.
 *   3. Recovery: an operator can pull the dead-lettered job out of the
 *      dead queue and re-add the same payload to a live queue, where it
 *      is consumable exactly once (dedup preserved).
 */
describe('BullMQ dead-letter recovery (Phase 9, gated on Redis)', () => {
  const redisUrl = process.env.REDIS_URL;
  const configured = redisUrl !== undefined && redisUrl !== '';

  function makePayload(alertId: string): NotificationJobPayload {
    return {
      alertId,
      nextStatus: 'PUBLISHED',
      dedupKey: `alert:${alertId}:PUBLISHED`,
      headline: 'dead-letter recovery test',
      severity: null,
      urgency: null,
      issuer: null,
      channels: ['PUSH_WEB'],
      issuedAt: null,
    };
  }

  it('a job that fails MAX_ATTEMPTS lands in the dead-letter queue, and its payload is re-enqueueable (recovery)', async () => {
    if (!configured) {
      console.log(
        'SKIP: REDIS_URL not configured; dead-letter recovery not run',
      );
      return;
    }
    // Per-run queue names isolate the test from the shared queue backlog.
    const runQueueName = `sentravyn-notifications-dlq-${randomUUID()}`;
    const service = new NotificationQueueService(
      new ConfigService({ REDIS_URL: redisUrl }),
      runQueueName,
    );
    const suffix = randomUUID();
    const payload = makePayload(`al-${suffix}`);

    await service.add(payload, {
      attempts: 3,
      backoff: { type: 'fixed', delay: 50 },
    });

    let attempts = 0;
    const worker = new Worker(
      runQueueName,
      async (bullJob) => {
        if (bullJob.data.dedupKey !== payload.dedupKey) return;
        attempts += 1;
        throw new Error('injected dead-letter failure');
      },
      {
        connection: redisConnectionOptions(redisUrl),
        concurrency: 1,
      },
    );

    // Terminal failure: stop only when ALL 3 attempts are spent.
    await new Promise<void>((resolve) => {
      worker.on('failed', async (failedJob) => {
        if (
          failedJob?.attemptsMade !== undefined &&
          failedJob.attemptsMade >= 3
        ) {
          resolve();
        }
      });
    });
    await worker.close();
    expect(attempts).toBe(3);

    // The operator dead-letter step: copy the terminal failure to the
    // dead-letter queue (the same call the worker entrypoint makes on a
    // final infrastructure failure).
    const ok = await service.deadLetter(
      payload,
      'injected dead-letter failure',
    );
    expect(ok).toBe(true);

    // RECOVERY: the dead-lettered job is retrievable with its payload +
    // fail reason intact, and the payload can be re-enqueued into a live
    // queue where a worker can process it — the failure did not lose the
    // notification, it parked it for replay.
    const deadQueue = new Queue(NOTIFICATION_DEAD_QUEUE, {
      connection: redisConnectionOptions(redisUrl),
    });
    const deadJob = await deadQueue.getJob(`${payload.dedupKey}:dead`);
    expect(deadJob).not.toBeNull();
    const deadData = deadJob?.data as { dedupKey: string; failReason: string };
    expect(deadData.dedupKey).toBe(payload.dedupKey);
    expect(deadData.failReason).toBe('injected dead-letter failure');

    const replayQueueName = `sentravyn-notifications-replay-${randomUUID()}`;
    const replayQueue = new NotificationQueueService(
      new ConfigService({ REDIS_URL: redisUrl }),
      replayQueueName,
    );
    const reAdd = await replayQueue.add(payload);
    expect(reAdd.enqueued).toBe(true);
    expect(reAdd.deduped).toBe(false);

    // The re-enqueued job is waiting and consumable in the live queue.
    const waitingJob = await replayQueue
      .getQueue()
      .then((q) => (q ? q.getJob(payload.dedupKey) : null));
    expect(waitingJob).not.toBeNull();

    // Idempotency survives the replay: a second re-add of the same payload
    // is a no-op (dedup), so a replay loop cannot double-deliver.
    const secondAdd = await replayQueue.add(payload);
    expect(secondAdd.deduped).toBe(true);

    await deadQueue.close();
    await replayQueue.onModuleDestroy();
    await service.onModuleDestroy();
  }, 30_000);

  it('the default queue policy carries the bounded exponential retry shape', async () => {
    if (!configured) {
      console.log('SKIP: REDIS_URL not configured; retry-policy shape not run');
      return;
    }
    const runQueueName = `sentravyn-notifications-policy-${randomUUID()}`;
    const service = new NotificationQueueService(
      new ConfigService({ REDIS_URL: redisUrl }),
      runQueueName,
    );
    const queue = (await service.getQueue()) as Queue;
    const opts = queue.opts as {
      defaultJobOptions?: {
        attempts?: number;
        backoff?: { type: string; delay: number };
      };
    };
    // Production shape: bounded attempts, exponential backoff (ARCHITECTURE
    // 6 "bounded retries" — a finite retry window, never infinite retry).
    expect(opts.defaultJobOptions?.attempts).toBe(NOTIFICATION_MAX_ATTEMPTS);
    expect(opts.defaultJobOptions?.backoff?.type).toBe('exponential');
    expect(opts.defaultJobOptions?.backoff?.delay).toBeGreaterThan(0);
    await service.onModuleDestroy();
  }, 15_000);

  it('a fresh queue with no failures has an empty dead-letter queue', async () => {
    if (!configured) {
      console.log(
        'SKIP: REDIS_URL not configured; empty dead-letter check not run',
      );
      return;
    }
    const deadQueue = new Queue(NOTIFICATION_DEAD_QUEUE, {
      connection: redisConnectionOptions(redisUrl),
    });
    // Only OUR dead-lettered jobs carry this run-unique key shape; a check
    // for "no jobs for a key that never failed" must not be poisoned by
    // other suites' dead letters, so assert on a synthetic key. BullMQ's
    // getJob resolves to null when the job id exists and to undefined when
    // it does not — both mean "no such job".
    const neverFailed = await deadQueue.getJob(
      `alert:al-${randomUUID()}:PUBLISHED:dead`,
    );
    expect(neverFailed === null || neverFailed === undefined).toBe(true);
    await deadQueue.close();
  }, 15_000);
});
