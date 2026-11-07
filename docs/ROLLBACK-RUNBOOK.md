# SENTRAVYN Rollout / Rollback Runbook

Phase 10 section 6 (gradual rollout and rollback, `docs/PHASE-10-LAUNCH-READINESS.md`).
Companion to `docs/INCIDENT-RUNBOOK.md` (incident classes) — this file covers
the launch-commit code and migration rollback, and the canary procedure.
Nothing here has been executed: rollback steps are verified against the
migration set, not by running them.

## 1. Feature flags per provider

The `enabled` column on `DataProvider` is the per-provider flag
(`backend/src/providers` — `POST /providers/:key/enable` /
`/disable`, ADMIN-only, audit-trailed). Ingest honours it: a fetch for a
disabled provider is refused at the provider-enablement gate
(`backend/src/integrations` — controlled enablement, docs/DATA-SOURCES.md
stage 5), so launch can be widened one provider at a time by disabling all
providers, then enabling them one by one.

**Geography allowlist — scope note (2026-11-06):** a geography-filtered
public list endpoint is NOT implemented, and the ledger row is kept open:
neither the `Alert` nor the `Place` model carries a region/country field
(`backend/prisma/schema.prisma`), and the CAP parser does not extract
geocode/area data. Adding a region model would be schema work requiring a
migration and review, and filtering the public list by a region nobody has
verified would be a coverage claim the product must not make
(SAFETY-POLICY.md 1: a map listing is not proof). Until a region model
exists, per-provider `enabled` is the only rollout knob, and that is the
documented design.

## 2. Rollback — code (git revert)

Reversible because every phase landed as a discrete commit/merge. A launch
commit rolls back in this order:

1. `git revert -m 1 <launch-merge>` (or revert the commit range) — restores
   the previous tree. Do NOT force-push a shared branch; revert is a new
   commit.
2. Re-run the gate before redeploying: `pnpm lint && pnpm typecheck &&
   pnpm test && pnpm build && pnpm --filter @sentravyn/backend test:e2e`
   (DB-gated; see `load/README.md` for the infra start steps).
3. Redeploy the reverted build. Socket.IO reconnect-sync
   (`backend/src/notifications/sync.service.ts`) replays missed alert
   revisions from the DB on reconnect, so clients resync to the reverted
   state rather than showing post-rollback data.

## 3. Rollback — migrations (PostGIS)

The spatial migrations are additive and reversible
(`backend/prisma/migrations/20260214000002_phase4_place_location/`):

- `ALTER TABLE "Place" ADD COLUMN "location" geography(Point, 4326)` and
  `ALTER TABLE "Incident" ADD COLUMN "footprint" geography` — drop back
  with `ALTER TABLE "Place" DROP COLUMN "location"` /
  `ALTER TABLE "Incident" DROP COLUMN "footprint"`. The source-of-truth
  columns `Place.lat`/`Place.lng` remain (the migration backfilled
  `location` from them, so no data is lost by dropping the geography
  column).
- `CREATE EXTENSION postgis` (20260214000001) is separate from the column
  migrations; dropping the columns does not require dropping the extension,
  and the extension itself is shared by the whole database.

**Procedure (staging DB only — never improvise on production):**
1. Take a backup first: `pg_dump` via `infrastructure/scripts/backup.sh`
   (dev RPO/RTO are local targets only; production values are pending the
   Phase 9 risk assessment — do not assume the 24 h/30 min numbers).
2. Apply the reverse DDL to the **staging** database, run the app against
   it, and run the gate (`pnpm --filter @sentravyn/backend test:e2e`
   points `DATABASE_URL` at the staged instance). The spatial read path
   (`backend/src/geospatial/geo.service.ts`) only runs when the columns
   exist; the app degrades to a no-spatial-search build if reverted as a
   set.
3. Promote only after the green run. Keep the backup until the post-
   rollback check passes.

Prisma note: a hand-rolled reverse migration does not update
`prisma/migrations` history; if the rollback is meant to be re-migrated
forward later, use `prisma migrate` with a new reverse migration rather
than raw DDL, so the history stays consistent.

## 4. Canary — single-region, single-provider, admin-visible

Given the current schema (§1), a canary is a **single-provider** canary,
not a geography canary:

1. Disable every provider (`enabled: false`), so the public list is
   empty-by-design and shows the "no data" state, not old data.
2. Enable exactly one provider (e.g. GDACS). Its alerts land through the
   normal quarantine path: they appear in the admin review queue
   (`apps/admin` `/review`) before any public publication.
3. Operate the canary as admin-visible: reviewers publish from the queue;
   the public surface only ever shows reviewed records
   (`PUBLIC_ALERT_STATUSES` filter, `backend/src/alerts`). This satisfies
   "admin-visible before public exposure" without a new feature flag.
4. Success check before widening: `GET /providers/health` (Phase 10
   section 3) shows the canary provider with zero outages and a recent
   last fetch; the public alerts list is non-empty and every row carries
   an API-computed freshness label. Widen one provider at a time; do not
   widen on a provider whose last fetch is `OUTAGE`
   (`FetchStatus.OUTAGE` — the stale-data semantics in
   `backend/src/integrations` treat outage as recorded failure, never as
   "no news").

## 5. Known limitations

- Rollback was not executed for this document (nothing is deployed —
  Phase 10 "NOT DEPLOYED"; there is no live system to roll back yet).
- The `staging` Terraform module is a skeleton
  (`infrastructure/terraform/staging` — "NOTHING IS DEPLOYED"), so steps
  3/4 target a database that does not exist yet; run them once staging
  lands.
- The 24 h RPO / 30 min RTO are **dev-only** targets
  (`infrastructure/README.md`); do not cite them as production SLOs.
