import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import {
  RedisThrottlerStorage,
  toRedisSeconds,
  throttlerTracker,
} from '../src/common/throttling/throttler-storage.service';

/**
 * Unit tests for the Redis-backed throttler storage (SECURITY.md section 3).
 *
 * Observable contract:
 *  - No REDIS_URL configured  -> every increment() resolves to the "unlimited"
 *    record (0 hits, not blocked) so the limiter is a safe no-op in a
 *    Redis-less local environment (runs everywhere, no SKIP).
 *  - The tracker resolves the original client IP from X-Forwarded-For.
 *  - With a reachable Redis  -> counts hits per (throttler, tracker) window
 *    and opens a block window once the limit is exceeded. These assertions
 *    are gated behind a live REDIS_URL so the suite stays green where Redis
 *    is absent (CI provides a redis service; local dev uses 6380).
 */
function configWith(url: string | null): ConfigService {
  return {
    get: (key: string) => (key === 'REDIS_URL' ? url : undefined),
  } as unknown as ConfigService;
}

const redisConfigured = Boolean(process.env.REDIS_URL);
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';

describe('RedisThrottlerStorage', () => {
  it('resolves to the unlimited record when REDIS_URL is unset', async () => {
    const storage = new RedisThrottlerStorage(configWith(null));
    const result = await storage.increment('key', 60_000, 10, 300_000, 'auth');
    expect(result).toEqual({
      totalHits: 0,
      timeToExpire: 0,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  describe('throttlerTracker', () => {
    it('uses the leftmost X-Forwarded-For entry when present', () => {
      const req = {
        headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
        socket: { remoteAddress: '10.0.0.1' },
      };
      expect(throttlerTracker(req as never, {} as never)).toBe('203.0.113.9');
    });

    it('falls back to the socket address when there is no forward header', () => {
      const req = { headers: {}, socket: { remoteAddress: '10.0.0.5' } };
      expect(throttlerTracker(req as never, {} as never)).toBe('10.0.0.5');
    });

    it('reports "unknown" when neither source is available', () => {
      expect(
        throttlerTracker({ headers: {}, socket: {} } as never, {} as never),
      ).toBe('unknown');
    });
  });

  describe('toRedisSeconds (ms -> Redis seconds) unit conversion', () => {
    it('converts millisecond durations to whole seconds', () => {
      expect(toRedisSeconds(60_000)).toBe(60);
      expect(toRedisSeconds(300_000)).toBe(300);
      expect(toRedisSeconds(5_000)).toBe(5);
    });

    it('rounds a fractional second and floors sub-second values to 1', () => {
      // A sub-second or non-positive expiry must never become 0, because
      // EXPIRE 0 makes a key persistent — the exact hazard this prevents.
      expect(toRedisSeconds(1_500)).toBe(2);
      expect(toRedisSeconds(500)).toBe(1);
      expect(toRedisSeconds(0)).toBe(1);
      expect(toRedisSeconds(-1)).toBe(1);
    });
  });

  describe('live-Redis window + block logic', () => {
    let redis: Redis;

    beforeAll(() => {
      if (!redisConfigured) {
        return;
      }
      redis = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
        connectTimeout: 1_500,
      });
    });

    afterAll(async () => {
      if (redisConfigured && redis) {
        await redis.quit().catch(() => undefined);
      }
    });

    it('counts hits per window and blocks a tracker that exceeds the limit', async () => {
      if (!redisConfigured) {
        console.log(
          'SKIP: REDIS_URL not configured; live-Redis throttle e2e not run',
        );
        return;
      }
      // Clean slate for a unique tracker + throttler name so the test never
      // collides with the running app or other tests.
      const tracker = `throttle-test-${Date.now()}`;
      const name = 'test-window';
      await redis
        .del(`throttle:${name}:${tracker}`, `throttle-block:${name}:${tracker}`)
        .catch(() => undefined);

      const storage = new RedisThrottlerStorage(configWith(redisUrl));
      // limit=3, ttl=60s, blockDuration=300s.
      const r1 = await storage.increment(tracker, 60_000, 3, 300_000, name);
      expect(r1.totalHits).toBe(1);
      expect(r1.isBlocked).toBe(false);
      await storage.increment(tracker, 60_000, 3, 300_000, name);
      const r3 = await storage.increment(tracker, 60_000, 3, 300_000, name);
      expect(r3.totalHits).toBe(3);
      expect(r3.isBlocked).toBe(false);

      // Units regression guard: the 60 s window (ttl=60_000 ms) must land as a
      // ~60 s key TTL, not 60,000 s. Passing ms straight into EXPIRE would make
      // the counter persist for ~16.7 h and lock a client out far past its
      // window — the exact defect a live load run surfaced in 2026-11.
      const counterTtl = await redis.ttl(`throttle:${name}:${tracker}`);
      expect(counterTtl).toBeGreaterThan(0);
      expect(counterTtl).toBeLessThanOrEqual(60);

      // The 4th request exceeds the limit of 3 -> a block window opens.
      const r4 = await storage.increment(tracker, 60_000, 3, 300_000, name);
      expect(r4.totalHits).toBeGreaterThan(3);

      // The 300 s block (blockDuration=300_000 ms) must land as a ~300 s key
      // TTL, not 300,000 s (~3.5 days of 429 lockout).
      const blockTtl = await redis.ttl(`throttle-block:${name}:${tracker}`);
      expect(blockTtl).toBeGreaterThan(0);
      expect(blockTtl).toBeLessThanOrEqual(300);
      // A subsequent request within the block window reports isBlocked.
      const blocked = await storage.increment(
        tracker,
        60_000,
        3,
        300_000,
        name,
      );
      expect(blocked.isBlocked).toBe(true);
      expect(blocked.timeToBlockExpire).toBeGreaterThan(0);

      // A different tracker is unaffected by this tracker's block.
      const other = await storage.increment(
        `throttle-test-other-${Date.now()}`,
        60_000,
        3,
        300_000,
        name,
      );
      expect(other.isBlocked).toBe(false);

      // Teardown.
      await redis
        .del(`throttle:${name}:${tracker}`, `throttle-block:${name}:${tracker}`)
        .catch(() => undefined);
      // Release the storage's own lazy ioredis client so Jest can exit.
      await storage.onModuleDestroy();
    });
  });
});
