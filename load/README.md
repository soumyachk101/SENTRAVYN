# SENTRAVYN load / stress harness (k6)

Phase 9 deliverable for the `Load and stress tests` roadmap item: the
harness, its thresholds and the run instructions. **No k6 run has been
executed for this change** — this is NOT RUN, not a measured result
(reason: Phase 9 gate for executed load evidence; the harness is the
deliverable now, the run happens when a dedicated load environment is up).

## Files

- `load/k6/public-read.js` — k6 script targeting the public read surface:
  - `GET /api/v1/health/live` (liveness)
  - `GET /api/v1/alerts` (paginated public list)
  - `GET /api/v1/places?lat=&lng=&radiusMeters=` (ADR-004 radius mode;
    response checked only for the `{ items: [] }` envelope, never for
    safety semantics)

  Small ramp: 0 -> 5 VUs over 20 s (`spawnRate: 0.25`), 80 s hold, 20 s
  drain. Per-endpoint `Trend` metrics (`health_latency_ms`,
  `alerts_latency_ms`, `places_latency_ms`) plus the k6 built-ins
  `http_req_duration` / `http_req_failed` / `http_status`.

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
| 5xx count                          | 0 (`http_status` check)          | API must not return server errors                   |
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
  p95/p99. Until that record exists, load tests stay **NOT RUN**.

## What a PASS would look like

- k6 exits 0 with all thresholds green (p95 under target, failed rate <
  1%, zero 5xx).
- The run report is stored with the evidence (date, host, throttle
  settings).
- No error in the API logs during the window.
