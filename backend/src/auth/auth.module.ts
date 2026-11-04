import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

/**
 * JwtModule is global so JwtService (required by JwtAuthGuard's constructor)
 * is resolvable in every module that attaches the guard on its controllers
 * (audit, providers, admin-review). The per-request secret is still resolved
 * from config; the service additionally fails closed when AUTH_JWT_SECRET is
 * unset, so no tokens can be issued with an empty key.
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
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
