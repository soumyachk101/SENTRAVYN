# SENTRAVYN Phase 2 Plan — Trust and Identity

This document captures the Phase 2 design before implementation. It maps the roadmap scope to workstreams with explicit file ownership, fixes the technical decisions, and lists the delivery gates that apply. Decisions in section 3 are fixed; implementation follows them without inventing alternatives.

The workstream entries in section 2 each carry an "As-built" note, and sections 4, 6 and 7 record how the planned inconsistencies were resolved, what was deferred, and the current evidence status, so this document remains an accurate record of what actually shipped, not only of what was planned.

References:

- `docs/ROADMAP.md` Phase 2 (scope, gate)
- `docs/SECURITY.md` sections 2, 6, 8 (identity, audit, threat model)
- `docs/ARCHITECTURE.md` sections 4, 5, 7, 8 (modules, data model, provenance, API standards)
- `docs/DATA-SOURCES.md` (provider register, fixture basis)
- `docs/DELIVERY-GATES.md` (gates B, C, E)
- `backend/prisma/schema.prisma` (Phase 1 baseline: `Role` enum, `User`, `AuditEvent`, `DataProvider`, `RawSourceRecord`)
- Phase 1 backend modules: `health`, `alerts`, `prisma` in `backend/src`

## 1. Scope

Phase 2 roadmap deliverables, mapped to this plan:

- Authentication and sessions: local email + password auth with bcryptjs, short-lived JWT access tokens, rotating revocable refresh tokens (workstreams W2, W3).
- Roles and permissions: `RolesGuard` over the Prisma `Role` enum, least-privilege enforcement on admin routes (W2, W4).
- Audit event framework: injectable `AuditService` writing to the existing `AuditEvent` model; privileged actions are audited (W2).
- Data provider registry: ADMIN-restricted CRUD over `DataProvider`, fixture seed for GDACS, USGS, Copernicus per `docs/DATA-SOURCES.md` (W5).
- Provenance model: idempotent `RawSourceRecord` upsert keyed on `providerId + sourceId + payloadHash` (W2, W5).
- Place verification model: `PlaceVerification` and `ShelterVerification` enums and attributes already exist in the schema (ADR-006). Phase 2 adds the admin review foundations that drive state transitions for those enums; no new verification table is introduced in this phase (W5).
- Admin review foundations: admin module with REVIEWER/OPERATOR review actions and audit capture, restricted by role (W5).

Roadmap gate for Phase 2: "Authorisation and audit tests pass" — satisfied by `test/auth.service.spec.ts`, `test/rbac.spec.ts` and `test/audit.spec.ts` plus the gate checklist in section 5. Evidence status as of this revision: see section 7 (unit tests and the DB-gated e2e run both PASS as recorded there).

## 2. Workstreams and file ownership

Each file below is owned by exactly one head. Schema changes land in a single new migration so the other workstreams build against it.

### W1 — Schema and migrations (Walter)

- `backend/prisma/schema.prisma` and the new migration under `backend/prisma/migrations/`:
  - `User`: add `passwordHash String?` (null until a user chooses credentials; keeps OIDC users representable later).
  - New `Session` model: `id`, `userId` (relation to `User`, `onDelete: Cascade`), `refreshTokenHash String` (hashed, never store the raw token), `expiresAt DateTime`, `revokedAt DateTime?`, `createdAt`, `updatedAt`, `@@index([userId])`, `@@index([expiresAt])`.
  - `RawSourceRecord`: add `@@unique([providerId, sourceId, payloadHash])` so the provenance upsert is idempotent by database constraint.
- No other workstream edits the schema or writes migrations.

As-built: migration `20260212000001_phase2_trust_identity` created the `Session` table and added `User.passwordHash`, with two deliberate deviations from the plan above: the refresh-token column is `tokenHash` (`String @unique`, sha256 hex — the unique constraint serves the refresh lookup) instead of `refreshTokenHash` with `@@index([expiresAt])`, plus optional `userAgent`/`ip` columns. The `RawSourceRecord @@unique([providerId, sourceId, payloadHash])` constraint initially not added in that migration — idempotency was enforced by the application-level upsert in `backend/src/common/provenance/provenance.ts` (hash comparison on the most recent row; replay returns the existing row unchanged, a new immutable row is created when the hash differs) — and was subsequently added as the write-path backstop in migration `20260213000001_phase2_rawsource_unique` (see the security-review deferrals: read-path re-hash-and-verify remains deferred). `provenance.spec.ts` covers both paths.

