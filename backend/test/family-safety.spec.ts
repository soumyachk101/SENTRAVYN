import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { AuditService } from '../src/audit/audit.service';
import { FamilySafetyService } from '../src/family-safety/family-safety.service';
import type {
  CreateLocationShareDto,
  UpdateEmergencyContactDto,
  UpdateHouseholdPlanDto,
} from '../src/family-safety/family-safety.dto';

/**
 * Unit test for FamilySafetyService object-level authorisation (Phase 7,
 * SECURITY.md 5 / PRODUCT-SPEC 8). The service scopes every read/mutation to
 * the authenticated user's id: a resource that belongs to ANOTHER user is a
 * 404 (existence of a foreign record is never confirmed), not a 403 leak.
 *
 * We mock PrismaService and AuditService so the test is pure (no DB, no
 * infra) and directly asserts the WHERE clauses the service builds.
 */

const userA = 'user-a';
const userB = 'user-b';

interface MockPrisma {
  emergencyContact: {
    findMany: jest.Mock;
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  locationShare: {
    findMany: jest.Mock;
    create: jest.Mock;
    findFirst: jest.Mock;
    update: jest.Mock;
  };
  householdPlan: {
    findUnique: jest.Mock;
    upsert: jest.Mock;
  };
}

function makePrisma(): MockPrisma {
  return {
    emergencyContact: {
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    locationShare: {
      findMany: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    householdPlan: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };
}

function makeAudit(): jest.Mocked<AuditService> {
  return {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditService>;
}

const contactRow = {
  id: 'contact-1',
  userId: userB, // belongs to user B
  name: 'User B Contact',
  relation: 'sibling',
  phone: '+1-555-0100',
  consent: true,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('FamilySafetyService object-level authorisation', () => {
  let prisma: MockPrisma;
  let audit: jest.Mocked<AuditService>;
  let svc: FamilySafetyService;

  beforeEach(() => {
    prisma = makePrisma();
    audit = makeAudit();
    svc = new FamilySafetyService(prisma as unknown as PrismaService, audit);
  });

  describe('emergency contacts', () => {
    it('scopes the contact lookup to the calling user: a foreign contact id is a 404', async () => {
      // The contact exists but belongs to user B. User A must not be able to
      // touch it: findFirst is scoped by userId, so it finds nothing -> 404.
      prisma.emergencyContact.findFirst.mockResolvedValue(null);

      await expect(
        svc.updateContact(userA, 'contact-1', {
          name: 'hijack',
        } as UpdateEmergencyContactDto),
      ).rejects.toThrow(NotFoundException);

      // Prove the query was scoped to user A, NOT a global id lookup.
      expect(prisma.emergencyContact.findFirst).toHaveBeenCalledWith({
        where: { id: 'contact-1', userId: userA },
      });
      // And the update was never attempted on the foreign row.
      expect(prisma.emergencyContact.update).not.toHaveBeenCalled();
    });

    it('allows the owner to update their own contact', async () => {
      prisma.emergencyContact.findFirst.mockResolvedValue(contactRow);
      // Prisma `update` returns the persisted row, so the mock returns the
      // post-update shape (the new phone), not the pre-update `contactRow`.
      const updatedRow = { ...contactRow, phone: '+1-555-0199' };
      prisma.emergencyContact.update.mockResolvedValue(updatedRow);

      const view = await svc.updateContact(userB, 'contact-1', {
        phone: '+1-555-0199',
      } as UpdateEmergencyContactDto);
      expect(view.phone).toBe('+1-555-0199');
      expect(prisma.emergencyContact.findFirst).toHaveBeenCalledWith({
        where: { id: 'contact-1', userId: userB },
      });
      expect(prisma.emergencyContact.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'contact-1' },
          data: expect.objectContaining({ phone: '+1-555-0199' }),
        }),
      );
    });

    it('deleting a foreign contact is a 404 and does not delete', async () => {
      prisma.emergencyContact.findFirst.mockResolvedValue(null);
      await expect(svc.deleteContact(userA, 'contact-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.emergencyContact.delete).not.toHaveBeenCalled();
    });
  });

  describe('location shares', () => {
    const shareRow = {
      id: 'share-1',
      userId: userB,
      recipient: 'partner',
      purpose: 'check-in',
      preciseConsent: false,
      lastKnownLat: null,
      lastKnownLng: null,
      lastKnownAt: null,
      consented: true,
      expiresAt: new Date('2026-01-02T00:00:00Z'),
      revoked: false,
      revokedAt: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };

    it('revoking a foreign share is a 404 and does not revoke', async () => {
      prisma.locationShare.findFirst.mockResolvedValue(null);
      await expect(svc.revokeShare(userA, 'share-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.locationShare.update).not.toHaveBeenCalled();
    });

    it('the owner can revoke their own share immediately', async () => {
      prisma.locationShare.findFirst.mockResolvedValue(shareRow);
      prisma.locationShare.update.mockResolvedValue({
        ...shareRow,
        revoked: true,
        consented: false,
        revokedAt: new Date('2026-01-01T12:00:00Z'),
      });

      const view = await svc.revokeShare(userB, 'share-1');
      expect(view.revoked).toBe(true);
      expect(view.active).toBe(false); // computed: revoked
      expect(prisma.locationShare.findFirst).toHaveBeenCalledWith({
        where: { id: 'share-1', userId: userB },
      });
    });

    it('computes active = not revoked and not expired', async () => {
      prisma.locationShare.findMany.mockResolvedValue([
        {
          ...shareRow,
          expiresAt: new Date('2026-01-01T23:59:00Z'), // still in the future vs now
        },
      ]);
      const now = new Date('2026-01-01T23:00:00Z');
      const views = await svc.listShares(userB, now);
      expect(views[0].active).toBe(true);

      // After expiry the same row is no longer active.
      const later = new Date('2026-01-02T01:00:00Z');
      const viewsLater = await svc.listShares(userB, later);
      expect(viewsLater[0].active).toBe(false);
    });

    it('rounds a coarse position and never persists a precise coordinate', async () => {
      prisma.locationShare.create.mockResolvedValue({
        ...shareRow,
        lastKnownLat: 51.5,
        lastKnownLng: -0.1,
        lastKnownAt: new Date(),
        expiresAt: new Date(Date.now() + 3600_000),
      });
      const dto: CreateLocationShareDto = {
        recipient: 'partner',
        purpose: 'check-in',
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        lastKnownLat: '51.5000001', // a "precise" value from a client
        lastKnownLng: '-0.1000002',
      };
      await svc.createShare(userB, dto);

      // The create call must have stored a rounded (coarse) value, not the
      // precise input: 51.5000001 rounds to 51.5 at 1e-3.
      expect(prisma.locationShare.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastKnownLat: 51.5,
            lastKnownLng: -0.1,
          }),
        }),
      );
    });

    it('rejects a share that expires at or before now', async () => {
      const dto: CreateLocationShareDto = {
        recipient: 'partner',
        purpose: 'check-in',
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      };
      await expect(svc.createShare(userB, dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.locationShare.create).not.toHaveBeenCalled();
    });
  });

  describe('household plan', () => {
    it('upserts a plan owned by the caller and sanitises the kit checklist', async () => {
      // The stored row may contain a malformed entry (e.g. hand-edited JSON).
      // The read path must drop it rather than crash.
      const row = {
        id: 'plan-1',
        userId: userB,
        meetingPoint: 'Community Hall',
        meetingPointNote: 'north entrance',
        kitChecklist: [
          { label: 'water', done: true },
          { label: 'stale-entry', done: 'not-a-boolean' }, // malformed -> dropped
        ],
        petConsiderations: 'two cats',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-01T00:00:00Z'),
      };
      prisma.householdPlan.upsert.mockResolvedValue(row);
      const dto: UpdateHouseholdPlanDto = {
        meetingPoint: 'Community Hall',
        kitChecklist: [
          { label: 'water', done: true },
          { label: 'meds', done: false },
        ],
      };
      const view = await svc.upsertHouseholdPlan(userB, dto);

      // The write carried the clean, validated kit list.
      expect(prisma.householdPlan.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: userB },
          create: expect.objectContaining({
            kitChecklist: [
              { label: 'water', done: true },
              { label: 'meds', done: false },
            ],
          }),
        }),
      );
      // The read view dropped the malformed stored entry.
      expect(view.kitChecklist).toEqual([{ label: 'water', done: true }]);
    });

    it('returns null when the user has no plan yet', async () => {
      prisma.householdPlan.findUnique.mockResolvedValue(null);
      const view = await svc.getHouseholdPlan(userA);
      expect(view).toBeNull();
    });
  });

  it('never writes a location value to the audit log (SECURITY.md 5)', async () => {
    const dto: CreateLocationShareDto = {
      recipient: 'partner',
      purpose: 'check-in',
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      lastKnownLat: '51.5',
      lastKnownLng: '-0.1',
    };
    prisma.locationShare.create.mockResolvedValue({
      id: 'share-1',
      userId: userB,
      recipient: 'partner',
      purpose: 'check-in',
      preciseConsent: false,
      lastKnownLat: 51.5,
      lastKnownLng: -0.1,
      lastKnownAt: new Date(),
      consented: true,
      expiresAt: new Date(Date.now() + 3600_000),
      revoked: false,
      revokedAt: null,
      createdAt: new Date(),
    });
    await svc.createShare(userB, dto);
    const auditCalls = audit.record.mock.calls;
    // Some audit record was made, but its detail must not contain coordinates.
    expect(auditCalls.length).toBeGreaterThan(0);
    for (const call of auditCalls) {
      const detail = call[4];
      if (detail !== null && detail !== undefined) {
        expect(detail).not.toMatch(/51\.5|-0\.1/);
      }
    }
  });
});
