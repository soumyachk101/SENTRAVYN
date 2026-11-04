# SENTRAVYN — Implementation Plan (Phase 0 Deliverable)

Status: Phase 0. Produced 2026-11-04. This plan sequences `docs/ROADMAP.md` phases with dependencies, blockers, and measurable acceptance criteria. It does not authorise starting Phase 1.

## 1. Recommended implementation order

```text
Phase 0  Audit + planning                  (this document set)
Phase 1  Foundation (monorepo, shells, CI)
Phase 2  Trust and identity
Phase 3  Alert ingestion (first provider)
Phase 4  Geospatial and services
Phase 5  Safety content
Phase 6  Notifications and offline
Phase 7  Family safety and mobile
Phase 8  Design completion
Phase 9  Production hardening
Phase 10 Controlled launch
```

Ordering rationale:
- Phase 2 before Phase 3 because alert publication needs roles + audit (Gate E: privileged actions audited).
- Phase 3 before Phase 4: alerts need durable API and provenance before map layers consume them.
- Phase 5 can start in parallel with Phase 4 (guides are content-workflow, not dependent on spatial queries) but shares the admin review foundations from Phase 2.
- Phase 6 consumes Phase 3 (alert fan-out) and Phase 1 (PWA shell).
- Phase 8 is a completion pass, not a rewrite: background system, typography, footer, responsive and a11y work begin in Phase 1's web shell (ADR-010/R-15).
- Phase 9 is gated on real infrastructure (owner actions in §3).

Parallel workstreams (post-Phase-2):
- WS-A: alerts + geospatial (Phases 3-4)
- WS-B: guides + localization (Phase 5)
- WS-C: notifications + offline (Phase 6)
- WS-D: mobile + family safety (Phase 7)

## 2. Critical blockers and dependencies

| Blocker | Blocks | Owner action | Evidence required |
|---|---|---|---|
| Domain purchase + DNS control | Search Console, Bing, IndexNow, PWA production URL | Owner | Registrar receipt, DNS records |
| OIDC provider selection (OQ-1) | Phase 2 auth implementation | Product + Security | Provider decision recorded in ADR |
| Licensed tile/geocoding provider (OQ-2) | Phase 4 production map layer | Engineering + Legal | License terms review |
| Phase 3 provider licensing (OQ-3, R-10) | Alert ingestion adapter | Engineering + Legal | Per-provider legal review note in DATA-SOURCES |
| FCM/APNs credentials (OQ-4) | Phase 6 push delivery | Engineering | Firebase project + APNs key |
| RPO/RTO + incident-response runbooks | Phase 9 gate | Engineering + Ops | Documented, tested restore |
| Trademark/domain clearance of SENTRAVYN (BRAND-NAME-RESEARCH gates) | Public launch (Phase 10) | Owner | Recorded queries + counsel review |

None of these block Phase 1 (local development and foundation code use Docker + placeholders; `.env.example` slots are intentionally empty).

## 3. Required environment variables and external services

Cross-checked against `.env.example` (all slots present; all empty by design — no secrets in repo):

| Group | Variables | Needed in |
|---|---|---|
| Runtime | `NODE_ENV`, `APP_ENV`, `API_PORT`, `API_BASE_URL`, `WEB_BASE_URL`, `ADMIN_BASE_URL` | Phase 1 |
| Data | `DATABASE_URL` (Postgres+PostGIS), `REDIS_URL` | Phase 1 (local Docker), Phase 9 (managed) |
| Auth | `AUTH_ISSUER_URL`, `AUTH_CLIENT_ID`, `AUTH_CLIENT_SECRET`, `AUTH_REDIRECT_URL` | Phase 2 (after OQ-1) |
| Maps | `MAP_STYLE_URL`, `GEOCODING_PROVIDER`, `GEOCODING_API_KEY` | Phase 4 (after OQ-2) |
| Push | `FCM_*`, `APNS_*` | Phase 6 |
| Storage | `S3_*` | Phase 1 (optional), Phase 5 (guide assets), Phase 9 |
| Monitoring | `OTEL_EXPORTER_OTLP_ENDPOINT`, `SENTRY_DSN` | Phase 1 (dev disabled or local), Phase 9 (prod) |
| Providers | `GDACS_ENABLED`, `USGS_ENABLED`, `COPERNICUS_ENABLED` (and future toggles) | Phase 3 |
| SEO/webmaster | `SITE_URL`, `GOOGLE_SITE_VERIFICATION`, `BING_SITE_VERIFICATION`, `INDEXNOW_KEY` | Only after owner domain + verification exist; never fabricated |

