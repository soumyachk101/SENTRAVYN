import {
  payloadHash,
  upsertRawRecord,
} from '../src/common/provenance/provenance';
import type { PrismaService } from '../src/prisma/prisma.service';

type MockPrisma = {
  rawSourceRecord: { findFirst: jest.Mock; create: jest.Mock };
};

function createPrismaMock(): MockPrisma {
  return {
    rawSourceRecord: { findFirst: jest.fn(), create: jest.fn() },
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'record-1',
    providerId: 'prov-1',
    sourceId: 'src-1',
    sourceUrl: 'https://example.org/record',
    payloadHash: 'a'.repeat(64),
    rawPayload: 'original',
    fetchedAt: new Date('2026-01-01T00:00:00Z'),
    ingestedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('provenance upsertRawRecord (ADR-007)', () => {
  const input = {
    providerId: 'prov-1',
    sourceId: 'src-1',
    sourceUrl: 'https://example.org/feed',
    rawPayload: 'body-1',
    fetchedAt: new Date('2026-01-02T00:00:00Z'),
  };

  describe('payloadHash', () => {
    it('is a deterministic 64-char hex digest', () => {
      const h = payloadHash('body-1');
      expect(h).toMatch(/^[a-f0-9]{64}$/);
      // Same input, same digest; a different input, a different digest.
      expect(payloadHash('body-1')).toBe(h);
      expect(payloadHash('body-2')).not.toBe(h);
    });
  });

  it('treats an identical-payload replay as a no-op: returns the existing row, created:false, and never creates', async () => {
    const prisma = createPrismaMock();
    const existing = row({ payloadHash: payloadHash(input.rawPayload) });
    prisma.rawSourceRecord.findFirst.mockResolvedValue(existing);

    const result = await upsertRawRecord(
      prisma as unknown as PrismaService,
      input,
    );

    expect(result.created).toBe(false);
    // The replay returns the existing row verbatim, with no create.
    expect(result.record).toBe(existing);
    expect(prisma.rawSourceRecord.create).not.toHaveBeenCalled();
  });

  it('creates a new immutable row when the stored hash differs from the incoming payload', async () => {
    const prisma = createPrismaMock();
    // An older record exists, but its hash does not match the new payload.
    prisma.rawSourceRecord.findFirst.mockResolvedValue(
      row({ payloadHash: payloadHash('stale-body') }),
    );
    prisma.rawSourceRecord.create.mockImplementation(({ data }) =>
      Promise.resolve(
        row({ payloadHash: data.payloadHash, rawPayload: data.rawPayload }),
      ),
    );

    const result = await upsertRawRecord(
      prisma as unknown as PrismaService,
      input,
    );

    expect(result.created).toBe(true);
    expect(prisma.rawSourceRecord.create).toHaveBeenCalledTimes(1);
    expect(
      prisma.rawSourceRecord.create.mock.calls[0][0].data.payloadHash,
    ).toBe(payloadHash(input.rawPayload));
    // The new record is the one returned, not the stale row.
    expect(result.record.payloadHash).toBe(payloadHash(input.rawPayload));
  });

  it('creates when no record exists yet for (providerId, sourceId)', async () => {
    const prisma = createPrismaMock();
    prisma.rawSourceRecord.findFirst.mockResolvedValue(null);
    prisma.rawSourceRecord.create.mockResolvedValue(row());

    const result = await upsertRawRecord(
      prisma as unknown as PrismaService,
      input,
    );

    expect(result.created).toBe(true);
    expect(prisma.rawSourceRecord.create).toHaveBeenCalledTimes(1);
    // The lookup is scoped to the provider/source pair.
    expect(prisma.rawSourceRecord.findFirst).toHaveBeenCalledWith({
      where: { providerId: 'prov-1', sourceId: 'src-1' },
      orderBy: { ingestedAt: 'desc' },
    });
  });
});
