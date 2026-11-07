import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  AdminReviewService,
  AlertQueueItem,
  PlaceQueueItem,
  ReviewQueueDepthView,
} from '../src/admin/admin-review.service';
import {
  AdminReviewDecisionDto,
  QueueKind,
} from '../src/admin/admin-review.dto';
import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../src/prisma/prisma.service';
import { AUDIT_ACTIONS } from '../src/audit/audit.service';
import type { AuditService } from '../src/audit/audit.service';

type MockPrisma = {
  alert: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  place: { findUnique: jest.Mock; update: jest.Mock };
  shelterProfile: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
    count: jest.Mock;
  };
  dataProvider: { findMany: jest.Mock };
  adminReviewDecision: { create: jest.Mock };
  $transaction: jest.Mock;
};

type MockAudit = {
  record: jest.Mock;
};

// alert.findUnique is used by the 'alert' decision branch (target lookup);
// findMany by the queue; count by the depth endpoint (Phase 10 section 3).
function createPrismaMock(): MockPrisma {
  return {
    alert: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    place: { findUnique: jest.fn(), update: jest.fn() },
    shelterProfile: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    dataProvider: { findMany: jest.fn() },
    adminReviewDecision: { create: jest.fn() },
    $transaction: jest.fn(),
  };
}

function createAuditMock(): MockAudit {
  return { record: jest.fn().mockResolvedValue(undefined) };
}

// ConfigService mock: by default no REVIEW_QUEUE_ALERT_THRESHOLD is set,
// which exercises the service's documented default (50).
function createConfigMock(reviewQueueAlertThreshold?: string): ConfigService {
  const store: Record<string, string> = {};
  if (reviewQueueAlertThreshold !== undefined) {
    store.REVIEW_QUEUE_ALERT_THRESHOLD = reviewQueueAlertThreshold;
  }
  return {
    get: jest.fn((key: string) => store[key]),
  } as unknown as ConfigService;
}

function decisionDto(
  kind: 'alert' | 'place' | 'shelter',
  id: string,
  decision:
    | 'REVIEW_APPROVED'
    | 'REVIEW_REJECTED'
    | 'SHELTER_VERIFIED'
    | 'SHELTER_STALE',
  extras: Partial<AdminReviewDecisionDto> = {},
): AdminReviewDecisionDto {
  const dto = new AdminReviewDecisionDto();
  dto.target = { kind, id };
  dto.decision = decision;
  Object.assign(dto, extras);
  return dto;
}

const USER = { id: 'user-9', role: 'ADMIN', email: 'admin@sentravyn.example' };

