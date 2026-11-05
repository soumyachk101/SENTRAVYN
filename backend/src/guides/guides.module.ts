import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { GuidesController } from './guides.controller';
import { GuidesAdminController } from './guides-admin.controller';
import { GuidesService } from './guides.service';

/**
 * Safety-guide module (Phase 5; SAFETY-POLICY.md 5, 8, 10).
 *
 * - GuidesController (public): GET /guides and GET /guides/:id. Public
 *   reads surface only APPROVED and PUBLISHED guides; every guide view
 *   carries a computed freshness label so stale content is surfaced,
 *   never presented as current (SAFETY-POLICY.md 8).
 * - GuidesAdminController (privileged): the full review workflow.
 *   Imports PrismaModule (global, data access), AuditModule (exports
 *   AuditService for the privileged mutations) and AuthModule (exports
 *   JwtAuthGuard used by the admin controller). RolesGuard is a stateless
 *   metadata reader; the guard runs per-route via the controller's
 *   @UseGuards(JwtAuthGuard, RolesGuard) — mirroring AdminReviewModule.
 */
@Module({
  imports: [PrismaModule, AuditModule, AuthModule],
  controllers: [GuidesController, GuidesAdminController],
  providers: [GuidesService],
  exports: [GuidesService],
})
export class GuidesModule {}
