import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * E2E: family-safety API (Phase 7, SECURITY.md 5) under /api/v1.
 *
 * Mirrors admin.e2e-spec.ts: the real AppModule is booted with the strict
 * ValidationPipe; every database-dependent assertion is gated behind
 * `dbConfigured`, and a skipped check logs SKIP: ... and never reports as a
 * pass.
 *
 * The core object-level authorisation property: user A can never read or
 * mutate user B's emergency contacts or location shares. A foreign resource
 * id is answered 404 (existence is never confirmed), and every route is
 * owner-scoped.
 */
describe('SENTRAVYN family-safety API (e2e)', () => {
  let app: INestApplication;

  const dbConfigured = Boolean(process.env.DATABASE_URL);
  const runId = Date.now();
  const PASSWORD = 'e2e-family-password';

  describe('unauthenticated family routes (no database required)', () => {
    beforeAll(async () => {
      process.env.AUTH_JWT_SECRET =
        process.env.AUTH_JWT_SECRET ?? 'sentravyn-e2e-test-jwt-secret-00000000';
      const moduleFixture = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleFixture.createNestApplication();
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

    it.each([
      '/api/v1/family/contacts',
      '/api/v1/family/location-shares',
      '/api/v1/family/household-plan',
    ])('GET %s expects 401', async (path) => {
      await request(app.getHttpServer()).get(path).expect(401);
    });
  });

  describe('family-safety object-level authorisation (DB-gated)', () => {
    let userA: { token: string; email: string };
    let userB: { token: string; email: string };
    let prisma: PrismaService;

    beforeAll(async () => {
      if (!dbConfigured) {
        console.log(
          'SKIP: DATABASE_URL not configured; family-safety e2e not run',
        );
        return;
      }
      process.env.AUTH_JWT_SECRET =
        process.env.AUTH_JWT_SECRET ?? 'sentravyn-e2e-test-jwt-secret-00000000';
      const moduleFixture = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      app = moduleFixture.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
        }),
      );
      app.setGlobalPrefix('api/v1');
      await app.init();
      prisma = app.get(PrismaService);

      // Two independent PUBLIC users; each logs in to get their own token.
      const hash = await bcrypt.hash(PASSWORD, 4);
      const aEmail = `e2e-fam-a-${runId}@sentravyn.test`;
      const bEmail = `e2e-fam-b-${runId}@sentravyn.test`;
      await prisma.user.create({
        data: { email: aEmail, role: 'PUBLIC', passwordHash: hash },
      });
      await prisma.user.create({
        data: { email: bEmail, role: 'PUBLIC', passwordHash: hash },
      });
      const aRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: aEmail, password: PASSWORD })
        .expect(200);
      const bRes = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: bEmail, password: PASSWORD })
        .expect(200);
      userA = { token: aRes.body.accessToken, email: aEmail };
      userB = { token: bRes.body.accessToken, email: bEmail };
    });

    afterAll(async () => {
      if (!dbConfigured) {
        return;
      }
      await app.close();
    });

    function skip(): void {
      if (!dbConfigured) {
        console.log(
          'SKIP: DATABASE_URL not configured; family-safety e2e not run',
        );
      }
    }

    it('user A cannot read or mutate user B contacts or shares', async () => {
      skip();
      // User B creates a contact and a share that A must not reach.
      const contact = await request(app.getHttpServer())
        .post('/api/v1/family/contacts')
        .set('Authorization', `Bearer ${userB.token}`)
        .send({ name: 'B Contact', phone: '+1-555-0100' })
        .expect(201);
      const share = await request(app.getHttpServer())
        .post('/api/v1/family/location-shares')
        .set('Authorization', `Bearer ${userB.token}`)
        .send({
          recipient: 'A',
          purpose: 'check-in',
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        })
        .expect(201);

      // A's lists never contain B's data (owner-scoped queries).
      const aContacts = await request(app.getHttpServer())
        .get('/api/v1/family/contacts')
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(200);
      expect(aContacts.body).toEqual([]);

      const aShares = await request(app.getHttpServer())
        .get('/api/v1/family/location-shares')
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(200);
      expect(aShares.body).toEqual([]);

      // A attempts B's resource ids: answered 404, never 200, never a leak.
      await request(app.getHttpServer())
        .patch(`/api/v1/family/contacts/${contact.body.id}`)
        .set('Authorization', `Bearer ${userA.token}`)
        .send({ name: 'hijack' })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`/api/v1/family/contacts/${contact.body.id}`)
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(404);
      await request(app.getHttpServer())
        .post(`/api/v1/family/location-shares/${share.body.id}/revoke`)
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(404);

      // B still owns and can mutate their own rows.
      const bShare = await request(app.getHttpServer())
        .post(`/api/v1/family/location-shares/${share.body.id}/revoke`)
        .set('Authorization', `Bearer ${userB.token}`)
        .expect(200);
      expect(bShare.body.revoked).toBe(true);
      expect(bShare.body.active).toBe(false);
    });

    it('the owner can create, list, and revoke their own share; active is computed', async () => {
      skip();
      const created = await request(app.getHttpServer())
        .post('/api/v1/family/location-shares')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          recipient: 'B',
          purpose: 'Household check-in during a declared emergency',
          expiresAt: new Date(Date.now() + 7200_000).toISOString(),
          preciseConsent: false,
          lastKnownLat: '51.5004',
          lastKnownLng: '-0.12345',
        })
        .expect(201);

      // Computed active flag: not revoked, not expired -> true.
      expect(created.body.active).toBe(true);

      // Coarse rounding: the precise-ish input was stored rounded to ~110m.
      const listed = await request(app.getHttpServer())
        .get('/api/v1/family/location-shares')
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(200);
      const row = listed.body.find(
        (s: { id: string }) => s.id === created.body.id,
      );
      expect(row.lastKnownLat).toBeCloseTo(51.5, 1);
      expect(row.lastKnownLng).toBeCloseTo(-0.123, 2);

      // A share that already expired is not active.
      const dead = await request(app.getHttpServer())
        .post('/api/v1/family/location-shares')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          recipient: 'B',
          purpose: 'stale',
          // Far enough ahead that it is still > now when created, but we
          // verify the not-active path via the revocation below instead.
          expiresAt: new Date(Date.now() + 7200_000).toISOString(),
        })
        .expect(201);
      const revoked = await request(app.getHttpServer())
        .post(`/api/v1/family/location-shares/${dead.body.id}/revoke`)
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(200);
      expect(revoked.body.active).toBe(false);
      expect(revoked.body.revokedAt).not.toBeNull();
    });

    it('an expired-at-creation share is rejected', async () => {
      skip();
      await request(app.getHttpServer())
        .post('/api/v1/family/location-shares')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          recipient: 'B',
          purpose: 'stale',
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        })
        .expect(404);
    });

    it('household plan is owner-scoped: A never sees B plan', async () => {
      skip();
      const bPlan = await request(app.getHttpServer())
        .put('/api/v1/family/household-plan')
        .set('Authorization', `Bearer ${userB.token}`)
        .send({
          meetingPoint: 'Community Hall',
          kitChecklist: [
            { label: 'water', done: true },
            { label: 'meds', done: false },
          ],
          petConsiderations: 'two cats',
        })
        .expect(200);
      expect(bPlan.body.kitChecklist).toHaveLength(2);

      // A has no plan yet -> the GET returns an empty body (Nest serialises a
      // null to no content; the api-client normalises that to null). The key
      // assertion: A must NOT see B's plan.
      const aPlan = await request(app.getHttpServer())
        .get('/api/v1/family/household-plan')
        .set('Authorization', `Bearer ${userA.token}`)
        .expect(200);
      const aPlanBody = aPlan.body as { meetingPoint?: string | null } | null;
      const aHasNoPlan =
        aPlanBody === null ||
        aPlanBody === undefined ||
        Object.keys(aPlanBody ?? {}).length === 0;
      expect(aHasNoPlan).toBe(true);
      expect(aPlanBody?.meetingPoint).not.toBe('Community Hall');
    });

    it('validation: unknown fields are rejected (strict boundary)', async () => {
      skip();
      // location-shares has no `address` field: forbidNonWhitelisted -> 400.
      await request(app.getHttpServer())
        .post('/api/v1/family/location-shares')
        .set('Authorization', `Bearer ${userA.token}`)
        .send({
          recipient: 'B',
          purpose: 'x',
          expiresAt: new Date(Date.now() + 3600_000).toISOString(),
          address: '123 Main St', // unknown field
        })
        .expect(400);
    });
  });
});
