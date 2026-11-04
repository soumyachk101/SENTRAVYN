# SENTRAVYN — Risk & Threat Register

Status: Phase 0. Updated 2026-11-04.
Scoring: Likelihood (L) 1-5, Impact (I) 1-5; Critical ≥ 15, High 9-14, Medium 5-8, Low ≤ 4.

Sensitivity rule: any risk whose mitigation touches user location or emergency claims must keep SAFETY-POLICY and SECURITY constraints intact.

## 1. Product safety risks

| ID | Risk | L | I | Severity | Mitigation (design) | Owner | Residual target |
|---|---|---|---|---|---|---|---|
| R-01 | Fake or compromised alert published as official | 3 | 5 | High | ADR-007 quarantine-by-default; validation; CAP reference integrity; authorised publication; audit | Engineering + Safety reviewer | L2 (validated + authorised path only) |
| R-02 | Unverified place displayed as safe shelter or open hospital | 3 | 5 | High | ADR-006 separated trust attributes; verified state requires evidence + authorised approval; UI labels unverified/stale | Safety reviewer | L2 |
| R-03 | Stale data presented as live | 3 | 4 | High | Per-provider freshness policies; visible last-updated; stale badge; no silent refresh (PRODUCT-SPEC §7-8) | Engineering | L2 |
| R-04 | AI output read as official instruction | 2 | 5 | High | ADR-009 summary-only, cited, labelled; information-class rendering (SAFETY-POLICY §2) | Engineering | L2 |
| R-05 | Nuclear-themed artwork misread as prediction or simulation | 1 | 4 | Medium | DESIGN.md label ("stylised artistic educational visualization"); no weapon/blast-modelling detail; reduced-motion support | Design + Safety reviewer | L1 |
| R-06 | Hazard guidance reused across incompatible hazard types | 2 | 4 | Medium | Per-hazard independently reviewed guides (SAFETY-POLICY §5); guide schema encodes hazard applicability | Safety reviewer | L2 |

## 2. Privacy and data risks

| ID | Risk | L | I | Severity | Mitigation (design) | Owner | Residual target |
|---|---|---|---|---|---|---|---|
| R-07 | Precise location leaked via logs, analytics, API responses | 2 | 5 | High | SECURITY §5: consent at moment of need, manual fallback, retention minimisation, telemetry redaction (ADR-011), API never returns precise location unrequested | Security engineer | L1 |
| R-08 | Covert family-location tracking (consent bypass) | 2 | 5 | High | Consent-based sharing with explicit scope/expiry/revocation (PRODUCT-SPEC §5 family safety); no default background location | Product + Security | L1 |
| R-09 | Emergency contacts / recipients exposed to crawlers or exfiltration | 2 | 4 | Medium | Robots excludes user data routes; structured data limited to public content (SEO-AEO-GEO); object-level authorisation | Security engineer | L2 |

## 3. Threat register (per `docs/SECURITY.md` §8 — minimum 10 assessed)

Threats: fake alert injection; provider/API compromise; admin account takeover; shelter verification fraud; location stalking or disclosure; API scraping and DoS; malicious feed payloads; dependency and CI compromise; notification spoofing; insider misuse; data corruption and replay.

| ID | Threat | L | I | Severity | Mitigation | Owner | Residual |
|---|---|---|---|---|---|---|---|
| T-01 | Fake alert injection | 3 | 5 | Critical | Provider allowlist, payload signature/URL pinning where possible, quarantine (ADR-007), admin authorisation for publication, audit events | Engineering + Security | L2 |
| T-02 | Provider/API compromise | 2 | 4 | High | Treat all feed content as untrusted; schema validation; egress allowlist; no secrets in feeds; SSRF protection for URL fetches | Engineering | L2 |
| T-03 | Admin account takeover | 2 | 5 | Critical | MFA required for privileged roles, short-lived tokens, session revocation, least-privilege RBAC (public/reviewer/operator/admin) | Security engineer | L1 |
| T-04 | Shelter verification fraud | 2 | 5 | High | Evidence fields mandatory (ADR-006); two-person approval where feasible; full audit trail; expiry + revalidation policy | Safety reviewer | L2 |
| T-05 | Location stalking / disclosure | 2 | 5 | High | R-07/R-08 mitigations; precision minimisation; expiry; revocation; no analytics location | Security engineer | L1 |
| T-06 | API scraping / DoS | 3 | 3 | Medium | Rate limits by route and identity, WAF in front, request size limits, queue backpressure (ADR-003 worker isolation) | Engineering | L2 |
| T-07 | Malicious feed payloads (XSS/instruction injection in rendered feed text) | 3 | 4 | High | Render feed text as inert data only; no HTML injection from feeds; output encoding; prompt-injection-resistant design (feeds are data, never instructions to the model or app) | Engineering | L2 |
| T-08 | Dependency / CI compromise | 2 | 4 | High | Pinned lockfile, dependency + secret + image scans in CI, least-privilege CI credentials, no secrets in logs | Engineering + Security | L2 |
| T-09 | Notification spoofing (user believes fake push) | 2 | 4 | High | Push only from app identity (FCM/APNs), alert content links to canonical public page, dedup keys, delivery receipts | Engineering | L2 |
| T-10 | Insider misuse (privileged editor publishes false claims) | 1 | 5 | Critical | Separation of reviewer vs admin, MFA, tamper-resistant audit logs, publish approval workflow, quarterly access review | Security engineer | L1 |
| T-11 | Data corruption / replay (duplicate or replayed alerts) | 2 | 3 | Medium | Idempotency keys, immutable raw records, revision chain, replay-safe queues (ADR-005) | Engineering | L2 |

