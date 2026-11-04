import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Readiness: process + Redis (+ Postgres when configured)' })
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
