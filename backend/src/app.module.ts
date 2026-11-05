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
import { ThrottlingModule } from './common/throttling/throttling.module';
import { GeoModule } from './geospatial/geo.module';
import { PlacesModule } from './places/places.module';
import { FamilySafetyModule } from './family-safety/family-safety.module';
import { GuidesModule } from './guides/guides.module';
import { NotificationModule } from './notifications/notification.module';

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
    // Phase 4: PostGIS spatial service and the places discovery / evidence API.
    GeoModule,
    PlacesModule,
    // Phase 7: family safety (consent-based; SECURITY.md 5).
    FamilySafetyModule,
    // Phase 5: reviewed safety-guides workflow (public + privileged).
    GuidesModule,
    // Phase 6: notifications + live updates + reconnect sync. Global
    // module: every alert publication path (admin-review, ingest) fans
    // out through PublishService without importing this module by name.
    NotificationModule,
    // Phase 9: global rate limiting (SECURITY.md 3) — APP_GUARD ThrottlerGuard,
    // Redis-backed storage (degrades to no-op when REDIS_URL is unset).
    ThrottlingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
