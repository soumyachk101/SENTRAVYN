# SENTRAVYN — Phase 0 Current-State Audit

Date: 2026-11-04
Auditor: Principal Engineering (Claude Code session)
Status: This audit is evidence-based. Every finding below cites files or observed state. Items that could not be verified locally are marked ASSUMPTION or NOT VERIFIED.

## 1. Repository inventory (observed)

```text
SENTRAVYN/
├── .env.example                     # Documented environment template
├── .gitignore                       # Node/Next/Expo/Docker/Terraform ignores
├── CLAUDE.md                        # Engineering constitution (7,382 bytes)
├── DESIGN.md                        # Design system & visual direction (7,608 bytes)
├── README.md                        # Product overview + surface map (3,230 bytes)
└── docs/
    ├── ARCHITECTURE.md              # Approved stack, module list, data model concepts
    ├── BRAND-NAME-RESEARCH.md       # Owner decision: SENTRAVYN (with clearance gates)
    ├── BRAND-NAMING.md              # Earlier candidate names; SUPERSEDED by BRAND-NAME-RESEARCH.md
    ├── DATA-SOURCES.md              # Provider register (GDACS, USGS, Copernicus, OSM, ...)
    ├── DELIVERY-GATES.md            # Gates A-F + PASS/FAIL/NOT RUN/BLOCKED language
    ├── MASTER-IMPLEMENTATION-PROMPT.md # Primary implementation guide
    ├── PRODUCT-SPEC.md              # Product surfaces, modules, trust rules, non-goals
    ├── ROADMAP.md                   # Phases 0-10 with gates
    ├── SAFETY-POLICY.md             # Verification, AI restrictions, stale-data rules
    ├── SEARCH-CONSOLE-SETUP.md      # Webmaster tracker — all PENDING OWNER DOMAIN AND ACCESS
    ├── SEO-AEO-GEO.md              # Technical SEO/AEO/GEO + Search Console/Bing/IndexNow
    └── SECURITY.md                 # Baseline, identity, API, secrets, location privacy, threats
```

## 2. What exists

| Item | State | Evidence |
|---|---|---|
| Product specification | Complete at requirements level | `docs/PRODUCT-SPEC.md` |
| Design specification | Complete, enforceable | `DESIGN.md` |
| Architecture direction | Complete at decision level | `docs/ARCHITECTURE.md` |
| Safety policy | Complete | `docs/SAFETY-POLICY.md` |
| Security requirements | Complete | `docs/SECURITY.md` |
| Data-source register | Starting list with official URLs only; no licensing verified | `docs/DATA-SOURCES.md` (explicitly "a starting register, not proof") |
| Delivery gates | Complete definitions; nothing executed | `docs/DELIVERY-GATES.md` |
| Roadmap | Phases 0-10 defined | `docs/ROADMAP.md` |
| Environment template | `.env.example` covers Postgres, Redis, OIDC, maps, FCM/APNs, S3, OTEL, Sentry, provider toggles, SEO | `.env.example` |
| Git history | **None** — directory is not a git repository | `git status` → "not a git repository" |
| Application code | **None** — no `apps/`, `backend/`, `packages/`, `infrastructure/` | File listing above |
| CI/CD | **None** — no `.github/` | File listing above |
| Tests | **None** | No test files anywhere |
| Lockfiles / package manifests | **None** | No `package.json`, `pnpm-lock.yaml`, `turbo.json`, `pnpm-workspace.yaml` |
| Docker / Terraform | **None** | No compose files, no `infrastructure/` |

## 3. What is missing (before Phase 1 can be green)

1. Monorepo scaffolding: `pnpm-workspace.yaml`, `turbo.json`, root `package.json`, `tsconfig` base, workspace layout per `docs/ARCHITECTURE.md` §3.
2. `apps/web`, `apps/admin`, `apps/mobile`, `backend`, `packages/*` — all absent.
3. Database schema and migrations (Prisma + PostGIS SQL) for the entity list in `docs/ARCHITECTURE.md` §5.
4. CI pipeline (format, lint, typecheck, test, build, secret/dependency scan).
5. Threat register table with owner/likelihood/impact/mitigation/residual risk (required by `docs/SECURITY.md` §8; produced in `docs/RISK-REGISTER.md` as part of this phase).
6. SEO audit artifact `docs/SEO-AEO-GEO-AUDIT.md` (listed as a required implementation artifact in `docs/SEO-AEO-GEO.md`; created in Phase 8 alongside the page surface).
7. Domain selection and trademark/domain clearance evidence for SENTRAVYN (`docs/BRAND-NAME-RESEARCH.md` gates; `docs/SEARCH-CONSOLE-SETUP.md` = PENDING).
8. Chosen OIDC provider, licensed map tile provider, geocoding provider, push-provider credentials, S3 provider, monitoring provider — none selected yet (env vars are empty in `.env.example` by design).
9. Operational artifacts: runbooks, on-call, RPO/RTO (Phase 9 scope).

## 4. Conflicts and corrections found