External services: Postgres+PostGIS, Redis, OIDC, tile provider, geocoder, FCM, APNs, S3, OTel collector, error monitor, object storage, provider endpoints, domain/DNS.

## 4. Phase-by-phase acceptance criteria (measurable)

### Phase 1 — Foundation
- [ ] `pnpm install` from clean clone installs all workspaces; Node 22 + pnpm pinned via `packageManager` (ADR-008).
- [ ] `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm test` all green from root.
- [ ] Local stack via Docker: Postgres with PostGIS extension enabled, Redis; `pnpm db:up`/`db:down` scripts; Prisma migrations apply cleanly and reverse.
- [ ] Web shell renders landing skeleton with custom background treatment v0 and ASCII footer v0 (ADR-010); admin and mobile shells build.
- [ ] Backend: NestJS app with health/readiness endpoints, OpenAPI generation, `/api/v1` routing, strict TS, unit tests pass.
- [ ] CI: format/lint/typecheck/test/build + secret scan + dependency scan run on push/PR.
- [ ] Git repository initialised with conventional-commit + branch protection rules.
- Gate: reproducible local setup + green baseline pipeline (ROADMAP Phase 1 gate).

### Phase 2 — Trust and identity
- [ ] OIDC login flow for web/admin; secure cookies; session revocation; MFA enforced for admin/operator roles.
- [ ] RBAC: public / reviewer / operator / admin enforced at API layer with negative tests.
- [ ] `AuditEvent` framework: every privileged write produces an audit record; tamper-evidence logged.
- [ ] `DataProvider` registry + `RawSourceRecord` provenance model in place; fixture round-trip test.
- [ ] Place verification schema (ADR-006 attributes) with admin review workflow; unverified-by-default tests.
- Gates: authorisation + audit tests pass (Gate C + E subset).

### Phase 3 — Alert ingestion
- [ ] First provider adapter (GDACS or USGS — OQ-3 decision recorded) with documented endpoint, license note, fixtures from documented examples.
- [ ] CAP parsing (where applicable) preserving all required fields; validation failures route to quarantine with reason codes.
- [ ] Dedup by provider+source-id+revision; update/cancel association verified by test.
- [ ] Freshness labels; stale alerts visibly stale in API responses.
- [ ] Admin review + publication flow produces public alert with source, times, geometry, uncertainty fields.
- Gate: fixtures + integration tests + provenance verified (ROADMAP Phase 3 gate).

### Phase 4 — Geospatial and services
- [ ] PostGIS layer: GiST indexes; radius/raster queries via reviewed raw SQL (ADR-004); spatial correctness test suite (known-answer cases).
- [ ] MapLibre with licensed tiles; map queries show source, last-update, verification state per feature.
- [ ] Distance shown as calculation, never as safety advice (UI + API doc).
- [ ] Shelter workflow: no "verified shelter" publishable without full evidence + authorised approval (negative test asserts block).
- [ ] Stale/unknown states rendered; no false operational claims.
- Gate: spatial correctness + no false shelter claims.

### Phase 5 — Safety content
- [ ] Guide schema: hazard, jurisdiction, language, author, reviewer, references, version, approval state, review date.
- [ ] Version/approval workflow in admin; published guides carry review date + authority.
- [ ] Per-hazard guides not cross-reused; localization foundation (at least 2 languages structure, 1 fully published).
- [ ] Freshness/retirement states visible.
- Gate: safety reviewer sign-off on workflow + initial published material (named reviewer recorded).

