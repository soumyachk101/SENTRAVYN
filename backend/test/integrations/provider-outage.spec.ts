import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { IngestService } from '../../src/integrations/ingest.service';
import { GdacsAdapter } from '../../src/integrations/adapters/gdacs.adapter';
import { CapAdapter } from '../../src/integrations/adapters/cap.adapter';
import { ProviderAdapterRegistry } from '../../src/integrations/adapters/registry';
import {
  evaluateFreshness,
  DEFAULT_FRESHNESS_POLICY_HOURS,
} from '../../src/common/freshness';

/**
 * Phase 9 provider-outage simulation (docs/ROADMAP.md Phase 9,
 * ARCHITECTURE.md 6: "Handle provider outages", SAFETY-POLICY.md 8:
 * stale data must never be presented as live).
 *
 * The ingest service is synchronous-to-DB only: fetching is the fetch
 * layer's job, and a provider outage is recorded by that layer as a
 * ProviderFetch with status OUTAGE (FetchStatus enum, schema.prisma)
 * without ingesting any payload. This spec simulates that contract on the
 * REAL pipeline (real adapters, real PrismaService against the local
 * Postgres): a valid fetch establishes a live alert, an OUTAGE fetch proves
 * that no content advances while the provider is down and that the
 * freshness state of the last data flips from fresh to stale, and a
 * subsequent successful fetch recovers the pipeline.
 *
 * DB gating (same discipline as test/geo.spec.ts and test/notifications/):
 * when DATABASE_URL is not configured every case logs
 * `SKIP: DATABASE_URL not configured; <case> not run` and returns — a
 * skipped check is never reported as a pass.
 */
