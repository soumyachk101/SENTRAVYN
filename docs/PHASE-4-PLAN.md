# SENTRAVYN Phase 4 Plan — Geospatial and services

This document captures the Phase 4 design before implementation. It maps the roadmap scope to workstreams with explicit file ownership, fixes the technical decisions, and lists the delivery gates that apply. Decisions in section 3 are fixed; implementation follows them without inventing alternatives.

References:

- `docs/ROADMAP.md` Phase 4 (scope, gate: "Spatial correctness and no false shelter claims")
- `docs/SAFETY-POLICY.md` sections 1, 3, 6 and 8 (safety-first rule, place verification, AI restrictions, stale data)
- `docs/DATA-SOURCES.md` section 3 (OSM caution), section 6 (no fabricated coverage)
- `docs/ARCHITECTURE-DECISIONS.md` ADR-004 (geography for distance, reviewed raw SQL), ADR-006 (trust model, "nearby" is never "safe"), ADR-016 through ADR-018 (Phase 4 spatial, tiles/geocoding, distance-as-calculation)
- `backend/src/geospatial/geo.service.ts` (`GeoService`: `nearby`, `updatePlaceLocation`, `backfillLocations`)
- `backend/src/common/freshness.ts` (Phase 1 freshness helper, reused by the shelter policy)
- `docs/PHASE-3-PLAN.md` (structure and evidence vocabulary this plan mirrors)

## 1. Scope

Phase 4 roadmap deliverables, mapped to this plan:

- PostGIS place layer: `Place.location` (`geography(Point, 4326)`) and `Incident.footprint` added by reviewed raw-SQL migrations, with an idempotent backfill from the staged `lat`/`lng` columns and a GIST index (`backend/prisma/migrations/20260214000001_phase4_postgis_extension`, `20260214000002_phase4_place_location`).
- Places API: public reads (`GET /places`, `GET /places/nearby`, `GET /places/:id`) and the shelter evidence workflow (`POST /places/:id/evidence`, REVIEWER and above) in `backend/src/places/`.
- Distance calculations: `GeoService.nearby` runs `ST_DWithin`/`ST_Distance` on the geography column; every radius result is a derived calculation, labelled as one (section 3b, ADR-018).
- Verification labels: a 5-value `displayState` set (`VERIFIED`, `UNVERIFIED`, `STALE`, `EXPIRED`, `INCOMPLETE`) computed per place at read time via `evaluateShelterPolicy` for shelters; labels are computed, never stored claims (section 3d, ADR-018).
- Shelter-specific evidence workflow: user-submitted `PlaceEvidence` is stored and audited under the `PLACE_EVIDENCE_ADDED` audit action and never mutates verification state (SAFETY-POLICY section 9).
- MapLibre integration and place discovery: the web places page with a raster-OSM-style map, user-entered coordinates, mandatory attribution, and explicit loading/empty/error/offline/unreachable states (section 3c, ADR-017).
- Stale/unknown states: the places surface renders stale/incomplete data through the display labels and the fixed coverage note, never as live or verified.

Roadmap gate for Phase 4: "Spatial correctness and no false shelter claims" — satisfied by the PostGIS-backed spatial tests (section 4, lead workstream), the no-false-shelter-claims checklist in section 2, and the exit criteria in section 7. Evidence status as of this revision: see section 5.

## 2. Safety gates

Non-negotiable, checked in every workstream and in the exit criteria:

- No false shelter claims: `POST /places/:id/evidence` stores the submission and writes one `PLACE_EVIDENCE_ADDED` audit row; it never mutates `verification`, operational status, or any verification state (SAFETY-POLICY sections 3 and 9). A user submission is treated as unverified until authorised review (SAFETY-POLICY section 9).
- Display-label suppression: `displayState` is computed via `evaluateShelterPolicy` at read time; a stored `VERIFIED` label is suppressed whenever the policy contract fails (evidence gap, staleness, expiry), rendering `STALE`, `EXPIRED` or `INCOMPLETE` instead. Verification is never asserted from a map point or an evidence count alone (SAFETY-POLICY section 3, Gate E).
- Coverage note, verbatim: an empty radius (no places with a known location in range) renders the fixed note: "a map listing is not proof that a place is open, safe or operational" (SAFETY-POLICY sections 1 and 6). No softened variant.
- Distance disclosure: every `/places/nearby` item carries `distanceMeters` plus the literal `distanceIsCalculation: true`, and the UI prints the disclosure line so distance reads as a derived calculation (SAFETY-POLICY section 2), never as a safe-reachability recommendation. No "safe", "clear" or "all good" phrasing anywhere in the places surface.
- Spatial correctness against the real engine: radius queries are asserted against PostGIS, not mocked (section 4, lead workstream; section 5).

