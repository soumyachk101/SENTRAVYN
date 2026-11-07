import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { ProviderUpsertDto } from './providers.dto';
import { COVERAGE_NOTE } from '../places/places.service';

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
 * Public coverage-disclosure view (docs/PHASE-10-LAUNCH-READINESS.md
 * section 1 "coverage disclosure", docs/DATA-SOURCES.md section 6 "no
 * fabricated coverage").
 *
 * It is *derived from the enabled provider registry*, never from hard-coded
 * claims: `coveredCategories` is the set of categories with at least one
 * enabled provider, `enabledProviderCount` / `totalProviderCount` come from
 * the DataProvider rows, and `coverageNote` is the fixed disclosure literal
 * shared with the places read path (SAFETY-POLICY.md 1, 6). A map listing
 * is never proof a place is open, safe or operational — the same literal
 * the radius-search empty state returns (places.service.ts COVERAGE_NOTE),
 * so the public disclosure and the data surface say the one identical thing.
 *
 * This is a registry-metacode disclosure, not a source of safety claims:
 * it tells the user which *kinds of data* are currently enabled, so that a
 * "no coverage" region or a disabled category reads as a real gap, never
 * as fabricated coverage.
 */
export interface CoverageView {
  /** Fixed disclosure literal; identical to places.service.ts COVERAGE_NOTE. */
  coverageNote: string;
  /** True when at least one provider in the registry is enabled. */
  hasCoverage: boolean;
  enabledProviderCount: number;
  totalProviderCount: number;
  /** Categories (data kinds) with at least one enabled provider. */
  coveredCategories: string[];
  /** Categories present in the registry but with no enabled provider — the
   *  explicit "no coverage" data types the landing/footer must disclose. */
  uncoveredCategories: string[];
}

/**
 * Per-provider fetch-health aggregation (docs/PHASE-10-LAUNCH-READINESS.md
 * section 3 "provider health surfaced"). Computed from ProviderFetch rows
 * over a bounded window: success/partial/failure/outage counts, the latest
 * fetch, and whether the most recent finished fetch is an outage. Read-only;
 * never mutates registry state.
 */
export interface ProviderHealthView {
  key: string;
  name: string;
  enabled: boolean;
  /** Provider fetch outcomes over the window, or null when no fetch has
   *  happened yet — "no data" is a different state than "failing". */
  window: {
    since: string;
    success: number;
    partial: number;
    failed: number;
    outages: number;
    total: number;
  } | null;
  lastFetchAt: string | null;
  lastFetchStatus: string | null;
  /** True when the most recent finished fetch recorded an OUTAGE. The
   *  public UI never shows this; it is an admin/stale-provider signal
   *  (Phase 10 section 3: a stale provider state is admin-visible, never
   *  public). */
  lastFetchWasOutage: boolean;
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

  /**
   * Public coverage disclosure (Phase 10 section 1). Derives which data
   * categories are actually covered from the enabled rows of the provider
   * registry, so the landing/footer/terms disclosure states real coverage,
   * not a hard-coded claim. An empty registry (or all disabled) is the
   * `hasCoverage: false` state: the UI then renders "no coverage" rather
   * than pretending a source is live.
   *
   * Read-only: one registry read, no mutation, no audit event (a read of
   * public registry state is not a PROVIDER_CHANGED).
   */
  async coverage(): Promise<CoverageView> {
    const rows = await this.prisma.dataProvider.findMany({
      select: { category: true, enabled: true },
    });

    const totalProviderCount = rows.length;
    const enabled = rows.filter((r) => r.enabled);
    const enabledProviderCount = enabled.length;

    // Distinct categories, each listed once, alphabetised so the public
    // disclosure is deterministic regardless of insertion order.
    const enabledCategories = new Set(enabled.map((r) => r.category));
    const allCategories = new Set(rows.map((r) => r.category));
    const coveredCategories = [...enabledCategories].sort();
    const uncoveredCategories = [...allCategories]
      .filter((c) => !enabledCategories.has(c))
      .sort();

    return {
      // SAFETY-POLICY.md 1, 6: a listing is never proof a place is open,
      // safe or operational — the same literal the places read path uses.
      coverageNote: COVERAGE_NOTE,
      hasCoverage: enabledProviderCount > 0,
      enabledProviderCount,
      totalProviderCount,
      coveredCategories,
      uncoveredCategories,
    };
  }

  /**
   * Provider fetch-health aggregation for the admin data-quality surface
   * (Phase 10 section 3). `sinceHours` bounds the window so a long-running
   * deployment does not scan every fetch ever recorded; null = unbounded.
   *
   * Failure counts include FAILED, RATE_LIMITED and OUTAGE (an outage is a
   * recorded fetch outcome, not an absence of data — docs/DATA-SOURCES.md,
   * provider-outage.spec.ts). PENDING fetches are excluded: a fetch that
   * has not finished is not yet a success or a failure.
   */
  async health(sinceHours: number | null): Promise<ProviderHealthView[]> {
    const providers = await this.prisma.dataProvider.findMany({
      orderBy: { key: 'asc' },
    });
    const since =
      sinceHours != null && sinceHours > 0
        ? new Date(Date.now() - sinceHours * 3_600_000)
        : null;

    const views: ProviderHealthView[] = [];
    for (const provider of providers) {
      const window = await this.fetchWindow(provider.id, since);
      const lastFetch = await this.prisma.providerFetch.findFirst({
        where: {
          providerId: provider.id,
          completedAt: { not: null },
        },
        orderBy: { completedAt: 'desc' },
      });
      views.push({
        key: provider.key,
        name: provider.name,
        enabled: provider.enabled,
        window,
        lastFetchAt: lastFetch?.completedAt?.toISOString() ?? null,
        lastFetchStatus: lastFetch?.status ?? null,
        lastFetchWasOutage: lastFetch?.status === 'OUTAGE',
      });
    }
    return views;
  }

  private async fetchWindow(
    providerId: string,
    since: Date | null,
  ): Promise<NonNullable<ProviderHealthView['window']>> {
    const rows = await this.prisma.providerFetch.findMany({
      where: {
        providerId,
        ...(since ? { requestedAt: { gte: since } } : {}),
      },
      select: { status: true },
    });
    const count = (statuses: string[]) =>
      rows.filter((r) => statuses.includes(r.status)).length;
    return {
      since: since?.toISOString() ?? 'unbounded',
      success: count(['SUCCESS']),
      partial: count(['PARTIAL']),
      failed: count(['FAILED', 'RATE_LIMITED']),
      outages: count(['OUTAGE']),
      total: rows.length,
    };
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
