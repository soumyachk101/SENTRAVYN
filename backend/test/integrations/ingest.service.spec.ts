import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService, AUDIT_ACTIONS } from '../../src/audit/audit.service';
import { IngestService } from '../../src/integrations/ingest.service';
import { GdacsAdapter } from '../../src/integrations/adapters/gdacs.adapter';
import { CapAdapter } from '../../src/integrations/adapters/cap.adapter';
import { ProviderAdapterRegistry } from '../../src/integrations/adapters/registry';
import { payloadHash } from '../../src/common/provenance/provenance';
import type { IngestOutcome } from '../../src/integrations/types';

const gdacsPayload = readFileSync(
  resolve(__dirname, '..', 'fixtures', 'gdacs', 'sample-events.json'),
  'utf8',
);
const FETCHED_AT = new Date('2026-02-12T08:00:00Z');
const FETCH_REF = 'gdacs-fetch-1';

/**
 * CAP cancel / test documents. The CAP parser module is written in parallel
 * and its exact fixture is not in this checkout, so these documents are
 * inline, in the dialect the parser accepts (<cap><alert>, <id>, times at
 * the <alert> level, <info><headline>).
 */
const CAP_CANCEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<cap version="2.0" xmlns="urn:us:government:fema">
  <alert>
    <id>urn:oid:sentravyn-e2e-cap-cancel</id>
    <sender>noreply@sentravyn.example</sender>
    <issued>2026-02-12T07:00:00Z</issued>
    <msgType>Cancel</msgType>
    <scope>Public</scope>
    <info>
      <language>en-US</language>
      <headline>Storm warning - coastal lowlands (cancelled)</headline>
      <description>The coastal lowlands storm warning is cancelled.</description>
    </info>
  </alert>
</cap>
`;

const CAP_TEST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<cap version="2.0" xmlns="urn:us:government:fema">
  <alert>
    <id>urn:oid:sentravyn-e2e-cap-test</id>
    <sender>noreply@sentravyn.example</sender>
    <issued>2026-02-12T07:30:00Z</issued>
    <msgType>Test</msgType>
    <scope>Public</scope>
    <info>
      <language>en-US</language>
      <headline>System test message</headline>
      <description>Scheduled parser test message.</description>
    </info>
  </alert>
</cap>
`;

type PrismaState = {
  provider?: Record<string, unknown> | null;
  rawFound?: Record<string, unknown> | null;
  alertFound?: Record<string, unknown> | null;
};

/**
 * Prisma stub scripted per test. Only the delegate methods the pipeline
 * touches are mocked; upsertRawRecord + AuditService are the REAL modules,
 * so the stub row must carry a real payloadHash for replay detection.
 */
function makePrisma(state: PrismaState) {
  return {
    dataProvider: {
      findUnique: jest.fn(async () => state.provider ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'provider-2',
        ...data,
      })),
    },
    rawSourceRecord: {
      findFirst: jest.fn(async () => state.rawFound ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'raw-1',
        ...data,
      })),
    },
    alert: {
      findFirst: jest.fn(async () => state.alertFound ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'alert-1',
        ...data,
      })),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => ({
          id: where.id,
          data,
        }),
      ),
    },
    alertRevision: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'rev-1',
        ...data,
      })),
    },
    providerFetch: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'fetch-1',
        ...data,
      })),
    },
    auditEvent: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'audit-1',
        ...data,
      })),
    },
  };
}

function makeService(prismaStub: ReturnType<typeof makePrisma>) {
  const prisma = prismaStub as unknown as PrismaService;
  const audit = new AuditService(prisma);
  const registry = new ProviderAdapterRegistry([
    new GdacsAdapter(),
    new CapAdapter(),
  ]);
  return {
    service: new IngestService(prisma, audit, registry),
    prisma: prismaStub,
  };
}

function zeroed(providerKey: string): IngestOutcome {
  return {
    providerKey,
    created: 0,
    updated: 0,
    cancelled: 0,
    quarantined: 0,
    alertIds: [],
    quarantinedIds: [],
    deduped: 0,
  };
}

