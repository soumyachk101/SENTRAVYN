import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { ProviderUpsertDto } from './providers.dto';

/**
 * Data-provider registry service (docs/DATA-SOURCES.md 2).
 *
 * Manages the DataProvider table only: identity, documentation URLs,
 * license/attribution notes, enablement and seed metadata. No provider
 * credentials live in this table and no route in this module returns
 * credential material.
 *
 * Every mutation records an AUDIT_ACTIONS.PROVIDER_CHANGED event via
 * AuditService so registry changes are traceable (SECURITY.md 6).
 *
 * Role enforcement lives on the controller via the shared RBAC decorators
 * (backend/src/common/rbac/roles.decorator.ts @Roles, which the global
 * RolesGuard enforces once wired by the auth head); the service stays
 * role-agnostic.
 */

export interface ProviderView {
  key: string;
  name: string;
  docUrl: string | null;
  category: string;
  license: string | null;
  attribution: string | null;
  enabled: boolean;
  freshnessPolicyHours: number | null;
  lastSeededAt: string | null;
}

export interface SeedResult {
  seededKeys: string[];
  lastSeededAt: string;
}

/**
 * Phase 2 fixture providers seeded by POST /providers/seed.
 *
 * docUrl values are taken verbatim from the "Official resource" column of
 * docs/DATA-SOURCES.md section 1. `license` is deliberately left null for
 * every fixture: the document does not state a license for these sources
 * and requires legal verification before integration (DATA-SOURCES.md 1-2),
 * so no license text is asserted here.
 *
 * All fixtures are seeded disabled: DATA-SOURCES.md stage 5 lists
 * "Controlled production enablement" as a later stage, and re-seeding never
 * silently flips `enabled` (see ProvidersService.seed).
 */
export const PHASE2_SEED_PROVIDERS: ProviderUpsertDto[] = [
  {
    key: 'gdacs',
    name: 'GDACS',
    docUrl: 'https://www.gdacs.org/gdacsapi/swagger/index.html',
    category: 'alerts',
    attribution:
      'GDACS global disaster event and alert information ' +
      '(docs/DATA-SOURCES.md 1). Verify current terms, quotas and update ' +
      'cadence before production use.',
    enabled: false,
  },
  {
    key: 'usgs',
    name: 'USGS',
    docUrl: 'https://earthquake.usgs.gov/data/',
    category: 'events',
    attribution:
      'USGS earthquake events and GeoJSON feeds (docs/DATA-SOURCES.md 1). ' +
      'Verify terms, quotas and update cadence before production use.',
    enabled: false,
  },
  {
    key: 'copernicus-emdat',
    name: 'Copernicus EMS / EMDAT',
    docUrl: 'https://documentation.dataspace.copernicus.eu/',
    category: 'events',
    attribution:
      'Copernicus Emergency Mapping Service ' +
      '(https://mapping.emergency.copernicus.eu/) and EM-DAT historical ' +
      'disaster research data (https://www.emdat.be/). Per ' +
      'docs/DATA-SOURCES.md 1-2, verify licensing, redistribution rights, ' +
      'quotas and update cadence before production use.',
    enabled: false,
  },
];

@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Lists providers for any authenticated role. Only public registry
   * metadata is returned; no credential material exists in this table.
   */
  async list(): Promise<ProviderView[]> {
    const rows = await this.prisma.dataProvider.findMany({
      orderBy: { key: 'asc' },
    });
    return rows.map(toProviderView);
  }

  /** Create or update a provider by stable key. */
  async upsert(
    actorUserId: string,
    dto: ProviderUpsertDto,
  ): Promise<ProviderView> {
    const provider = await this.prisma.dataProvider.upsert({
      where: { key: dto.key },
      create: {
        key: dto.key,
        name: dto.name,
        docUrl: dto.docUrl,
        category: dto.category ?? 'alerts',
        license: dto.license ?? null,
        attribution: dto.attribution ?? null,
        enabled: dto.enabled ?? false,
        freshnessPolicyHours: dto.freshnessPolicyHours ?? null,
      },
      update: {
        name: dto.name,
        docUrl: dto.docUrl,
        category: dto.category ?? 'alerts',
        license: dto.license ?? null,
        attribution: dto.attribution ?? null,
        enabled: dto.enabled ?? false,
        freshnessPolicyHours: dto.freshnessPolicyHours ?? null,
      },
    });
    await this.audit.record(
      actorUserId,
      AUDIT_ACTIONS.PROVIDER_CHANGED,
      'dataProvider',
      provider.key,
      `upserted provider ${provider.key}`,
    );
    return toProviderView(provider);
  }

  /** Enable or disable a provider. */
  async setEnabled(
    actorUserId: string,
    key: string,
    enabled: boolean,
  ): Promise<ProviderView> {
    const provider = await this.prisma.dataProvider.findUnique({
      where: { key },
    });
    if (!provider) {
      throw new NotFoundException(`Provider not found: ${key}`);
    }
    const updated = await this.prisma.dataProvider.update({
      where: { key },
      data: { enabled },
    });
    await this.audit.record(
      actorUserId,
      AUDIT_ACTIONS.PROVIDER_CHANGED,
      'dataProvider',
      key,
      `${enabled ? 'enabled' : 'disabled'} provider ${key}`,
    );
    return toProviderView(updated);
  }

  /**
   * Seeds the Phase 2 fixture providers (docs/DATA-SOURCES.md). Idempotent:
   * every row is upserted by key, so re-seeding refreshes metadata and
   * lastSeededAt without duplicating providers. The update path deliberately
   * does not touch `enabled`, so re-seeding never silently re-disables a
   * provider an operator enabled.
   *
   * When `rows` is omitted, the three documented fixture providers are
   * seeded. Explicit rows use the same key-based upsert.
   */
  async seed(
    actorUserId: string,
    rows?: ProviderUpsertDto[],
  ): Promise<SeedResult> {
    const seedRows = rows ?? PHASE2_SEED_PROVIDERS;
    const lastSeededAt = new Date();
    const seededKeys: string[] = [];

    for (const row of seedRows) {
      const provider = await this.prisma.dataProvider.upsert({
        where: { key: row.key },
        create: {
          key: row.key,
          name: row.name,
          docUrl: row.docUrl,
          category: row.category ?? 'alerts',
          license: row.license ?? null,
          attribution: row.attribution ?? null,
          enabled: row.enabled ?? false,
          freshnessPolicyHours: row.freshnessPolicyHours ?? null,
          lastSeededAt,
        },
        update: {
          name: row.name,
          docUrl: row.docUrl,
          category: row.category ?? 'alerts',
          license: row.license ?? null,
          attribution: row.attribution ?? null,
          freshnessPolicyHours: row.freshnessPolicyHours ?? null,
          lastSeededAt,
        },
      });
      seededKeys.push(provider.key);
      await this.audit.record(
        actorUserId,
        AUDIT_ACTIONS.PROVIDER_CHANGED,
        'dataProvider',
        provider.key,
        'seeded provider fixtures (docs/DATA-SOURCES.md)',
      );
    }

    return {
      seededKeys,
      lastSeededAt: lastSeededAt.toISOString(),
    };
  }
}

function toProviderView(
  r: Prisma.DataProviderGetPayload<Prisma.DataProviderDefaultArgs>,
): ProviderView {
  return {
    key: r.key,
    name: r.name,
    docUrl: r.docUrl,
    category: r.category,
    license: r.license,
    attribution: r.attribution,
    enabled: r.enabled,
    freshnessPolicyHours: r.freshnessPolicyHours,
    lastSeededAt: r.lastSeededAt?.toISOString() ?? null,
  };
}
