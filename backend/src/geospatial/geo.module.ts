import { Module } from '@nestjs/common';
import { GeoService } from './geo.service';

/**
 * PostGIS spatial service module (Phase 4, ADR-004). No controllers here:
 * this head owns the GeoService only; a consuming controller module imports
 * GeoModule and uses the exported service. PrismaService comes from the
 * @Global PrismaModule, so it is not imported here (mirrors AlertsModule).
 */
@Module({
  providers: [GeoService],
  exports: [GeoService],
})
export class GeoModule {}
