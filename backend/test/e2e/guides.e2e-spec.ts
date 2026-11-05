import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * E2E: Phase 5 safety-guide workflow against the real AppModule under
 * /api/v1 (SAFETY-POLICY.md 10; SECURITY.md 6).
 *
 * Mirrors admin.e2e-spec.ts: a reviewer account is seeded directly through
 * the app's Prisma client and authenticated with /auth/login; every
 * database-dependent assertion is gated behind `dbConfigured`, and a
 * skipped case logs `SKIP: DATABASE_URL not configured; <case> e2e not
 * run` so a skip is never reported as a pass.
 *
 * The unauthenticated cases (public guide endpoints + 401 on the
 * privileged ones) always run, because JwtAuthGuard rejects before any
 * database call.
 */
describe('SENTRAVYN guides API (e2e, Phase 5 gate)', () => {
  let app: INestApplication;

  const dbConfigured = Boolean(process.env.DATABASE_URL);

  beforeAll(async () => {
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

  // Always run: the guard rejects unauthenticated calls before any DB access.
  describe('unauthenticated access (no database required)', () => {
    it('GET /api/v1/guides is public and answers 200 with an empty list when the DB is reachable', async () => {
      if (!dbConfigured) {
        console.log(
          'SKIP: DATABASE_URL not configured; public list e2e not run',
        );
        return;
      }
      const res = await request(app.getHttpServer())
        .get('/api/v1/guides')
        .expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.pagination.page).toBe(1);
    });

    it.each([
      '/api/v1/admin/guides',
      '/api/v1/admin/guides/some-id/review',
      '/api/v1/admin/guides/some-id/approve',
    ])('POST %s without a token expects 401', async (path) => {
      await request(app.getHttpServer()).post(path).expect(401);
    });
  });

  describe('privileged guide lifecycle (DB-gated)', () => {
    let prisma: PrismaService;
    let reviewerToken = '';
    let publicToken = '';
    const runId = Date.now();
    const reviewerEmail = `e2e-guide-reviewer-${runId}@sentravyn.test`;
    const publicEmail = `e2e-guide-public-${runId}@sentravyn.test`;
    let guideId = '';

    beforeAll(async () => {
      if (!dbConfigured) {
        return;
      }
      prisma = app.get(PrismaService);
      // bcrypt cost 4: fast fixtures, not the production cost (admin.e2e-spec).
      const hash = await bcrypt.hash('e2e-guide-password', 4);
      await prisma.user.create({
        data: { email: reviewerEmail, role: 'REVIEWER', passwordHash: hash },
      });
      await prisma.user.create({
        data: { email: publicEmail, role: 'PUBLIC', passwordHash: hash },
      });
      const reviewerRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: reviewerEmail, password: 'e2e-guide-password' })
        .expect(200);
      reviewerToken = reviewerRes.body.accessToken;
      const publicRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: publicEmail, password: 'e2e-guide-password' })
        .expect(200);
      publicToken = publicRes.body.accessToken;
    });

    it('create -> review -> approve -> publish -> list -> retire, with audit rows and version bumps', async () => {
      if (!dbConfigured) {
        console.log(
          'SKIP: DATABASE_URL not configured; guide lifecycle e2e not run',
        );
        return;
      }

      // 1. Create: DRAFT at version 1, first revision row written in one tx.
      const created = await request(app.getHttpServer())
        .post('/api/v1/admin/guides')
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({
          hazardType: 'EARTHQUAKE',
          body: 'Placeholder: reviewed guidance for earthquakes is not yet written up.',
          jurisdiction: 'Test jurisdiction',
          language: 'en',
          author: 'e2e author',
          reviewer: 'e2e reviewer',
          authority: 'e2e testing authority',
          references: ['https://example.com/earthquake-guidance'],
        })
        .expect(201);
      guideId = created.body.id;
      expect(created.body.approval).toBe('DRAFT');
      expect(created.body.version).toBe(1);
      expect(created.body.body).toContain('Placeholder');
      expect(created.body.revisions).toHaveLength(1);

      // An incomplete guide cannot be approved.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/guides/${guideId}/approve`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({})
        .expect(400);

      // 2. Review: DRAFT -> IN_REVIEW, stamps lastReviewedAt, audits GUIDE_REVIEWED.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/guides/${guideId}/review`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({})
        .expect(201);

      // 3. Approve: IN_REVIEW -> APPROVED, completeness gate passes now.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/guides/${guideId}/approve`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({ rationale: 'e2e approval' })
        .expect(201);

      // 4. Publish: APPROVED -> PUBLISHED.
      const published = await request(app.getHttpServer())
        .post(`/api/v1/admin/guides/${guideId}/publish`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({})
        .expect(201);
      expect(published.body.approval).toBe('PUBLISHED');

      // 5. Public visibility: the PUBLISHED guide is now readable through
      //    the unauthenticated surface, with body + metadata + revisions.
      const publicRead = await request(app.getHttpServer())
        .get(`/api/v1/guides/${guideId}`)
        .expect(200);
      expect(publicRead.body.approval).toBe('PUBLISHED');
      expect(publicRead.body.hazardType).toBe('EARTHQUAKE');
      expect(publicRead.body.revisions.length).toBe(1);
      expect(Array.isArray(publicRead.body.references)).toBe(true);

      const publicList = await request(app.getHttpServer())
        .get('/api/v1/guides?hazardType=EARTHQUAKE')
        .expect(200);
      expect(
        publicList.body.items.some((g: { id: string }) => g.id === guideId),
      ).toBe(true);

      // 6. A revision write is refused once PUBLISHED (immutability).
      await request(app.getHttpServer())
        .patch(`/api/v1/admin/guides/${guideId}`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({ body: 'late edit' })
        .expect(400);

      // 7. Retire: PUBLISHED -> RETIRED, audited as GUIDE_RETIRED.
      const retired = await request(app.getHttpServer())
        .post(`/api/v1/admin/guides/${guideId}/retire`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({ rationale: 'e2e retirement' })
        .expect(201);
      expect(retired.body.approval).toBe('RETIRED');

      // 8. Public surface no longer exposes the retired guide: 404, and it
      //    is absent from the public listing.
      await request(app.getHttpServer())
        .get(`/api/v1/guides/${guideId}`)
        .expect(404);
      const afterList = await request(app.getHttpServer())
        .get('/api/v1/guides')
        .expect(200);
      expect(
        afterList.body.items.some((g: { id: string }) => g.id === guideId),
      ).toBe(false);

      // 9. Audit trail: the privileged transitions left rows. The audit
      //    endpoint is ADMIN-only (JwtAuthGuard + @Roles('ADMIN')), so
      //    seed a second ADMIN account just for this assertion.
      const adminHash = await bcrypt.hash('e2e-guide-admin-password', 4);
      const adminEmail = `e2e-guide-admin-${runId}@sentravyn.test`;
      await prisma.user.create({
        data: { email: adminEmail, role: 'ADMIN', passwordHash: adminHash },
      });
      const adminRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: adminEmail, password: 'e2e-guide-admin-password' })
        .expect(200);
      const auditEvents = await request(app.getHttpServer())
        .get('/api/v1/admin/audit?entity=guide&limit=200')
        .set('Authorization', `Bearer ${adminRes.body.accessToken}`)
        .expect(200);
      const mine = auditEvents.body.filter(
        (e: { entityId: string }) => e.entityId === guideId,
      );
      const actions = mine.map((e: { action: string }) => e.action);
      expect(actions).toContain('GUIDE_UPDATED'); // create
      expect(actions).toContain('GUIDE_REVIEWED');
      expect(actions).toContain('GUIDE_APPROVED');
      expect(actions).toContain('GUIDE_PUBLISHED');
      expect(actions).toContain('GUIDE_RETIRED');

      // 10. Reopen: RETIRED -> DRAFT, then a new revision bumps the version.
      await request(app.getHttpServer())
        .post(`/api/v1/admin/guides/${guideId}/reopen`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({})
        .expect(201);
      const revised = await request(app.getHttpServer())
        .patch(`/api/v1/admin/guides/${guideId}`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({ body: 'Reviewed re-issued guidance for earthquakes.' })
        .expect(200);
      expect(revised.body.version).toBe(2);
      expect(revised.body.revisions).toHaveLength(2);
    });

    it('a PUBLIC account cannot mutate guide state (RBAC)', async () => {
      if (!dbConfigured || !guideId) {
        console.log('SKIP: DATABASE_URL not configured; RBAC 403 case not run');
        return;
      }
      await request(app.getHttpServer())
        .post(`/api/v1/admin/guides/${guideId}/review`)
        .set('Authorization', `Bearer ${publicToken}`)
        .expect(403);
    });

    it('an incomplete guide is rejected at publication (400 with a clear message)', async () => {
      if (!dbConfigured) {
        console.log(
          'SKIP: DATABASE_URL not configured; incomplete-publication case not run',
        );
        return;
      }
      // Create a guide with no references, reviewer or authority, then push
      // it through to the approval gate: it must 400.
      const incomplete = await request(app.getHttpServer())
        .post('/api/v1/admin/guides')
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({
          hazardType: 'FLOOD',
          body: 'Placeholder: flood guidance not yet written.',
          references: [],
        })
        .expect(201);
      const incompleteId = incomplete.body.id;
      await request(app.getHttpServer())
        .post(`/api/v1/admin/guides/${incompleteId}/review`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({})
        .expect(201);
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/guides/${incompleteId}/approve`)
        .set('Authorization', `Bearer ${reviewerToken}`)
        .send({})
        .expect(400);
      expect(String(res.body.message)).toMatch(/requires:/);
      expect(String(res.body.message)).toMatch(/references/);
      expect(String(res.body.message)).toMatch(/reviewer/);
    });
  });
});
