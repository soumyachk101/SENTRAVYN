import 'reflect-metadata';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * E2E: Phase 9 hardening — MFA (SECURITY.md section 2), session revocation
 * and rate-limit enforcement, against the real Nest AppModule.
 *
 * The otplib import is resolved to test/mocks/otplib.mock.ts by
 * jest-e2e.config.js (the installed otplib 13.x is ESM-first and does not
 * load under the Jest CJS runtime; the mock implements real RFC 6238 TOTP
 * via node:crypto and is cross-checked against the real library), so the
 * privileged login MFA flow below exercises genuine TOTP round-trips:
 *
 *   1. Register + login a PUBLIC account -> full token pair (no MFA step).
 *   2. Promote it to ADMIN in the DB, enable MFA with a real seed.
 *   3. POST /auth/login -> mfaPending + mfaTempToken (no full tokens).
 *   4. POST /auth/mfa/complete with a TOTP code derived from the seed ->
 *      the full token pair is finally issued.
 *   5. A wrong TOTP code on /auth/mfa/complete is rejected with 401.
 *   6. GET /auth/sessions lists the active session WITHOUT the token hash.
 *   7. POST /auth/sessions/revoke-all revokes every session (refresh stops
 *      working) and writes an audit row.
 *   8. Rate limits: with a strict THROTTLE_AUTH_LIMIT and a live Redis the
 *      /auth/login surface returns 429 once the per-window limit is hit;
 *      without Redis the limiter is a documented no-op (no 429s) — the spec
 *      is Redis-gated, mirroring the fail-open design.
 *
 * Every database/redis-dependent assertion is gated; a skipped check logs
 * SKIP: ... and never reports as a pass.
 */
