# SENTRAVYN Incident Runbook

Owner: on-call engineer (appointment is a Phase 10 BLOCKED owner item —
`docs/PHASE-10-LAUNCH-READINESS.md` section 2). This runbook is the
procedure; the roster is not yet staffed.

Scope: the five incident classes named in the Phase 10 ledger
(`docs/PHASE-10-LAUNCH-READINESS.md` section 4), each with
detect / contain / communicate / restore. It is an information and
preparedness platform, not an operational emergency service: the failure
modes below are about *what the platform shows*, not about real-world
emergency response.

## Ground rules (all incidents)

1. **Never fabricate state.** Every status line you post must come from a
   command you actually ran, with its output. "Looks healthy" is not a
   status. (CLAUDE.md rule 3.)
2. **Safety precedence.** A false "shelter is open / alert is current"
   claim is a P1. If you are unsure whether the platform is showing
   unverified or stale data, say so explicitly and prefer the explicit
   "stale / not live" state over silence. (SAFETY-POLICY.md.)
3. **Evidence first.** Before declaring an incident over, re-run the
   detector. Before restoring, confirm the backup is restorable
   (`pg_restore --list` row counts — `infrastructure/README.md`).
4. **Logs are structured.** Request and error lines are single-line JSON
   (`event`, `method`, `path`, `status`, `durationMs`); precise-location
   query params are already scrubbed by the request-log middleware
   (`backend/src/observability/request-log.middleware.ts`). Sentry error
   capture and OpenTelemetry tracing are env-gated (`SENTRY_DSN`,
   `OTEL_EXPORTER_OTLP_ENDPOINT`); when unset, error lines in the API log
   are the only capture.

## 0. Quick status check (run first, every incident)

```bash
# Liveness + DB + PostGIS + Redis
curl -fsS http://<api-host>/api/v1/health        # expect "healthy" + deps ok
curl -fsS http://<api-host>/api/v1/health/live   # expect "healthy"
# Error rate in the structured log (last 15 min)
grep '"event":"http.error"' /var/log/sentravyn/api.log | tail -50
```

A non-200 on `/health` or a `deps` field showing `postgres`/`redis`
downgrade immediately identifies the layer.

## 1. Fake alert injection (someone publishes a bogus alert)

**Detect**
- Public `/alerts` shows a record with an issuer/event that does not match
  any enabled provider in the registry (`GET /api/v1/admin/audit` or the
  admin review queue).
- Log signature: ingest lines from a provider fetch that succeeded, but
  the alert content is clearly not provider-shaped.

**Contain**
- The publish path is admin-reviewed by design: a quarantined alert can
  only become public through an `AdminReviewDecision` (audit-trail row is
  written). If an unreviewed record is visible on the public list, that is
  a P0 code defect — freeze public writes to the alerts route
  (disable the provider so no new ingests land; `POST /providers`
  `enabled: false`, ADMIN).
- Identify the acting admin via the audit row's `actorId` +
  `createdAt`; revoke their sessions
  (`POST /auth/sessions/revoke-all`, then rotate credentials).

**Communicate**
- Post the incident with the audit-trail extract proving which record and
  which actor. State plainly which records were affected and when.

**Restore**
- Cancel/soft-delete the injected records *through the review API* so the
  audit trail stays intact — never delete rows directly from the DB.
- Re-enable the provider only after its egress/allowlist check passes.
- Root-cause the credential compromise (MFA was bypassed, stolen, or an
  over-privileged role).

## 2. Provider/API compromise (a feed source is serving malicious data)

**Detect**
- `ProviderFetch` rows flip to `OUTAGE` or start returning schema-invalid
  payloads (ingest 400s in the log), or a provider's data suddenly
  contains instruction-shaped text.

**Contain**
- Treat all feed content as untrusted data, never as instructions
  (CLAUDE.md rule; `docs/DATA-SOURCES.md`). The ingest pipeline schema-
  validates and quarantines; quarantine depth spikes are the signal.
