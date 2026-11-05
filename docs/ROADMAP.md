# SENTRAVYN Implementation Roadmap

Build incrementally. Each phase has a gate; do not start the next phase with unresolved critical failures.

## Phase 0 — Repository audit and planning

- Inspect current repository and toolchain.
- Confirm product scope and deployment constraints.
- Create architecture decision records.
- Create `DESIGN.md` and threat register.
- Define initial data providers and legal/licensing review.
- Produce milestones, estimates and dependencies.

**Gate:** Auditable plan, architecture and risks accepted.

## Phase 1 — Foundation

- Monorepo and package management.
- Next.js web/admin shells.
- Expo mobile shell.
- NestJS backend.
- PostgreSQL/PostGIS and Redis local environment.
- Shared types and API client.
- CI checks, lint, typecheck and tests.
- Environment and secrets templates.

**Gate:** Reproducible local setup and green baseline pipeline.

## Phase 2 — Trust and identity

- Authentication and sessions.
- Roles and permissions.
- Audit event framework.
- Data provider registry.
- Provenance model.
- Place verification model.
- Admin review foundations.

**Phase 2 status:** Implementation has landed for email and password authentication using bcryptjs, JWT access tokens and rotating database sessions; role-based guards over the PUBLIC/REVIEWER/OPERATOR/ADMIN hierarchy; the audit event framework; a provider registry with the fixtures documented in docs/DATA-SOURCES.md; idempotent raw-record provenance; and the admin review queue with its decisions API. Delivery-gate evidence (the gate B/C/E test runs) is pending final validation by the maintainers, so this status does not claim that the Phase 2 gate has passed. Multi-factor authentication per docs/SECURITY.md section 2 is explicitly deferred to the Phase 9 hardening phase and is recorded here as a known limitation, not as an omission. Known limitations from the Phase 2 security review (token-claim role model, no revoke-all-sessions path, audit-action gaps listed in docs/PHASE-2-PLAN.md) are recorded as deferrals and do not block the Phase 2 gate.

**Gate:** Authorisation and audit tests pass.

## Phase 3 — Alert ingestion

- First documented provider adapter.
- Schema validation and quarantine.
- CAP support where applicable.
- Deduplication and update/cancel lifecycle.
- Freshness and source metadata.
- Admin review and publication.
- Durable alert API.

**Phase 3 status:** implementation has landed for the provider adapter framework (GDACS JSON + generic CAP 1.2 XML), quarantine-by-default ingestion, dedup/update/cancel lifecycle over AlertRevision, verbatim RawSourceRecord provenance, provider fetch bookkeeping, and the durable alert detail API (revisions + provenance + provider freshness policy). Scheduled fetching (BullMQ) remains a Phase 6 item. Delivery-gate evidence (fixture/integration/provenance test runs) is pending final validation by the maintainers, so this status does not claim the Phase 3 gate has passed.

**Gate:** Fixtures, integration tests and source provenance verified.

## Phase 4 — Geospatial and services

- PostGIS queries.
- MapLibre integration.
- Place discovery.
- Distance calculations.
- Verification labels.
- Shelter-specific evidence workflow.
- Stale/unknown states.
- Licensed tile and geocoding provider.

**Phase 4 status (backend):** the places backend has landed. The places API is implemented: `GET /api/v1/places` (paginated list by default, PostGIS radius search when `lat` and `lng` are supplied, with `distanceMeters` and a literal `distanceIsCalculation: true` envelope and the fixed empty-radius coverage note), `GET /api/v1/places/:id` (place detail with its shelter profiles, evidence and the computed read-path label), and `POST /api/v1/places/:id/evidence` (authenticated, any role) which stores a user-submitted `PlaceEvidence` row and records a `PLACE_EVIDENCE_ADDED` audit action without mutating `Place.verification` or `ShelterProfile.verification` (SAFETY-POLICY.md §9). Every returned place carries the 6-value read-path `verificationLabel` (VERIFIED/REVIEWED/UNVERIFIED/STALE/EXPIRED/INCOMPLETE) computed by the shared shelter-policy label engine, so a stored-verified shelter whose evidence has lapsed is downgraded, never shown live (ADR-018). The module is registered in `backend/src/app.module.ts`. Evidence-backed coverage: a mocked-Prisma unit spec and a DB-gated e2e spec assert list/detail/label, distance disclosure, coverage note, the evidence write, the audit row and that verification state is unchanged. The web place-discovery map (MapLibre raster tiles, attribution, no geolocation, ADR-017), the shared-types/API-client contracts and the geocoding/licensed-tile workstream are owned by a separate workstream and are not claimed here. No production tile host or geocoding provider is claimed. The spatial-correctness / no-false-shelter-claim gate remains pending the maintainers' PostGIS-backed test runs.

