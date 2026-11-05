import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AlertsModule } from './alerts/alerts.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { ProvidersModule } from './providers/providers.module';
import { AdminReviewModule } from './admin/admin-review.module';
import { IngestModule } from './integrations/ingest.module';
import { GuidesModule } from './guides/guides.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Load .env from repo root (where it lives in this monorepo).
      envFilePath: [
        '.env',
        '../.env',
        process.env.NODE_ENV === 'test' ? '.env.test' : undefined,
      ].filter(Boolean) as string[],
    }),
    PrismaModule,
    HealthModule,
    AlertsModule,
    // Phase 2: trust and identity.
    AuthModule,
    AuditModule,
    ProvidersModule,
    AdminReviewModule,
    // Phase 3: provider adapters + ingestion pipeline.
    IngestModule,
    // Phase 5: reviewed safety-guides workflow (public + privileged).
    GuidesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
