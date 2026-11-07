import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { FamilySafetyController } from './family-safety.controller';
import { FamilySafetyService } from './family-safety.service';

/**
 * Family-safety module (Phase 7: consent-based location sharing, emergency
 * contacts, household plan; SECURITY.md 5 / PRODUCT-SPEC.md 8).
 *
 * Same composition as the providers module: PrismaModule (global, data
 * access), AuditModule (exports AuditService - every mutation here is
 * audited) and AuthModule (exports JwtAuthGuard used by the controller).
 * Object-level authorisation (only the owning user) is enforced inside
 * FamilySafetyService, not in this module.
 */
@Module({
  imports: [PrismaModule, AuditModule, AuthModule],
  controllers: [FamilySafetyController],
  providers: [FamilySafetyService],
})
export class FamilySafetyModule {}
