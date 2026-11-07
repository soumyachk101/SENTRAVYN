import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PlacesService, COVERAGE_NOTE } from '../src/places/places.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { AuditService } from '../src/audit/audit.service';
import type { GeoService } from '../src/geospatial/geo.service';
import type {
  PlaceListItemListed,
  PlaceListItemNear,
} from '../src/places/places.service';

/**
 * Unit tests for PlacesService (Phase 4 places backend, ROADMAP Phase 4).
 *
 * Prisma is mocked; GeoService and AuditService are stubbed (the real
 * PostGIS path is covered by test/geo.spec.ts and the places e2e). The
 * load-bearing behaviour under test:
 * - default vs radius mode selection (including the 400 on a half-supplied
 *   coordinate pair and the fixed coverage note on an empty radius),
 * - the read-path verification label is computed via the real
 *   resolveVerificationLabel from the shelter profiles (no re-derivation),
 * - addEvidence never mutates verification state: it performs exactly one
 *   placeEvidence create, zero place/shelterProfile updates, and records the
 *   PLACE_EVIDENCE_ADDED audit event (SAFETY-POLICY.md section 9).
 */

type MockPrisma = {
  place: {
    findMany: jest.Mock;
    findUnique: jest.Mock;
    count: jest.Mock;
  };
  shelterProfile: {
    findMany: jest.Mock;
  };
  placeEvidence: {
    create: jest.Mock;
  };
  $transaction: jest.Mock;
};

