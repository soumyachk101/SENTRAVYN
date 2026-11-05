import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisThrottlerStorage } from './throttler-storage.service';

/**
 * Provides the Redis-backed throttler storage as a global singleton so the
 * @nestjs/throttler dynamic module (ThrottlerModule.forRootAsync) can inject
 * it: a dynamic module's `inject` resolves against the modules it IMPORTS,
 * not against providers declared on its host module. ConfigModule is global
 * (isGlobal: true in app.module.ts), so the storage's ConfigService
 * dependency resolves in every context.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [RedisThrottlerStorage],
  exports: [RedisThrottlerStorage],
})
export class ThrottlerStorageModule {}