describe('AdminReviewService (SAFETY-POLICY.md 3, Gate E)', () => {
  let prisma: MockPrisma;
  let audit: MockAudit;
  let config: ConfigService;
  let service: AdminReviewService;

  beforeEach(() => {
    prisma = createPrismaMock();
    audit = createAuditMock();
    config = createConfigMock();
    service = new AdminReviewService(
      prisma as unknown as PrismaService,
      audit as unknown as AuditService,
      config,
    );
  });

  describe('depth (Phase 10 section 3, quarantine queue-depth alert threshold)', () => {
    it("depth('alerts') counts QUARANTINED/RECEIVED alerts and flags the default threshold (50)", async () => {
      prisma.alert.count.mockResolvedValue(50);

      const view = await service.depth('alerts');

      expect(prisma.alert.count).toHaveBeenCalledWith({
        where: { status: { in: ['QUARANTINED', 'RECEIVED'] } },
      });
      expect(view).toEqual<ReviewQueueDepthView>({
        kind: 'alerts',
        depth: 50,
        threshold: 50,
        exceedsAlertThreshold: true,
      });
      // depth === threshold is the boundary: "reaches" means >=.
      expect(view.exceedsAlertThreshold).toBe(true);
    });

    it("depth('alerts') below the threshold does not flag it", async () => {
      prisma.alert.count.mockResolvedValue(12);

      const view = await service.depth('alerts');

      expect(view).toEqual({
        kind: 'alerts',
        depth: 12,
        threshold: 50,
        exceedsAlertThreshold: false,
      });
    });

    it("depth('places') counts shelter profiles that are not VERIFIED", async () => {
      prisma.shelterProfile.count.mockResolvedValue(3);

      const view = await service.depth('places');

      expect(prisma.shelterProfile.count).toHaveBeenCalledWith({
        where: { verification: { not: 'VERIFIED' } },
      });
      expect(view).toEqual({
        kind: 'places',
        depth: 3,
        threshold: 50,
        exceedsAlertThreshold: false,
      });
    });

    it('honours a REVIEW_QUEUE_ALERT_THRESHOLD config override', async () => {
      const configured = createConfigMock('5');
      const svc = new AdminReviewService(
        prisma as unknown as PrismaService,
        audit as unknown as AuditService,
        configured,
      );
      prisma.alert.count.mockResolvedValue(5);

      const view = await svc.depth('alerts');

      // 5 items vs. an operator-retuned threshold of 5: boundary >=.
      expect(view.threshold).toBe(5);
      expect(view.exceedsAlertThreshold).toBe(true);
    });

    it('falls back to the default threshold when the override is non-numeric or non-positive', async () => {
      for (const bad of ['abc', '0', '-3', '']) {
        const configured = createConfigMock(bad);
        const svc = new AdminReviewService(
          prisma as unknown as PrismaService,
          audit as unknown as AuditService,
          configured,
        );
        prisma.alert.count.mockResolvedValue(10);
        const view = await svc.depth('alerts');
        expect(view.threshold).toBe(50);
        expect(view.exceedsAlertThreshold).toBe(false);
      }
    });

    it('depth for an unknown kind throws BadRequestException without touching prisma', async () => {
      await expect(
        service.depth('bogus' as unknown as QueueKind),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.alert.count).not.toHaveBeenCalled();
      expect(prisma.shelterProfile.count).not.toHaveBeenCalled();
    });

    it('depth is read-only: it never writes queue state or decision rows', async () => {
      prisma.alert.count.mockResolvedValue(999);

      await service.depth('alerts');

      expect(prisma.alert.update).not.toHaveBeenCalled();
      expect(prisma.adminReviewDecision.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });

  describe('queue', () => {
    it("queue('alerts') reads QUARANTINED/RECEIVED alerts and resolves the source provider key", async () => {
      const fetchedAt = new Date('2026-01-05T08:05:00Z');
      prisma.alert.findMany.mockResolvedValue([
        {
          id: 'al-1',
          externalRef: 'ext-1',
          status: 'QUARANTINED',
          headline: 'Flood warning issued',
          issuer: 'Issuing authority',
          issuedAt: new Date('2026-01-05T08:00:00Z'),
          createdAt: new Date('2026-01-05T09:00:00Z'),
          sourceRecord: {
            providerId: 'p-1',
            sourceUrl: 'https://example.org/feed/1',
            payloadHash: 'h'.repeat(64),
            fetchedAt,
          },
        },
      ]);
      prisma.dataProvider.findMany.mockResolvedValue([
        { id: 'p-1', key: 'usgs' },
      ]);

      const items = (await service.queue('alerts')) as AlertQueueItem[];

      expect(prisma.alert.findMany.mock.calls[0][0].where).toEqual({
        status: { in: ['QUARANTINED', 'RECEIVED'] },
      });
      // The provider key is resolved by a single batched lookup on the
      // source-record provider ids.
      expect(prisma.dataProvider.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['p-1'] } },
        select: { id: true, key: true },
      });
      expect(items).toHaveLength(1);
      expect(items[0].providerKey).toBe('usgs');
      // Timestamps are projected to ISO strings, never raw Dates.
      expect(items[0].alert.createdAt).toBe('2026-01-05T09:00:00.000Z');
      expect(items[0].provenance?.fetchedAt).toBe(fetchedAt.toISOString());
    });

    it("queue('places') reads shelter profiles that are not VERIFIED, joined to their place", async () => {
      prisma.shelterProfile.findMany.mockResolvedValue([
        {
          id: 'sh-1',
          verification: 'PENDING',
          inspectAuthority: null,
          inspectionDate: null,
          place: {
            id: 'pl-1',
            name: 'Riverside hall',
            kind: 'SHELTER',
            verification: 'UNVERIFIED',
          },
        },
      ]);

      const items = (await service.queue('places')) as PlaceQueueItem[];

      expect(prisma.shelterProfile.findMany.mock.calls[0][0].where).toEqual({
        verification: { not: 'VERIFIED' },
      });
      expect(items).toHaveLength(1);
      expect(items[0].place.name).toBe('Riverside hall');
      expect(items[0].shelter.verification).toBe('PENDING');
      expect(items[0].shelter.inspectionDate).toBeNull();
    });

    it('queue with any other kind value throws BadRequestException', async () => {
      await expect(
        service.queue('bogus' as unknown as QueueKind),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.alert.findMany).not.toHaveBeenCalled();
      expect(prisma.shelterProfile.findMany).not.toHaveBeenCalled();
    });
  });

  describe('decide', () => {
    it('SHELTER_VERIFIED without an authority is rejected before any write (Gate E)', async () => {
      prisma.shelterProfile.findUnique.mockResolvedValue({
        id: 'sh-1',
        placeId: 'pl-1',
        classification: 'Emergency shelter',
      });

      await expect(
        service.decide(
          USER,
          decisionDto('shelter', 'sh-1', 'SHELTER_VERIFIED'),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.adminReviewDecision.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it('SHELTER_VERIFIED without a verification date is rejected before any write (Gate E)', async () => {
      prisma.shelterProfile.findUnique.mockResolvedValue({
        id: 'sh-1',
        placeId: 'pl-1',
        classification: 'Emergency shelter',
      });

      await expect(
        service.decide(
          USER,
          decisionDto('shelter', 'sh-1', 'SHELTER_VERIFIED', {
            authority: 'State CERT unit',
          }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.adminReviewDecision.create).not.toHaveBeenCalled();
    });

    it('SHELTER_VERIFIED with authority and a valid ISO date stamps the shelter profile and its place in one transaction', async () => {
      prisma.shelterProfile.findUnique.mockResolvedValue({
        id: 'sh-1',
        placeId: 'pl-1',
        classification: 'Emergency shelter',
      });
      prisma.shelterProfile.update.mockResolvedValue({});
      prisma.place.update.mockResolvedValue({});
      prisma.$transaction.mockResolvedValue([{}, {}]);
      prisma.adminReviewDecision.create.mockResolvedValue({ id: 'dec-1' });

      // A verification inside the 30-day revalidation window so the shelter
      // policy (shelter-policy.ts, Gate E) passes regardless of run time.
      const inspectionDate = new Date(Date.now() - 3 * 86_400_000);
      const result = await service.decide(
        USER,
        decisionDto('shelter', 'sh-1', 'SHELTER_VERIFIED', {
          authority: 'State CERT unit',
          verificationDate: inspectionDate.toISOString(),
        }),
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const ops = prisma.$transaction.mock.calls[0][0] as unknown[];
      expect(ops).toHaveLength(2);
      expect(prisma.shelterProfile.update).toHaveBeenCalledWith({
        where: { id: 'sh-1' },
        data: {
          verification: 'VERIFIED',
          inspectAuthority: 'State CERT unit',
          inspectionDate,
        },
      });
      expect(prisma.place.update).toHaveBeenCalledWith({
        where: { id: 'pl-1' },
        data: {
          verification: 'VERIFIED',
          sourceAuthority: 'State CERT unit',
        },
      });
      expect(prisma.adminReviewDecision.create).toHaveBeenCalledWith({
        data: {
          shelter: { connect: { id: 'sh-1' } },
          decision: 'SHELTER_VERIFIED',
          rationale: null,
          actor: { connect: { id: USER.id } },
        },
      });
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record.mock.calls[0][0]).toBe(USER.id);
      expect(audit.record.mock.calls[0][1]).toBe(
        AUDIT_ACTIONS.SHELTER_VERIFIED,
      );
      expect(result).toEqual({
        decisionId: 'dec-1',
        decision: 'SHELTER_VERIFIED',
        targetKind: 'shelter',
        targetId: 'sh-1',
        auditAction: AUDIT_ACTIONS.SHELTER_VERIFIED,
      });
    });

    it('SHELTER_VERIFIED with an unparseable verification date throws BadRequestException', async () => {
      prisma.shelterProfile.findUnique.mockResolvedValue({
        id: 'sh-1',
        placeId: 'pl-1',
        classification: 'Emergency shelter',
      });

      await expect(
        service.decide(
          USER,
          decisionDto('shelter', 'sh-1', 'SHELTER_VERIFIED', {
            authority: 'State CERT unit',
            verificationDate: 'not-a-date',
          }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.adminReviewDecision.create).not.toHaveBeenCalled();
    });

    it('SHELTER_VERIFIED rejects when the shelter row has no classification (Gate E, shelter policy)', async () => {
      prisma.shelterProfile.findUnique.mockResolvedValue({
        id: 'sh-1',
        placeId: 'pl-1',
        classification: null,
      });

      await expect(
        service.decide(
          USER,
          decisionDto('shelter', 'sh-1', 'SHELTER_VERIFIED', {
            authority: 'State CERT unit',
            verificationDate: new Date().toISOString(),
          }),
        ),
      ).rejects.toThrow(
        expect.objectContaining({
          message: expect.stringContaining('missing shelter classification'),
        }),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.adminReviewDecision.create).not.toHaveBeenCalled();
    });

    it('REVIEW_APPROVED on an existing alert publishes it in the same transaction as the decision row', async () => {
      prisma.alert.findUnique.mockResolvedValue({ id: 'al-1' });
      prisma.alert.update.mockResolvedValue({ id: 'al-1' });
      prisma.adminReviewDecision.create.mockResolvedValue({ id: 'dec-1' });
      prisma.$transaction.mockImplementation(async (ops: unknown[]) =>
        Promise.all(ops as [Promise<unknown>, Promise<{ id: string }>]),
      );

      const result = await service.decide(
        USER,
        decisionDto('alert', 'al-1', 'REVIEW_APPROVED'),
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const ops = prisma.$transaction.mock.calls[0][0] as unknown[];
      expect(ops).toHaveLength(2);
      // The alert row is flipped to PUBLISHED with a publishedAt stamp, and
      // the decision row is written, both in one transaction.
      expect(prisma.alert.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'al-1' },
          data: expect.objectContaining({ status: 'PUBLISHED' }),
        }),
      );
      const updateData = (
        prisma.alert.update.mock.calls[0][0] as {
          data: { status: string; publishedAt: Date };
        }
      ).data;
      expect(updateData.status).toBe('PUBLISHED');
      expect(updateData.publishedAt).toBeInstanceOf(Date);
      expect(prisma.adminReviewDecision.create).toHaveBeenCalledWith({
        data: {
          alert: { connect: { id: 'al-1' } },
          decision: 'REVIEW_APPROVED',
          rationale: null,
          actor: { connect: { id: USER.id } },
        },
      });
      expect(audit.record).toHaveBeenCalledTimes(1);
      expect(audit.record.mock.calls[0][1]).toBe(AUDIT_ACTIONS.ALERT_PUBLISHED);
      expect(result).toEqual({
        decisionId: 'dec-1',
        decision: 'REVIEW_APPROVED',
        targetKind: 'alert',
        targetId: 'al-1',
        auditAction: AUDIT_ACTIONS.ALERT_PUBLISHED,
      });
    });

    it('REVIEW_REJECTED on an alert writes the decision row only, without publishing (no $transaction)', async () => {
      prisma.alert.findUnique.mockResolvedValue({ id: 'al-1' });
      prisma.adminReviewDecision.create.mockResolvedValue({ id: 'dec-1' });

      const result = await service.decide(
        USER,
        decisionDto('alert', 'al-1', 'REVIEW_REJECTED'),
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.alert.update).not.toHaveBeenCalled();
      expect(prisma.adminReviewDecision.create).toHaveBeenCalledTimes(1);
      expect(result.decision).toBe('REVIEW_REJECTED');
      expect(result.auditAction).toBe(AUDIT_ACTIONS.ALERT_UPDATED);
    });

    it('decide for an unknown alert target throws NotFoundException without a decision row', async () => {
      prisma.alert.findUnique.mockResolvedValue(null);

      await expect(
        service.decide(USER, decisionDto('alert', 'al-9', 'REVIEW_APPROVED')),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.adminReviewDecision.create).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });
  });
});