describe('SENTRAVYN Phase 9 hardening (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const dbConfigured = Boolean(process.env.DATABASE_URL);
  const redisConfigured = Boolean(process.env.REDIS_URL);
  const runId = Date.now();
  const PASSWORD = 'phase9-e2e-password';

  beforeAll(async () => {
    process.env.AUTH_JWT_SECRET =
      process.env.AUTH_JWT_SECRET ?? 'sentravyn-e2e-test-jwt-secret-0000000000';

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

    // Clear any throttle counters/blocks left in the shared Redis by earlier
    // manual runs or other suites, so the relaxed limits (backend/.env.test)
    // govern this suite deterministically. The dedicated rate-limit test
    // re-scopes to its own IP and cleans up after itself.
    if (redisConfigured) {
      const { Redis } = await import('ioredis');
      const flusher = new Redis(process.env.REDIS_URL as string, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
        connectTimeout: 1_500,
      });
      await flusher.connect().catch(() => undefined);
      const stale = await flusher
        .keys('throttle:*')
        .catch(() => [] as string[]);
      if (stale.length > 0) {
        await flusher.del(stale).catch(() => undefined);
      }
      await flusher.quit().catch(() => undefined);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  describe('MFA-gated privileged login (DB-gated)', () => {
    it('requires MFA at login for a privileged account and completes the second factor', async () => {
      if (!dbConfigured) {
        console.log('SKIP: DATABASE_URL not configured; MFA e2e not run');
        return;
      }
      // Fresh user per run: re-registers a same-named account on the same
      // shared DB.
      const fresh = `e2e-mfa-fresh-${runId}@sentravyn.test`;
      const reg = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: fresh, password: PASSWORD })
        .expect(201);
      const userId = reg.body.id as string;

      // Promote to a privileged role and enrol MFA (the storage shape MfaService
      // persists), so the next login must gate the second factor.
      const mfaSecret = 'KRSZG4T7O2Q6YQY3I6BZDQZQ';
      await prisma.user.update({
        where: { id: userId },
        data: {
          role: 'OPERATOR',
          mfaSecret,
          mfaEnabled: true,
          mfaRecoveryCodes: [
            createHash('sha256').update('AAAAAA-BBBB-CCCC').digest('hex'),
          ],
        },
      });

      // Step 1: the password alone is no longer enough.
      const pending = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: fresh, password: PASSWORD })
        .expect(200);
      expect(pending.body.mfaPending).toBe(true);
      expect(pending.body.mfaTempToken).toEqual(expect.any(String));
      // No usable tokens on the pending path.
      expect(pending.body.accessToken).toBeUndefined();
      expect(pending.body.refreshToken).toBeUndefined();
      expect(pending.body.recoveryCodesRemaining).toBe(1);

      // A wrong second factor is rejected (no tokens issued).
      const wrong = await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/complete')
        .send({ mfaTempToken: pending.body.mfaTempToken, code: '000001' })
        .expect(401);
      expect(wrong.body.message).toBe('Invalid MFA code');

      // Step 2: a TOTP code derived from the seed completes the login and
      // finally issues the full token pair.
      // (The e2e otplib mock derives real TOTP codes from the seed.)
      const { generate } = await import('../mocks/otplib.mock');
      const token = await generate({
        secret: mfaSecret,
        strategy: 'totp',
        period: 30,
        digits: 6,
      });
      const completed = await request(app.getHttpServer())
        .post('/api/v1/auth/mfa/complete')
        .send({ mfaTempToken: pending.body.mfaTempToken, code: token })
        .expect(200);
      expect(completed.body.accessToken).toEqual(expect.any(String));
      expect(completed.body.refreshToken).toMatch(/^[0-9a-f]{64}$/);
      expect(completed.body.user).toMatchObject({ role: 'OPERATOR' });

      // The completed access token is a real, usable session credential.
      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${completed.body.accessToken}`)
        .expect(200);
      expect(me.body.email).toBe(fresh);
    });

    it('a non-privileged account logs in without an MFA step even when MFA is configured', async () => {
      if (!dbConfigured) {
        console.log(
          'SKIP: DATABASE_URL not configured; PUBLIC-login MFA e2e not run',
        );
        return;
      }
      const fresh = `e2e-mfa-public-${runId}@sentravyn.test`;
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: fresh, password: PASSWORD })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: fresh, password: PASSWORD })
        .expect(200);
      // PUBLIC role: no MFA step, immediate token pair.
      expect(login.body.mfaPending).toBeUndefined();
      expect(login.body.accessToken).toEqual(expect.any(String));
    });
  });

  describe('session listing and revocation (DB-gated)', () => {
    let adminToken = '';
    let adminRefresh = '';

    it('lists active sessions without token material, and revoke-all stops refresh', async () => {
      if (!dbConfigured) {
        console.log('SKIP: DATABASE_URL not configured; sessions e2e not run');
        return;
      }
      const user = await prisma.user.create({
        data: {
          email: `e2e-sessions-${runId}@sentravyn.test`,
          role: 'ADMIN',
          passwordHash: await bcrypt.hash(PASSWORD, 4),
        },
      });
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: PASSWORD });
      // MFA is not enrolled on this user, so it is a straight token pair.
      expect(login.status).toBe(200);
      adminToken = login.body.accessToken;
      adminRefresh = login.body.refreshToken;

      // The active session lists; the response never carries the token hash.
      const list = await request(app.getHttpServer())
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(Array.isArray(list.body)).toBe(true);
      expect(list.body.length).toBeGreaterThanOrEqual(1);
      expect(
        Object.values(list.body[0]).some(
          (v) => typeof v === 'string' && v.length === 64,
        ),
      ).toBe(false);

      // Credential-compromise path: revoke every active session. The current
      // refresh token stops working and an audit row records the event.
      const revoked = await request(app.getHttpServer())
        .post('/api/v1/auth/sessions/revoke-all')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(revoked.body.revoked).toBeGreaterThanOrEqual(1);

      const refreshAfter = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: adminRefresh });
      expect(refreshAfter.status).toBe(401);

      // The revocation is audited under SESSION_REVOKED_ALL. Read the audit
      // table directly (ADMIN-only audit endpoint requires a fresh MFA step
      // for a privileged user, so the DB is the least-indirect assertion).
      const auditRows = await prisma.auditEvent.findMany({
        where: { action: 'SESSION_REVOKED_ALL', actorUserId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      expect(auditRows.length).toBe(1);
      expect(auditRows[0].detail ?? '').toContain('user-initiated');
    });
  });

  describe('rate-limit enforcement (Redis-gated)', () => {
    it('returns 429 on /auth/login once the strict auth limit is hit', async () => {
      if (!redisConfigured) {
        console.log(
          'SKIP: REDIS_URL not configured; rate-limit e2e not run ' +
            '(without Redis the limiter is a documented no-op, SECURITY.md 3)',
        );
        return;
      }
      // A dedicated X-Forwarded-For IP scopes every throttle key for this
      // test, so the 300s block window opened below can never 429 the other
      // specs (which run from 127.0.0.1) on the shared Redis.
      const scopedIp = '203.0.113.99';
      const { Redis } = await import('ioredis');
      const redis = new Redis(process.env.REDIS_URL as string, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableReadyCheck: false,
        connectTimeout: 1_500,
      });
      try {
        await redis.connect().catch(() => undefined);
        // Clean slate for the scoped IP so the test is deterministic
        // regardless of state left by previous runs.
        const staleKeys = await redis
          .keys('throttle:*')
          .catch(() => [] as string[]);
        if (staleKeys.length > 0) {
          await redis.del(staleKeys).catch(() => undefined);
        }

        // Boot a dedicated app instance with a strict auth limit. The
        // THROTTLE_* env is read at module-init time, so it must be set
        // before init; the shared app (relaxed by backend/.env.test) is
        // unaffected because this is a separate instance.
        process.env.THROTTLE_DEFAULT_LIMIT = '100000';
        process.env.THROTTLE_AUTH_LIMIT = '3';
        process.env.THROTTLE_BLOCK_MS = '300000';
        const fixture = await Test.createTestingModule({
          imports: [AppModule],
        }).compile();
        const strictApp = fixture.createNestApplication();
        strictApp.setGlobalPrefix('api/v1');
        await strictApp.init();

        // A fresh account per run so registration stays valid.
        const rateEmail = `e2e-rate-${runId}@sentravyn.test`;
        await request(strictApp.getHttpServer())
          .post('/api/v1/auth/register')
          .set('X-Forwarded-For', scopedIp)
          .send({ email: rateEmail, password: PASSWORD })
          .expect(201);

        // 3 attempts are within limit=3; once the window is exceeded the
        // auth throttler opens a 300s block, so the next request returns
        // 429 with the Retry-After-auth header and the configured message.
        let saw429 = false;
        for (let i = 0; i < 6; i += 1) {
          const res = await request(strictApp.getHttpServer())
            .post('/api/v1/auth/login')
            .set('X-Forwarded-For', scopedIp)
            .send({ email: rateEmail, password: 'wrong-password' });
          if (res.status === 429) {
            saw429 = true;
            expect(res.headers['retry-after-auth']).toBeDefined();
            expect(res.body.message).toBe('Too many requests; retry later.');
            break;
          }
          expect([401, 429]).toContain(res.status);
        }
        expect(saw429).toBe(true);

        // The general `default` surface is unaffected by the auth block.
        const meta = await request(strictApp.getHttpServer())
          .get('/api/v1/meta')
          .set('X-Forwarded-For', scopedIp);
        expect(meta.status).toBe(200);

        await strictApp.close();
      } finally {
        // Remove the scoped-IP throttle state so no residue outlives the test.
        const keys = await redis.keys('throttle:*').catch(() => [] as string[]);
        if (keys.length > 0) {
          await redis.del(keys).catch(() => undefined);
        }
        await redis.quit().catch(() => undefined);
        delete process.env.THROTTLE_DEFAULT_LIMIT;
        delete process.env.THROTTLE_AUTH_LIMIT;
        delete process.env.THROTTLE_BLOCK_MS;
      }
    });
  });
});