describe('IngestService (Phase 3 pipeline, ADR-005/ADR-007)', () => {
  it('creates one alert + revision + raw record + provider fetch for a fresh gdacs fetch', async () => {
    const { service, prisma } = makeService(makePrisma({}));

    const outcome = await service.ingest('gdacs', gdacsPayload, {
      fetchRef: FETCH_REF,
      fetchedAt: FETCHED_AT,
    });

    // Two elements → two alerts, no updates/cancels/quarantines.
    expect(outcome).toEqual({
      providerKey: 'gdacs',
      created: 2,
      updated: 0,
      cancelled: 0,
      quarantined: 0,
      alertIds: ['alert-1', 'alert-1'],
      quarantinedIds: [],
      deduped: 0,
    });

    // Exactly one raw record per ingest call, keyed by the fetch ref (ADR-007).
    expect(prisma.rawSourceRecord.create).toHaveBeenCalledTimes(1);
    expect(prisma.rawSourceRecord.create.mock.calls[0][0].data.sourceId).toBe(
      FETCH_REF,
    );
    expect(prisma.rawSourceRecord.create.mock.calls[0][0].data.rawPayload).toBe(
      gdacsPayload,
    );
    expect(
      prisma.rawSourceRecord.create.mock.calls[0][0].data.payloadHash,
    ).toBe(payloadHash(gdacsPayload));

    // Two alerts, both VALIDATED / UNVERIFIED / OFFICIAL_SOURCE, linked to the raw record.
    expect(prisma.alert.create).toHaveBeenCalledTimes(2);
    const [first, second] = prisma.alert.create.mock.calls.map(
      (call) => call[0].data,
    );
    expect(first.externalRef).toBe('gdacs:4242');
    expect(second.externalRef).toBe('gdacs:4243');
    expect(first.status).toBe('VALIDATED');
    expect(first.verification).toBe('UNVERIFIED');
    expect(first.informationClass).toBe('OFFICIAL_SOURCE');
    expect(first.sourceRecordId).toBe('raw-1');

    // One revision per alert, revision 1, body preserved.
    expect(prisma.alertRevision.create).toHaveBeenCalledTimes(2);
    expect(prisma.alertRevision.create.mock.calls[0][0].data).toMatchObject({
      alertId: 'alert-1',
      revision: 1,
      status: 'VALIDATED',
      body: 'Magnitude 5.1 earthquake reported near the continental shelf.',
    });

    // Provider fetch: success, 2 items.
    expect(prisma.providerFetch.create).toHaveBeenCalledTimes(1);
    expect(prisma.providerFetch.create.mock.calls[0][0].data).toMatchObject({
      status: 'SUCCESS',
      itemCount: 2,
      error: null,
    });

    // Every canonical mutation leaves an audit trail (system actor = null).
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(2);
    expect(prisma.auditEvent.create.mock.calls[0][0].data).toMatchObject({
      actorUserId: null,
      action: AUDIT_ACTIONS.ALERT_UPDATED,
      entity: 'alert',
    });
  });

  it('treats a replay of the same fetchRef as deduped: no second revision, no status change', async () => {
    const { service, prisma } = makeService(
      makePrisma({
        provider: { id: 'provider-1', key: 'gdacs' },
        // A prior ingest stored this exact payload for the same fetch ref.
        rawFound: {
          id: 'raw-1',
          providerId: 'provider-1',
          sourceId: FETCH_REF,
          payloadHash: payloadHash(gdacsPayload),
          rawPayload: gdacsPayload,
          ingestedAt: FETCHED_AT,
        },
        alertFound: {
          id: 'alert-1',
          externalRef: 'gdacs:4242',
          _count: { revisions: 1 },
        },
      }),
    );

    const outcome = await service.ingest('gdacs', gdacsPayload, {
      fetchRef: FETCH_REF,
      fetchedAt: FETCHED_AT,
    });

    // Both events are replays of an existing canonical alert: deduped, no writes.
    expect(outcome).toEqual({
      providerKey: 'gdacs',
      created: 0,
      updated: 0,
      cancelled: 0,
      quarantined: 0,
      alertIds: [],
      quarantinedIds: [],
      deduped: 2,
    });
    expect(prisma.rawSourceRecord.create).not.toHaveBeenCalled();
    expect(prisma.alert.create).not.toHaveBeenCalled();
    expect(prisma.alert.update).not.toHaveBeenCalled();
    expect(prisma.alertRevision.create).not.toHaveBeenCalled();
    // The replay still records the fetch.
    expect(prisma.providerFetch.create).toHaveBeenCalledTimes(1);
  });

  it('applies a cancel to the existing alert: status CANCELLED + a new revision', async () => {
    const { service, prisma } = makeService(
      makePrisma({
        provider: { id: 'provider-1', key: 'cap' },
        alertFound: {
          id: 'alert-target',
          externalRef: 'urn:uuid:11111111-2222-3333-4444-555555555556',
          _count: { revisions: 1 },
        },
      }),
    );

    const outcome = await service.ingest('cap', CAP_CANCEL_XML, {
      fetchRef: 'cap-cancel-1',
      fetchedAt: FETCHED_AT,
    });

    expect(outcome.cancelled).toBe(1);
    expect(outcome.alertIds).toEqual(['alert-target']);
    expect(prisma.alert.update).toHaveBeenCalledTimes(1);
    expect(prisma.alert.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'alert-target' },
      data: { status: 'CANCELLED' },
    });
    expect(prisma.alertRevision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          alertId: 'alert-target',
          revision: 2,
          status: 'CANCELLED',
        }),
      }),
    );
    // The cancel is audited under ALERT_CANCELLED.
    const auditCalls = prisma.auditEvent.create.mock.calls.map(
      (call) => call[0].data,
    );
    expect(
      auditCalls.some((data) => data.action === AUDIT_ACTIONS.ALERT_CANCELLED),
    ).toBe(true);
    expect(prisma.providerFetch.create.mock.calls[0][0].data.status).toBe(
      'SUCCESS',
    );
  });

  it('quarantines a CAP test message: QUARANTINED alert, non-empty quarantinedIds', async () => {
    const { service, prisma } = makeService(
      makePrisma({ provider: { id: 'provider-1', key: 'cap' } }),
    );

    const outcome = await service.ingest('cap', CAP_TEST_XML, {
      fetchRef: 'cap-test-1',
      fetchedAt: FETCHED_AT,
    });

    expect(outcome.quarantined).toBe(1);
    expect(outcome.created).toBe(0);
    expect(outcome.quarantinedIds).toEqual(['raw-1']);
    expect(prisma.alert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'QUARANTINED',
          verification: 'UNVERIFIED',
        }),
      }),
    );
    const detail = prisma.auditEvent.create.mock.calls[0][0].data
      .detail as string;
    expect(JSON.parse(detail)).toMatchObject({
      action: 'quarantined',
      code: 'TEST_MESSAGE',
    });
  });

  it('returns a zeroed outcome and a FAILED ProviderFetch for an unknown provider (never throws)', async () => {
    const { service, prisma } = makeService(makePrisma({}));

    const outcome = await service.ingest('does-not-exist', 'whatever', {
      fetchedAt: FETCHED_AT,
    });

    expect(outcome).toEqual(zeroed('does-not-exist'));
    // The provider row is registered on demand.
    expect(prisma.dataProvider.create).toHaveBeenCalledWith({
      data: { key: 'does-not-exist', name: 'does-not-exist', enabled: false },
    });
    expect(prisma.providerFetch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          error: 'unknown provider: does-not-exist',
        }),
      }),
    );
    expect(prisma.alert.create).not.toHaveBeenCalled();
    expect(prisma.rawSourceRecord.create).not.toHaveBeenCalled();
  });

  it('refuses to ingest for an existing explicitly-disabled provider (controlled enablement)', async () => {
    // An existing registry row with enabled:false is a refusal: no raw record,
    // no alerts, a FAILED ProviderFetch explaining why (DATA-SOURCES.md 5.7).
    const { service, prisma } = makeService(
      makePrisma({
        provider: { id: 'provider-1', key: 'gdacs', enabled: false },
      }),
    );

    const outcome = await service.ingest('gdacs', gdacsPayload, {
      fetchRef: 'gdacs-disabled',
      fetchedAt: FETCHED_AT,
    });

    expect(outcome).toEqual(zeroed('gdacs'));
    expect(prisma.rawSourceRecord.create).not.toHaveBeenCalled();
    expect(prisma.alert.create).not.toHaveBeenCalled();
    expect(prisma.providerFetch.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          error: expect.stringContaining('disabled'),
        }),
      }),
    );
  });

  it('marks a PARTIAL fetch when some records are rejected', async () => {
    const payload = JSON.stringify([
      { eventid: 1, title: 'A', datetime: '2026-02-12T06:00:00Z' },
      { eventid: 2, title: 'B', datetime: 'not-a-time' },
    ]);
    const { service, prisma } = makeService(makePrisma({}));

    const outcome = await service.ingest('gdacs', payload, {
      fetchRef: 'gdacs-partial',
      fetchedAt: FETCHED_AT,
    });

    expect(outcome.created).toBe(1);
    expect(prisma.providerFetch.create.mock.calls[0][0].data).toMatchObject({
      status: 'PARTIAL',
      itemCount: 1,
      error: 'datetime is not parseable ISO 8601',
    });
  });
});
