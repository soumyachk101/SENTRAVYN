import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';

/**
 * Data-provider registry module (docs/DATA-SOURCES.md 2).
 *
 * Imports PrismaModule (global, data access), AuditModule (exports
 * AuditService, required by ProvidersService for every registry mutation)
 * and AuthModule (exports JwtAuthGuard used by the controller). Role
 * enforcement is via the @Roles decorators on the routes.
 */
@Module({
  imports: [PrismaModule, AuditModule, AuthModule],
  controllers: [ProvidersController],
  providers: [ProvidersService],
})
export class ProvidersModule {}
