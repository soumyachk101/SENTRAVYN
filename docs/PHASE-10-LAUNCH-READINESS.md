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

- [ ] Web landing + footer state the covered geographies and enabled providers (from the registry,
      not hard-coded claims).
- [ ] "No coverage" is shown where no trusted source exists for a region/data type
      (docs/DATA-SOURCES.md 6 — no fabricated coverage).
- [ ] Public terms page discloses: information-and-preparedness scope, official sources always
      take precedence, and the distance-is-a-calculation rule.

## 2. Operational ownership and support

- [BLOCKED] Named on-call owner for the API, workers and review queue (owner action: appoint).
- [BLOCKED] Support channel + SLA for public reports (owner action: define).
- [ ] `README.md` "Operations" section: how to start/stop API + worker, where logs live,
      how to run the review queue, and who to page for each incident class.

## 3. Data-quality monitoring

- [ ] Provider health surfaced: `ProviderFetch` success/partial/failure rates per provider
      (existing schema; needs a dashboard or admin page — see Phase 6 notifications workstream).
- [ ] Stale-data watch: `DataProviders` with `freshnessPolicyHours` beyond threshold show a
      "stale provider" state in admin, never in the public UI.
- [ ] Quarantine queue depth alert threshold (docs/ROADMAP.md Phase 3 gate evidence trail).

## 4. Incident response / on-call process

- [ ] `docs/INCIDENT-RUNBOOK.md`: fake-alert-injection, provider compromise, admin takeover,
      dependency failure, database corruption — each with detect/contain/communicate/restore.
- [BLOCKED] On-call roster + escalation path (owner action).
- [ ] Drills: backup-restore and provider-outage simulations (docs/ROADMAP.md Phase 9 items;
      marked NOT RUN until executed in staging — see Phase 9 hardening workstream).

## 5. Public limitations and terms

- [ ] `/terms` (planned → real page): platform scope, non-service disclaimer, data sources and
      attribution, user-content policy (unverified until reviewed), contact channel.
- [ ] `/privacy` (planned → real page): precise-location consent model (docs/SECURITY.md 5),
      what is stored, deletion/revocation controls.
- [ ] `/about` (planned → real page): who operates SENTRAVYN, how to reach a human.
- [ ] Footer links flip from `.planned` to real routes when the pages above ship.

## 6. Gradual rollout and rollback

- [ ] Feature flags per provider (`enabled` column already exists) + a "geography allowlist"
      filter at the public list endpoint, so launch can be widened one region at a time.
- [ ] Rollback: `git revert` + migration rollback runbook for the launch commit; PostGIS
      geography columns are additive and reversible (document the steps).
- [ ] Canary: single-region, single-provider, admin-visible before public exposure.
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
| (none yet) | | | |