**Gate:** Spatial correctness and no false shelter claims.

**Phase 4 status (UI):** the web place-discovery map has landed at `apps/web`'s `/map` route (Phase 4, ADR-017). MapLibre GL JS with OpenStreetMap raster tiles (ODbL; attribution is mandatory and rendered in the UI; the tiles are marked dev-only, production-scale usage pending a terms review — no production tile host is claimed). The surface shows per-category marker layers with a legend, manual centre + radius search (no automatic geolocation), verification-state chips that always carry a text label (VERIFIED/UNVERIFIED/STALE/EXPIRED/INCOMPLETE — colour is never the only signal), distance-as-a-calculation disclosure ("~445 m — a calculation, not a safety recommendation"), and an EMPTY / ERROR-retry / OFFLINE / STALE state machine. Mobile gets a bottom-sheet detail panel, not a shrunken desktop. It is wired to the `@sentravyn/api-client` `places` methods against the real a1 service contract (radius mode: `distanceIsCalculation` + `coverageNote`, no pagination; detail: `shelterProfiles`), asserted by a jsdom render test that does not over-test MapLibre's canvas. The map depends on the a1 places route; e2e against that route PASSes once a1 is merged.

## Phase 5 — Safety content

- Reviewed guide schema.
- Version and approval workflow.
- Hazard-specific guide pages.
- Source references and review dates.
- Localization foundation.
- Content freshness and retirement.

**Phase 5 status:** implementation has landed for the reviewed safety-guides
workflow. The `SafetyGuide` / `GuideRevision` schema (ADR-009) now has a
guides module (`backend/src/guides/`) exposing a public surface
(`GET /guides`, `GET /guides/:id` — APPROVED/PUBLISHED only, with a
`lastReviewedAt`-based `stale` flag and per-view freshness label) and a
privileged surface (`/admin/guides`: create, revise, review, approve,
publish, retire, reopen) mirroring the admin-review RBAC pattern. New
revision writes bump `version` and append a `GuideRevision` row in one
transaction; approval/publish are completeness-gated (reviewer + authority +
non-empty references + hazardType). Privileged mutations are audited under the
canonical `GUIDE_*` actions (`AUDIT_ACTIONS`), and the review policy,
responsible role, versioning and retirement rules are documented in
`docs/SAFETY-GUIDES.md`. The public web app has a guide index and detail
page (`/guides`, `/guides/[id]`, hazard tabs, loading/empty/error/offline/
stale states), the admin console has a role-gated `/guides` approval
workflow with the guide audit trail, and the localization foundation
(`@sentravyn/localization`, `en` + `es`) drives the UI chrome while the
`language` column drives content. Delivery-gate evidence: unit tests
(`backend/test/guides.spec.ts`, `audit.spec.ts`), DB-gated e2e
(`backend/test/e2e/guides.e2e-spec.ts`), api-client and localization unit
tests — initial published guide content is still pending a named safety
reviewer, so the Phase 5 gate (safety-reviewer approval of the content
workflow and initial published material) has not been claimed.

**Gate:** Safety reviewer approves content workflow and initial published material.

## Phase 6 — Notifications and offline

- WebSocket live updates.
- Reconnect cursor sync.
- Web Push, FCM and APNs.
- Delivery receipts and retries.
- PWA service worker.
- Offline guides and saved contacts.
- Visible last-sync state.

**Gate:** Offline and reconnect scenarios pass.