## 3. Decisions (fixed)

- (a) Spatial columns live in reviewed raw-SQL migrations, not the Prisma schema (ADR-004). The `location` and `footprint` columns are added by `20260214000001` (extension) and `20260214000002` (columns, backfill, GIST index); they are deliberately not modeled in `schema.prisma` and the schema file receives comment-only updates. Consequence, recorded as a hard CI rule: `prisma migrate deploy` is the only migration path. `prisma db push` and `prisma migrate dev` must never run in CI — both reconcile the database against the Prisma schema and would drop or drift the unmodelled spatial columns (ADR-016).
- (b) Distance is a calculation, never a safety recommendation. Every `/nearby` item carries `distanceMeters` plus `distanceIsCalculation: true`; the UI prints the disclosure line. When a radius returns nothing, the UI renders the fixed coverage note verbatim: "a map listing is not proof that a place is open, safe or operational" (SAFETY-POLICY sections 1 and 6; ADR-018).
- (c) Tiles: MapLibre GL JS with an inline raster style over OpenStreetMap standard tiles, the `MapAttributionControl` always visible. Production-scale usage and any OSM tile mirror require a terms review first (`docs/DATA-SOURCES.md` section 3 caution); this phase ships local/dev usage only. `GEOCODING_PROVIDER`/`GEOCODING_KEY` stay unconfigured — no geocoding coverage is claimed where no provider exists (ADR-017, `docs/DATA-SOURCES.md` section 6).
- (d) Verification labels are computed, never stored claims. The 5-value `displayState` set (`VERIFIED`, `UNVERIFIED`, `STALE`, `EXPIRED`, `INCOMPLETE`) is derived via `evaluateShelterPolicy` for shelters at read time; a stored `VERIFIED` label is suppressed when the policy contract fails (Gate E; ADR-018).
- (e) No geolocation in Phase 4. The map works from user-entered coordinates only. Device-location consent, expiry and revocation are Phase 7 family-safety scope (`docs/SAFETY-POLICY.md` section 1, `docs/SECURITY.md` section 5): precise location is highly sensitive, is asked at the moment of need, and manual selection is offered instead — the manual selection is exactly the Phase 4 surface.

## 4. Workstreams and file ownership

Each file below is owned by exactly one workstream. The two `20260214*` migration folders already exist and are owned by the geo workstream; the `schema.prisma` edits are comment-only.

### W-geo — PostGIS layer and spatial service

- `backend/src/geospatial/` (existing): `GeoService` — `nearby()` (`ST_DWithin`/`ST_Distance` on `Place.location` as `geography(Point, 4326)`, radius and limit clamped in the service, places without a location excluded so an unknown location never ranks as "near"), `updatePlaceLocation` (Prisma `lat`/`lng` write plus the raw spatial UPDATE in one transaction), `backfillLocations` (idempotent fill of missing locations from staged coordinates).
- `backend/prisma/migrations/20260214000001_phase4_postgis_extension/migration.sql` and `...20260214000002_phase4_place_location/migration.sql`: `CREATE EXTENSION` plus the `location`/`footprint` columns, backfill and GIST index (ADR-016).
- `backend/test/geo.spec.ts`: spatial correctness tests — radius membership and ordering asserted against the real PostGIS engine. Runs only when `DATABASE_URL` is set; a skip logs `SKIP` and is never counted as a pass.
- `backend/prisma/schema.prisma`: comment-only updates recording that the spatial columns are managed by reviewed migrations (ADR-004/ADR-016). No structural change.

### W-places — places API and evidence workflow

- `backend/src/places/` (new module): `GET /places`, `GET /places/nearby` and `GET /places/:id` public reads; `POST /places/:id/evidence` for REVIEWER and above. `displayState` is computed via `evaluateShelterPolicy` for shelters; every nearby item is wrapped with `distanceMeters` and the literal `distanceIsCalculation: true`; an empty radius returns the fixed `coverageNote`.
- `backend/test/places.spec.ts` and `backend/test/e2e/places.e2e-spec.ts`: unit coverage of the service plus the DB-gated e2e (same SKIP pattern as the Phase 2/3 specs).
- `PLACE_EVIDENCE_ADDED` audit action: the constant added to the Phase 2 audit-action set and the spec key updated so the evidence POST is audited (and asserted never to touch verification).
- `packages/shared-types/src/index.ts` and `packages/api-client` (Phase 4 append): the shared places/nearby/displayState types mirroring the service, so web consumes one contract; `distanceIsCalculation` is a literal `true` in the type, so a consumer cannot set it `false`.

