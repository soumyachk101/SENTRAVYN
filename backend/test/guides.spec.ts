import { GuidesService, evaluateGuideFreshness } from '../src/guides/guides.service';
import { AuditService, AUDIT_ACTIONS } from '../src/audit/audit.service';
import type { GuideApprovalState } from '../src/guides/guides.dto';

/**
 * Unit tests for the safety-guide workflow (Phase 5; SAFETY-POLICY.md 10,
 * SECURITY.md 6). A minimal in-memory fake of the Prisma delegates the
 * service touches keeps these fast and infrastructure-free; the DB-gated
 * lifecycle assertions (create -> review -> approve -> publish -> retire,
 * audit rows, version bumps, public visibility) live in
 * test/e2e/guides.e2e-spec.ts.
 */

interface GuideRow {
  id: string;
  hazardType: string;
  jurisdiction: string | null;
  language: string;
  author: string | null;
  reviewer: string | null;
  authority: string | null;
  approval: GuideApprovalState;
  version: number;
  lastReviewedAt: Date | null;
  references: string[];
  createdAt: Date;
  updatedAt: Date;
}

interface RevisionRow {
  guideId: string;
  revision: number;
  body: string;
  createdAt: Date;
}

const NOW = new Date('2026-11-04T12:00:00Z');

const COMPLETE: GuideRow = {
  id: 'g-1',
  hazardType: 'EARTHQUAKE',
  jurisdiction: null,
  language: 'en',
  author: 'safety-team',
  reviewer: 'Jane Reviewer',
  authority: 'USGS Earthquake Hazards',
  approval: 'IN_REVIEW',
  version: 1,
  lastReviewedAt: NOW,
  references: ['https://example.gov/earthquake'],
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

function build(rows: GuideRow[] = [], revisions: RevisionRow[] = []) {
  type GuideDelegate = {
    create: jest.Mock;
    update: jest.Mock;
    findUnique: jest.Mock;
    count: jest.Mock;
    findMany: jest.Mock;
  };
  type RevisionDelegate = {
    create: jest.Mock;
    findMany: jest.Mock;
    findFirst: jest.Mock;
  };
  const prisma: {
    safetyGuide: GuideDelegate;
    guideRevision: RevisionDelegate;
    $transaction: jest.Mock;
  } = {
    safetyGuide: {
      create: jest.fn(async ({ data }: { data: Partial<GuideRow> }) => {
        const row: GuideRow = {
          ...COMPLETE,
          id: `g-${rows.length + 1}`,
          approval: 'DRAFT',
          version: 1,
          lastReviewedAt: null,
          references: [],
          reviewer: null,
          authority: null,
          ...data,
        };
        rows.push(row);
        return row;
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<GuideRow>;
        }) => {
          const row = rows.find((r) => r.id === where.id);
          if (!row) throw new Error('no such guide');
          Object.assign(row, data);
          return row;
        },
      ),
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) =>
          rows.find((r) => r.id === where.id) ?? null,
      ),
      count: jest.fn(async () => rows.length),
      findMany: jest.fn(async () => [...rows]),
    },
    guideRevision: {
      create: jest.fn(async ({ data }: { data: Partial<RevisionRow> }) => {
        const rev: RevisionRow = {
          guideId: 'g-1',
          revision: 1,
          body: '',
          createdAt: NOW,
          ...data,
        };
        revisions.push(rev);
        return rev;
      }),
      findMany: jest.fn(
        async ({ where }: { where: { guideId: string } }) =>
          revisions
            .filter((r) => r.guideId === where.guideId)
            .sort((a, b) => a.revision - b.revision),
      ),
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: { guideId: string; revision: number };
        }) =>
          revisions.find(
            (r) => r.guideId === where.guideId && r.revision === where.revision,
          ) ?? null,
      ),
    },
    $transaction: jest.fn(async (arg: unknown) => {
      // The service uses two forms:
      //  - array of pending operations (list): run each and collect results.
      //  - an async callback receiving a "client" (create/update): the fake
      //    hands the same delegate set back so nested create/update hit the
      //    same in-memory rows.
      if (typeof arg === 'function') {
        const txClient = {
          safetyGuide: prisma.safetyGuide,
          guideRevision: prisma.guideRevision,
        };
        return arg(txClient);
      }
      const ops = arg as unknown[];
      const results = [];
      for (const op of ops) {
        results.push(await op);
      }
      return results;
    }),
  };

  // The audit fake records calls; the service only needs .record.
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  };
  const service = new GuidesService(
    prisma as never,
    audit as unknown as AuditService,
  );
  return { service, rows, revisions, prisma, audit };
}

