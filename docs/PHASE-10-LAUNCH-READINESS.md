# SENTRAVYN Phase 10 — Controlled Launch Readiness

Phase 10 gate (docs/ROADMAP.md): launch approval from product, security, operations and safety owners.
This checklist is the evidence ledger for that gate. Every item is one of:
`[x] DONE`, `[ ] PENDING` (implementable in-repo, tracked here), `[BLOCKED]` (needs an external party or owner action), `[NOT RUN]` (not yet executed).

Completion language per docs/DELIVERY-GATES.md Gate F: only DONE items may be cited as passing;
a NOT RUN or PENDING item never converts to a pass. Deployment and launch approval are NOT
asserted anywhere in this document until the owner-approval row is marked DONE by the owning human.

## 1. Coverage disclosure (limited geography/providers)

SENTRAVYN is an information and preparedness platform, not an operational emergency service.
Public coverage is whatever the enabled provider registry actually ingests — a listing on a map is
never proof a place is open, safe or operational (docs/SAFETY-POLICY.md 1, 3).

- [x] DONE Web landing + footer + data-sources state the enabled providers and
      covered data categories from the registry (added 2026-11-07), not
      hard-coded claims: a public, registry-derived
      `GET /coverage` (`backend/src/providers/coverage.controller.ts` +
      `ProvidersService.coverage()`) returns `hasCoverage`, the
      enabled/total provider counts, the covered/uncovered data categories and
      the shared `COVERAGE_NOTE` disclosure literal (identical to
      `places.service.ts`). The web app reads it through `getCoverage()`
      (`apps/web/src/lib/api.ts`, mirroring `listGuides`) via the
      `CoverageDisclosure` component (`apps/web/src/components/coverage/`),
      mounted on the landing page (`/`), the cinematic footer
      (`CinematicFooter`, compact form, carried on every page) and the
      data-sources register (full form).
      Caveat (honest, not a limit to hide): the disclosure states enabled
      **providers** and **data categories** — the only geography the
      registry actually carries. It does **not** claim covered *geographies /
      regions*: neither `Alert` nor `Place` nor `DataProvider` carries a
      region/country field (the same reason section 6 keeps the geography
      allowlist open), so a region-level coverage claim would be a
      fabrication (SAFETY-POLICY.md 1). Unit:
      `backend/test/providers.spec.ts` `coverage` block (4 cases); e2e:
      `backend/test/e2e/api.e2e-spec.ts` unauthenticated `GET /coverage`;
      web: `apps/web/src/components/coverage/__tests__/CoverageDisclosure.test.tsx`
      (4 states).
