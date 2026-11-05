import { ConfigService } from '@nestjs/config';
import { ThrottlerOptions } from '@nestjs/throttler';
import { throttlerOptions } from '../src/common/throttling/throttling.module';

/**
 * Rate-limit configuration assertions (SECURITY.md section 3).
 *
 * The documented defaults are: general surface 300 req / 60s per client IP;
 * credential-exchange surface 15 req / 60s with a 300s block (bcrypt cost 12
 * makes /auth/login the DoS-critical route). These are env-overridable so
 * load testing (Phase 9) and the e2e suite can adjust them without code
 * changes, but the documented production posture is the defaults.
 */
function configFrom(vars: Record<string, string>): ConfigService {
  return {
    get: (key: string) => vars[key],
  } as unknown as ConfigService;
}

/**
 * `throttlerOptions` returns the object-form ThrottlerModuleOptions (with a
 * `throttlers` array); narrow the array|object union to that form.
 */
function byName(
  options: ReturnType<typeof throttlerOptions>,
): Record<string, ThrottlerOptions> {
  const throttlers: ThrottlerOptions[] = Array.isArray(options)
    ? options
    : options.throttlers;
  return throttlers.reduce(
    (acc, t) => {
      const name = t.name ?? 'default';
      acc[name] = t;
      return acc;
    },
    {} as Record<string, ThrottlerOptions>,
  );
}

describe('throttlerOptions (rate-limit configuration)', () => {
  it('applies the documented defaults when no THROTTLE_* env is set', () => {
    const limits = byName(throttlerOptions(configFrom({})));
    expect(limits.default?.limit).toBe(300);
    expect(limits.default?.ttl).toBe(60_000);
    expect(limits.auth?.limit).toBe(15);
    expect(limits.auth?.ttl).toBe(60_000);
    // The auth surface blocks for 5 minutes once its per-window limit is hit.
    expect(limits.auth?.blockDuration).toBe(300_000);
    // The general surface does not open a block window.
    expect(limits.default?.blockDuration).toBeUndefined();
  });

  it('honours THROTTLE_* env overrides', () => {
    const limits = byName(
      throttlerOptions(
        configFrom({
          THROTTLE_DEFAULT_LIMIT: '120',
          THROTTLE_AUTH_LIMIT: '5',
          THROTTLE_BLOCK_MS: '60000',
        }),
      ),
    );
    expect(limits.default?.limit).toBe(120);
    expect(limits.auth?.limit).toBe(5);
    expect(limits.auth?.blockDuration).toBe(60_000);
  });

  it('falls back to the default when an override is non-numeric or non-positive', () => {
    const limits = byName(
      throttlerOptions(
        configFrom({
          THROTTLE_DEFAULT_LIMIT: 'abc',
          THROTTLE_AUTH_LIMIT: '0',
          THROTTLE_BLOCK_MS: '-5',
        }),
      ),
    );
    expect(limits.default?.limit).toBe(300);
    expect(limits.auth?.limit).toBe(15);
    expect(limits.auth?.blockDuration).toBe(300_000);
  });
});
