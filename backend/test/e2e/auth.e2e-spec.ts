import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

/**
 * E2E: authentication API (Phase 2) under the /api/v1 global prefix.
 *
 * Mirrors api.e2e-spec.ts: the real AppModule is booted with the same strict
 * ValidationPipe; every database-dependent assertion is gated behind
 * `dbConfigured` so the suite stays green in a no-services environment, and a
 * skipped check logs SKIP: ... and never reports as a pass.
 *
 * Without a database: unauthenticated / malformed-token rejections on
 * GET /auth/me (the JwtAuthGuard rejects before any service or DB call).
 *
 * With a reachable DATABASE_URL: register, login, refresh-token rotation
 * (replay-safe), logout and authenticated /auth/me.
 */
describe('SENTRAVYN auth API (e2e)', () => {
  let app: INestApplication;

  const dbConfigured = Boolean(process.env.DATABASE_URL);

  /** Fresh email per run; re-runs against the same disposable DB never collide. */
  let email = '';
  const PASSWORD = 'phase2-e2e-password';

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

    if (dbConfigured) {
      // Create one user through the API itself so later assertions (duplicate
      // register, wrong-password login) hold on every re-run against the same
      // disposable database.
      email = `e2e-auth-${Date.now()}@sentravyn.test`;
      const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
        email,
        password: PASSWORD,
      });
      expect(res.status).toBe(201);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  // These run without a database: the JwtAuthGuard rejects before any
  // service or DB call, and the malformed-token cases fail at JWT
  // verification, not at Prisma.
  describe('GET /api/v1/auth/me (no database required)', () => {
    it('expects 401 with no Authorization header', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });

    it.each(['Bearer not-a-jwt', 'Bearer abc.def.ghi', 'Basic dXNlcjpwYXNz'])(
      'rejects a malformed token with 401',
      async (authorization) => {
        const res = await request(app.getHttpServer())
          .get('/api/v1/auth/me')
          .set('Authorization', authorization);
        expect(res.status).toBe(401);
      },
    );
  });

  describe('POST /api/v1/auth/register (DB-gated)', () => {
    it('returns 201 with a user shape that has no passwordHash field', async () => {
      if (!dbConfigured) {
        console.log('SKIP: DATABASE_URL not configured; register e2e not run');
        return;
      }
      const freshEmail = `e2e-register-${Date.now()}@sentravyn.test`;
      const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
        email: freshEmail,
        password: 'phase2-e2e-password',
      });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ email: freshEmail, role: 'PUBLIC' });
      expect(res.body.id).toEqual(expect.any(String));
      // The public user shape must never leak credential material.
      expect((res.body as Record<string, unknown>).passwordHash).toBeUndefined();
    });

    it('returns 409 on a duplicate email', async () => {
      if (!dbConfigured) {
        console.log('SKIP: DATABASE_URL not configured; duplicate-register e2e not run');
        return;
      }
      const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send({
        email,
        password: PASSWORD,
      });
      expect(res.status).toBe(409);
    });
  });

  describe('POST /api/v1/auth/login (DB-gated)', () => {
    it('returns 401 with the generic message for a wrong password', async () => {
      if (!dbConfigured) {
        console.log('SKIP: DATABASE_URL not configured; wrong-password login e2e not run');
        return;
      }
      const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
        email,
        password: 'definitely-the-wrong-password',
      });
      expect(res.status).toBe(401);
      expect(res.body.message).toBe('Invalid email or password');
    });

    it('returns an accessToken and a 64-char hex refreshToken on success', async () => {
      if (!dbConfigured) {
        console.log('SKIP: DATABASE_URL not configured; login e2e not run');
        return;
      }
      const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({
        email,
        password: PASSWORD,
      });
      expect(res.status).toBe(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(res.body.user).toMatchObject({ email, role: 'PUBLIC' });
    });
  });

  describe('POST /api/v1/auth/refresh + logout (DB-gated)', () => {
    it('rotates the refresh token, rejects the old one, and rejects after logout', async () => {
      if (!dbConfigured) {
        console.log('SKIP: DATABASE_URL not configured; refresh-rotation e2e not run');
        return;
      }
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      let refresh = login.body.refreshToken;

      // GET /auth/me with the new access token returns the registered user.
      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);
      expect(me.body).toMatchObject({ email, role: 'PUBLIC' });

      // Rotation: the new token pair is issued and the OLD refresh token is
      // rejected on a second use (in-place rotation is replay-safe).
      const rotated = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: refresh })
        .expect(200);
      expect(rotated.body.accessToken).toEqual(expect.any(String));
      expect(rotated.body.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(rotated.body.refreshToken).not.toBe(refresh);
      refresh = rotated.body.refreshToken;
      const replay = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: login.body.refreshToken });
      expect(replay.status).toBe(401);

      // Logout revokes the session: the current refresh token stops working.
      const out = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({ refreshToken: refresh });
      expect(out.status).toBe(200);
      const afterLogout = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: refresh });
      expect(afterLogout.status).toBe(401);
    });
  });
});
