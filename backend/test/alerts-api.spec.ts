import { AlertsService } from '../src/alerts/alerts.service';
import type { PrismaService } from '../src/prisma/prisma.service';

type MockPrisma = {
  alert: {
    findUnique: jest.Mock;
  };
  alertRevision: {
    findMany: jest.Mock;
  };
  dataProvider: {
    findUnique: jest.Mock;
  };
};

function createPrismaMock(): MockPrisma {
  return {
    alert: {
      findUnique: jest.fn(),
    },
    alertRevision: {
      findMany: jest.fn(),
    },
    dataProvider: {
      findUnique: jest.fn(),
    },
  };
}

function sourceRecordRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    providerId: 'prov-usgs',
    sourceUrl: 'https://earthquake.usgs.gov/test/1',
    payloadHash: 'sha256:abcdef',
    fetchedAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

function providerRow(overrides: Record<string, unknown> = {}) {
  return {
    key: 'usgs',
    name: 'USGS',
    docUrl: null,
    license: 'public domain',
    attribution: 'USGS',
    enabled: false,
    freshnessPolicyHours: null,
    ...overrides,
  };
}

function alertRow(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-07-01T00:00:00.000Z');
  return {
    id: 'alert-1',
    externalRef: 'cap-1',
    status: 'PUBLISHED',
    verification: 'UNVERIFIED',
    informationClass: 'OFFICIAL_SOURCE',
    headline: 'Test alert',
    issuer: 'Test Authority',
    severity: null,
    urgency: null,
    certainty: null,
    issuedAt: now,
    effectiveAt: null,
    expiresAt: null,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
    sourceRecord: null,
    ...overrides,
  };
}

function revisionRow(
  revision: number,
  overrides: Record<string, unknown> = {},
) {
  return {
    revision,
    status: 'RECEIVED',
    body: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('AlertsService.getDetail (Phase 3 durable alert API)', () => {
  let prisma: MockPrisma;
  let service: AlertsService;

  beforeEach(() => {
    prisma = createPrismaMock();
    service = new AlertsService(prisma as unknown as PrismaService);
  });

  it('computes freshness from the source provider policy: 3h-old alert, 2h policy -> stale', async () => {
    // updatedAt (publishedAt) is 3h old; the provider policy is 2h, so the
    // real evaluateFreshness must label it stale and report policyHours=2.
    prisma.alert.findUnique.mockResolvedValue(
      alertRow({
        publishedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
        sourceRecord: sourceRecordRow(),
      }),
    );
    prisma.dataProvider.findUnique.mockResolvedValue(
      providerRow({ freshnessPolicyHours: 2 }),
    );
    prisma.alertRevision.findMany.mockResolvedValue([
      revisionRow(1, { status: 'RECEIVED' }),
      revisionRow(2, { status: 'PUBLISHED', body: 'final' }),
    ]);

    const detail = await service.getDetail('alert-1');

    expect(detail).not.toBeNull();
    expect(detail!.alert.freshness.state).toBe('stale');
    expect(detail!.alert.freshness.policyHours).toBe(2);
    // The provider row must be used for the policy lookup.
    expect(prisma.dataProvider.findUnique).toHaveBeenCalledWith({
      where: { id: 'prov-usgs' },
    });
    // Provenance resolves the provider key and mirrors the registry row.
    expect(detail!.provenance).toEqual({
      sourceRecordId: 'rec-1',
      sourceUrl: 'https://earthquake.usgs.gov/test/1',
      payloadHash: 'sha256:abcdef',
      fetchedAt: '2026-07-01T00:00:00.000Z',
      providerKey: 'usgs',
      provider: {
        name: 'USGS',
        docUrl: null,
        license: 'public domain',
        attribution: 'USGS',
        enabled: false,
        freshnessPolicyHours: 2,
      },
    });
  });

  it('falls back to the default freshness policy when the alert has no source record', async () => {
    prisma.alert.findUnique.mockResolvedValue(
      alertRow({
        sourceRecord: null,
        publishedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      }),
    );
    prisma.alertRevision.findMany.mockResolvedValue([
      revisionRow(1, { status: 'PUBLISHED' }),
    ]);

    const detail = await service.getDetail('alert-1');

    expect(detail!.provenance).toBeNull();
    // No source record -> no provider lookup -> default 6h policy.
    expect(prisma.dataProvider.findUnique).not.toHaveBeenCalled();
    expect(detail!.alert.freshness.policyHours).toBe(6);
  });

  it('returns null for an unknown alert id and reads nothing else', async () => {
    prisma.alert.findUnique.mockResolvedValue(null);

    const detail = await service.getDetail('does-not-exist');

    expect(detail).toBeNull();
    expect(prisma.alertRevision.findMany).not.toHaveBeenCalled();
    expect(prisma.dataProvider.findUnique).not.toHaveBeenCalled();
  });

  it('leaves providerKey null and does not throw when the provider row was deleted', async () => {
    prisma.alert.findUnique.mockResolvedValue(
      alertRow({ sourceRecord: sourceRecordRow() }),
    );
    prisma.dataProvider.findUnique.mockResolvedValue(null);
    prisma.alertRevision.findMany.mockResolvedValue([]);

    const detail = await service.getDetail('alert-1');

    expect(detail).not.toBeNull();
    // Deleted registry row: provenance still returns the immutable record,
    // with providerKey null and no nested provider.
    expect(detail!.provenance!.providerKey).toBeNull();
    expect(detail!.provenance!.provider).toBeNull();
    expect(detail!.provenance!.sourceRecordId).toBe('rec-1');
  });

  it('returns revisions in ascending revision order', async () => {
    prisma.alert.findUnique.mockResolvedValue(
      alertRow({ sourceRecord: sourceRecordRow() }),
    );
    prisma.dataProvider.findUnique.mockResolvedValue(providerRow());
    prisma.alertRevision.findMany.mockResolvedValue([
      revisionRow(1, { status: 'RECEIVED' }),
      revisionRow(2, { status: 'PUBLISHED' }),
      revisionRow(3, { status: 'EXPIRED', body: null }),
    ]);

    const detail = await service.getDetail('alert-1');

    // The query asks for ascending revision order and the view preserves it.
    expect(prisma.alertRevision.findMany).toHaveBeenCalledWith({
      where: { alertId: 'alert-1' },
      orderBy: { revision: 'asc' },
    });
    expect(detail!.revisions.map((r) => r.revision)).toEqual([1, 2, 3]);
    expect(detail!.revisions[0].status).toBe('RECEIVED');
    expect(detail!.revisions[0].createdAt).toBe('2026-07-01T00:00:00.000Z');
  });
});
