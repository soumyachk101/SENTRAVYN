import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * Self-contained audit framework: records and lists AuditEvent rows.
 * Exports AuditService so other modules (alerts, shelters, auth) can inject
 * it and write audit entries. AuthModule is imported so the controller's
 * @UseGuards(JwtAuthGuard, RolesGuard) resolve in this module's context.
 */
@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