**Phase 6 status:** implementation has landed for the real-time layer: an authenticated Socket.IO gateway (`backend/src/notifications/gateway/`) with a durable reconnect-since-cursor sync service that replays missed alert revisions from the DB — never an in-memory ring — so a reconnect can reconstruct the live state; a BullMQ notification worker (`backend/worker/`) that enqueues one idempotent job per published/updated alert (dedup key + bounded retries + dead-letter on terminal failure) and persists the `Notification`/`NotificationAttempt` state machine (PENDING → SENT/DELIVERED/FAILED, receipts and attempts recorded); credential-gated push adapters (Web Push/FCM/APNs behind `backend/src/notifications/push/push-adapters.ts`) that fail soft and never fabricate delivery when provider credentials are absent; and the web PWA layer (`apps/web/public/sw.js`, `PwaRegistrar`, `PwaSyncBanner`) caching reviewed content with a visible last-sync state and cached content labelled not-live. A notification fan-out hook fires on alert publication (admin review) and on the ingest UPDATED path, placed after the controlled provider-enablement gate so a refused fetch can never fan out. Evidence: `backend/test/notifications/` unit specs (cursor replay, queue dedup + retry/dead-letter, publish, gateway) and the live DB-gated e2e suites (8/8, 57/57, zero SKIP) including `places.e2e-spec.ts`/`guides.e2e-spec.ts`/`family.e2e-spec.ts`/`mfa-sessions.e2e-spec.ts`. The offline/reconnect *scenarios* gate is PARTIALLY COMPLETE: reconnect-cursor replay is proven in specs; a full real-browser offline + PWA install run is NOT RUN (no browser in this environment). Push delivery to real FCM/APNs endpoints is NOT RUN (no provider credentials — credential-gated fail-soft is the documented behaviour).

## Phase 7 — Family safety and mobile

- Consent-based location sharing.
- Expiry and revocation.
- Emergency contacts.
- Household plan.
- Expo iOS and Android builds.
- Permission and privacy review.