describe('evaluateGuideFreshness (SAFETY-POLICY.md 8)', () => {
  it('marks a guide reviewed within the window as fresh', () => {
    expect(
      evaluateGuideFreshness({
        lastReviewedAt: new Date('2026-01-01T00:00:00Z'),
        now: new Date('2026-06-01T00:00:00Z'),
      }),
    ).toBe('fresh');
  });

  it('marks a guide past the review window as stale (labelled, never hidden)', () => {
    expect(
      evaluateGuideFreshness({
        lastReviewedAt: new Date('2025-01-01T00:00:00Z'),
        now: new Date('2026-01-01T00:00:00Z'),
      }),
    ).toBe('stale');
  });

  it('marks a never-reviewed guide as unknown', () => {
    expect(evaluateGuideFreshness({ lastReviewedAt: null, now: NOW })).toBe(
      'unknown',
    );
  });
});

describe('guide approval transitions', () => {
  it('approve: IN_REVIEW -> APPROVED with the completeness gate', async () => {
    const { service, rows, audit } = build([{ ...COMPLETE }]);
    await service.approve('g-1', {}, { id: 'actor-1' }, NOW);
    expect(rows[0].approval).toBe('APPROVED');
    expect(rows[0].lastReviewedAt).toEqual(NOW);
    expect(audit.record).toHaveBeenCalledWith(
      'actor-1',
      AUDIT_ACTIONS.GUIDE_APPROVED,
      'guide',
      'g-1',
      expect.stringContaining('"to":"APPROVED"'),
    );
  });

  it('rejects approval from the wrong state (400, documented message)', async () => {
    const { service } = build([{ ...COMPLETE, approval: 'DRAFT' }]);
    await expect(
      service.approve('g-1', {}, { id: 'actor-1' }, NOW),
    ).rejects.toThrow(/approval is only possible from IN_REVIEW/);
  });

  it('rejects approval of an incomplete guide (missing references)', async () => {
    const { service } = build([{ ...COMPLETE, references: [] }]);
    await expect(
      service.approve('g-1', {}, { id: 'actor-1' }, NOW),
    ).rejects.toThrow(/requires: references/);
  });

  it('rejects approval when the named reviewer is missing', async () => {
    const { service } = build([{ ...COMPLETE, reviewer: null }]);
    await expect(
      service.approve('g-1', {}, { id: 'actor-1' }, NOW),
    ).rejects.toThrow(/requires: reviewer/);
  });

  it('publish: APPROVED -> PUBLISHED (the public visibility flip)', async () => {
    const { service, rows, audit } = build([
      { ...COMPLETE, approval: 'APPROVED' },
    ]);
    await service.publish('g-1', {}, { id: 'actor-1' }, NOW);
    expect(rows[0].approval).toBe('PUBLISHED');
    expect(audit.record).toHaveBeenCalledWith(
      'actor-1',
      AUDIT_ACTIONS.GUIDE_PUBLISHED,
      'guide',
      'g-1',
      expect.stringContaining('"to":"PUBLISHED"'),
    );
  });

  it('rejects publishing from the wrong state', async () => {
    const { service } = build([{ ...COMPLETE, approval: 'DRAFT' }]);
    await expect(
      service.publish('g-1', {}, { id: 'actor-1' }, NOW),
    ).rejects.toThrow(/publication is only possible from APPROVED/);
  });

  it('retire: PUBLISHED -> RETIRED, stamps the review date', async () => {
    const { service, rows, audit } = build([
      { ...COMPLETE, approval: 'PUBLISHED' },
    ]);
    await service.retire('g-1', { rationale: 'superseded' }, { id: 'actor-1' }, NOW);
    expect(rows[0].approval).toBe('RETIRED');
    expect(rows[0].lastReviewedAt).toEqual(NOW);
    expect(audit.record).toHaveBeenCalledWith(
      'actor-1',
      AUDIT_ACTIONS.GUIDE_RETIRED,
      'guide',
      'g-1',
      expect.stringContaining('"to":"RETIRED"'),
    );
  });

  it('reopen: RETIRED -> DRAFT starts a new review cycle', async () => {
    const { service, rows, audit } = build([{ ...COMPLETE, approval: 'RETIRED' }]);
    await service.reopen('g-1', { id: 'actor-1' }, NOW);
    expect(rows[0].approval).toBe('DRAFT');
    expect(audit.record).toHaveBeenCalledWith(
      'actor-1',
      AUDIT_ACTIONS.GUIDE_UPDATED,
      'guide',
      'g-1',
      expect.stringContaining('"event":"reopened"'),
    );
  });

  it('refuses a revision write on an approved/published guide (immutability)', async () => {
    const { service } = build([{ ...COMPLETE, approval: 'PUBLISHED' }]);
    await expect(
      service.update('g-1', { body: 'new' }, { id: 'actor-1' }, NOW),
    ).rejects.toThrow(/a new revision is only possible from DRAFT or IN_REVIEW/);
  });
});

