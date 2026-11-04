import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';

type DepState = 'ok' | 'down';

interface DependencyReport {
  status: 'healthy' | 'degraded' | 'down';
  deps: Record<string, DepState>;
}

function buildReport(
  deps: Array<{ key: string; state: DepState; optional?: boolean }>,
): DependencyReport {
  const active = deps.filter((d) => !d.optional || d.state === 'ok');
  const downCount = active.filter((d) => d.state === 'down').length;
  const total = active.length;
  const status: DependencyReport['status'] =
    total === 0 || downCount === 0
      ? 'healthy'
      : downCount === total
        ? 'down'
        : 'degraded';
  return {
    status,
    deps: Object.fromEntries(deps.map((d) => [d.key, d.state])),
  };
}

/**
 * Pings Redis. When no REDIS_URL is configured (local dev without the
 * service), the dependency is optional and reported rather than failing
 * readiness. Kept as a plain injectable (no terminus base class) so the
 * health surface is stable across dependency versions.
 */
@Injectable()
export class RedisHealthIndicator {
  constructor(private readonly config: ConfigService) {}

  async isHealthy(): Promise<DepState> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) return 'down';
    let redis: Redis | undefined;
    try {
      redis = new Redis(url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
        connectTimeout: 1500,
      });
      await redis.connect();
      const pong = await redis.ping();
      return pong === 'PONG' ? 'ok' : 'down';
    } catch {
      return 'down';
    } finally {
      // ioredis disconnect() is synchronous and returns void; guard against
      // a client that was never created.
      if (redis) redis.disconnect();
    }
  }
}

/**
 * Composes liveness / readiness / database for the API. Kept dependency-light
 * so the process boots before infrastructure and reports readiness honestly.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly config: ConfigService,
    private readonly redis: RedisHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  async checkLiveness(): Promise<DependencyReport> {
    return buildReport([{ key: 'process', state: 'ok' }]);
  }

  async checkReadiness(): Promise<DependencyReport> {
    const hasRedis = Boolean(this.config.get<string>('REDIS_URL'));
    const redisState = hasRedis ? await this.redis.isHealthy() : 'ok';
    return buildReport([
      { key: 'process', state: 'ok' },
      { key: 'redis', state: redisState, optional: !hasRedis },
    ]);
  }

  async checkDatabase(): Promise<DependencyReport> {
    if (!this.config.get<string>('DATABASE_URL')) {
      return buildReport([{ key: 'database', state: 'down', optional: true }]);
    }
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return buildReport([{ key: 'database', state: 'ok' }]);
    } catch {
      return buildReport([{ key: 'database', state: 'down' }]);
    }
  }
}
