import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { GeoModule } from '../geospatial/geo.module';
import { PlacesController } from './places.controller';
import { PlacesService } from './places.service';

/**
 * Places discovery and shelter-evidence module (Phase 4; ROADMAP Phase 4).
 *
 * - PrismaModule is @Global, so it is imported here only for readability;
 *   it mirrors the sibling module declarations (ProvidersModule,
 *   AdminReviewModule).
 * - GeoModule exports GeoService (PostGIS radius search + label
 *   annotation, ADR-004).
 * - AuditModule exports AuditService, used to record the
 *   PLACE_EVIDENCE_ADDED event for every evidence submission.
 * - AuthModule exports JwtAuthGuard, which the controller attaches to the
 *   authenticated POST /:id/evidence route.
 */
@Module({
  imports: [PrismaModule, GeoModule, AuditModule, AuthModule],
  controllers: [PlacesController],
  providers: [PlacesService],
})
export class PlacesModule {}
