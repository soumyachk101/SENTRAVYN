import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthService } from './health.service';

/**
 * Non-auth surface: governed only by the general `default` rate limit
 * (throttling.module.ts, SECURITY.md 3).
 */
@ApiTags('health')
@Controller('health')
@SkipThrottle({ auth: true })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({
    summary: 'Readiness: process + Redis (+ Postgres when configured)',
  })
  readiness() {
    return this.health.checkReadiness();
  }

  @Get('live')
  @ApiOperation({ summary: 'Liveness: process is up' })
  liveness() {
    return this.health.checkLiveness();
  }

  @Get('database')
  @ApiOperation({ summary: 'Database health (Postgres + PostGIS)' })
  database() {
    return this.health.checkDatabase();
  }
}