| # | Finding | Resolution recorded in |
|---|---|---|
| C1 | `docs/BRAND-NAMING.md` keeps SENTRAVYN as "internal codename" while `docs/BRAND-NAME-RESEARCH.md` records the owner decision "Selected brand: SENTRAVYN". `CLAUDE.md`/`README.md`/`DESIGN.md` all treat SENTRAVYN as the approved brand. | `ARCHITECTURE-DECISIONS.md` ADR-001: SENTRAVYN is the approved brand name for all new artifacts; `BRAND-NAMING.md` is retained as migration history only; trademark/domain clearance gates still apply before public launch. |
| C2 | `docs/BRAND-NAMING.md` dates its screening "2026-11-04" and lists three invented names (Selyvora, Nivoraxis, Asterqen) — superseded by the owner decision in `BRAND-NAME-RESEARCH.md`. | Retain file for history; no new artifact may use the superseded names. |
| C3 | `docs/ROADMAP.md` Phase 0 says "Create `DESIGN.md` and threat register" — `DESIGN.md` already exists; the threat register does not. | This phase delivers `docs/RISK-REGISTER.md` including the threat register table; `DESIGN.md` confirmed as already complete. |
| C4 | `README.md` lists `backend/` as a top-level workspace (not under `apps/`) while `docs/ARCHITECTURE.md` §3 shows the same layout. No conflict — both agree. | n/a — consistency confirmed. |
| C5 | No runtime Node version is pinned anywhere; local machine runs Node 22. | `IMPLEMENTATION-PLAN.md` fixes Node 22 LTS + pnpm via `packageManager` field in Phase 1. |

## 5. Security, privacy and emergency-safety risks (summary)

Full register with owners, likelihood, impact, mitigation and residual risk: `docs/RISK-REGISTER.md`. Highest-severity items:

- R-01 Fake alert injection / feed payload compromise (threat T-01, T-07): untrusted feed content must never be rendered as instruction or published without validation + quarantine.
- R-02 Shelter/hospital verification fraud or implied safety (safety policy §3, Gate E): unverified places must be labelled unverified; no map point = safe shelter.
- R-03 Stale data presented as live (SAFETY-POLICY §8): per-provider freshness policies and visible timestamps are required.
- R-04 Precise-location exposure (SECURITY §5): consent-based, minimized retention, excluded from analytics/logs.
- R-05 Admin account takeover / privilege abuse (SECURITY §2, threat T-03): MFA for privileged roles, audited privileged changes.
- R-06 Provider licensing/terms unverified (DATA-SOURCES §2, §3 OSM caution): no production ingestion until legal review of each provider.
- R-07 Brand/domain: no evidence of domain ownership, trademark clearance, GSC/Bing verification (`SEARCH-CONSOLE-SETUP.md` all PENDING).

## 6. Local environment prerequisites (observed on this machine, 2026-11-04)

| Tool | Version observed | Verdict |
|---|---|---|
| Node.js | v22.22.3 | Sufficient for Next.js and NestJS current lines (noted, not pinned yet) |
| pnpm | 11.9.0 | Present; pin exact version via `packageManager` in Phase 1 |
| Docker | 29.8.0, Compose v5.5.1 | Present, suitable for local Postgres/PostGIS/Redis |
| PostgreSQL client | psql 14.24 (Homebrew) | Client present; server to be run via Docker (PostGIS image) in Phase 1 |
| Redis | redis-cli 8.10.3 | Present; server via Docker in Phase 1 (or Homebrew) |
| Git | 2.56.0 | Present; repository not yet initialised |
| GitHub CLI | 2.103.3 | Present; usable for remote repo + CI setup |
| Xcode build tooling | xcodebuild present | Suitable for Expo iOS builds (Phase 7) |
| PostGIS server | NOT VERIFIED locally | Will be provided by Docker in Phase 1 |

## 7. External services required (not yet provisioned)

1. PostgreSQL + PostGIS (managed, production) — local via Docker for dev.
2. Redis (managed, production) — local via Docker for dev.
3. OIDC identity provider (selection unmade; MFA for admins required).
4. Map tile provider with license permitting this use (MapLibre); OSM public tile servers are explicitly not production-suitable per `docs/DATA-SOURCES.md` §3.
5. Geocoding provider + API key.
6. Push providers: FCM (Firebase project) and APNs (key + team + bundle).
7. S3-compatible object storage.
8. Observability: OTLP collector endpoint + error-monitoring DSN.
9. Data providers: at minimum one documented alert provider for Phase 3 (GDACS and/or USGS candidate; India SACHET where in scope) — licensing and endpoint verification outstanding.
10. Domain + Search Console + Bing + IndexNow key — all pending owner action.

## 8. Scalability / performance observations (pre-code)

- Modular monolith + independently scalable workers is the approved approach (ARCHITECTURE §1, §10). No design conflicts observed.
- PostGIS geography vs geometry: distance/radius work in geography (geodetic), tiling in geometry — decision recorded in `ARCHITECTURE-DECISIONS.md` ADR-004.
- Notification fan-out (websockets + push + durable queue) needs dedup keys and bounded retries from day one (ARCHITECTURE §6) — design, not implementation, risk if deferred.
- Map query performance under alert surges is an explicit Phase 9 load-test target (ROADMAP Phase 9).

## 9. Acceptance criteria per phase

See `docs/IMPLEMENTATION-PLAN.md` §4 (phase-by-phase criteria) and `docs/DELIVERY-GATES.md` for gate language. Phase 0 gate evidence:

| Gate item | Result |
|---|---|
| Auditable plan produced | `docs/IMPLEMENTATION-PLAN.md` |
| Architecture decisions recorded | `docs/ARCHITECTURE-DECISIONS.md` |
| Risk + threat register produced | `docs/RISK-REGISTER.md` |
| Missing/conflicting specs identified | This file §4 |
| Environment vars + external services identified | §7 + `.env.example` cross-check |
| No application code modified | Confirmed — only `docs/` files created/updated in this phase |

## 10. Phase 0 status

**PARTIALLY COMPLETE → PASS (audit gate)** for planning artifacts: plan, ADRs, and risk register are complete and internally consistent. Items that are inherently owner-dependent (domain, trademark clearance, provider selection, GSC/Bing access) are recorded as BLOCKED-ON-OWNER and do not gate Phase 1, which has no dependency on them.
