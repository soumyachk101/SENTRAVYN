import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { GeoService } from '../../src/geospatial/geo.service';

/**
 * E2E: Phase 4 places backend under the /api/v1 global prefix.
 *
 * Mirrors api.e2e-spec.ts: the real AppModule boots with the same strict
 * ValidationPipe; every database-dependent assertion is gated behind
 * `dbConfigured`, and a skipped check logs 'SKIP: DATABASE_URL not
 * configured; ...' and never reports as a pass.
 *
 * DB-gated cases seed a place via Prisma with lat/lng, call
 * GeoService.backfillLocations so the derived PostGIS location column is
 * populated (ADR-004), then:
 * - GET /places default mode returns the row with a computed label;
 * - GET /places?lat&lng radius mode returns distanceMeters + the
 *   distanceIsCalculation disclosure;
 * - GET /places/:id returns profiles, evidence and the label;
 * - POST /places/:id/evidence is authenticated, stores the submission,
 *   records PLACE_EVIDENCE_ADDED, and leaves verification state untouched.
 */
describe('SENTRAVYN places API (e2e)', () => {
  let app: INestApplication;

  const dbConfigured = Boolean(process.env.DATABASE_URL);

  let prisma: PrismaService;
  let geo: GeoService;
  let publicToken = '';
  const runId = Date.now();
  const runKind = `e2e-place-${runId}`;
  let placeId = '';
  let shelterId = '';
  let evidenceId = '';

  beforeAll(async () => {
    // Fixed test secret so token issuance works in CI and locally; each
    // runner/dev env may set its own. Never from a shared source.
    process.env.AUTH_JWT_SECRET =
      process.env.AUTH_JWT_SECRET ?? 'sentravyn-e2e-test-jwt-secret-0000000000';

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirror main.ts security configuration for the test app.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();

    if (dbConfigured) {
      prisma = app.get(PrismaService);
      geo = app.get(GeoService);

      // Seed a place with coordinates and a VERIFIED shelter profile whose
      // inspection is inside the 30-day revalidation window -> the read-path
      // label must be VERIFIED with no downgrade reasons. The stored place
      // state is set explicitly: the e2e then asserts the evidence POST never
      // moves it.
      const place = await prisma.place.create({
        data: {
          name: `E2E Place ${runId}`,
          kind: runKind,
          verification: 'VERIFIED',
          sourceAuthority: 'City Emergency Management Office',
          lat: 40.7,
          lng: -74.0,
        },
      });
      placeId = place.id;
      const profile = await prisma.shelterProfile.create({
        data: {
          placeId: place.id,
          classification: 'Emergency shelter',
          hazardApplicability: ['flood'],
          verification: 'VERIFIED',
          inspectAuthority: 'City Emergency Management Office',
          inspectionDate: new Date(Date.now() - 3 * 86_400_000),
        },
      });
      shelterId = profile.id;

      // Populate the derived PostGIS geography column from the staged
      // lat/lng (ADR-004), so radius search can find it.
      await geo.backfillLocations();

      // One authenticated PUBLIC user, so the evidence POST is exercised
      // under a real token for a non-privileged role (SAFETY-POLICY.md 9).
      const hash = await bcrypt.hash('e2e-public-password', 4);
      await prisma.user.create({
        data: {
          email: `e2e-public-places-${runId}@sentravyn.test`,
          role: 'PUBLIC',
          passwordHash: hash,
        },
      });
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({
          email: `e2e-public-places-${runId}@sentravyn.test`,
          password: 'e2e-public-password',
        })
        .expect(200);
      publicToken = login.body.accessToken;
    }
  });

  afterAll(async () => {
    if (dbConfigured) {
      await prisma.placeEvidence.deleteMany({ where: { placeId } });
      await prisma.auditEvent.deleteMany({ where: { entityId: placeId } });
      await prisma.shelterProfile.deleteMany({ where: { id: shelterId } });
      await prisma.place.deleteMany({ where: { id: placeId } });
    }
    await app.close();
  });

  describe('GET /api/v1/places (public read)', () => {
    it('default mode returns the seeded place with a computed VERIFIED label and no distance fields', async () => {
      if (!dbConfigured) {
        console.log(
          'SKIP: DATABASE_URL not configured; places list e2e not run',
        );
        return;
      }
      const res = await request(app.getHttpServer())
        .get(`/api/v1/places?kind=${runKind}`)
        .expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.pagination).toMatchObject({ page: 1, pageSize: 20 });
      expect(res.body.coverageNote).toBeUndefined();

      const item = (res.body.items as Array<Record<string, unknown>>).find(
        (i) => i.id === placeId,
      );
      expect(item).toBeDefined();
      expect(item!.verification).toBe('VERIFIED');
      expect(item!.verificationLabel).toBe('VERIFIED');
      expect(item!.verificationLabelReasons).toEqual([]);
      // Default mode carries no distance claim.
      expect(item!.distanceMeters).toBeUndefined();
      expect(item!.distanceIsCalculation).toBeUndefined();
    });

    it('radius mode returns distanceMeters and the distanceIsCalculation disclosure', async () => {
      if (!dbConfigured) {
        console.log(
          'SKIP: DATABASE_URL not configured; radius search e2e not run',
        );
        return;
      }
      const res = await request(app.getHttpServer())
        .get(
          `/api/v1/places?lat=40.7&lng=-74.0&radiusMeters=500&limit=200&kind=${runKind}`,
        )
        .expect(200);
      const item = (res.body.items as Array<Record<string, unknown>>).find(
        (i) => i.id === placeId,
      );
      expect(item).toBeDefined();
      // The place is at the search centre; distance is 0 within a hair's breadth.
      expect(typeof item!.distanceMeters).toBe('number');
      expect((item!.distanceMeters as number).valueOf()).toBeLessThan(10);
      expect(item!.distanceIsCalculation).toBe(true);
    });

    it('a half-supplied coordinate pair is a 400, and unknown fields are rejected', async () => {
      if (!dbConfigured) {
        console.log('SKIP: DATABASE_URL not configured; 400-case e2e not run');
        return;
      }
      await request(app.getHttpServer())
        .get('/api/v1/places?lat=40.7')
        .expect(400);
      // ForbidNonWhitelisted: a field the DTO does not declare is a 400.
      await request(app.getHttpServer())
        .get('/api/v1/places?wat=1')
        .expect(400);
    });

    it('an empty radius returns the fixed coverage note', async () => {
      if (!dbConfigured) {
        console.log(
          'SKIP: DATABASE_URL not configured; coverage-note e2e not run',
        );
        return;
      }
      // A far-away centre finds no place with a known location in range.
      const res = await request(app.getHttpServer())
        .get('/api/v1/places?lat=0.0&lng=0.0&radiusMeters=500000')
        .expect(200);
      expect(res.body.items).toEqual([]);
      expect(res.body.coverageNote).toBe(
        'a map listing is not proof that a place is open, safe or operational',
      );
    });
  });

  describe('GET /api/v1/places/:id (public detail)', () => {
    it('returns the place with its shelter profiles, evidence and the label', async () => {
      if (!dbConfigured) {
        console.log(
          'SKIP: DATABASE_URL not configured; place detail e2e not run',
        );
        return;
      }
      const res = await request(app.getHttpServer())
        .get(`/api/v1/places/${placeId}`)
        .expect(200);
      expect(res.body.place).toMatchObject({
        id: placeId,
        kind: runKind,
        verification: 'VERIFIED',
      });
      expect(res.body.verificationLabel).toBe('VERIFIED');
      expect(Array.isArray(res.body.shelterProfiles)).toBe(true);
      expect(res.body.shelterProfiles).toHaveLength(1);
      expect(res.body.shelterProfiles[0]).toMatchObject({
        id: shelterId,
        classification: 'Emergency shelter',
        verification: 'VERIFIED',
      });
      expect(Array.isArray(res.body.evidence)).toBe(true);
    });

    it('rejects an unknown place id with 404', async () => {
      if (!dbConfigured) {
        console.log(
          'SKIP: DATABASE_URL not configured; detail 404 e2e not run',
        );
        return;
      }
      await request(app.getHttpServer())
        .get('/api/v1/places/does-not-exist')
        .expect(404);
    });
  });

  describe('POST /api/v1/places/:id/evidence (authenticated, any role)', () => {
    it('is 401 without a token', async () => {
      if (!dbConfigured) {
        console.log(
          'SKIP: DATABASE_URL not configured; evidence 401 e2e not run',
        );
        return;
      }
      await request(app.getHttpServer())
        .post(`/api/v1/places/${placeId}/evidence`)
        .send({ claim: 'test' })
        .expect(401);
    });

    it('stores the submission, records PLACE_EVIDENCE_ADDED, and never changes verification state', async () => {
      if (!dbConfigured) {
        console.log('SKIP: DATABASE_URL not configured; evidence e2e not run');
        return;
      }
      const res = await request(app.getHttpServer())
        .post(`/api/v1/places/${placeId}/evidence`)
        .set('Authorization', `Bearer ${publicToken}`)
        .send({
          claim:
            'Resident reported the shelter was accepting walk-ins on arrival',
          sourceUrl: 'https://example.com/e2e-report',
        })
        .expect(201);
      evidenceId = res.body.id;
      expect(res.body.claim).toBe(
        'Resident reported the shelter was accepting walk-ins on arrival',
      );
      expect(res.body.sourceUrl).toBe('https://example.com/e2e-report');
      expect(typeof res.body.createdAt).toBe('string');

      // The row is in the DB.
      const stored = await prisma.placeEvidence.findUnique({
        where: { id: evidenceId },
      });
      expect(stored).not.toBeNull();

      // Verification state is untouched: the place is still VERIFIED with no
      // stale flag, and the shelter profile still says VERIFIED (SAFETY-POLICY.md 9:
      // a submission must not promote/demote official state).
      const placeAfter = await prisma.place.findUnique({
        where: { id: placeId },
      });
      expect(placeAfter!.verification).toBe('VERIFIED');
      expect(placeAfter!.staleSince).toBeNull();
      const profileAfter = await prisma.shelterProfile.findUnique({
        where: { id: shelterId },
      });
      expect(profileAfter!.verification).toBe('VERIFIED');

      // The audit trail records exactly this submission.
      const auditRows = await prisma.auditEvent.findMany({
        where: { entityId: placeId, action: 'PLACE_EVIDENCE_ADDED' },
      });
      expect(auditRows.length).toBe(1);
      expect(auditRows[0].entity).toBe('place');
      expect(auditRows[0].detail).toContain(evidenceId);

      // The submission now appears in the place detail evidence list.
      const detail = await request(app.getHttpServer())
        .get(`/api/v1/places/${placeId}`)
        .expect(200);
      const listed = (detail.body.evidence as Array<{ id: string }>).find(
        (e) => e.id === evidenceId,
      );
      expect(listed).toBeDefined();
    });

    it('rejects an unknown place id with 404 and an undeclared body field with 400', async () => {
      if (!dbConfigured) {
        console.log(
          'SKIP: DATABASE_URL not configured; evidence 404/400 e2e not run',
        );
        return;
      }
      await request(app.getHttpServer())
        .post('/api/v1/places/does-not-exist/evidence')
        .set('Authorization', `Bearer ${publicToken}`)
        .send({ claim: 'x' })
        .expect(404);
      await request(app.getHttpServer())
        .post(`/api/v1/places/${placeId}/evidence`)
        .set('Authorization', `Bearer ${publicToken}`)
        .send({ claim: 'x', notAField: 1 })
        .expect(400);
    });
  });
});