function createPrismaMock(): MockPrisma {
  return {
    place: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    shelterProfile: {
      findMany: jest.fn(),
    },
    placeEvidence: {
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };
}

function placeRow(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-07-01T00:00:00.000Z');
  return {
    id: 'place-1',
    name: 'City Emergency Shelter',
    kind: 'shelter',
    verification: 'VERIFIED',
    sourceAuthority: 'City Emergency Management Office',
    operationalStatus: null,
    operationalEvidence: null,
    accessibility: null,
    capacityNote: null,
    staleSince: null,
    lat: 40.7,
    lng: -74.0,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'shelter-1',
    placeId: 'place-1',
    classification: 'Emergency shelter',
    hazardApplicability: ['flood', 'heat'],
    capacity: null,
    inspectAuthority: 'City Emergency Management Office',
    // Recent inspection: inside the 30-day revalidation window -> VERIFIED.
    inspectionDate: new Date(Date.now() - 3 * 86_400_000),
    verification: 'VERIFIED',
    expiresAt: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

function evidenceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evidence-1',
    placeId: 'place-1',
    claim: 'Resident reports the shelter was open this morning',
    sourceUrl: null,
    recordedByUserId: 'user-1',
    createdAt: new Date('2026-07-02T00:00:00.000Z'),
    ...overrides,
  };
}

function createService() {
  const prisma = createPrismaMock();
  // Keep the stubs' jest mock types (the service constructor takes the real
  // module types; the cast is the seam, as in alerts-api.spec.ts).
  const geo: { nearby: jest.Mock } = {
    // The nearby() results already carry the label (GeoService annotates).
    nearby: jest.fn().mockResolvedValue([]),
  };
  const audit: { record: jest.Mock } = {
    record: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PlacesService(
    prisma as unknown as PrismaService,
    geo as unknown as GeoService,
    audit as unknown as AuditService,
  );
  return { prisma, geo, audit, service };
}

describe('PlacesService.list (default vs radius mode)', () => {
  it('default mode: paginates, fetches shelter profiles in one bounded query, and resolves the label from them', async () => {
    const { prisma, geo, service } = createService();
    prisma.place.count.mockResolvedValue(1);
    prisma.place.findMany.mockResolvedValue([placeRow()]);
    prisma.$transaction.mockResolvedValue([1, [placeRow()]]);
    prisma.shelterProfile.findMany.mockResolvedValue([profileRow()]);

    const res = await service.list({});

    // One profile query for the whole page (mirror of the GeoService
    // pattern), scoped to the page's place ids.
    expect(prisma.shelterProfile.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.shelterProfile.findMany.mock.calls[0][0].where).toEqual({
      placeId: { in: ['place-1'] },
    });
    // Radius mode is not used in default mode.
    expect(geo.nearby).not.toHaveBeenCalled();
    expect(res.pagination).toEqual({ page: 1, pageSize: 20, total: 1 });
    expect(res.coverageNote).toBeUndefined();

    const item = res.items[0] as PlaceListItemListed;
    // VERIFIED place + a current VERIFIED profile -> label VERIFIED, no reasons.
    expect(item.verificationLabel).toBe('VERIFIED');
    expect(item.verificationLabelReasons).toEqual([]);
    // No distance is claimed in default mode.
    expect('distanceMeters' in item).toBe(false);
  });

  it('default mode: a lapsed (expired) shelter profile downgrades a stored VERIFIED place to EXPIRED', async () => {
    const { prisma, service } = createService();
    const expiredProfile = profileRow({
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    prisma.place.count.mockResolvedValue(1);
    prisma.place.findMany.mockResolvedValue([placeRow()]);
    prisma.$transaction.mockResolvedValue([1, [placeRow()]]);
    prisma.shelterProfile.findMany.mockResolvedValue([expiredProfile]);

    const res = await service.list({});
    const item = res.items[0] as PlaceListItemListed;

    // The stored row still says VERIFIED; the READ path downgrades it.
    expect(item.verification).toBe('VERIFIED');
    expect(item.verificationLabel).toBe('EXPIRED');
    expect(item.verificationLabelReasons.length).toBeGreaterThan(0);
  });

  it('rejects a half-supplied coordinate pair with 400', async () => {
    const { service } = createService();
    await expect(service.list({ lat: 40.7 })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.list({ lng: -74 })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('radius mode: delegates to GeoService with clamped-able inputs and adds the distance disclosure', async () => {
    const { prisma, geo, service } = createService();
    const nearRow = {
      id: 'place-1',
      name: 'City Emergency Shelter',
      kind: 'shelter',
      verification: 'UNVERIFIED',
      operationalStatus: null,
      operationalEvidence: null,
      staleSince: null,
      lat: 40.7,
      lng: -74.0,
      distanceMeters: 120,
      verificationLabel: 'UNVERIFIED' as const,
      verificationLabelReasons: [] as string[],
    };
    geo.nearby.mockResolvedValue([nearRow]);

    const res = await service.list({ lat: 40.7, lng: -74 });
    const item = res.items[0] as PlaceListItemNear;

    // The caller's inputs are passed through; clamping lives in GeoService.
    expect(geo.nearby).toHaveBeenCalledWith({
      lat: 40.7,
      lng: -74,
      radiusMeters: 1000,
      limit: 200,
      kind: undefined,
    });
    expect(item.distanceMeters).toBe(120);
    expect(item.distanceIsCalculation).toBe(true);
    expect(res.pagination).toBeUndefined();
    expect(res.coverageNote).toBeUndefined();
    // The listing-side profile query is not used in radius mode.
    expect(prisma.shelterProfile.findMany).not.toHaveBeenCalled();
  });

  it('radius mode: an empty radius returns the fixed coverage note and no pagination', async () => {
    const { geo, service } = createService();
    geo.nearby.mockResolvedValue([]);

    const res = await service.list({ lat: 40.7, lng: -74, kind: 'shelter' });

    expect(geo.nearby).toHaveBeenCalledWith({
      lat: 40.7,
      lng: -74,
      radiusMeters: 1000,
      limit: 200,
      kind: 'shelter',
    });
    expect(res.items).toEqual([]);
    expect(res.coverageNote).toBe(COVERAGE_NOTE);
    expect(res.pagination).toBeUndefined();
  });
});

describe('PlacesService.detail', () => {
  it('returns the place with profiles, evidence and the computed label', async () => {
    const { prisma, service } = createService();
    prisma.place.findUnique.mockResolvedValue({
      ...placeRow(),
      shelters: [profileRow()],
      evidence: [evidenceRow()],
    });

    const detail = await service.detail('place-1');

    expect(detail).not.toBeNull();
    expect(detail!.place).toMatchObject({
      id: 'place-1',
      name: 'City Emergency Shelter',
      verification: 'VERIFIED',
    });
    expect(detail!.verificationLabel).toBe('VERIFIED');
    expect(detail!.shelterProfiles[0]).toMatchObject({
      id: 'shelter-1',
      verification: 'VERIFIED',
      classification: 'Emergency shelter',
    });
    // Dates are serialised to ISO strings at the boundary.
    expect(typeof detail!.shelterProfiles[0].inspectionDate).toBe('string');
    expect(detail!.evidence[0]).toMatchObject({
      id: 'evidence-1',
      claim: 'Resident reports the shelter was open this morning',
      recordedByUserId: 'user-1',
    });
    // The detail read is a single query: profiles and evidence arrive nested,
    // so no second profile lookup is issued on the read path.
    expect(prisma.shelterProfile.findMany).not.toHaveBeenCalled();
  });

  it('downgrades a stored VERIFIED place with an old inspection to STALE', async () => {
    const { prisma, service } = createService();
    // Inspection older than the 30-day revalidation window.
    const staleProfile = profileRow({
      inspectionDate: new Date(Date.now() - 45 * 86_400_000),
    });
    prisma.place.findUnique.mockResolvedValue({
      ...placeRow(),
      shelters: [staleProfile],
      evidence: [],
    });

    const detail = await service.detail('place-1');
    expect(detail!.place.verification).toBe('VERIFIED');
    expect(detail!.verificationLabel).toBe('STALE');
    expect(detail!.verificationLabelReasons.length).toBeGreaterThan(0);
  });

  it('downgrades a VERIFIED place whose shelter has an explicit past expiry to EXPIRED', async () => {
    const { prisma, service } = createService();
    const expired = profileRow({
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    prisma.place.findUnique.mockResolvedValue({
      ...placeRow(),
      shelters: [expired],
      evidence: [],
    });

    const detail = await service.detail('place-1');
    expect(detail!.verificationLabel).toBe('EXPIRED');
  });

  it('returns null for an unknown place id (the controller answers 404)', async () => {
    const { prisma, service } = createService();
    prisma.place.findUnique.mockResolvedValue(null);

    const detail = await service.detail('does-not-exist');
    expect(detail).toBeNull();
    // The detail read carries the nested select (shelters + evidence); only
    // the where clause is asserted here.
    expect(prisma.place.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'does-not-exist' } }),
    );
  });
});

describe('PlacesService.addEvidence (SAFETY-POLICY.md section 9)', () => {
  it('creates one evidence row and one audit event; never mutates verification state', async () => {
    const { prisma, geo, audit, service } = createService();
    prisma.place.findUnique.mockResolvedValue({ id: 'place-1' });
    prisma.placeEvidence.create.mockResolvedValue(
      evidenceRow({
        id: 'evidence-new',
        sourceUrl: 'https://example.com/report',
      }),
    );

    const created = await service.addEvidence('user-1', 'place-1', {
      claim: 'Neighbour says the shelter took in families last night',
      sourceUrl: 'https://example.com/report',
    });

    // The store is untouched outside the evidence row: no place update, no
    // shelter update (SAFETY-POLICY.md section 9), no spatial writes.
    expect(prisma.placeEvidence.create).toHaveBeenCalledTimes(1);
    expect(prisma.placeEvidence.create).toHaveBeenCalledWith({
      data: {
        place: { connect: { id: 'place-1' } },
        claim: 'Neighbour says the shelter took in families last night',
        sourceUrl: 'https://example.com/report',
        recordedByUserId: 'user-1',
      },
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
    const [actorId, action, entity, entityId, detail] = audit.record.mock
      .calls[0] as unknown as [
      string,
      string,
      string,
      string | null,
      string | undefined,
    ];
    expect(actorId).toBe('user-1');
    expect(action).toBe('PLACE_EVIDENCE_ADDED');
    expect(entity).toBe('place');
    expect(entityId).toBe('place-1');
    expect(detail).toContain('evidence-new');
    // No Prisma mutation path for place/shelter verification is even present
    // in this service's mock surface: those delegates are not stubbed.
    expect(geo.nearby).not.toHaveBeenCalled();
    expect(created).toMatchObject({
      id: 'evidence-new',
      recordedByUserId: 'user-1',
      sourceUrl: 'https://example.com/report',
    });
    expect(typeof created.createdAt).toBe('string');
  });

  it('404s for an unknown place and writes nothing', async () => {
    const { prisma, audit, service } = createService();
    prisma.place.findUnique.mockResolvedValue(null);

    await expect(
      service.addEvidence('user-1', 'missing', { claim: 'a claim' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.placeEvidence.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('stores the claim verbatim (no trimming) when no source URL is given', async () => {
    const { prisma, service } = createService();
    prisma.place.findUnique.mockResolvedValue({ id: 'place-1' });
    prisma.placeEvidence.create.mockResolvedValue(
      evidenceRow({ sourceUrl: null }),
    );

    await service.addEvidence('user-1', 'place-1', {
      claim: '  spaced claim  ',
      sourceUrl: null,
    });

    expect(
      (
        prisma.placeEvidence.create.mock.calls[0][0] as {
          data: { claim: string; sourceUrl: string | null };
        }
      ).data.claim,
    ).toBe('  spaced claim  ');
    expect(
      (
        prisma.placeEvidence.create.mock.calls[0][0] as {
          data: { claim: string; sourceUrl: string | null };
        }
      ).data.sourceUrl,
    ).toBeNull();
  });
});
