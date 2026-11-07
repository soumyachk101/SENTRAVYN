// SENTRAVYN load harness — public read endpoints (k6).
//
// Phase 9 deliverable: the harness + thresholds. Running k6 is NOT part of
// the current change (no real load test executed here — see load/README.md,
// marked NOT RUN with reason).
//
// Targets the public read surface (ARCHITECTURE.md 8): /api/v1/health
// (liveness), /api/v1/alerts and /api/v1/places in radius mode (ADR-004:
// radius mode needs BOTH lat and lng).
//
// Throttle note: the API's general `default` limit is 300 requests / 60 s
// per client (backend/src/common/throttling/throttling.module.ts). This
// script's cadence (a few requests per second per VU, small ramp) stays
// inside that limit for a single host on a quiet local service; for a real
// run against a shared service, raise THROTTLE_DEFAULT_LIMIT for the run —
// the knob is proven to be honoured by backend/test/throttling-config.spec.ts.
//
// Usage (from the repo root, API + infra up):
//   BASE_URL=http://localhost:4000 k6 run load/k6/public-read.js
//
// Threshold semantics: k6 FAILS a run when a threshold is breached. The
// latency targets are TARGETS pending the Phase 9 operational risk
// assessment (ARCHITECTURE.md 10 "measure query latency / ingestion delay /
// notification delivery before adding infrastructure complexity"); they are
// overridable via env and are not fabricated production SLOs.

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const API = `${BASE_URL}/api/v1`;

// Read-latency target p95 (ARCHITECTURE.md 10 "database query latency").
const LATENCY_P95_MS = Number(__ENV.LATENCY_P95_MS || 300);

// Targets for the ingest-delay and notification-delivery dimensions of
// ARCHITECTURE.md 10. k6 can only measure the read side here; the values
// exist as named constants so the same gate applies once the Phase 9
// measurement path is wired. They are NOT asserted by this script.
const INGESTION_DELAY_P95_MS_TARGET = Number(
  __ENV.INGESTION_DELAY_P95_MS || 5000,
);
const NOTIFICATION_DELIVERY_P95_MS_TARGET = Number(
  __ENV.NOTIFICATION_DELIVERY_P95_MS || 2000,
);

// A named Trend per endpoint keeps per-route latency visible in the run
// report instead of lumping every read into one number.
const healthLatency = new Trend('health_latency_ms', true);
const alertsLatency = new Trend('alerts_latency_ms', true);
const placesLatency = new Trend('places_latency_ms', true);

// Incremented on any 5xx and gated by the `http_req_5xx` threshold. A JS
// function cannot live inside `options` (k6 JSON-serializes it), so the 5xx
// count is a custom Counter metric instead of a function-valued threshold.
const http5xx = new Counter('http_req_5xx');

export const options = {
  // Load profile matching the documented intent: 0 -> 5 VUs over the first 20 s,
  // hold at 5 VUs for 80 s, then drain to 0 over 20 s. Expressed with the stable
  // classic top-level `vus` + `stages` form, which is portable across k6 v0.x and
  // v2.x. (The previous `scenarios` block mixed v2-only and classic fields with no
  // valid executor and did not load on any k6 release — that is why this harness
  // had never been run.)
  vus: 5,
  stages: [
    { duration: '20s', target: 5 }, // ramp 0 -> 5
    { duration: '80s', target: 5 }, // hold
    { duration: '20s', target: 0 }, // drain
  ],
  thresholds: {
    // Read latency (ARCHITECTURE.md 10): overall + per-endpoint p95.
    http_req_duration: [`p(95)<${LATENCY_P95_MS}`],
    health_latency_ms: [`p(95)<${LATENCY_P95_MS}`],
    alerts_latency_ms: [`p(95)<${LATENCY_P95_MS}`],
    places_latency_ms: [`p(95)<${LATENCY_P95_MS}`],
    // Public reads must not fail under the small ramp.
    http_req_failed: ['rate<0.01'],
    // No 5xx from the API.
    http_req_5xx: ['count<1'],
  },
};

export default function () {
  group('health', () => {
    const res = http.get(`${API}/health/live`);
    healthLatency.add(res.timings.duration);
    if (res.status >= 500) http5xx.add(1);
    check(res, {
      'health: status 200': (r) => r.status === 200,
    });
  });

  group('alerts', () => {
    const res = http.get(`${API}/alerts?page=1&pageSize=20`);
    alertsLatency.add(res.timings.duration);
    if (res.status >= 500) http5xx.add(1);
    check(res, {
      'alerts: status 200': (r) => r.status === 200,
      'alerts: envelope has items[]': (r) =>
        r.status === 200 && Array.isArray(JSON.parse(r.body).items),
    });
  });

  // Radius mode: the service returns a distance-ordered listing with the
  // literal distanceIsCalculation flag (ADR-004); check the envelope only,
  // never interpret the distances as safety claims.
  group('places-radius', () => {
    const res = http.get(
      `${API}/places?lat=40.7&lng=-74.0&radiusMeters=1000&limit=20`,
    );
    placesLatency.add(res.timings.duration);
    if (res.status >= 500) http5xx.add(1);
    check(res, {
      'places: status 200': (r) => r.status === 200,
      'places: envelope has items[]': (r) =>
        r.status === 200 && Array.isArray(JSON.parse(r.body).items),
    });
  });

  // Gentle cadence: the throttle window is per-minute, not per-second.
  sleep(2);
}

// Exported for operator documentation; asserted by no threshold by design.
export const targets = {
  ingestionDelayP95Ms: INGESTION_DELAY_P95_MS_TARGET,
  notificationDeliveryP95Ms: NOTIFICATION_DELIVERY_P95_MS_TARGET,
};
