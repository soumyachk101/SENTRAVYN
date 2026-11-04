import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import type { ProviderAdapter } from './types';
import { PROVIDER_ADAPTERS } from './types';
import { CapAdapter, GdacsAdapter, ProviderAdapterRegistry } from './adapters';
import { IngestService } from './ingest.service';

/**
 * Phase 3 provider-adapter framework + ingest pipeline.
 *
 * Adapters are exposed to the registry under the single token PROVIDER_ADAPTERS
 * (types.ts seam) as an explicit array, via a useFactory provider. The factory
 * form is used rather than repeated `multi: true` registrations because, in
 * the installed @nestjs/common, multi-provider merging is unreliable here:
 * each `multi` registration overwrites the previous one instead of
 * accumulating, so the registry would see only the last adapter (or nothing)
 * and every ingest would fall into the unknown-provider branch. The factory
 * returns the concrete array, which ProviderAdapterRegistry consumes directly.
 *
 * A later provider module (Phase 6 scheduling, other feeds) adds its adapter
 * to this factory's array; the registry needs no change.
 *
 * The module exports the registry + adapters so later modules can build on
 * the same pipeline.
 */
@Module({
  imports: [PrismaModule, AuditModule],
  providers: [
    GdacsAdapter,
    CapAdapter,
    {
      provide: PROVIDER_ADAPTERS,
      useFactory: (gdacs: GdacsAdapter, cap: CapAdapter): ProviderAdapter[] => [gdacs, cap],
      inject: [GdacsAdapter, CapAdapter],
    },
    ProviderAdapterRegistry,
    IngestService,
  ],
  exports: [IngestService, ProviderAdapterRegistry, GdacsAdapter, CapAdapter],
})
export class IngestModule {}