### W2 — Audit module (Ada)

- `backend/src/audit/audit.module.ts`, `backend/src/audit/audit.service.ts`
  - `AuditService.record(actorId, action, entity, entityId, detail)` writes one `AuditEvent` row via `PrismaService`.
  - Injectable globally: `AuditModule` exposes `AuditService`; other modules import it.
  - `action` values are stable strings (`provider.create`, `provider.update`, `provider.delete`, `alert.review`, `user.role_change`, ...); no personal data beyond `actorId` and structured `detail` JSON.
- `backend/test/audit.spec.ts`: records rows for the above actions, `actorId` is nullable (system actor), timestamps are stored.

As-built: shipped as planned, with two additions: an `AuditController` (`GET /admin/audit`, ADMIN-only, paged read of recent `AuditEvent` rows) and an `AUDIT_ACTIONS` constants map in `audit.service.ts` that names the canonical action strings (`PROVIDER_CHANGED`, `ALERT_PUBLISHED`, ..., `USER_ROLE_CHANGED`, `SESSION_REVOKED`); the provider and admin-review services reference these constants rather than raw strings.

### W3 — Auth module (Otto)

- `backend/src/auth/`: `auth.module.ts`, `auth.service.ts`, `auth.controller.ts`, `auth.dto.ts`, `jwt.guard.ts`, `refresh.service.ts`
  - Login: verify `passwordHash` with bcryptjs, issue a short-lived JWT access token (claims: `sub` = user id, `role`) signed with `AUTH_JWT_SECRET` via `@nestjs/jwt`, and a rotating refresh token persisted as `Session.refreshTokenHash`.
  - Refresh: look up the session, verify the presented token hash, rotate (invalidate old row state, issue new token). Revocation marks `revokedAt` and prevents refresh.
  - `AUTH_JWT_SECRET` is required from the environment; missing or weak secret fails startup.
- `backend/package.json` (backend deps only): add `@nestjs/jwt`, `bcryptjs`; add `@types/bcryptjs` as devDependency. No other package manifests change.
- `backend/test/auth.service.spec.ts`: password verify, token issue/refresh/rotate/revoke, expired-session rejection, unknown-user rejection.
- The new `AUTH_JWT_SECRET` line in the root `.env.example` is owned by the lead (integration step), not Otto.

As-built: shipped in `backend/src/auth/` as `auth.module.ts`, `auth.service.ts`, `auth.controller.ts` and `guards/jwt-auth.guard.ts`; the planned `auth.dto.ts` and `refresh.service.ts` were not created — DTO classes live inline in `auth.controller.ts`, and refresh/rotation and session revocation are methods on `AuthService` (in-place rotation rewrites `Session.tokenHash`; `logout` marks `revokedAt`). The guard is a per-route Bearer guard (`JwtAuthGuard`), not a module-level global, and audit reads `request.user` populated by it; `AUTH_JWT_SECRET` is resolved per request from `ConfigService` and missing/empty values fail closed at token issue/verify time. `backend/package.json` gained `@nestjs/jwt` and `bcryptjs` (3.x, which ships its own types, so the planned `@types/bcryptjs` devDependency was not needed). The plan's OIDC-era `AUTH_*` variables (`AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, ...) were not shipped: the shipped decision is local email + password with bcryptjs (cost 12), 15-minute JWT access tokens and 30-day rotating opaque refresh tokens whose sha256 hex is stored in `Session.tokenHash`. The root `.env.example` was updated accordingly: the OIDC block is gone, `AUTH_JWT_SECRET=` remains with a generate/comment, and `docs/ROADMAP.md` Phase 2 status records the same decision. `auth.service.spec.ts` covers the listed behaviours, including the fail-closed unset-secret case.

### W4 — RBAC guards (Nova)

- `backend/src/common/rbac/roles.decorator.ts`, `backend/src/common/rbac/roles.guard.ts`
  - `@Roles(...)` decorator plus `RolesGuard` (applied where routes demand it, or globally in the module that imports it): reads the JWT-subjected user, loads `User.role` from Prisma (does not trust the token claim alone for privileged roles; the guard re-checks the persisted role), then enforces against the required `Role` values.
  - `PUBLIC` is the default posture: unauthenticated requests are allowed only on routes without a `@Roles` guard.