- [x] DONE "No coverage" is shown where no trusted source exists
      (docs/DATA-SOURCES.md 6 — no fabricated coverage), added 2026-11-07:
      `CoverageDisclosure` has three explicit honest states on top of the
      loading spinner — `hasCoverage: false` (the "No live data coverage
      yet / No data source is currently enabled" state), an API-unreachable
      error state that degrades to "No coverage is claimed right now" (never
      a fabricated source), and the covered state that lists enabled
      categories and the uncovered ones. The data-sources page already
      carried the static "No coverage is claimed" register notice
      (`apps/web/src/app/data-sources/page.tsx`); the live disclosure is the
      registry-driven complement.
- [x] DONE Public terms page discloses: information-and-preparedness scope,
      official sources always take precedence, and the
      distance-is-a-calculation rule (added 2026-11-07,
      `apps/web/src/app/terms/page.tsx`): the "What SENTRAVYN is / is not" +
      "In an emergency — official instructions win" blocks pre-date this row
      and cover scope + precedence; the new "Distance and coverage are
      calculations, not claims" block states the distance-is-a-calculation
      rule explicitly (a computed straight-line figure, not a safe-reachability
      claim) and the no-geography-coverage rule, linking it to the
      data-sources disclosure.

## 2. Operational ownership and support

- [BLOCKED] Named on-call owner for the API, workers and review queue (owner action: appoint).
- [BLOCKED] Support channel + SLA for public reports (owner action: define).
- [x] DONE `README.md` "Operations" section (added 2026-11-06): start/stop for
      API + worker + infra, log locations (structured JSON; OTEL/Sentry
      opt-in), the review-queue workflow, and the escalation note that the
      on-call owner is BLOCKED until a human is appointed.

## 3. Data-quality monitoring

- [x] DONE Provider health surfaced (added 2026-11-06): `GET /providers/health`
      (`backend/src/providers/providers.service.ts` `health()` +
      `providers.controller.ts`) aggregates `ProviderFetch` outcomes per
      provider (success/partial/failed+rate-limited/outage, last finished
      fetch, outage flag, optional `?sinceHours` window). The admin
      data-quality panel (`apps/admin` `/providers` "Provider data quality",
      REVIEWER+) renders it with loading/empty/error states.
- [x] DONE Stale-data watch (added 2026-11-06): the same panel flags a
      provider as "Stale provider" (warn badge + alert line) when its most
      recent finished fetch recorded `FetchStatus.OUTAGE`. Admin-visible
      only — the public web/app surfaces never show provider health or
      stale-provider state (verified: no consumer of the outage flag
      outside `apps/admin`).
- [x] DONE Quarantine queue depth alert threshold (added 2026-11-07,
      `backend/src/admin/admin-review.service.ts` `depth()` +
      `admin-review.controller.ts` `GET /admin/review/depth`): the review
      queue already existed and is visible (`GET /admin/review/queue`,
      `apps/admin` `/review`); this row closes the *threshold* half of the
      item. `depth(kind)` counts items awaiting review per kind (unbounded,
      unlike the QUEUE_TAKE-capped list view) against the configured
      `REVIEW_QUEUE_ALERT_THRESHOLD` (default 50, read at call time so an
      operator retunes it without a restart) and returns
      `{ kind, depth, threshold, exceedsAlertThreshold }`. Exceeding the
      threshold is a structured `logger.warn` signal
      (`event: "review.queue-depth-threshold"`), never a mutation of queue
      state. Unit: `backend/test/admin-review.spec.ts` `depth` block (7
      cases: boundary met/unmet, `places` counting, config override,
      non-numeric/non-positive fallback, unknown-kind 400, read-only);
      e2e: `backend/test/e2e/admin.e2e-spec.ts` unauthenticated 401 +
      DB-gated RBAC (PUBLIC 403 / ADMIN 200) + signal-consistency check.
      Wiring the threshold signal into an actual paging system remains the
      BLOCKED owner item in section 2.

## 4. Incident response / on-call process

- [x] DONE-pending-review `docs/INCIDENT-RUNBOOK.md` (written 2026-11-06): fake-alert
      injection, provider compromise, admin takeover, dependency failure, database
      corruption — each with detect/contain/communicate/restore, plus a post-incident
      checklist. Correction: an earlier version of this ledger claimed the file was
      created by the b4 observability workstream; the file did not exist in the tree
      until 2026-11-06. Pending the owner review of the doc content; the row converts
      to DONE only after that review, not on the file's existence.
- [BLOCKED] On-call roster + escalation path (owner action).
- [NOT RUN] Drills: backup-restore and provider-outage simulations (docs/ROADMAP.md Phase 9
      items; marked NOT RUN until executed in staging — see Phase 9 hardening workstream).
      Supporting evidence exists in-repo: `infrastructure/README.md` (backup/restore
      drill executed locally, 2026-11-05) and the outage/queue simulation specs under
      `backend/test/`. Staging execution remains open.

## 5. Public limitations and terms

- [x] DONE `/terms` (shipped with b1-web-pages, `apps/web/src/app/terms/page.tsx`):
      platform scope, non-service disclaimer, data sources and attribution,
      user-content policy (unverified until reviewed), contact channel.
- [x] DONE `/privacy` (shipped with b1-web-pages, `apps/web/src/app/privacy/page.tsx`):
      precise-location consent model (docs/SECURITY.md 5), what is stored,
      deletion/revocation controls.
- [x] DONE `/about` (shipped with b1-web-pages, `apps/web/src/app/about/page.tsx`):
      who operates SENTRAVYN, how to reach a human.
- [x] DONE Footer links are live routes (b1-web-pages, `apps/web/src/components/CinematicFooter.tsx`):
      alerts, guides, map, prepare, data-sources, verification, about,
      privacy, security, terms, contact — no `.planned` stubs remain.
      Content accuracy is still the Product owner's launch sign-off (section 7);
      DONE here means the pages exist and are linked, not that the text has
      been owner-approved.

## 6. Gradual rollout and rollback

- [x] DONE Per-provider feature flag: the `enabled` column is the working
      rollout knob (`POST /providers/:key/enable`/`/disable`, ADMIN-only,
      audit-trailed; ingest refuses fetches for disabled providers). Launch
      can be widened one provider at a time today.
- [ ] Geography allowlist filter at the public list endpoint: NOT
      implemented, and kept open deliberately (docs/ROLLBACK-RUNBOOK.md
      section 1). Neither `Alert` nor `Place` carries a region/country
      field and the CAP parser does not extract geocode/area, so a
      geography filter would be a coverage claim the product must not make
      (SAFETY-POLICY.md 1). Requires a region model + migration + review;
      until then per-provider `enabled` is the only knob, which is the
      documented design.
- [x] DONE Rollback runbook (added 2026-11-06, `docs/ROLLBACK-RUNBOOK.md`):
      code revert order, PostGIS migration reverse DDL (verified against
      `20260214000001/02`), canary procedure, and the known-limitations
      block (nothing is deployed; the staging Terraform is a skeleton, so
      the DB-targeted steps run once staging lands).
- [x] DONE Canary procedure (added 2026-11-06, `docs/ROLLBACK-RUNBOOK.md`
      section 4): single-provider, admin-visible canary — disable all,
      enable one, operate through the review queue so nothing is public
      before a reviewer publishes; widen only when `/providers/health`
      shows zero outages. NOT executed (nothing is deployed).
- [BLOCKED] CI/CD pipeline for staging + prod (see Terraform/CI workstream; owner: infra).

## 7. Launch sign-off (owner actions — NOT self-certifiable)

| Role | Scope | Status |
|---|---|---|
| Product owner | Coverage disclosure + terms accuracy | [BLOCKED] pending owner |
| Security owner | Gate E evidence + threat register residual risk | [BLOCKED] pending owner |
| Operations owner | On-call + runbooks + rollback | [BLOCKED] pending owner |
| Safety owner | Guide review + no-false-shelter-claim check | [BLOCKED] pending owner |

No launch may proceed while this table has any [BLOCKED] row. Launch status: **NOT DEPLOYED,
NOT APPROVED.** No domain, hosting URL or deployment status is claimed anywhere in the repo;
see docs/SEARCH-CONSOLE-SETUP.md for the search-visibility ownership note.

## 8. Evidence ledger (fill in as items complete)

| Item | Commit / PR | Command + output | Gate |
|---|---|---|---|
| §3 quarantine queue-depth alert threshold (2026-11-07) | b3-resilience (uncommitted) | `pnpm --filter @sentravyn/backend test` → 258/258 unit PASS incl. 7 `depth` cases; `pnpm --filter @sentravyn/backend test:e2e` (DATABASE_URL/REDIS_URL local) → admin.e2e-spec 12/12 PASS incl. depth 401 + DB-gated RBAC/signal; typecheck/lint/build exit 0 | F (evidence-backed) |
| §1 coverage disclosure — registry-driven (2026-11-07) | b3-resilience (uncommitted) | public `GET /coverage` (`backend/src/providers/coverage.controller.ts` + `ProvidersService.coverage()`): `pnpm --filter @sentravyn/backend test` → `providers.spec` coverage block 4 cases PASS; `test:e2e` → api.e2e-spec unauthenticated `/coverage` PASS. Web: `CoverageDisclosure` mounted on `/`, footer, `/data-sources`; `pnpm --filter @sentravyn/web test` → 30/30 incl. 4 `CoverageDisclosure` state cases + detail-route offline case. Workspace gate: typecheck 11/11, build 8/8, lint 11/11, unit (local 11 + backend 258 + api-client 11 + web 30), e2e 8/8 (62) | F (evidence-backed) |
