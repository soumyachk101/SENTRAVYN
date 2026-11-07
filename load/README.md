# SENTRAVYN load / stress harness (k6)

Phase 9 deliverable for the `Load and stress tests` roadmap item: the
harness, its thresholds and the run instructions. The harness was first
executed 2026-11-06 against a live local stack (this is no longer NOT RUN —
see the run record below).

## Files

- `load/k6/public-read.js` — k6 script targeting the public read surface:
  - `GET /api/v1/health/live` (liveness)
  - `GET /api/v1/alerts` (paginated public list)
  - `GET /api/v1/places?lat=&lng=&radiusMeters=` (ADR-004 radius mode;
    response checked only for the `{ items: [] }` envelope, never for
    safety semantics)

  Load profile: 0 -> 5 VUs over 20 s (stages ramp), 80 s hold, 20 s drain.
  Per-endpoint `Trend` metrics (`health_latency_ms`, `alerts_latency_ms`,
  `places_latency_ms`) plus the k6 built-in `http_req_duration` /
  `http_req_failed`, and a custom `Counter` (`http_req_5xx`) gating server
  errors.

## k6 version

The script uses the classic top-level `vus` + `stages` + string-array
threshold form, which loads on k6 **v0.x through v2.x** (verified v0.45.0
and v2.3.0). Do not reintroduce the V2-only `scenarios`/`spawnRate` shape or
a function-valued threshold — `options` must stay JSON-serializable, so a
`check: (r) => …` in `options.thresholds` makes the whole script refuse to
load.

## Thresholds (targets, matching ARCHITECTURE.md section 10)

ARCHITECTURE.md 10 says to measure **database query latency, queue lag,
provider ingestion delay, alert publication latency, notification delivery
and map query performance** before adding infrastructure complexity. The
harness encodes that:

| Threshold                          | Value (overridable)              | Source                                              |
|------------------------------------|----------------------------------|-----------------------------------------------------|
| read p95 (`http_req_duration`)     | `LATENCY_P95_MS` default 300 ms  | ARCHITECTURE.md 10 "query latency"                  |
| per-endpoint p95 (three Trends)    | same 300 ms default              | ARCHITECTURE.md 10 "query latency"                  |
| failed-request rate                | < 1%                             | public reads must not fail under the small ramp     |
| 5xx count                          | 0 (`http_req_5xx` counter)       | API must not return server errors                   |
| ingestion delay p95 (target)       | `INGESTION_DELAY_P95_MS` = 5000  | ARCHITECTURE.md 10 "ingestion delay" (target only)  |
| notification delivery p95 (target) | `NOTIFICATION_DELIVERY_P95_MS` = 2000 | ARCHITECTURE.md 10 "notification delivery" (target only) |

The ingestion-delay and notification-delivery values are exported as
`targets` from the script but **not asserted by any threshold**: k6 can
only measure the read side here. When the Phase 9 measurement path is
wired (ingest/notify instrumentation), those thresholds get promoted to
real `options.thresholds` entries. No number here is a claimed SLO —
production RPO/RTO/SLO values are pending the Phase 9 operational risk
assessment (ARCHITECTURE.md 9).

## Prerequisites

- k6 installed locally (or a k6 runner in CI): `k6 version`
- Local infra up: `pnpm db:up`
- The API running: `pnpm dev:backend` (or `pnpm --filter @sentravyn/backend build && pnpm --filter @sentravyn/backend start`)

## Run instructions

```sh
# from the repo root
BASE_URL=http://localhost:4000 k6 run load/k6/public-read.js
```

- **Throttle check first:** the general limit is 300 req / 60 s per client
  (`backend/src/common/throttling/throttling.module.ts`). The script's
  cadence (~1–2 req/s per VU, max 5 VUs) stays inside that on a quiet
  local service. For a shared or loaded service, start the API with a
  raised `THROTTLE_DEFAULT_LIMIT` for the run — the knob is proven to be
  honoured by `backend/test/throttling-config.spec.ts` — and record the
  value used in the run's report.
- A threshold breach **fails the k6 run** (exit code 99). Do not edit the
  thresholds to make a failing run pass: that suppresses a signal. Raise
  a target only with a recorded rationale in this file.
- Record the run report (k6's default output) with the run date, the
  `BASE_URL`, the `THROTTLE_DEFAULT_LIMIT` in effect and the resulting
  p95/p99.

## Run record

| Date | Host | Throttle in effect | Result | Notes |
|---|---|---|---|---|
| 2026-11-06 | localhost (Docker PostGIS+Redis, remapped ports 5434/6380) | `THROTTLE_DEFAULT_LIMIT=5000` (raised per run-instructions) | **PASS** — all thresholds green: p95 health 5.7 ms / alerts 11.1 ms / places 5.1 ms (target 300 ms), `http_req_failed` 0.00%, `http_req_5xx` 0, checks 1400/1400. k6 v0.45.0. | Predecessor run (same day, default 300 limit) failed `http_req_failed` (38.7%) **and** exposed two real defects, both fixed and regression-tested: (1) `RedisThrottlerStorage` fed millisecond `ttl`/`blockDuration` into Redis `EXPIRE`/`SET EX` (seconds) — a 60 s window became ~16.7 h and a 300 s auth block ~3.5 days; fixed in `throttler-storage.service.ts` (`toRedisSeconds`), regression test asserts live key TTLs stay in-window; (2) `places`/`guides`/`guides-admin`/`family`/`notifications` controllers were missing `@SkipThrottle({ auth: true })`, so a public map read was co-governed by the 15/min credential `auth` group — under load this 429'd the public surface and opened long blocks; fixed by restoring the documented decorator (only `auth` + `mfa` remain in the `auth` group), regression test `throttling-groups.spec.ts` locks the design. Run evidence: `docs/evidence/phase-10/load-test-2026-11-06.txt`. |

## What a PASS would look like

- k6 exits 0 with all thresholds green (p95 under target, failed rate <
  1%, zero 5xx).
- The run report is stored with the evidence (date, host, throttle
  settings).
- No error in the API logs during the window.
