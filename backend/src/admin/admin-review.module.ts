import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AdminReviewController } from './admin-review.controller';
import { AdminReviewService } from './admin-review.service';

/**
 * Admin review module (SAFETY-POLICY.md 3, Gate E; SECURITY.md 6).
 *
 * Imports PrismaModule (global, data access), AuditModule (exports
 * AuditService) and AuthModule (exports JwtAuthGuard used by the
 * controller). RolesGuard is a stateless metadata reader; the module does
 * not register it — the guard runs per-route via the controller's
 * @UseGuards(JwtAuthGuard, RolesGuard).
 */
@Module({
  imports: [PrismaModule, AuditModule, AuthModule],
  controllers: [AdminReviewController],
  providers: [AdminReviewService],
})
export class AdminReviewModule {}
