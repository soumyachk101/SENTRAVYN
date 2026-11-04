import { Injectable, OnModuleInit, OnApplicationShutdown, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

/**
 * Wraps PrismaClient. The client connects lazily, so the API can boot before
 * the database is reachable and report honest readiness (see health module).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly config: ConfigService) {
    super({ log: ['warn', 'error'] });
  }

  async onModuleInit(): Promise<void> {
    if (this.config.get<string>('DATABASE_URL')) {
      await this.$connect().catch((err: unknown) => {
        // Boot must not fail when the DB is down locally; readiness reflects it.
        this.logger.warn(`Postgres not reachable yet: ${String(err)}`);
      });
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