describe('version bump + revision write', () => {
  it('bumps the version and writes a new GuideRevision row for an editable guide', async () => {
    const { service, rows, revisions, audit } = build([{ ...COMPLETE, approval: 'DRAFT' }]);
    await service.update('g-1', { body: 'revised text' }, { id: 'actor-1' }, NOW);
    expect(rows[0].version).toBe(2);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      guideId: 'g-1',
      revision: 2,
      body: 'revised text',
    });
    expect(audit.record).toHaveBeenCalledWith(
      'actor-1',
      AUDIT_ACTIONS.GUIDE_UPDATED,
      'guide',
      'g-1',
      expect.stringContaining('"event":"revised"'),
    );
  });

  it('create writes version 1 plus the first revision row in one transaction', async () => {
    const { service, rows, revisions, prisma } = build();
    const detail = await service.create(
      {
        hazardType: 'FLOOD',
        body: 'Placeholder: this guide has not been written up yet.',
        references: ['https://example.gov/flood'],
        reviewer: 'Jane',
        authority: 'FEMA',
      },
      { id: 'actor-1' },
    );
    expect(detail.version).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0].approval).toBe('DRAFT');
    expect(revisions).toHaveLength(1);
    expect(revisions[0].revision).toBe(1);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('dedupes and trims references on create', async () => {
    const { service, rows } = build();
    await service.create(
      {
        hazardType: 'FLOOD',
        body: 'x',
        references: ['https://a', 'https://a', '  https://b  ', ''],
      },
      { id: 'actor-1' },
    );
    expect(rows[0].references).toEqual(['https://a', 'https://b']);
  });

  it('rejects create with a blank body: placeholders must say so explicitly', async () => {
    const { service } = build();
    await expect(
      service.create({ hazardType: 'FLOOD', body: '   ' }, { id: 'actor-1' }),
    ).rejects.toThrow(/body is required/);
  });
});

describe('public exposure of only approved/published guides', () => {
  it('getDetail(publicOnly) returns null for a DRAFT guide', async () => {
    const { service } = build([{ ...COMPLETE, approval: 'DRAFT' }]);
    await expect(service.getDetail('g-1', NOW, true)).resolves.toBeNull();
  });

  it('getDetail(publicOnly) returns null for a RETIRED guide', async () => {
    const { service } = build([{ ...COMPLETE, approval: 'RETIRED' }]);
    await expect(service.getDetail('g-1', NOW, true)).resolves.toBeNull();
  });

  it('getDetail(publicOnly) returns the PUBLISHED guide with its current body', async () => {
    const { service, revisions } = build([{ ...COMPLETE, approval: 'PUBLISHED' }]);
    revisions.push({ guideId: 'g-1', revision: 1, body: 'reviewed guidance', createdAt: NOW });
    const detail = await service.getDetail('g-1', NOW, true);
    expect(detail).not.toBeNull();
    expect(detail!.approval).toBe('PUBLISHED');
    expect(detail!.body).toBe('reviewed guidance');
    expect(detail!.revisions).toHaveLength(1);
  });

  it('list(publicOnly) queries only APPROVED/PUBLISHED when no state is given', async () => {
    const { service, prisma } = build();
    await service.list({}, NOW, true);
    const where = prisma.safetyGuide.findMany.mock.calls[0][0].where;
    expect(where.approval).toEqual({ in: ['APPROVED', 'PUBLISHED'] });
  });

  it('list(publicOnly) rejects a non-public approval filter with a 400', async () => {
    const { service } = build();
    await expect(service.list({ approval: 'RETIRED' }, NOW, true)).rejects.toThrow(
      /approval must be one of APPROVED, PUBLISHED/,
    );
  });

  it('list (admin, no publicOnly) passes the requested state through unchanged', async () => {
    const { service, prisma } = build();
    await service.list({ approval: 'DRAFT' }, NOW, false);
    const where = prisma.safetyGuide.findMany.mock.calls[0][0].where;
    expect(where.approval).toBe('DRAFT');
  });
});

describe('stale flag (SAFETY-POLICY.md 8: labelled, never auto-hidden)', () => {
  it('stale=true queries lastReviewedAt at or before the cutoff', async () => {
    const { service, prisma } = build();
    await service.list({ stale: true }, NOW, false);
    const where = prisma.safetyGuide.findMany.mock.calls[0][0].where;
    expect(where.lastReviewedAt).toEqual({
      lte: new Date(NOW.getTime() - 365 * 86_400_000),
    });
  });

  it('stale=false queries lastReviewedAt strictly after the cutoff', async () => {
    const { service, prisma } = build();
    await service.list({ stale: false }, NOW, false);
    const where = prisma.safetyGuide.findMany.mock.calls[0][0].where;
    expect(where.lastReviewedAt).toEqual({
      gt: new Date(NOW.getTime() - 365 * 86_400_000),
    });
  });
});
