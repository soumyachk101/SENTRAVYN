import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { AlertsModule } from './alerts/alerts.module';

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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
