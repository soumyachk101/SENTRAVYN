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

## Phase 7 — Family safety and mobile

- Consent-based location sharing.
- Expiry and revocation.
- Emergency contacts.
- Household plan.
- Expo iOS and Android builds.
- Permission and privacy review.

**Gate:** Device testing and privacy review pass.

## Phase 8 — Design completion

- Apply `DESIGN.md` to all surfaces.
- Custom background system.
- Premium typography.
- Responsive layouts.
- Cinematic ASCII footer.
- Accessibility and reduced-motion review.
- Browser/device screenshots.

**Gate:** Visual review passes at all target sizes.

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

**Gate:** All critical delivery checks pass.

## Phase 10 — Controlled launch

- Limited geography/provider coverage clearly disclosed.
- Operational ownership and support.
- Data quality monitoring.
- Incident response on-call process.
- Public limitations and terms.
- Gradual rollout and rollback plan.

**Gate:** Launch approval from product, security, operations and safety owners.
