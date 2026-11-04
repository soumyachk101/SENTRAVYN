# SENTRAVYN — Architecture Decision Records

Status: Phase 0. These ADRs record the owner-approved decisions from `CLAUDE.md`/`docs/` plus the engineering decisions that Phase 1 must implement without re-litigating. "Consequences" list known risks.

## ADR-001 — Brand name is SENTRAVYN

- Status: Accepted
- Context: `docs/BRAND-NAMING.md` treated SENTRAVYN as an internal codename; `docs/BRAND-NAME-RESEARCH.md` records the owner decision "Selected brand: SENTRAVYN". `CLAUDE.md` approves SENTRAVYN as the brand.
- Decision: SENTRAVYN is the approved brand for all new UI, documentation, metadata, package names and generated assets. `docs/BRAND-NAMING.md` is retained only as migration history. The trademark/domain clearance gates in `BRAND-NAME-RESEARCH.md` still apply before public launch.
- Consequences: No mass-rename risk in Phase 1 (nothing to rename yet). Domain selection remains BLOCKED-ON-OWNER.

## ADR-002 — TypeScript monorepo, NestJS backend, no Python

- Status: Accepted (owner-approved, non-negotiable)
- Context: `CLAUDE.md` technology decisions; `docs/ARCHITECTURE.md` §2.
- Decision: pnpm workspaces + Turborepo. `apps/web` (Next.js), `apps/admin` (Next.js), `apps/mobile` (Expo + RN), `backend` (NestJS), `packages/{shared-types,api-client,design-tokens,localization,ui}`. PostgreSQL + PostGIS, Prisma for general use with reviewed raw SQL for advanced spatial operations, Redis + BullMQ, Socket.IO, MapLibre, Docker/AWS/Terraform, Vercel for suitable web surfaces.
- Consequences: One language across the ecosystem simplifies shared types (`packages/shared-types` + `packages/api-client`). NestJS + Prisma + PostGIS requires care: Prisma's PostGIS support is limited — spatial columns will use `Unsupported` Prisma types with reviewed SQL accessors.

## ADR-003 — Modular monolith first, not microservices

- Status: Accepted
- Context: `docs/ARCHITECTURE.md` §1, §10.
- Decision: NestJS modular monolith with domain modules (`auth`, `users`, `alerts`, `incidents`, `geospatial`, `places`, `shelters`, `guides`, `family-safety`, `notifications`, `integrations`, `administration`). BullMQ workers run as separate deployable processes from the API but share the codebase. Microservice split only after measured scaling/isolation needs.
- Consequences: Simpler ops for Phase 1-8. Scaling seams are predefined (API vs workers) so Phase 9 can split without rewrites.

## ADR-004 — PostGIS: geography for distance, geometry for tiling/exploitation; SRID 4326 pinned

- Status: Accepted (engineering decision to be implemented in Phase 1 migrations)
- Context: `docs/ARCHITECTURE.md` §5 requires explicit SRIDs and appropriate geometry/geography types.
- Decision: Store WGS84 coordinates as `geography(Point, 4326)` for distance/radius queries (`ST_DWithin`, `ST_Distance` in metres) and `geometry(Polygon, 4326)` for areal alert/incident footprints. All spatial queries use reviewed raw SQL (or Prisma `$queryRaw`), not string-concatenated user input. Indexes: `GiST` on all spatial columns.
- Consequences: Deterministic geodetic distances; avoids the common bug of plane-Earth `geometry` distance queries returning radian-based numbers. Map tile rasterisation, if needed later, uses the geometry columns.

## ADR-005 — Alert lifecycle is persisted-before-published; real-time is a channel, not a source of truth

