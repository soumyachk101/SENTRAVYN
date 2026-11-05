import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { MfaController } from './mfa/mfa.controller';
import { MfaService } from './mfa/mfa.service';

/**
 * JwtModule is global so JwtService (required by JwtAuthGuard's constructor)
 * is resolvable in every module that attaches the guard on its controllers
 * (audit, providers, admin-review). The per-request secret is still resolved
 * from config; the service additionally fails closed when AUTH_JWT_SECRET is
 * unset, so no tokens can be issued with an empty key.
 *
 * MFA (docs/SECURITY.md section 2) lives in this module so the auth and
 * second-factor flows share one provider graph with no circular dependency:
 * MfaService only depends on Prisma/Config/Jwt; AuthService orchestrates
 * MfaService; both are exported for controllers and guards.
 */
@Module({
  imports: [
    PrismaModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('AUTH_JWT_SECRET') ?? '',
      }),
    }),
  ],
  controllers: [AuthController, MfaController],
  providers: [AuthService, MfaService, JwtAuthGuard],
  exports: [AuthService, MfaService, JwtAuthGuard],
})
export class AuthModule {}
