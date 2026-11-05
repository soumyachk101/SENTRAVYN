import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { RedisOptions } from 'ioredis';
import {
  ThrottlerStorage,
  ThrottlerGetTrackerFunction,
} from '@nestjs/throttler';

/**
 * The per-increment result the v6 ThrottlerGuard consumes
 * (mirrors @nestjs/throttler's ThrottlerStorageRecord, which is not
 * re-exported from the package root).
 */
interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

/**
 * Default tracker: the original client IP (the leftmost X-Forwarded-For entry
 * when behind a proxy, else the socket address). Typed as
 * ThrottlerGetTrackerFunction so it plugs directly into ThrottlerModule and
 * can be unit-tested without an HTTP request.
 */
export const throttlerTracker: ThrottlerGetTrackerFunction = (req) => {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (forwarded) {
    const first = String(forwarded).split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }
  return (req.socket?.remoteAddress as string | undefined) ?? 'unknown';
};

/**
 * Redis-backed store for @nestjs/throttler v6 (SECURITY.md section 3: rate
 * limits and abuse controls; closes the Phase 2 security-review deferral).
 *
 * - When REDIS_URL is unset, `increment` resolves to the "unlimited" record
 *   (0 hits, not blocked). The limiter still runs but enforces nothing,
 *   which keeps a local dev environment without Redis working and makes the
 *   no-op behaviour explicit and testable rather than a hidden failure. The
 *   documented limits are meaningful only where Redis is present.
 * - On a Redis connection error the call resolves the unlimited record and
 *   logs (fail-open for availability: a public-safety API must not 503 the
 *   whole surface because the limiter's backing store is down — matching the
 *   fail-open posture of health.service.ts).
 *
 * The limiter keys are namespaced per throttler name (default / auth-login /
 * ...), so the same client IP is tracked independently per limit. The hit
 * counter and the block marker live under separate Redis keys.
 */
@Injectable()
export class RedisThrottlerStorage
  implements ThrottlerStorage, OnModuleDestroy
{
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private client: Redis | null = null;

  constructor(private readonly config: ConfigService) {}

  /**
   * Lazily creates and connects the ioredis client on first use. A down
   * Redis is non-fatal: connect() failures are caught and the caller degrades
   * to the unlimited record (fail-open). Retry-on-disconnect is left to
   * ioredis defaults; the limiter simply re-opens a connection on the next
   * request.
   */
  private async ensureClient(): Promise<Redis | null> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) {
      return null;
    }
    if (!this.client) {
      this.client = new Redis(url, {
        // The limiter must not hold requests hostage: short connect timeout,
        // one retry attempt, no offline queue, so a down Redis degrades the
        // limiter to a no-op quickly instead of stalling every request.
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        connectTimeout: 2_000,
      } as Partial<RedisOptions>);
      this.client.on('error', (error: unknown) => {
        // 'end' fires on disconnect; log but never crash the request path.
        this.logger.warn(`throttler storage Redis error: ${String(error)}`);
      });
    }
    if (this.client.status === 'wait') {
      try {
        await this.client.connect();
      } catch {
        this.logger.warn(
          'throttler storage: Redis connect failed; limiter degraded to no-op',
        );
        this.client.disconnect();
        this.client = null;
        return null;
      }
    }
    return this.client;
  }

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const redis = await this.ensureClient();
    if (!redis) {
      // No Redis configured (or connect failed): unlimited.
      return {
        totalHits: 0,
        timeToExpire: 0,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
    try {
      const counterKey = `throttle:${throttlerName}:${key}`;
      const blockKey = `throttle-block:${throttlerName}:${key}`;

      // A previously-blocked IP keeps blocking until its block window lapses.
      const blockRaw = await redis.get(blockKey);
      if (blockRaw) {
        const remaining = await redis.ttl(blockKey);
        return {
          totalHits: limit, // report the cap so the limiter treats it as at-limit
          timeToExpire: 0,
          isBlocked: true,
          timeToBlockExpire: remaining > 0 ? remaining : 1,
        };
      }

      await redis.incr(counterKey);
      // Set the TTL on the first hit of the window; subsequent INCRs leave the
      // existing TTL untouched so the window does not slide per request.
      const counterTtl = await redis.ttl(counterKey);
      if (counterTtl < 0) {
        await redis.expire(counterKey, ttl);
      }
      const raw = await redis.get(counterKey);
      const totalHits = raw ? Number.parseInt(raw, 10) : 0;

      // Once the window's cap is exceeded, open a block window so the client
      // cannot keep requesting immediately; the guard surfaces 429 during it.
      if (blockDuration > 0 && totalHits > limit) {
        await redis.set(blockKey, String(totalHits), 'EX', blockDuration);
      }
      return {
        totalHits,
        timeToExpire: counterTtl > 0 ? counterTtl : ttl,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    } catch {
      this.logger.warn('throttler storage read failed; treating as unlimited');
      return {
        totalHits: 0,
        timeToExpire: 0,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      this.client.disconnect();
      this.client = null;
    }
  }
}