- Status: Accepted
- Context: `docs/ARCHITECTURE.md` §6 ("Do not rely on WebSockets as the sole delivery channel"), `docs/PRODUCT-SPEC.md` §7.
- Decision: Canonical flow: ingest → validate → persist (`Alert` + `AlertRevision` + immutable `RawSourceRecord`) → enqueue idempotent notification job → broadcast to connected sockets → record delivery attempts. Clients synchronise on reconnect using durable cursors (`since` revision id / cursor), never relying on socket state. Dedup keys: provider + source identifier + revision.
- Consequences: Websocket loss cannot lose alerts. Replay/retry is safe via idempotency keys. Notification dedup must be tested explicitly (Gate C).

## ADR-006 — Trust model: places, shelters, and alerts carry explicit verification state; "nearby" is never "safe"

- Status: Accepted
- Context: `docs/PRODUCT-SPEC.md` §6, `docs/SAFETY-POLICY.md` §3, Gate E.
- Decision: `Place` entities carry separated attributes — existence confidence, source authority, operational status + evidence, accessibility, shelter classification, capacity evidence, verification authority, verification date and expiry (per ARCHITECTURE §5 entities `Place`, `PlaceEvidence`, `ShelterProfile`, `Verification`). Publication of a shelter as "verified" requires: documented evidence fields populated AND an authorised admin approval action recorded in `AuditEvent`. Stale data (past per-provider freshness policy) must render as stale, not live.
- Consequences: More schema fields up front; prevents the class of failures this product must never make. Admin workflow and audit are required before shelter claims can exist — no shortcuts.

## ADR-007 — All feed content is untrusted data; quarantine-by-default ingestion

- Status: Accepted
- Context: `CLAUDE.md` external data rules, `docs/SAFETY-POLICY.md` §7, `docs/DATA-SOURCES.md` §4.
- Decision: Provider adapters fetch → validate (schema, required fields, times, geometry, semantics) → normalise → store `RawSourceRecord` (immutable original) → `PARSED/VALIDATED` states. Malformed or suspicious records go to quarantine state; only authorised review publishes. CAP parsing preserves issuer/status/messageType/scope/urgency/severity/certainty/times/areas/references.
- Consequences: Every adapter ships with fixtures (documented examples) and parser tests (Gate C, ROADMAP Phase 3).

## ADR-008 — Node 22 LTS + pnpm pinned via `packageManager`

- Status: Accepted
- Context: Local machine runs Node v22.22.3 / pnpm 11.9.0. No version was pinned in the repo.
- Decision: Phase 1 sets `engines.node >= 22` and `packageManager: pnpm@<pinned-version>` in root `package.json`, enabled via corepack in CI. All apps target the same Node major.
- Consequences: Reproducible local + CI. Expo/Next/Nest current stable lines all support Node 22.

## ADR-009 — AI usage boundary: summary and translation only, always cited

- Status: Accepted
- Context: `CLAUDE.md` operating rule 8, `docs/PRODUCT-SPEC.md` §9, `docs/SAFETY-POLICY.md` §6.
- Decision: Any AI-generated text in the product is either (a) a translation of reviewed guidance, or (b) a summary that retains source links and is labelled a summary. AI never: declares event confirmation, generates official alerts, issues evacuation orders, certifies shelters/hospitals, infers safe routes, or overrides official instructions.
- Consequences: UI components must enforce information-class labels (SAFETY-POLICY §2) at render time, not just by author discipline.

## ADR-010 — Design system: DESIGN.md is law; anti-slop is a filter, not an override

- Status: Accepted
- Context: `DESIGN.md` §3-§4, `CLAUDE.md` anti-slop governance + rule 19.
- Decision: Custom background treatments (SVG/procedural/atmospheric, purposeful), premium typography (Geist/Inter/Manrope/Satoshi/Instrument Sans candidates + IBM Plex Mono for technical metadata/ASCII), no neon, zero emoji, restrained motion, and the cinematic ASCII nuclear-explosion footer sequence (7 frames, `PREPAREDNESS SAVES LIVES.`, pause/replay, reduced-motion support, static fallback, low CPU) are all mandatory deliverables — Phase 8 completion gate, but the footer and background system begin in Phase 1's web shell to avoid a late visual rework.
- Consequences: The ASCII footer is an original, deliberately composed artwork (not a stock asset); frames are precomputed/deterministic; labelled as artistic visualization per SAFETY-POLICY §4.