### W-web — place discovery map

- `apps/web/src/app/places/` (new page), `apps/web/src/components/map/` (MapLibre GL map component), `apps/web/src/lib/places.ts`, `apps/web/src/app/globals.css` and the `maplibre-gl` dependency: raster OSM style with the `MapAttributionControl` mandatory and a `NEXT_PUBLIC_MAP_STYLE_URL` override for a later reviewed provider; user-entered coordinates only, no geolocation; reduced-motion `jumpTo`; explicit loading/empty/error/offline/unreachable states; the distance disclosure line and the empty-radius coverage note.

### Integration step (lead, after workstreams return)

- Register the places and geospatial modules in `backend/src/app.module.ts` (owned by the lead; no workstream edits it).
- Full validation: `pnpm typecheck`, `pnpm lint`, `pnpm test` (unit), e2e without a database, e2e against local Postgres/PostGIS via `infrastructure/docker` + `prisma migrate deploy` only, and `pnpm build`. The PostGIS-backed runs are the spatial-correctness evidence; results are recorded in section 5 by the lead.

## 5. Evidence status

Status vocabulary: PASS, NOT RUN, FAIL.

- Spatial correctness against PostGIS (`backend/test/geo.spec.ts` plus the places e2e, run against local Postgres/PostGIS via `prisma migrate deploy`): NOT RUN — pending the lead's Postgres/PostGIS-backed test runs; a `SKIP` log for an unset `DATABASE_URL` is recorded as NOT RUN, not as a pass.
- Places API and evidence workflow (unit `backend/test/places.spec.ts` and e2e `backend/test/e2e/places.e2e-spec.ts`): NOT RUN — pending the lead's validation.
- No-false-shelter-claims checklist (evidence POST mutates no verification state; display-state suppression; coverage note rendered verbatim; distance disclosure printed): NOT RUN — pending the lead's validation and UI inspection.
- Web place-discovery map (states, attribution control, no geolocation, reduced-motion behaviour): NOT RUN — pending browser inspection.
- Full validation commands (typecheck, lint, unit, e2e without DB, e2e against Postgres/PostGIS, build): NOT RUN — pending the lead.

## 6. Known limitations / deferred

Recorded here and mirrored in the `docs/ROADMAP.md` Phase 4 status paragraph:

- No geocoding: `GEOCODING_PROVIDER`/`GEOCODING_KEY` are unconfigured, so no geocoding coverage is claimed (`docs/DATA-SOURCES.md` section 6).
- OSM standard tiles are a dev-time data source; production-scale tile usage and any mirror require a terms review (`docs/DATA-SOURCES.md` section 3), ahead of the Phase 9 legal gate.
- `prisma migrate dev` and `prisma db push` are forbidden migration paths (section 3a); `prisma migrate deploy` is the only one.
- MapLibre is rendering-only in Phase 4: no routing/directions and no safe-route inference (SAFETY-POLICY section 6 AI/derivation restriction).
- `Incident.footprint` exists as a column but no provider populates it yet; Phase 4 ships the schema, not the geometry source.

## 7. Exit criteria

Mirrors the `docs/ROADMAP.md` Phase 4 gate: "Spatial correctness and no false shelter claims".

- [ ] `Place.location` and `Incident.footprint` added by the two reviewed `20260214*` migrations; backfill and GIST index verified; `migrate deploy` is the only migration path used.
- [ ] Spatial correctness asserted against the real PostGIS engine; skips without `DATABASE_URL` are logged, never counted as passes.
- [ ] `/places`, `/places/nearby` and `/places/:id` serve public reads; `POST /places/:id/evidence` is REVIEWER-gated, audited under `PLACE_EVIDENCE_ADDED`, and mutates no verification state.
- [ ] Every nearby item carries `distanceMeters` with `distanceIsCalculation: true`; the disclosure line is printed; an empty radius renders the fixed coverage note verbatim.
- [ ] The 5-value `displayState` is computed via `evaluateShelterPolicy` for shelters; a stored `VERIFIED` label is suppressed when the policy contract fails.
- [ ] The web map renders with the attribution control always visible, user-entered coordinates only, and loading/empty/error/offline/unreachable states present.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` green; evidence recorded in section 5 with PASS/NOT RUN/FAIL vocabulary.
