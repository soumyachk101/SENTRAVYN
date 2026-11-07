import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ProvidersController } from './providers.controller';
import { CoverageController } from './coverage.controller';
import { ProvidersService } from './providers.service';

/**
 * Data-provider registry module (docs/DATA-SOURCES.md 2).
 *
 * Imports PrismaModule (global, data access), AuditModule (exports
 * AuditService, required by ProvidersService for every registry mutation)
 * and AuthModule (exports JwtAuthGuard used by the auth-gated registry
 * controller). Role enforcement on the registry routes is via the @Roles
 * decorators; the public CoverageController (Phase 10 section 1) hosts the
 * unauthenticated coverage-disclosure read and carries no such guard.
 */
@Module({
  imports: [PrismaModule, AuditModule, AuthModule],
  controllers: [ProvidersController, CoverageController],
  providers: [ProvidersService],
})
export class ProvidersModule {}
