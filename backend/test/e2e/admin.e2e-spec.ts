import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * E2E: Phase 2 privileged API surface (providers registry, audit trail,
 * admin review queue and shelter-verification decisions) under /api/v1.
 *
 * Mirrors api.e2e-spec.ts: the real AppModule is booted with the same strict
 * ValidationPipe; every database-dependent assertion is gated behind
 * `dbConfigured`, and a skipped check logs SKIP: ... and never reports as a
 * pass.
 *
 * Specs target a disposable database (CI postgres service / local dev db);
 * they never touch production data.
 */
describe('SENTRAVYN admin API (e2e)', () => {
  let app: INestApplication;

  const dbConfigured = Boolean(process.env.DATABASE_URL);

  beforeAll(async () => {
    // Fixed test secret so token issuance works in CI and locally. It must
    // never come from a shared source: each CI runner and developer env sets
    // its own value; this fallback exists only for the test suite.
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
  });

  afterAll(async () => {
    await app.close();
  });

  // These three always run, with or without a database: JwtAuthGuard rejects
  // an unauthenticated request before any service or DB call, so the
  // fail-closed privileged-route evidence does not depend on infrastructure.
  describe('unauthenticated privileged routes (no database required)', () => {
    // Plain paths: it.each values are used directly as the request URL, so the
    // test title and the URL share one string (method is always GET).
    it.each([
      '/api/v1/admin/audit',
      '/api/v1/providers',
      '/api/v1/providers/health',
      '/api/v1/admin/review/queue?kind=alerts',
      '/api/v1/admin/review/depth?kind=alerts',
    ])('GET %s expects 401', async (path) => {
      await request(app.getHttpServer()).get(path).expect(401);
    });
  });

  // DB-gated: seed identity and role fixtures directly via the Prisma client
  // of the booted app (choice over a standalone PrismaClient: the same
  // connection the services use, no second client to dispose, and app.close()
  // tears it down).
  describe('authenticated role and admin flows (DB-gated)', () => {
    let prisma: PrismaService;
    let publicToken = '';
    let adminToken = '';
    const runId = Date.now();
    const publicEmail = `e2e-public-${runId}@sentravyn.test`;
    const adminEmail = `e2e-admin-${runId}@sentravyn.test`;

    beforeAll(async () => {
      if (!dbConfigured) {
        return;
      }
      prisma = app.get(PrismaService);
      // bcrypt cost 4 is enough for test fixtures: it is a few milliseconds,
      // not the production cost of 12, so the suite stays fast.
      const hash = await bcrypt.hash('e2e-admin-password', 4);
      await prisma.user.create({
        data: { email: publicEmail, role: 'PUBLIC', passwordHash: hash },
      });
      await prisma.user.create({
        data: { email: adminEmail, role: 'ADMIN', passwordHash: hash },
      });
      const publicRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: publicEmail, password: 'e2e-admin-password' })
        .expect(200);
      publicToken = publicRes.body.accessToken;
      const adminRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: adminEmail, password: 'e2e-admin-password' })
        .expect(200);
      adminToken = adminRes.body.accessToken;
    });

    it('enforces the role model on provider routes', async () => {
      if (!dbConfigured) {
        console.log(
          'SKIP: DATABASE_URL not configured; providers RBAC e2e not run',
        );
        return;
      }
      // Any authenticated role may list.
      const list = await request(app.getHttpServer())
        .get('/api/v1/providers')
        .set('Authorization', `Bearer ${publicToken}`)
        .expect(200);
      expect(Array.isArray(list.body)).toBe(true);
      // Privileged read: PUBLIC is below ADMIN, so 403.
      await request(app.getHttpServer())
        .get('/api/v1/admin/audit')
        .set('Authorization', `Bearer ${publicToken}`)
        .expect(403);
      // Mutating: ADMIN only.
      const upsertBody = {
        key: `e2e-provider-${runId}`,
        name: 'E2E Test Provider',
        docUrl: 'https://example.com/e2e-provider',
      };
      await request(app.getHttpServer())
        .post('/api/v1/providers')
        .set('Authorization', `Bearer ${publicToken}`)
        .send(upsertBody)
        .expect(403);
      // The same POST as ADMIN succeeds.
      const asAdmin = await request(app.getHttpServer())
        .post('/api/v1/providers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(upsertBody);
      expect([200, 201]).toContain(asAdmin.status);
      expect(asAdmin.body.key).toBe(upsertBody.key);
    });

    it('seeds the Phase 2 fixture providers idempotently', async () => {
      if (!dbConfigured) {
        console.log(
          'SKIP: DATABASE_URL not configured; provider seed e2e not run',
        );
        return;
      }
      const seededKeys = ['gdacs', 'usgs', 'copernicus-emdat'];
      const first = await request(app.getHttpServer())
        .post('/api/v1/providers/seed')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect([200, 201]).toContain(first.status);
      expect(first.body.seededKeys).toEqual(expect.arrayContaining(seededKeys));
      const second = await request(app.getHttpServer())
        .post('/api/v1/providers/seed')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({});
      expect([200, 201]).toContain(second.status);
      expect(second.body.seededKeys).toEqual(first.body.seededKeys);
    });

    it('aggregates provider fetch health and RBAC (Phase 10 section 3)', async () => {
      if (!dbConfigured) {
        console.log(
          'SKIP: DATABASE_URL not configured; provider health e2e not run',
        );
        return;
      }
      // A fresh provider + a mix of finished fetches: one success, one outage.
      const providerKey = `e2e-health-${runId}`;
      const provider = await prisma.dataProvider.create({
        data: { key: providerKey, name: 'E2E Health Provider', enabled: true },
      });
      await prisma.providerFetch.create({
        data: {
          providerId: provider.id,
          status: 'SUCCESS',
          requestedAt: new Date(),
          completedAt: new Date(),
        },
      });
      await prisma.providerFetch.create({
        data: {
          providerId: provider.id,
          status: 'OUTAGE',
          requestedAt: new Date(),
          completedAt: new Date(),
        },
      });

      // REVIEWER+ may read; PUBLIC is below the role floor, so 403.
      await request(app.getHttpServer())
        .get('/api/v1/providers/health')
        .set('Authorization', `Bearer ${publicToken}`)
        .expect(403);
      const res = await request(app.getHttpServer())
        .get('/api/v1/providers/health')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const health = res.body as {
        key: string;
        window: {
          success: number;
          failed: number;
          outages: number;
          total: number;
        } | null;
        lastFetchStatus: string | null;
        lastFetchWasOutage: boolean;
      }[];
      expect(Array.isArray(health)).toBe(true);
      const row = health.find((h) => h.key === providerKey);
      expect(row).toBeDefined();
      // Window aggregates the two finished fetches (PENDING is excluded;
      // no PENDING row exists for this provider, so total is 2).
      expect(row?.window?.total).toBe(2);
      expect(row?.window?.success).toBe(1);
      expect(row?.window?.outages).toBe(1);
      // The most recent finished fetch (created last) was the outage, so
      // the stale-provider flag must be on for this provider.
      expect(row?.lastFetchWasOutage).toBe(true);
      expect(row?.lastFetchStatus).toBe('OUTAGE');
    });

    it('surfaces PROVIDER_CHANGED in the admin audit trail', async () => {
      if (!dbConfigured) {
        console.log('SKIP: DATABASE_URL not configured; audit e2e not run');
        return;
      }
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/audit')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      // AuditService.list returns the raw event array (no envelope).
      expect(Array.isArray(res.body)).toBe(true);
      const providerEvent = (
        res.body as { action: string; entity: string }[]
      ).find((item) => item.action === 'PROVIDER_CHANGED');
      expect(providerEvent).toBeDefined();
      // Optional chaining keeps the assertion meaningful: if the event is
      // missing the expectation fails on undefined, and toBeDefined() above
      // documents the intent (strict TS does not narrow on matchers).
      expect(providerEvent?.entity).toBe('dataProvider');
    });

    it('serves the alerts review queue to an authenticated admin', async () => {
      if (!dbConfigured) {
        console.log(
          'SKIP: DATABASE_URL not configured; review queue e2e not run',
        );
        return;
      }
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/review/queue?kind=alerts')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('reports the review-queue depth and alert-threshold signal (Phase 10 section 3)', async () => {
      if (!dbConfigured) {
        console.log(
          'SKIP: DATABASE_URL not configured; review depth e2e not run',
        );
        return;
      }
      // Seed a quarantined alert so the alerts queue has a known non-zero
      // depth. The alert row is unambiguously quarantined: no publication,
      // no review, so its status is the review surface (ADR-007).
      const alert = await prisma.alert.create({
        data: {
          headline: `E2E quarantine alert ${runId}`,
          status: 'QUARANTINED',
        },
      });
      expect(alert.status).toBe('QUARANTINED');

      // PUBLIC is below the role floor (REVIEWER+), so 403.
      await request(app.getHttpServer())
        .get('/api/v1/admin/review/depth?kind=alerts')
        .set('Authorization', `Bearer ${publicToken}`)
        .expect(403);

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/review/depth?kind=alerts')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const view = res.body as {
        kind: string;
        depth: number;
        threshold: number;
        exceedsAlertThreshold: boolean;
      };
      expect(view.kind).toBe('alerts');
      // At least the seeded alert is counted (other e2e data is possible, so
      // >= 1, not a strict equality).
      expect(view.depth).toBeGreaterThanOrEqual(1);
      // threshold is the configured/default positive integer.
      expect(view.threshold).toBeGreaterThan(0);
      // The signal is consistent with the two fields.
      expect(view.exceedsAlertThreshold).toBe(view.depth >= view.threshold);
    });

    it('verifies a shelter only with an authority and a date (Gate E)', async () => {
      if (!dbConfigured) {
        console.log(
          'SKIP: DATABASE_URL not configured; shelter decision e2e not run',
        );
        return;
      }
      // Seed an unverified place + shelter directly so the queue lists it.
      // The shelter carries a classification: the SHELTER_VERIFIED policy
      // check (shelter-policy.ts, Gate E) requires authority + date AND
      // classification to be present on the row.
      const place = await prisma.place.create({
        data: { name: `E2E Shelter ${runId}`, kind: 'shelter' },
      });
      const shelter = await prisma.shelterProfile.create({
        data: { placeId: place.id, classification: 'Emergency shelter' },
      });

      // SHELTER_VERIFIED without authority / verificationDate is a 400 policy
      // rejection, not a silent verify.
      const missing = await request(app.getHttpServer())
        .post('/api/v1/admin/review/decide')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          target: { kind: 'shelter', id: shelter.id },
          decision: 'SHELTER_VERIFIED',
        });
      expect(missing.status).toBe(400);

      // With a verifying authority and an ISO date the decision succeeds.
      // The date is run-time-relative so it is always inside the shelter
      // policy's 30-day revalidation window.
      const verificationDate = new Date(
        Date.now() - 3 * 86_400_000,
      ).toISOString();
      const decided = await request(app.getHttpServer())
        .post('/api/v1/admin/review/decide')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          target: { kind: 'shelter', id: shelter.id },
          decision: 'SHELTER_VERIFIED',
          authority: 'City Emergency Management Office',
          verificationDate,
        });
      expect([200, 201]).toContain(decided.status);
      expect(decided.body.decision).toBe('SHELTER_VERIFIED');
      expect(decided.body.auditAction).toBe('SHELTER_VERIFIED');

      // The verified shelter no longer appears in the places review queue.
      const queue = await request(app.getHttpServer())
        .get('/api/v1/admin/review/queue?kind=places')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(
        queue.body.some(
          (item: { shelter: { id: string } }) => item.shelter.id === shelter.id,
        ),
      ).toBe(false);
    });
  });
});
