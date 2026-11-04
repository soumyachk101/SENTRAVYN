import { NotFoundException } from '@nestjs/common';
import { ProvidersService } from '../src/providers/providers.service';
import type { ProviderUpsertDto } from '../src/providers/providers.dto';
import type { PrismaService } from '../src/prisma/prisma.service';
import { AUDIT_ACTIONS } from '../src/audit/audit.service';
import type { AuditService } from '../src/audit/audit.service';

type MockPrisma = {
  dataProvider: {
    upsert: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    findMany: jest.Mock;
  };
};

type MockAudit = {
  record: jest.Mock;
};

function createPrismaMock(): MockPrisma {
  return {
    dataProvider: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      findMany: jest.fn(),
    },
  };
}

function createAuditMock(): MockAudit {
  return { record: jest.fn().mockResolvedValue(undefined) };
}

function providerRow(key: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `prov-${key}`,
    key,
    name: key,
    docUrl: null,
    category: 'alerts',
    license: null,
    attribution: null,
    enabled: false,
    freshnessPolicyHours: null,
    lastSeededAt: null,
    ...overrides,
  };
}

function upsertsInOrder(prisma: MockPrisma): string[] {
  return prisma.dataProvider.upsert.mock.calls.map(
    (call) => (call[0].where as { key: string }).key,
  );
}

describe('ProvidersService (docs/DATA-SOURCES.md 2)', () => {
  let prisma: MockPrisma;
  let audit: MockAudit;
  let service: ProvidersService;

  beforeEach(() => {
    prisma = createPrismaMock();
    audit = createAuditMock();
    service = new ProvidersService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
    );
  });

  it('seeds the three documented fixtures by upsert: disabled, lastSeededAt set, one audit row each', async () => {
    prisma.dataProvider.upsert.mockImplementation(({ where, create }) =>
      Promise.resolve(providerRow(where.key, { ...create })),
    );

    const result = await service.seed('admin-1');

    expect(prisma.dataProvider.upsert).toHaveBeenCalledTimes(3);
    expect(upsertsInOrder(prisma)).toEqual([
      'gdacs',
      'usgs',
      'copernicus-emdat',
    ]);
    // Every create carries enabled:false and a set lastSeededAt.
    for (const call of prisma.dataProvider.upsert.mock.calls) {
      expect(call[0].create.enabled).toBe(false);
      expect(call[0].create.lastSeededAt).toBeInstanceOf(Date);
    }
    // One PROVIDER_CHANGED audit row per fixture, attributed to the actor.
    expect(audit.record).toHaveBeenCalledTimes(3);
    for (const call of audit.record.mock.calls) {
      expect(call[0]).toBe('admin-1');
      expect(call[1]).toBe(AUDIT_ACTIONS.PROVIDER_CHANGED);
      expect(call[2]).toBe('dataProvider');
    }
    expect(result.seededKeys).toEqual(['gdacs', 'usgs', 'copernicus-emdat']);
    // lastSeededAt in the result is an ISO string, not a Date.
    expect(Number.isNaN(Date.parse(result.lastSeededAt))).toBe(false);
  });

  it('re-seeding is idempotent: upserts by the same where.key values and never a separate create path', async () => {
    prisma.dataProvider.upsert.mockImplementation(({ where, create }) =>
      Promise.resolve(providerRow(where.key, { ...create })),
    );

    await service.seed('admin-1');
    await service.seed('admin-1');

    // Two rounds of the same three keys, in the same order.
    const keys = upsertsInOrder(prisma);
    expect(keys).toHaveLength(6);
    expect(keys.slice(0, 3)).toEqual(['gdacs', 'usgs', 'copernicus-emdat']);
    expect(keys.slice(3)).toEqual(['gdacs', 'usgs', 'copernicus-emdat']);
    // Seed touches only upsert: no create, no update, no lookup.
    expect(prisma.dataProvider.update).not.toHaveBeenCalled();
    expect(prisma.dataProvider.findUnique).not.toHaveBeenCalled();
  });

  it('the seed update path never writes enabled, so re-seeding cannot re-disable an operator', async () => {
    prisma.dataProvider.upsert.mockImplementation(({ where, create }) =>
      Promise.resolve(providerRow(where.key, { ...create })),
    );

    await service.seed('admin-1');

    for (const call of prisma.dataProvider.upsert.mock.calls) {
      const update = call[0].update as Record<string, unknown>;
      expect(update.lastSeededAt).toBeInstanceOf(Date);
      expect('enabled' in update).toBe(false);
    }
  });

  it('upsert records an audit row with the actor id passed in', async () => {
    prisma.dataProvider.upsert.mockImplementation(({ where, create }) =>
      Promise.resolve(providerRow(where.key, { ...create })),
    );

    const dto: ProviderUpsertDto = {
      key: 'usgs',
      name: 'USGS',
      docUrl: 'https://earthquake.usgs.gov/data/',
    };
    const view = await service.upsert('admin-7', dto);

    expect(view.key).toBe('usgs');
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0]).toEqual([
      'admin-7',
      AUDIT_ACTIONS.PROVIDER_CHANGED,
      'dataProvider',
      'usgs',
      'upserted provider usgs',
    ]);
  });

  it('setEnabled on an unknown key throws NotFoundException without any update or audit', async () => {
    prisma.dataProvider.findUnique.mockResolvedValue(null);

    await expect(service.setEnabled('admin-1', 'ghost', true)).rejects.toThrow(
      NotFoundException,
    );
    expect(prisma.dataProvider.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('list maps lastSeededAt to an ISO string, or null when never seeded', async () => {
    const seeded = new Date('2026-02-01T00:00:00Z');
    prisma.dataProvider.findMany.mockResolvedValue([
      providerRow('gdacs', { name: 'GDACS', lastSeededAt: seeded }),
      providerRow('usgs', { name: 'USGS', lastSeededAt: null }),
    ]);

    const views = await service.list();

    expect(views[0].lastSeededAt).toBe('2026-02-01T00:00:00.000Z');
    expect(views[1].lastSeededAt).toBeNull();
    // Key ordering is preserved from the query.
    prisma.dataProvider.findMany.mockClear();
    prisma.dataProvider.findMany.mockResolvedValue([
      providerRow('usgs', {}),
      providerRow('gdacs', {}),
    ]);
    const shuffled = await service.list();
    expect(shuffled.map((v) => v.key)).toEqual(['usgs', 'gdacs']);
  });
});