describe('Provider outage simulation (Phase 9, gated on DATABASE_URL)', () => {
  const dbConfigured = Boolean(process.env.DATABASE_URL);

  let prisma: PrismaService;
  let ingest: IngestService;

  const runId = Date.now();
  // Real-time window the spec's own fetches fall in (the shared dev DB may
  // carry cap fetches from other suites; assertions scope to this window).
  let runStart = 0;
  const providerKey = 'cap';
  // Run-unique CAP identifier so the spec never collides with other rows.
  const alertId = `urn:oid:sentravyn-outage-${runId}`;
  const fetchRefs = {
    baseline: `outage-baseline-${runId}`,
    recovery: `outage-recovery-${runId}`,
  };

  const iso = (d: Date): string => d.toISOString();
  const minutes = (n: number): number => n * 60_000;

  function capDoc(
    msgType: 'Alert' | 'Update',
    issuedAt: Date,
    effectiveAt: Date,
    headline: string,
  ): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<cap version="2.0" xmlns="urn:us:government:fema">
  <alert>
    <id>${alertId}</id>
    <sender>noreply@sentravyn.example</sender>
    <issued>${iso(issuedAt)}</issued>
    <msgType>${msgType}</msgType>
    <scope>Public</scope>
    <severity>Moderate</severity>
    <urgency>Expected</urgency>
    <certainty>Likely</certainty>
    <info>
      <language>en-US</language>
      <headline>${headline}</headline>
      <description>Outage simulation record (${msgType}).</description>
    </info>
    <effective>${iso(effectiveAt)}</effective>
  </alert>
</cap>
`;
  }

  /**
   * The publish step of the pipeline (admin review → PUBLISHED). The outage
   * spec owns this transition directly so the freshness reference
   * (publishedAt) is exact.
   */
  async function publishAlert(): Promise<void> {
    const alert = await prisma.alert.findFirstOrThrow({
      where: { externalRef: alertId },
    });
    await prisma.alert.update({
      where: { id: alert.id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
  }

  /** FetchStatus of the most recent fetch recorded by this spec's run. */
  async function latestFetchStatus(): Promise<string> {
    const provider = await prisma.dataProvider.findUniqueOrThrow({
      where: { key: providerKey },
    });
    const fetch = await prisma.providerFetch.findFirst({
      where: {
        providerId: provider.id,
        requestedAt: { gte: new Date(runStart) },
      },
      orderBy: { completedAt: 'desc' },
    });
    return fetch?.status ?? 'none';
  }

  beforeAll(async () => {
    if (!dbConfigured) return;
    runStart = Date.now();
    prisma = new PrismaService(new ConfigService(process.env));
    await prisma.$connect();

    const registry = new ProviderAdapterRegistry([
      new GdacsAdapter(),
      new CapAdapter(),
    ]);
    const audit = new AuditService(prisma);
    ingest = new IngestService(prisma, audit, registry);

    // Controlled-enablement rule (DATA-SOURCES.md 5.7): an on-demand
    // registration lands with enabled:false, and an existing disabled row is
    // a refusal. The spec owns its fixture: guarantee an ENABLED cap row up
    // front so every ingest in the run proceeds through the parse path
    // instead of the refusal path.
    const existing = await prisma.dataProvider.findUnique({
      where: { key: providerKey },
    });
    if (!existing) {
      await prisma.dataProvider.create({
        data: { key: providerKey, name: 'CAP (generic)', enabled: true },
      });
    } else if (existing.enabled === false) {
      await prisma.dataProvider.update({
        where: { key: providerKey },
        data: { enabled: true },
      });
    }
  });

  afterAll(async () => {
    if (!dbConfigured) return;
    await prisma.$disconnect();
  });

  it('baseline: a valid provider fetch publishes a live alert that reads as fresh', async () => {
    if (!dbConfigured) {
      console.log(
        'SKIP: DATABASE_URL not configured; outage baseline fetch not run',
      );
      return;
    }
    const t0 = new Date();
    const outcome = await ingest.ingest(
      providerKey,
      capDoc('Alert', t0, t0, 'Outage simulation baseline'),
      { fetchRef: fetchRefs.baseline, fetchedAt: t0 },
    );
    expect(outcome.created).toBe(1);

    await publishAlert();

    // The published alert is public-visible and its freshness reads as
    // fresh relative to the fetch time (the source data is current).
    const row = await prisma.alert.findFirstOrThrow({
      where: { externalRef: alertId },
    });
    expect(row.status).toBe('PUBLISHED');
    const provider = await prisma.dataProvider.findUniqueOrThrow({
      where: { key: providerKey },
    });
    const policyHours =
      provider.freshnessPolicyHours ?? DEFAULT_FRESHNESS_POLICY_HOURS;
    const fresh = evaluateFreshness({
      updatedAt: row.publishedAt,
      now: t0,
      policyHours,
    });
    expect(fresh.state).toBe('fresh');
    expect(await latestFetchStatus()).toBe('SUCCESS');
  });

  it('outage: an OUTAGE fetch records the provider down and no content advances; freshness flips stale', async () => {
    if (!dbConfigured) {
      console.log(
        'SKIP: DATABASE_URL not configured; outage recording not run',
      );
      return;
    }
    const t0 = new Date();
    const revisionCountBefore = await prisma.alertRevision.count({
      where: { alert: { externalRef: alertId } },
    });

    // The fetch layer's outage contract: record a FAILED fetch with the
    // OUTAGE status; no payload is ingested while the provider is down.
    const provider = await prisma.dataProvider.findUniqueOrThrow({
      where: { key: providerKey },
    });
    await prisma.providerFetch.create({
      data: {
        providerId: provider.id,
        status: 'OUTAGE',
        itemCount: 0,
        requestedAt: t0,
        completedAt: t0,
        error: 'simulated provider outage (Phase 9 drill)',
      },
    });
    expect(await latestFetchStatus()).toBe('OUTAGE');

    // No partial publication: nothing changed while the provider was down —
    // no new revision, no alert transition, no public-list change.
    const revisionCountAfter = await prisma.alertRevision.count({
      where: { alert: { externalRef: alertId } },
    });
    expect(revisionCountAfter).toBe(revisionCountBefore);
    const row = await prisma.alert.findFirstOrThrow({
      where: { externalRef: alertId },
    });
    expect(row.status).toBe('PUBLISHED'); // unchanged by the outage

    // Stale data must not read as live: the last data is now older than the
    // provider's freshness policy (SAFETY-POLICY.md 8). The public list must
    // say so explicitly instead of hiding it.
    const policyHours =
      (
        await prisma.dataProvider.findUniqueOrThrow({
          where: { key: providerKey },
        })
      ).freshnessPolicyHours ?? DEFAULT_FRESHNESS_POLICY_HOURS;
    const staleNow = new Date(
      (row.publishedAt ?? row.issuedAt ?? t0).getTime() +
        minutes(policyHours * 60 + 5),
    );
    const stale = evaluateFreshness({
      updatedAt: row.publishedAt ?? row.issuedAt,
      now: staleNow,
      policyHours,
    });
    expect(stale.state).toBe('stale');
    expect(stale.ageMinutes).toBeGreaterThanOrEqual(policyHours * 60 + 5);
    // And data with no timestamp at all can never read as fresh either.
    expect(evaluateFreshness({ updatedAt: null, now: staleNow }).state).toBe(
      'unknown',
    );

    // The quarantine half of "no partial publication": unreviewed records
    // (here a provider test message) persist but can never surface publicly.
    const testDoc = capDoc('Alert', t0, t0, 'Outage simulation quarantined');
    const quarantinedId = `urn:oid:sentravyn-outage-test-${runId}`;
    const testXml = testDoc
      .replace(alertId, quarantinedId)
      .replace('<msgType>Alert</msgType>', '<msgType>Test</msgType>');
    const q = await ingest.ingest(providerKey, testXml, {
      fetchRef: `outage-test-${runId}`,
      fetchedAt: t0,
    });
    expect(q.quarantined).toBe(1);
    const quarantinedRow = await prisma.alert.findFirstOrThrow({
      where: { externalRef: quarantinedId },
    });
    expect(quarantinedRow.status).toBe('QUARANTINED'); // never public
    // The live alert still exists, still public-visible; its freshness is
    // the one that now reads stale (computed above), never hidden.
    expect(row.status).toBe('PUBLISHED');
  });

  it('recovery: a subsequent successful fetch resumes the pipeline and data reads fresh again', async () => {
    if (!dbConfigured) {
      console.log('SKIP: DATABASE_URL not configured; outage recovery not run');
      return;
    }
    const t1 = new Date();
    const outcome = await ingest.ingest(
      providerKey,
      capDoc('Update', t1, t1, 'Outage simulation recovery update'),
      { fetchRef: fetchRefs.recovery, fetchedAt: t1 },
    );
    expect(outcome.updated).toBe(1);

    await publishAlert();

    // The pipeline recovered: the newest fetch is a SUCCESS after the
    // OUTAGE row, and the alert advanced exactly one revision on top of the
    // baseline (the quarantined test message in the outage step is a
    // separate alert, so it does not count here).
    expect(await latestFetchStatus()).toBe('SUCCESS');
    const revisionCount = await prisma.alertRevision.count({
      where: { alert: { externalRef: alertId } },
    });
    expect(revisionCount).toBe(2); // baseline + recovery

    // Freshness reads fresh again relative to the recovery fetch time.
    const row = await prisma.alert.findFirstOrThrow({
      where: { externalRef: alertId },
    });
    const provider = await prisma.dataProvider.findUniqueOrThrow({
      where: { key: providerKey },
    });
    const policyHours =
      provider.freshnessPolicyHours ?? DEFAULT_FRESHNESS_POLICY_HOURS;
    const recovered = evaluateFreshness({
      updatedAt: row.publishedAt ?? row.issuedAt,
      now: t1,
      policyHours,
    });
    expect(recovered.state).toBe('fresh');

    // The OUTAGE row remains in the fetch history: the outage is recorded,
    // not erased by the recovery. The window also holds the quarantine
    // step's fetch (a parse-success with a quarantined test message).
    const fetches = await prisma.providerFetch.findMany({
      where: {
        providerId: provider.id,
        requestedAt: { gte: new Date(runStart) },
      },
      orderBy: { requestedAt: 'asc' },
    });
    const statuses = fetches.map((f) => f.status);
    expect(statuses[0]).toBe('SUCCESS'); // baseline
    expect(statuses).toEqual(
      expect.arrayContaining(['SUCCESS', 'OUTAGE', 'SUCCESS']),
    );
    expect(statuses.filter((s) => s === 'OUTAGE').length).toBe(1);
    expect(statuses[statuses.length - 1]).toBe('SUCCESS'); // recovery last
  });
});