## 4. Delivery and operational risks

| ID | Risk | L | I | Severity | Mitigation | Owner |
|---|---|---|---|---|---|---|
| R-10 | Provider licensing/terms block ingestion (OSM public endpoints, Copernicus, SACHET) | 3 | 3 | Medium | Per-provider legal review before Phase 3 adapter work (DATA-SOURCES §2-3); fallback provider selection | Legal + Engineering |
| R-11 | Domain / trademark / GSC / Bing absent at launch window | 4 | 2 | Medium | Explicitly owner-action items; launch (Phase 10) gate requires them; no claims without evidence | Owner |
| R-12 | PostGIS + Prisma gap causes buggy spatial code | 3 | 3 | Medium | ADR-004: raw-SQL spatial layer with reviewed queries; spatial correctness tests (Gate C) | Engineering |
| R-13 | Notification fan-out duplicates under retry | 3 | 2 | Medium | ADR-005 dedup keys + bounded retries; delivery receipt tests | Engineering |
| R-14 | Single-team monolith hides scaling hotspots until surge events | 2 | 3 | Medium | ADR-003 predefined split seams; Phase 9 load/stress testing | Engineering |
| R-15 | Design rework late if footer/background system starts at Phase 8 | 2 | 3 | Medium | ADR-010: background system + ASCII footer begin in Phase 1 web shell; Phase 8 completes all surfaces | Design + Engineering |
| R-16 | Mobile builds (iOS/Android) blocked by signing/store prerequisites | 3 | 2 | Medium | Phase 7 gate includes permission/privacy review and device test; EAS/Expo config early in Phase 7 | Engineering |
| R-17 | Transitive dependency advisories reach HIGH/CRITICAL severity | 2 | 3 | Medium | Phase 1: `pnpm audit --audit-level=high` fails the build on any HIGH/CRITICAL in the resolved tree. The 2 HIGH advisories (multer DoS, deepmerge-ts stack-exhaustion) are cleared via `pnpm.overrides` (multer 2.5.0, deepmerge-ts 8.0.2) with Prisma verified still to generate/build. 3 remaining advisories (2 moderate, 1 low: minimatch, glob, deepmerge) are transitive toolchain issues (jest/eslint/nest-cli) with no direct bump that clears them without moving major toolchain lines; they are accepted risk, re-checked on every `pnpm audit` and at each major toolchain bump. | Engineering + Security |

## 5. Watch items (revisit triggers)

- GSC/Bing/IndexNow: remains `NOT CONFIGURED` until owner domain + keys exist (`docs/SEARCH-CONSOLE-SETUP.md`).
- OSM usage: do not scale against public Nominatim/tile servers (DATA-SOURCES §3) — revisit when OQ-2 answered.
- Nuclear-content policy: any new nuclear-related feature or artwork change requires SAFETY-POLICY §4 re-review.
- Dependency overrides (R-17): re-run `pnpm audit` after any major toolchain bump (jest, eslint, prisma, Nest) to clear the 3 accepted advisories or update the overrides; the CI gate already fails on HIGH/CRITICAL.
- NestJS version: backend is pinned to the v11 CommonJS line (ADR-013). Revisit migrating to NestJS v12 (ESM-only) as a deliberate later change; until then the backend stays CJS.