- `backend/test/rbac.spec.ts`: matrix of roles (`PUBLIC`, `REVIEWER`, `OPERATOR`, `ADMIN`) against allowed/denied route requirements, plus revoked/expired token denial.

As-built: shipped as `roles.decorator.ts`, `roles.guard.ts` plus two additions, `rbac.constants.ts` (`HIERARCHY`) and `current-user.decorator.ts` (`@CurrentUser()`). `rbac.spec.ts` covers the role-matrix behaviour and a sync check that the RBAC role union matches the Prisma `Role` enum values. One deliberate deviation: the shipped `RolesGuard` enforces roles from the authenticated user's JWT role claim (expanded via the privilege hierarchy, fail-closed when `request.user`/role is missing) and does not re-read the persisted `User.role` from Prisma as the plan text described — so a changed or revoked role only takes effect at the next token rotation, not on every request. This is the as-built behaviour that this plan documents; the residual gap against `docs/SECURITY.md` section 2 ("Role-based access control and least privilege") is flagged for the lead rather than silently closed here.

### W5 — Admin review, provider registry, provenance (Remy)

- `backend/src/providers/providers.module.ts`, `providers.controller.ts`, `providers.service.ts`, `providers.dto.ts`
  - CRUD over `DataProvider`; every route is `@Roles(ADMIN)`; every mutation calls `AuditService.record`.
  - No live provider keys in code; registry stores `docUrl`, license, attribution, `enabled` flags and `freshnessPolicyHours`.
- `backend/prisma/seed.ts` (fixture seed): deterministic DataProvider rows for GDACS, USGS and Copernicus (names, official doc URLs, categories, licenses/attribution per `docs/DATA-SOURCES.md`), all `enabled: false`.
- `backend/src/common/provenance/provenance.service.ts`, `provenance.module.ts`
  - `upsertRawSourceRecord(providerId, sourceId, payload)`: computes `payloadHash` (sha256 hex), upserts on the `@@unique([providerId, sourceId, payloadHash])` key, preserves original `sourceId`, `sourceUrl` and verbatim `rawPayload` (ADR-007: immutable after ingest).
- `backend/src/admin/admin.module.ts`, `admin.controller.ts`, `admin.service.ts`
  - Review foundations: REVIEWER and OPERATOR actions that move `Alert.verification` / `Place.verification` / `ShelterProfile.verification` along their enums, each action written through `AuditService.record`; role-change endpoint restricted to ADMIN.
- Tests: `backend/test/providers.spec.ts` (ADMIN-only access, seed contents, audit rows), `backend/test/provenance.spec.ts` (idempotent upsert, hash-keyed dedup, payload preservation), `backend/test/admin.spec.ts` (role transitions, audit capture).