### Phase 6 — Notifications and offline
- [ ] Socket.IO live updates + reconnect cursor sync (durable, ADR-005); lost-socket test proves no missed alerts.
- [ ] Push: FCM + APNs with delivery receipts, bounded retries, dedup; notification-spoofing controls.
- [ ] PWA service worker: offline guides + saved contacts; last-sync label; cached alerts never implied live.
- Gate: offline + reconnect scenarios pass.

### Phase 7 — Family safety and mobile
- [ ] Consent-based location sharing: explicit start/scope/recipient/expiry/revocation; no default background location.
- [ ] Emergency contacts, household plan, meeting points.
- [ ] Expo iOS + Android device builds; permission + privacy review recorded; privacy impact assessment.
- Gate: device tests + privacy review pass.

### Phase 8 — Design completion
- [ ] DESIGN.md applied to all surfaces; background system documented; typography tokens; spacing audit.
- [ ] ASCII footer final: 7-frame sequence, pause/replay, reduced-motion, static fallback, labelled artistic visualization, low CPU, works at 360-1920.
- [ ] Zero emoji, no neon verified by automated scan + visual checklist.
- [ ] Responsive inspection at 360/390/768/1024/1440/1920 with screenshots; WCAG 2.2 AA: keyboard, focus, contrast, reduced motion, touch targets.
- [ ] `docs/SEO-AEO-GEO-AUDIT.md` page-by-page findings recorded; robots/sitemap/canonical/JSON-LD implemented for public routes only.
- Gate: visual review passes at all target sizes (Gate A).

### Phase 9 — Production hardening
- [ ] Load/stress tests on API + map queries + queue; documented baselines.
- [ ] Security testing: OWASP ASVS target level recorded; API Top-10 assessment; DAST/SAST; dependency + image scans; backup restore drill; provider outage + queue failure simulation.
- [ ] Monitoring/alerting live; incident-response runbooks; on-call process; Terraform staging+prod; legal/privacy/safety review.
- Gate: all critical delivery checks pass.

### Phase 10 — Controlled launch
- [ ] Limited geography/provider coverage publicly disclosed; operational ownership + support; data-quality monitoring; rollback plan; terms + limitations published.
- [ ] Search Console/Bing property verified on real domain; sitemap submitted; IndexNow live only with real key.
- Gate: launch approval from product, security, operations and safety owners (recorded).

## 5. Testing and QA policy (all phases)

- Unit: strict TS, provider parsers, validation, RBAC negative cases, spatial known-answers.
- Integration: Docker Postgres/Redis; CAP lifecycle; notification dedup; reconnect cursor.
- E2E: Playwright for web/admin critical flows; device farm or emulators for mobile.
- Accessibility: automated axe run + manual keyboard/focus/contrast pass; reduced-motion checks.
- Security: secret scan, dependency scan, SSRF/CORS/rate-limit negative tests; log-redaction verification.
- Evidence: every gate records commands run + output; unrun checks are `NOT RUN`, never `PASS` (DELIVERY-GATES).

## 6. Local development prerequisites (exact)

Prereqs on this machine: Node v22.22.3, pnpm 11.9.0, Docker 29.8.0 + Compose, git 2.56.0, gh 2.103.3, Xcode tooling — all present (CURRENT-STATE-AUDIT §6).

Commands (to exist after Phase 1; not runnable today — no manifests yet):

```bash
# Prereq: Docker daemon running
pnpm install          # from repo root (after Phase 1 scaffolding)
pnpm db:up            # Postgres+PostGIS + Redis via docker compose
pnpm db:migrate       # apply Prisma + PostGIS SQL migrations
pnpm dev              # turbo: web(3000), admin(3001), backend(4000)
pnpm test             # unit + integration
pnpm build            # all apps + backend
```

## 7. Production-readiness requirements (non-exhaustive, per ROADMAP Phase 9-10)

- RPO/RTO defined and restore-tested.
- WAF/CDN + DDoS posture; secrets in managed store; least-privilege IAM.
- Privacy impact assessment complete (location data especially).
- Incident response + on-call + vulnerability disclosure live.
- Provider licensing documented per active adapter.
- Legal, privacy, safety and operational sign-offs recorded before public launch.
- No production claim (URL, verification, ranking) without recorded evidence.