**Phase 7 status:** family-safety has landed. Backend `backend/src/family-safety` exposes: emergency contacts (`GET/POST/PATCH/DELETE /family/contacts`, owner-scoped object-level authorisation — a user can never read or mutate another user's rows; a foreign id is a 404, not a 403 leak, and is audited); location shares (`POST/GET /family/location-shares` + `POST /family/location-shares/:id/revoke`) with explicit consent, purpose, recipient and a bounded `expiresAt`, a computed read-time `active` flag, coarse-only last-known positions (a precise coordinate is never persisted and no location value reaches the audit log — SECURITY.md §5), immediate irreversible revocation; and the household plan (`GET/PUT /family/household-plan`: meeting point, kit checklist, pet considerations, owner-scoped, validated). Prisma `LocationShare` + `HouseholdPlan` models + a migration. Mobile (`apps/mobile`) builds the family screens on top of the existing `location.ts` consent model and the api-client family methods, with a "share now / stop" control, a last-shared timestamp and an offline note; `App.tsx` is a working section shell, not a dead placeholder. Evidence: a mocked-Prisma unit spec proves user A cannot touch user B's rows, a DB-gated e2e proves object-level isolation and revocation, and a pure precision-helper unit test proves a precise coordinate is only ever transmitted when active AND precise-consented. Device testing is NOT RUN (no emulator here) — see the permission/privacy review notes in `apps/mobile` and the report. The gate (device + privacy review) is therefore PARTIALLY COMPLETE, not passed.

**Gate:** Device testing and privacy review pass.

## Phase 8 — Design completion

- Apply `DESIGN.md` to all surfaces.
- Custom background system.
- Premium typography.
- Responsive layouts.
- Cinematic ASCII footer.
- Accessibility and reduced-motion review.
- Browser/device screenshots.

**Phase 8 status:** the mandated font system now loads for real. Web and admin both load self-hosted `.woff2` (Geist display, Inter body, IBM Plex Mono for technical metadata + the cinematic ASCII footer) via `next/font/local` from `public/fonts/`, and the `--font-display/-body/-mono` token vars are re-pointed at the actually-loaded families instead of system fallbacks (documented: deterministic, no build-time network, no third-party CDN). Multilingual coverage is NOT claimed — these are latin subsets; non-latin users get system fallbacks. The new `/map` page and the mobile family screens honour reduced motion (no animated fly-to — the map uses an instant `jumpTo`; any new animation is behind `prefers-reduced-motion`), use the custom backgrounds + the cinematic ASCII footer (kept intact), no neon, and zero emoji. Responsive behaviour (360/390/768/1024/1440/1920, no horizontal scroll, ≥44px touch targets on the new controls) is implemented in code/CSS; a true 6-viewport device/browser screenshot pass is NOT RUN here — flagged in the report. The gate (visual review at all sizes) is therefore PARTIALLY COMPLETE, not passed.

## Phase 9 — Production hardening

- Load and stress tests.
- Security testing.
- Backup restore.
- Provider outage simulation.
- Queue failure recovery.
- Monitoring and alerting.
- Incident response runbooks.
- Terraform staging and production.
- Legal, privacy and safety review.

**Phase 9 status (resilience workstream):** what now exists, and what is still pending.

- **Backup restore: PASS (local dev, with evidence).** `infrastructure/scripts/backup.sh`
  (pg_dump custom-format archive to gitignored `data/backups/`, verified with
  `pg_restore --list`) and `infrastructure/scripts/restore.sh` (drop-and-restore
  into a discardable `sentravyn_restore_dev` database; refuses to target the
  live database). Root aliases `pnpm db:backup` / `pnpm db:restore`;
  `infrastructure/README.md` records exactly what was tested. Evidence run
  2026-11-05 against the live local service (host port 5434): 317,669-byte
  archive, 145 objects listed by `pg_restore --list`, restore into
  `sentravyn_restore_dev` verified by row counts (288 `Alert`, 515 `User` —
  equal to the live database at dump time) with PostGIS 3.4 present. RPO/RTO
  are documented as **local dev targets only** (RPO ≤ 24 h, RTO ≤ 30 min);
  production values are pending the Phase 9 operational risk assessment
  (ARCHITECTURE.md 9) — no production RPO/RTO numbers are claimed.
- **Provider outage simulation: PASS (test coverage).** `FetchStatus` already
  carries `OUTAGE` (schema.prisma), so no migration was required.
  `backend/test/integrations/provider-outage.spec.ts` (DB-gated,
  SKIP-never-pass) proves on the real pipeline: a valid fetch publishes a
  live alert that reads fresh; an `OUTAGE` ProviderFetch advances no content
  (no new revision, no public-list change, quarantined records never surface)
  and the freshness state of the last data flips to `stale` (freshness.ts);
  a subsequent successful fetch recovers the pipeline.
- **Queue failure recovery: PASS (test coverage).**
  `backend/test/notifications/dead-letter-recovery.spec.ts`
  (Redis-gated, SKIP-never-pass, executed against local Redis port 6380):
  a job that fails `NOTIFICATION_MAX_ATTEMPTS`-style bounded retries lands in
  `sentravyn-notifications-dead` with its payload + fail reason intact, and
  the payload is re-enqueueable (recovery/replay) with dedup preserved; the
  default queue policy carries the bounded exponential backoff shape.
- **Load and stress tests: harness exists, run = NOT RUN.**
  `load/k6/public-read.js` (public read endpoints: `/api/v1/health/live`,
  `/api/v1/alerts`, `/api/v1/places` radius mode; small 0→5 VU ramp) plus
  `load/README.md` with thresholds matching ARCHITECTURE.md §10 (read p95
  default 300 ms, failed-rate < 1%, zero 5xx; ingestion-delay and
  notification-delivery targets recorded as targets, not asserted). No k6
  run has been executed for this change — the run happens when a dedicated
  load environment is up; the report must record the throttle settings in
  effect (default limit 300/60 s per client).
- **Incident response runbooks: in parallel (sibling workstream).**
  `docs/INCIDENT-RUNBOOK.md` is being created by the b4 workstream; the
  queue-dead-letter and provider-outage rows in `docs/RISK-REGISTER.md`
  reference it. Not claimed here.
- **Still pending (owner / other workstreams):** security testing,
  monitoring and alerting (b4 observability module), Terraform staging, and
  **legal, privacy and safety review: PENDING OWNER**.

**Gate:** All critical delivery checks pass.


## Phase 10 — Controlled launch

- Limited geography/provider coverage clearly disclosed.
- Operational ownership and support.
- Data quality monitoring.
- Incident response on-call process.
- Public limitations and terms.
- Gradual rollout and rollback plan.

**Gate:** Launch approval from product, security, operations and safety owners.
