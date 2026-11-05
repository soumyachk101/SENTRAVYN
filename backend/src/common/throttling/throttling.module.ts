import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule, ThrottlerModuleOptions } from '@nestjs/throttler';
import { ThrottlerStorageModule } from './throttler-storage.module';
import { RedisThrottlerStorage, throttlerTracker } from './throttler-storage.service';

/**
 * Global rate limiting (SECURITY.md section 3: "Rate limits and abuse
 * controls"; closes the Phase 2 security-review deferral).
 *
 * Storage is Redis-backed (RedisThrottlerStorage, REDIS_URL) so the limits
 * hold across API replicas. When REDIS_URL is unset the storage degrades to
 * "unlimited" explicitly (no-op, logged) so a local dev environment without
 * Redis still boots and the limiter never crashes the request path.
 *
 * Named throttler limits (all env-overridable; see docs/SECURITY.md section 3
 * for the authoritative table):
 *  - default:  THROTTLE_DEFAULT_LIMIT  req / 60s / client ip — the general
 *              API surface (alerts, places, providers, review, ...).
 *  - auth:     THROTTLE_AUTH_LIMIT     req / 60s, THROTTLE_BLOCK_MS block —
 *              the credential-exchange surface. bcrypt cost 12 makes
 *              /auth/login the DoS-critical route, so it is gated here,
 *              tighter than the general limit.
 *
 * The `auth` throttler is applied only to the auth controllers
 * (AuthController, MfaController); every other controller carries class-level
 * @SkipThrottle({ auth: true }) so only the general `default` limit governs
 * them. Because a request is checked against each named throttler, a login
 * request is bounded by the tighter of the two plus a block window when it
 * exceeds the auth limit.
 */
export function throttlerOptions(config: ConfigService): ThrottlerModuleOptions {
  const int = (key: string, fallback: number): number => {
    const raw = config.get<string>(key);
    const n = raw === undefined || raw === '' ? NaN : Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  return {
    getTracker: throttlerTracker,
    setHeaders: true,
    errorMessage: 'Too many requests; retry later.',
    throttlers: [
      { name: 'default', limit: int('THROTTLE_DEFAULT_LIMIT', 300), ttl: 60_000 },
      {
        name: 'auth',
        limit: int('THROTTLE_AUTH_LIMIT', 15),
        ttl: 60_000,
        blockDuration: int('THROTTLE_BLOCK_MS', 300_000),
      },
    ],
  };
}

/**
 * Hosts the @nestjs/throttler dynamic module and the global APP_GUARD.
 * The storage provider lives in ThrottlerStorageModule so the dynamic
 * module's `inject` resolves it: a dynamic module's inject list is resolved
 * against the modules in its `imports`, not against the host's providers.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ThrottlerStorageModule],
      useFactory: (
        storage: RedisThrottlerStorage,
        config: ConfigService,
      ): ThrottlerModuleOptions => ({
        ...throttlerOptions(config),
        storage,
      }),
      inject: [RedisThrottlerStorage, ConfigService],
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class ThrottlingModule {}