As-built: the provider registry shipped in `backend/src/providers/` (`providers.module.ts`, `providers.controller.ts`, `providers.service.ts`, `providers.dto.ts`) with `GET /providers` open to any authenticated role and mutating routes (`POST /providers`, `POST /providers/seed`, `PATCH /providers/:key/enable`, `PATCH /providers/:key/disable`) restricted to `@Roles('ADMIN')`. The planned `backend/prisma/seed.ts` file was not created; fixture seeding instead lives behind the ADMIN-only `POST /providers/seed` endpoint, using `PHASE2_SEED_PROVIDERS` (GDACS, USGS, Copernicus EMS/EMDAT rows, all `enabled: false`, doc URLs from `docs/DATA-SOURCES.md` section 1, `license` deliberately `null` pending legal review). Provenance shipped as a single file `backend/src/common/provenance/provenance.ts` (no separate `provenance.module.ts`), exporting `payloadHash` and `upsertRawRecord` (a plain function taking the Prisma client so it is unit-testable against a stub). Admin review shipped as `backend/src/admin/admin-review.{module,controller,service,dto}.ts`: `GET /admin/review/queue?kind=alerts|places` and `POST /admin/review/decide`, both `@Roles('REVIEWER','OPERATOR','ADMIN')` with a decision persisted as an immutable `AdminReviewDecision` row plus an `AuditService.record` call; the planned standalone ADMIN role-change endpoint was not built (the `USER_ROLE_CHANGED` audit action exists but no route writes it yet). Tests are `providers.spec.ts`, `provenance.spec.ts` and `admin-review.spec.ts` (the plan's `admin.spec.ts` landed under this name).

### Integration step (lead, after heads return)

- Register `AuthModule`, `AuditModule`, `RbacModule` (or apply `RolesGuard` where needed), `ProvidersModule` and `AdminModule` in `backend/src/app.module.ts`. That file is owned by the lead; no head edits it.
- Add `AUTH_JWT_SECRET=` to the root `.env.example` (and a note that OIDC-era `AUTH_*` vars remain until auth is finalised).
- Heads' modules are self-contained and import `PrismaModule`/`AuditModule` themselves; registration is additive.

As-built: `backend/src/app.module.ts` registers `AuthModule`, `AuditModule`, `ProvidersModule` and `AdminReviewModule` directly — confirmed against the file. There is no standalone `RbacModule`: `RolesGuard` (a stateless metadata reader, `backend/src/common/rbac/roles.guard.ts`) is applied per-controller via `@UseGuards(JwtAuthGuard, RolesGuard)` on the providers, admin-review and audit controllers, and `JwtAuthGuard`/`AuthService` are resolved through `AuthModule`'s global `JwtModule.registerAsync` export. `.env.example` gained `AUTH_JWT_SECRET=` with a generation comment; no OIDC-era `AUTH_*` vars remain in the template.

## 3. Decisions (fixed)

- Auth: local email + password with bcryptjs hashing.
- Access tokens: short-lived JWTs via `@nestjs/jwt`, signed with the `AUTH_JWT_SECRET` env var.
- Sessions: rotating refresh tokens stored in a new Prisma `Session` model; sessions are revocable (mark `revokedAt`; revoked sessions cannot refresh).
- RBAC: `RolesGuard` reads the JWT-subjected user's role; roles come from the Prisma `Role` enum (`PUBLIC`, `REVIEWER`, `OPERATOR`, `ADMIN`).
- Audit: injectable `AuditService.record(actorId, action, entity, entityId, detail)` writing to the existing `AuditEvent` model.
- Provider registry: CRUD over `DataProvider`, restricted to `ADMIN`; fixture seed covers GDACS, USGS and Copernicus per `docs/DATA-SOURCES.md` (doc URLs only, no live keys in code, all `enabled: false`).
- Provenance: `RawSourceRecord` upsert keyed on `providerId + sourceId + payloadHash` (sha256); idempotent.

## 4. Inconsistencies found (docs vs Phase 1 code)

Confirmed (verified in the working tree at planning time; all four resolved as shipped — resolutions are annotated inline in the items below, with details in the W1, W3, W5 and integration-step as-built notes):

- `backend/prisma/schema.prisma` has no credential field on `User` and no `Session` model; W1 adds both. Without W1's migration first, W2/W3 cannot build. (Resolved: shipped in migration `20260212000001_phase2_trust_identity`.)
- `RawSourceRecord` currently has only a non-unique index on `[providerId, sourceId]` and no `payloadHash`-based uniqueness; the fixed provenance upsert requires the new `@@unique` constraint from W1. (Resolved as-built: the constraint was added as migration `20260213000001_phase2_rawsource_unique`; application-level idempotency in `provenance.ts` remains the primary check, and read-path re-hash-and-verify is recorded as a deferral in section 6 — see the W1 as-built note.)
- The root `.env.example` still describes auth via OIDC (`AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, ...), while the Phase 2 decision is local email + password with `AUTH_JWT_SECRET`; the template gains `AUTH_JWT_SECRET` in the integration step. (Resolved: the template now carries `AUTH_JWT_SECRET=` with a generation comment and no OIDC-era `AUTH_*` vars; see the W3 as-built note.)
- No seed file exists yet (`backend/prisma/seed.ts` is new in W5); CI does not run seeds, so the seed is a dev/local fixture and its presence is asserted by tests, not by the pipeline. (Resolved as-built: no `seed.ts` was created; fixtures ship behind `POST /providers/seed` instead — see the W5 as-built note.)

Each of the four confirmed items above was verified against the Phase 1 tree and is resolved by the shipped work (the resolutions are annotated inline). They are kept here as history, not as open defects.

Assumption (not verified beyond reading the docs):

- The roadmap item "Place verification model" is read as extending the review workflow over the ADR-006 verification enums already on `Place`/`ShelterProfile`, not as a new standalone `Verification` table, even though `ARCHITECTURE.md` section 5 lists `Verification` among data model concepts. W5 implements the workflow; a dedicated table would be a later-phase decision.

## 5. Gate checklist (Phase 2 applicable items)

Gate B — Functionality

- [ ] Permissions are handled: `@Roles` guards enforced on all admin/provider routes; role matrix covered in `test/rbac.spec.ts`.
- [ ] API calls handle failure: auth endpoints return structured error envelopes for bad credentials, expired/revoked sessions and missing secret.
- [ ] No placeholder endpoint represented as complete: every W3–W5 route is implemented against Prisma; seed data is labelled fixture data.
- [ ] No fabricated live data: provider registry is `enabled: false`; no fetch status is reported for seeded rows.

Gate C — Backend and data

- [ ] DTO/schema validation: `class-validator` DTOs on auth, providers and admin endpoints.
- [ ] Database constraints and migrations: W1 migration (Session table, `User.passwordHash`) applied via `prisma migrate`; the `RawSourceRecord` unique key was added as migration `20260213000001_phase2_rawsource_unique` (write-path backstop).
- [ ] Idempotent ingestion: provenance upsert is application-level (hash-keyed dedup in `provenance.ts`, replay returns the existing row), backed by the `@@unique([providerId, sourceId, payloadHash])` constraint; safe to replay.
- [ ] Source provenance: `RawSourceRecord` preserves `sourceId`, `sourceUrl`, `rawPayload` verbatim; `AuditEvent` records privileged mutations.
- [ ] Authorisation tests: `test/rbac.spec.ts` and `test/providers.spec.ts` (ADMIN-only) pass.
- [ ] Audit history: `test/audit.spec.ts` proves rows are written for privileged actions; `AuditEvent` indexes remain sufficient for review lookups.

Gate E — Safety and security

- [ ] Privileged actions audited: provider mutations and review state transitions call `AuditService.record`; `USER_ROLE_CHANGED` is a defined audit action but no route writes it yet (see W5 as-built).
- [ ] Source and timestamps visible: registry and provenance rows expose `docUrl`, `fetchedAt`/`ingestedAt` semantics; stale session state is revocable.
- [ ] Critical threat-model findings addressed (per `docs/SECURITY.md` section 8): admin account takeover mitigated by rotating, revocable refresh tokens and session revocation; fake-alert injection mitigated by quarantined, hash-keyed provenance with ADMIN-controlled provider enablement; credential reuse mitigated by bcryptjs hashing.
- [ ] No unverified shelter marked safe: review endpoints may only advance states within the existing enums and always record an audit row; a `SHELTER_VERIFIED` decision is only accepted when a verifying authority and an ISO verification date are both present (shelter-policy.ts), so `ShelterVerification.VERIFIED` is stamped only with that evidence.

## 6. Known limitations / deferred

Recorded here and, where noted, in `docs/ROADMAP.md` Phase 2 status:

- Multi-factor authentication for privileged administrators (`docs/SECURITY.md` section 2) is deferred to the Phase 9 hardening phase. Also recorded in the `docs/ROADMAP.md` Phase 2 status paragraph.
- Rate limits and abuse controls (`docs/SECURITY.md` section 3) are not implemented in the Phase 2 API surface.
- Account lockout is not implemented; the login path mitigates account-existence enumeration (constant-time bcrypt comparison against a dummy hash, identical error text) but has no lockout/abuse threshold.
- Session revocation on credential compromise (`docs/SECURITY.md` section 2, "Revoke sessions after credential compromise") is not yet wired to a password-change event: no password-change endpoint exists in Phase 2, so nothing currently revokes a user's other sessions when credentials change.
- CSRF protection (`docs/SECURITY.md` section 3) is not applicable in the current design: authentication is Bearer-token based (Authorization header), not cookie-based, so there is no cross-site request forgery surface to guard.

### Security review deferrals (Phase 2 close-out)

Recorded from the Phase 2 security review; each item is deferred with its severity and where it applies, not silently closed.

- RolesGuard enforces the JWT role claim; a role change or revocation takes effect at the next token rotation (access tokens live 15 minutes; refresh sessions 30 days). Re-checking the persisted `User.role` per request is deferred as a hardening item (severity: medium, applies to `backend/src/common/rbac/roles.guard.ts`). The lead ACCEPTED the token-claim model as the Phase 2 decision; it is not a gap that shipped by accident.
- Credential-compromise session revocation: logout revokes the presenting session only; a revoke-all-sessions path (revoke every `Session` row for a user on password change) is deferred (severity: high, applies to the auth module and any future password-change event, `docs/SECURITY.md` section 2 "Revoke sessions after credential compromise").
- `RawSourceRecord` read-path integrity: `payloadHash` is computed at write time; a re-hash-and-verify helper on read paths is deferred (severity: medium, applies to `backend/src/common/provenance/provenance.ts`). The DB unique constraint on `[providerId, sourceId, payloadHash]` is landing as a write-path backstop in this same phase.
- `SHELTER_STALE` decisions currently record the audit action `SHELTER_REJECTED` (no distinct `SHELTER_STALE` constant); forensic query pollution acknowledged, constant to be added when the alert/shelter audit action set is widened (severity: low, applies to the audit action set in `backend/src/audit/`).
- `AUTH_JWT_SECRET` entropy: documented as random 256-bit but not machine-validated at boot; the e2e suites pin an in-process test secret (severity: low, applies to auth startup and `test/e2e/*`).
- Register/login do not yet write audit rows; deferred to the audit-backfill item alongside `USER_ROLE_CHANGED`, which has no writer yet (severity: medium, applies to `backend/src/auth/` and the audit framework, `docs/SECURITY.md` section 6).

## 7. Evidence status

Status vocabulary: PASS, NOT RUN, FAIL.

- Unit tests (`test/auth.service.spec.ts`, `test/rbac.spec.ts`, `test/audit.spec.ts`, `test/provenance.spec.ts`, `test/providers.spec.ts`, `test/admin-review.spec.ts`): PASS — asserted locally without a database (Prisma is stubbed in these specs). Backend unit suite: 61 passed.
- Fail-closed gating in the e2e specs (`test/e2e/auth.e2e-spec.ts`, `test/e2e/admin.e2e-spec.ts`): PASS — with `DATABASE_URL` unset the specs run, every DB-backed assertion logs `SKIP: DATABASE_URL not configured` instead of being counted as a pass, and the unauthenticated 401 cases still execute.
- DB-gated e2e assertions (register/login/refresh rotation; providers, seed, audit, review-queue and shelter-decision e2e): PASS — executed against local Postgres (`postgis/postgis:16-3.4` via `infrastructure/docker/docker-compose.yml`, host port 5434) after `prisma migrate deploy` applied `20260212000001_phase2_trust_identity` and `20260213000001_phase2_rawsource_unique`; all 22 e2e tests passed. CI re-runs the same steps via its postgres service.
- Phase 2 gate B/C/E evidence (this revision): Gate B (loading/error states, no fabricated live data) exercised in the admin/web UIs and e2e; Gate C (DTO validation, migrations, idempotent seed, provenance, authorisation tests, geospatial NOT RUN — spatial work is Phase 4); Gate E (no unverified shelter marked safe — shelter decision requires authority + ISO date + shelter-policy pass; no expired alert presented as live — freshness labels; audit events for privileged mutations). Known deferrals are recorded in section 6 and do not convert any of the above into a production-readiness claim.

## 8. Exit criteria

- All sections of this plan implemented; modules registered by the lead.
- `pnpm lint`, `pnpm typecheck`, `pnpm test` (backend unit + new specs), `pnpm build` and the CI pipeline are green.
- Phase 2 roadmap gate: authorisation and audit tests pass.
- Remaining known limitations: see section 6 (MFA for privileged administrators, `docs/SECURITY.md` section 2, deferred to Phase 9 hardening; plus the open `docs/SECURITY.md` section 3 items and the security-review deferrals).
- Evidence status: section 7 — unit and DB-gated e2e PASS as recorded; production deployment status: NOT RUN (no deployment claimed).