- Disable the provider (`enabled: false`); quarantined records are
  already excluded from the public list (`PUBLIC_ALERT_STATUSES` filter).
- Egress allowlist: confirm the provider URL matches its documented
  endpoint; a redirected host is a compromise, not an outage.

**Communicate**
- Record the provider key, the fetch refs, and the first/last affected
  timestamp. Do not claim the provider is "safe again" until a clean
  fetch cycle lands.

**Restore**
- Re-enable only after one full clean fetch. Verify freshness state
  recovers (`stale` → `FRESH`) before declaring the data current again.

## 3. Admin account takeover

**Detect**
- `audit` event with an unexpected `actorId` performing privileged
  actions; session count anomaly on `/auth/sessions`; MFA challenge
  failures followed by success.

**Contain**
- `POST /auth/sessions/revoke-all` for the account; rotate
  `AUTH_JWT_SECRET` (all access/refresh tokens invalidate); reset the
  account's MFA (re-issue setup, disable the old secret).

**Communicate**
- Audit-trail extract of every privileged action in the window, with
  timestamps.

**Restore**
- Re-authorise the account only after credential rotation + MFA
  re-enrolment + a post-mortem on how the takeover happened (phishing,
  leaked secret, over-privileged role).

## 4. Dependency failure (Postgres/Redis/worker down)

**Detect**
- `/health` `deps` fields: `postgres: down`, `redis: down`. Worker:
  dead-letter queue depth (`sentravyn-notifications-dead`) growing, or
  the BullMQ queue stalled.

**Contain**
- These are fail-open by design: Redis down degrades the throttler to
  no-op and logs; Postgres down makes `/health` report unhealthy and the
  read endpoints return errors, not fabricated data. Do not patch
  endpoints to "return empty"; let the honest degraded state show.

**Communicate**
- Which dependency, since when, and which surfaces are degraded. The
  web PWA layer already shows "not live" for cached data, so the public
  surface degrades without lying.

**Restore**
- Postgres: `pnpm db:up` (dev) or the Terraform-managed instance;
  verify `prisma migrate deploy` reports no pending migrations.
  Redis: restart the container; confirm `throttle:*` keys have sane TTLs
  (a multi-day `throttle-block:*` TTL is the ms/s units bug class —
  verify with `redis-cli TTL <key>`; the fix is in
  `throttler-storage.service.ts` `toRedisSeconds`).
  Worker: restart `backend/worker`; replay the dead-letter queue via the
  operator path (bounded, idempotent — dedup keys in ADR-005).

## 5. Database corruption

**Detect**
- `prisma` query errors with `corrupt`, constraint violations on
  immutable rows (`RawSourceRecord` should never be updated), or
  `pg_restore --list` failing on the latest backup.

**Contain**
- Stop writes (take the API out of rotation, or set the app to read-only
  if your host supports it). Do not run migrations on a corrupt DB.

**Communicate**
- Corruption scope: which tables, last good backup timestamp, and the
  RPO/RTO being met (dev: RPO ≤ 24 h, RTO ≤ 30 min —
  `infrastructure/README.md`).

**Restore**
- `pnpm db:restore <backup>` restores into the discardable
  `sentravyn_restore_dev` database and **refuses the live DB** —
  promote it manually only after a row-count + PostGIS sanity check.
  Keep the corrupt snapshot as forensic evidence; do not delete it until
  the post-mortem closes.

---

## Post-incident (every class)

- Re-run the affected e2e suite: `pnpm --filter @sentravyn/backend test:e2e`
  (DB-gated). A green run is the restore proof.
- Update the audit rows and the incident ticket with: commands run,
  outputs, the exact commit the API was running, and the detection time.
- If a threshold or limit was changed during the incident, record the
  value and restore the default (the throttle knobs are env-overridable —
  `backend/src/common/throttling/throttling.module.ts`).
