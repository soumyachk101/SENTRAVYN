/**
 * E2E shared-app throttle relaxation (Phase 9, SECURITY.md section 3).
 *
 * Phase 9 added a global Redis-backed ThrottlerGuard. Its `auth` surface is
 * deliberately tight in production (default 15 req/60s + a 300s block) because
 * /auth/login is the bcrypt-cost-12 DoS-critical route. But the e2e suites
 * (admin, guides, family, places, ingest, auth, mfa-sessions) all call /auth/*
 * from 127.0.0.1 against the SAME shared Redis, and run in parallel jest
 * workers, so the shared throttle counters would be exceeded collectively and
 * one spec's 300s block window would 429 every other spec's logins.
 *
 * This setup file — registered via `setupFiles` in jest-e2e.config.js, so it
 * runs before any spec boots its shared AppModule — sets PERMISSIVE limits on
 * the shared app for the whole suite (effectively unlimited: the per-window
 * caps below can never be reached by the e2e request volume, so no spec is
 * ever throttled by a neighbour's traffic). It only sets a variable when the
 * caller did not already provide one, so a CI job or local run can still
 * tighten it externally.
 *
 * This relaxes the SHARED test app only; it does not touch the production
 * defaults in src/common/throttling/throttling.module.ts. The dedicated
 * rate-limit assertion (test/e2e/mfa-sessions.e2e-spec.ts) boots its OWN app
 * instance with strict THROTTLE_* values on a dedicated client IP and asserts
 * the real 429 + block behaviour — so the security control itself is still
 * exercised end to end. The production-default unit assertion lives in
 * test/throttling-config.spec.ts and is unaffected.
 */
const SHARED_E2E_LIMIT = '1000000';

if (process.env.THROTTLE_DEFAULT_LIMIT === undefined) {
  process.env.THROTTLE_DEFAULT_LIMIT = SHARED_E2E_LIMIT;
}
if (process.env.THROTTLE_AUTH_LIMIT === undefined) {
  process.env.THROTTLE_AUTH_LIMIT = SHARED_E2E_LIMIT;
}

export {};
