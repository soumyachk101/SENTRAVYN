import {
  Injectable,
  Logger,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type JobsOptions } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import type { NotificationJobPayload } from './types';

/** BullMQ queue names (stable across API + worker processes; no `:` in names). */
export const NOTIFICATION_QUEUE = 'sentravyn-notifications';
export const NOTIFICATION_DEAD_QUEUE = 'sentravyn-notifications-dead';

/** Bounded retry policy (ARCHITECTURE.md 6: bounded retries, dead-letter). */
export const NOTIFICATION_MAX_ATTEMPTS = 4;

/**
 * Shared connection option builder for BullMQ.
 *
 * Parses REDIS_URL into ioredis options. BullMQ wants
 * `maxRetriesPerRequest: null` on its connections so a Redis blip makes the
 * queue reconnect rather than fail every command; that is a queue-specific
 * need and is applied here, not on the API's probe connections.
 */
export function redisConnectionOptions(redisUrl: string): RedisOptions {
  let url: URL;
  try {
    url = new URL(redisUrl);
  } catch {
    throw new Error('REDIS_URL is not a valid URL');
  }
  const options: RedisOptions = {
    host: url.hostname || 'localhost',
    port: url.port ? Number(url.port) : 6379,
    maxRetriesPerRequest: null,
  };
  if (url.username) options.username = url.username;
  if (url.password) options.password = url.password;
  if (url.pathname && url.pathname.length > 1) {
    options.db = Number(url.pathname.slice(1));
  }
  if (url.protocol === 'rediss:') {
    options.tls = {};
  }
  return options;
}

export interface EnqueueResult {
  enqueued: boolean;
  /** True when a job with this dedup key was already queued/running. */
  deduped: boolean;
  dedupKey: string;
  /** Set when the queue could not be reached at all. */
  error?: string;
}

/**
 * DI token for the queue-name override. `queueName` stays a positional
 * default parameter so tests and the standalone worker can construct the
 * service by hand; the module registers this token as a provider so Nest
 * DI resolves constructor index 1 (a plain string paramtype would read as
 * the unresolvable `String` token).
 */
export const NOTIFICATION_QUEUE_NAME = 'NOTIFICATION_QUEUE_NAME';

/**
 * BullMQ producer for notification jobs (Phase 6; ARCHITECTURE.md 6 step 3).
 *
 * Idempotency: every job carries `jobId = dedupKey`, so re-publishing the
 * same alert revision never adds a second job while the first is still
 * waiting/delayed/active — BullMQ returns the existing job instead.
 */
@Injectable()
export class NotificationQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationQueueService.name);
  private queue: Queue | null = null;

  /**
   * `queueName` overrides the default queue (tests use a per-run name to
   * isolate the retry test from leftover waiting jobs; production leaves it
   * unset and uses NOTIFICATION_QUEUE).
   */
  constructor(
    private readonly config: ConfigService,
    @Inject(NOTIFICATION_QUEUE_NAME)
    private readonly queueName: string = NOTIFICATION_QUEUE,
  ) {}

  /** The queue name this producer enqueues to. */
  get queueNameValue(): string {
    return this.queueName;
  }

  /** True when REDIS_URL is present and a live queue connection exists. */
  isConfigured(): boolean {
    return Boolean(this.config.get<string>('REDIS_URL'));
  }

  private queueInstance(): Queue | null {
    if (this.queue !== null) return this.queue;
    const url = this.config.get<string>('REDIS_URL');
    if (!url) return null;
    try {
      this.queue = new Queue(this.queueName, {
        connection: redisConnectionOptions(url),
        defaultJobOptions: {
          attempts: NOTIFICATION_MAX_ATTEMPTS,
          // Bounded exponential backoff. BullMQ's exponential strategy
          // doubles `delay` per attempt with no explicit cap; attempts is
          // bounded (NOTIFICATION_MAX_ATTEMPTS), so the total window stays
          // finite. ARCHITECTURE.md 6 "bounded retries".
          backoff: { type: 'exponential', delay: 2000 },
          // Keep completed/failed jobs a bounded window so a worker crash
          // never replays ancient jobs, while dedup keys stay checkable.
          removeOnComplete: { age: 7 * 86_400, count: 5000 },
          removeOnFail: { age: 7 * 86_400, count: 5000 },
        },
      });
      return this.queue;
    } catch (err) {
      this.logger.error(`failed to create queue: ${String(err)}`);
      return null;
    }
  }

  /**
   * Enqueue one notification job. With no REDIS_URL this returns
   * `enqueued: false` with an error reason rather than throwing: callers
   * mark the push channel rows DROPPED so the pipeline fails soft and the
   * live/socket path is unaffected.
   *
   * `jobOptions` overrides the queue default retry policy for this single
   * job (tests use it to bound backoff; production callers leave it unset).
   */
  async add(
    job: NotificationJobPayload,
    jobOptions?: JobsOptions,
  ): Promise<EnqueueResult> {
    const queue = this.queueInstance();
    if (!queue) {
      return {
        enqueued: false,
        deduped: false,
        dedupKey: job.dedupKey,
        error: 'REDIS_URL is not configured; notification queue unavailable',
      };
    }
    try {
      // BullMQ keys jobs by `jobId` (= the dedup key), so adding a key that
      // already has a job in the queue is a no-op — the second add does not
      // create a second job. `getJob` returns the live job for the key (or
      // undefined when none is present), so a non-null pre-add lookup is the
      // "already queued" signal we surface to callers.
      const existing = await queue.getJob(job.dedupKey);
      await queue.add('notify', job, { jobId: job.dedupKey, ...jobOptions });
      const deduped = existing !== null && existing !== undefined;
      this.logger.log(
        `enqueued notification ${job.dedupKey}${deduped ? ' (deduped)' : ''}`,
      );
      return { enqueued: true, deduped, dedupKey: job.dedupKey };
    } catch (err) {
      this.logger.error(
        `enqueue failed for ${job.dedupKey}: ${String(err)}`,
      );
      return {
        enqueued: false,
        deduped: false,
        dedupKey: job.dedupKey,
        error: String(err),
      };
    }
  }

  /**
   * Move a terminally failed job into the dead-letter queue so operators can
   * inspect/replay it. Failures on the dead-letter path itself are logged,
   * never swallowed silently.
   */
  async deadLetter(
    job: NotificationJobPayload,
    failReason: string,
  ): Promise<boolean> {
    const queue = this.queueInstance();
    if (!queue) return false;
    const url = this.config.get<string>('REDIS_URL');
    if (!url) return false;
    const dead = new Queue(NOTIFICATION_DEAD_QUEUE, {
      connection: redisConnectionOptions(url),
    });
    try {
      await dead.add(
        'dead-letter',
        { ...job, failReason, deadAt: new Date().toISOString() },
        { jobId: `${job.dedupKey}:dead` },
      );
      this.logger.warn(
        `dead-lettered ${job.dedupKey}: ${failReason}`,
      );
      return true;
    } catch (err) {
      this.logger.error(
        `dead-letter enqueue failed for ${job.dedupKey}: ${String(err)}`,
      );
      return false;
    } finally {
      await dead.close();
    }
  }

  /** Fetch the live queue (or null), for tests and operator tooling. */
  async getQueue(): Promise<Queue | null> {
    return this.queueInstance();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }
  }
}