## ADR-011 — Observability: OpenTelemetry + SENTRY-class error monitoring from Phase 1

- Status: Accepted
- Context: `CLAUDE.md` monitoring decision; `.env.example` OTEL/SENTRY slots.
- Decision: Structured logs, traces and metrics via OTel from Phase 1; error monitoring via SENTRY DSN (provider selectable, documented). Precise user location is excluded from all telemetry (SECURITY §5).
- Consequences: Requires log redaction filters (location, emergency contact data) verified in Phase 9 security pass.

## ADR-012 — Deployment topology and environment separation

- Status: Accepted
- Context: `docs/ARCHITECTURE.md` §9.
- Decision: Three environments (dev/staging/prod), Terraform-managed. Next.js web/admin may deploy to Vercel; NestJS API + BullMQ workers deploy as containers (ECS/EKS/EC2 decision in Phase 9); managed Postgres+PostGIS, managed Redis, S3, WAF/CDN in front. RPO/RTO defined by operational risk assessment before launch (Phase 9).
- Consequences: No production infrastructure may be claimed as existing anywhere; `docs/SEARCH-CONSOLE-SETUP.md` stays PENDING until real domain + owner access.

## ADR-013 — NestJS v11 (CommonJS) for Phase 1, not NestJS v12 (ESM-only)

- Status: Accepted (engineering decision, Phase 1)
- Context: `docs/ARCHITECTURE.md` §2 specifies "NestJS + TypeScript" but no
  major version. The initial Phase 1 attempt pinned the current line, which
  is NestJS v12 — and NestJS v12 packages are published as ESM-only
  (`@nestjs/common`, `@nestjs/core`, `@nestjs/config`, `@nestjs/swagger` all
  declare `"type": "module"`). The approved CJS toolchain (Prisma CJS client,
  ts-jest, `nest build` CommonJS output) cannot `require()` ESM-only Nest v12
  at test/runtime without a full ESM re-architecture of the backend.
- Decision: Pin the backend to the mature CommonJS NestJS line:
  `@nestjs/common|core|platform-express|testing@11.2.8`,
  `@nestjs/config@4.0.4` (its CJS line, supports Nest 10/11),
  `@nestjs/swagger@11.4.8`, `@nestjs/terminus@11.1.1`, `@nestjs/cli@11.0.24`.
  This is within "NestJS + TypeScript" (the approved stack) and gives a
  reproducible green baseline. Revisit an ESM backend (Nest v12) in a later
  phase as a deliberate migration, not mid-foundation.
- Consequences: CJS throughout the backend; no `"type": "module"` in the
  backend workspace; Jest uses the `ts-jest` preset unchanged. If the project
  later adopts ESM (e.g. to share a code path with a Node ESM tool), this ADR
  is the point to migrate.

## Open questions (not blockers for Phase 1)

| # | Question | Owner | Needed by |
|---|---|---|---|
| OQ-1 | Which OIDC provider (Auth0/Cognito/Keycloak/self-hosted)? | Product + Security | Phase 2 |
| OQ-2 | Which licensed tile provider for MapLibre production (self-hosted OSM extract vs commercial)? | Engineering + Legal | Phase 4 |
| OQ-3 | Which alert provider is the Phase 3 first adapter (GDACS vs USGS vs SACHET vs CAP aggregator)? | Engineering + Safety reviewer | Phase 3 |
| OQ-4 | Push: single Firebase project covering FCM+APNs or separate? | Engineering | Phase 6 |
| OQ-5 | Domain purchase + GSC/Bing property creation | Owner | Before public launch (Phase 10) |
| OQ-6 | Primary launch geographies and hazard coverage disclosure | Product + Safety reviewer | Phase 10 |
