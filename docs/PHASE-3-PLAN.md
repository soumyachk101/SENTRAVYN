# SENTRAVYN Phase 3 Plan — Alert Ingestion

This document captures the Phase 3 design before implementation. It maps the roadmap scope to workstreams with explicit file ownership, fixes the technical decisions, and lists the delivery gates that apply. Decisions in section 3 are fixed; implementation follows them without inventing alternatives.

References:

- `docs/ROADMAP.md` Phase 3 (scope, gate: "Fixtures, integration tests and source provenance verified")
- `docs/DATA-SOURCES.md` (provider register, section 2 source policy, section 4 CAP rules, section 5 integration stages)
- `docs/SAFETY-POLICY.md` sections 7–8 (alert validation, stale data)
- `docs/ARCHITECTURE-DECISIONS.md` ADR-005 (persisted-before-published lifecycle), ADR-007 (quarantine-by-default), ADR-014 (CAP parsing), ADR-015 (on-demand ingestion)
- `backend/src/integrations/types.ts` (the shared Phase 3 seam, described below)
- `backend/src/common/provenance/provenance.ts` (Phase 2 `payloadHash` + `upsertRawRecord`)
- `backend/src/common/freshness.ts` (Phase 1 freshness helper)
- `docs/PHASE-2-PLAN.md` (Phase 2 decide endpoint, security-review deferrals in its section 6)

## 1. Scope

Phase 3 roadmap deliverables, mapped to this plan:

- Provider adapter framework: the `PROVIDER_ADAPTERS` multi-provider token, `ProviderAdapterRegistry`, and the first two concrete adapters — GDACS (JSON) and generic CAP 1.2 (XML) (workstreams W1, W2).
- CAP 1.2 XML parsing: pure parser with `fast-xml-parser`, validate-and-quarantine semantics (W1, ADR-014).
- Quarantine-by-default ingestion: normalise → validate → persist → publish only via authorised review (ADR-007, W2).
- Dedup / update / cancel lifecycle over `Alert` + `AlertRevision`, keyed on `externalRef` (ADR-005, W2).
- Provenance: every alert traces to an immutable `RawSourceRecord` (verbatim payload + sha256 `payloadHash`) (W2).
- Freshness metadata: per-provider `freshnessPolicyHours` respected by the Phase 1 freshness helper; an expired alert renders stale/expired, never live (SAFETY-POLICY section 8).
- Admin review → publication: the Phase 2 admin review queue and `POST /admin/review/decide` endpoint are reused as the only publication path. No new admin route is added in this phase; that is a recorded decision, not a gap (section 3).
- Durable alert detail API: `GET /alerts/:id` returning alert + revisions + provenance + provider freshness policy (W3).

The shared contract is `backend/src/integrations/types.ts`, which every workstream builds against instead of re-declaring shapes:

- `NormalizedAlert`: one canonical, provider-agnostic event (all timestamps ISO 8601 strings, `null` where the source omits a value; `quarantine` set only on quarantined events).
- `ProviderAdapter` (`key`, `name`, `parse(rawPayload, fetchedAt): ParseResult`): a pure parser — no Prisma, no DI, no network; it must not throw on bad input, it surfaces rejects.
- `ParseResult`: `events` (normalised + validated), `quarantined` (normalised but failed validation), `rejected` (could not even be parsed).
- `ProviderAdapterRegistry`: `get(key)` / `keys()`; concrete in `backend/src/integrations/adapters/registry.ts`, degrading to an empty registry rather than failing bootstrap.
- `PROVIDER_ADAPTERS` DI token: each provider module registers its adapter with `{ provide: PROVIDER_ADAPTERS, useValue: adapter, multi: true }`; the registry consumes the merged array so adapters never import each other.
- `IngestOptions` (`fetchRef`): the stable provider-scoped fetch identifier; defaults to `${providerKey}-${fetchedAt ISO}` when omitted, which is what makes replay of the same fetch idempotent.
- `IngestOutcome`: per-call counters (`created`, `updated`, `cancelled`, `quarantined`, `deduped`) plus the touched canonical `alertIds` and `quarantinedIds` for the review queue.

Roadmap gate for Phase 3: "Fixtures, integration tests and source provenance verified" — satisfied by the fixture-based parser tests (W1, W2), the gate e2e (W4) and the provenance assertions inside them, plus the checklist in section 7. Evidence status as of this revision: see section 5.

## 2. Safety gates

Non-negotiable, checked in every workstream and in the exit criteria:

- No fabricated alerts: every `Alert` row traces to a `RawSourceRecord` (`Alert.sourceRecordId` populated on every write); test-message CAP records (`msgType: 'test'`) and malformed records are quarantined, never `PUBLISHED`.
- Expiry semantics: `expiresAt` is honored by the Phase 1 freshness helper (`backend/src/common/freshness.ts`); an expired alert renders as stale/expired, never as live data (SAFETY-POLICY section 8, ADR-006 consequence).
- Untrusted XML: CAP documents are untrusted input (ADR-007, `docs/DATA-SOURCES.md` section 4). `fast-xml-parser` with values treated as data only — no entity expansion, values trimmed, not interpreted; unknown `msgType` normalises to `'unknown'`, never guessed.
- An event entry is not proof of operational status (SAFETY-POLICY section 3, Gate E): ingestion only records what a provider published; it stamps no operational, safety or shelter claim. Publication happens exclusively through the Phase 2 admin decide endpoint and its audit capture.

## 3. Decisions (fixed)

- CAP parsing: `fast-xml-parser` pinned in `backend/package.json` (pure JS, no native dependencies); XML is treated as untrusted data — no entity expansion, values only trimmed (ADR-014).
- GDACS fetching: Node 22 global `fetch` with timeouts and bounded retries. The fetch itself lands in the Phase 6 scheduler; Phase 3 ingestion is on-demand through `IngestService` (ADR-015).
- No BullMQ scheduler in Phase 3. This is a recorded deferral against `docs/ROADMAP.md` Phase 6, not an omission.
- `externalRef` namespacing: `gdacs:<eventid>` for GDACS events, the bare CAP `<id>` for CAP messages. The two namespaces are disjoint so an update/cancel from one provider can never collide with the other (ADR-005 dedup key).
- Provider auto-registration: ingestion against an unknown provider key upserts a `DataProvider` row by key with `enabled: false`. The production path stays the Phase 2 ADMIN seed/enable flow (`POST /providers/seed`, `PATCH /providers/:key/enable`); auto-registration is bookkeeping for the ingest call, not an enablement mechanism.
- Quarantine audit rows: written as `AUDIT_ACTIONS.ALERT_UPDATED` with detail JSON `{ action: 'quarantined', code, reason }`. The Phase 2 audit-action set has no dedicated quarantine constant; widening it is a recorded minor deferral in the same bucket as the Phase 2 close-out list in `docs/PHASE-2-PLAN.md` section 6.
- No new admin route this phase: admin review → publication reuses the Phase 2 `POST /admin/review/decide` endpoint. Recorded decision, not a gap.

## 4. Workstreams and file ownership

Each file below is owned by exactly one workstream. No new database migration is required: `Alert`, `AlertRevision`, `RawSourceRecord` and `ProviderFetch` already exist from Phases 1–2.

### W1 — CAP parser

- `backend/src/integrations/cap/cap.parser.ts`: pure CAP 1.2 parsing — `parseCAPDocument(raw)` (single-document rule: the first `<alert>` element of the document is the one parsed; a document with no `<alert>` is a `CapParseError`), `validateCAPAlert(parsed)` (issuer, status, message type, scope, urgency, severity, certainty, times, areas, references — per `docs/DATA-SOURCES.md` section 4), and the `CapAlert` shape. XML size cap is enforced at parse time, before `fast-xml-parser` runs (ADR-014).
- `backend/test/cap-parser.spec.ts` and `backend/test/fixtures/cap/`: fixtures based on documented CAP 1.2 examples — a valid `alert`, an `update` with `<inProg>`/`<reference>`, a `cancel`, a `test`, malformed XML, missing `<id>`, unknown `msgType` (must land as `'unknown'`), and oversized payload rejection.

### W2 — Adapters, registry and ingest service

- `backend/src/integrations/adapters/gdacs.adapter.ts` (existing): parses the documented minimal JSON element shape `{ eventid, title, datetime, description? }`; anything else is a rejection, not a guess; `externalRef` is `gdacs:<eventid>`.
- `backend/src/integrations/adapters/cap.adapter.ts` (existing): wraps `cap.parser` in the `ProviderAdapter` seam; valid → `events`, normalised-but-failed → `quarantined` with the parser's first reason as code; `rawPayload` is stored in full on every item (ADR-007), never trimmed to per-event.
- `backend/src/integrations/adapters/registry.ts` (existing): concrete `ProviderAdapterRegistry` over the `PROVIDER_ADAPTERS` multi-token.
- `backend/src/integrations/ingest.service.ts`: on-demand pipeline — look up the adapter via the registry (unknown key → `FAILED` `ProviderFetch`, no partial writes), auto-upsert the `DataProvider` row (`enabled: false`), write the verbatim `RawSourceRecord` via `backend/src/common/provenance` (sha256 `payloadHash`; the `@@unique([providerId, sourceId, payloadHash])` constraint is the write backstop), apply the lifecycle per `externalRef` (create / update / cancel over `Alert` + `AlertRevision`, dedup counted as such), quarantine events get `QUARANTINED` status plus an `AUDIT_ACTIONS.ALERT_UPDATED` row with `{ action: 'quarantined', code, reason }` detail, one `ProviderFetch` row per call (status, `itemCount`, error), returns an `IngestOutcome`.
- `backend/src/integrations/ingest.module.ts`: registers `IngestService`, the registry, and both adapters under the `PROVIDER_ADAPTERS` token; self-contained, importable without touching other modules.
- `backend/test/integrations/` and `backend/test/fixtures/gdacs/`: unit coverage of the GDACS adapter (valid array, per-element rejects: missing `eventid`, missing title, unparseable datetime, non-array payload), the CAP adapter against W1 fixtures, and `IngestService` against stubbed Prisma — lifecycle counts, dedup on replay, quarantine audit rows, `ProviderFetch` bookkeeping, unknown-adapter path.

### W3 — Durable alert detail API

- `backend/src/alerts/alerts.service.ts` and `alerts.controller.ts` (extending the Phase 1 module): `GET /alerts/:id` returns the durable `AlertDetail` envelope — the alert, its `AlertRevision` history, `RawSourceRecord` provenance (verbatim payload hash, `fetchedAt`), and the provider's freshness policy rendered by the Phase 1 freshness helper (stale/expired labels, never silent staleness).
- `packages/shared-types/src/index.ts` and `packages/api-client`: shared `AlertDetail` / `AlertRevisionView` types mirroring the service, so web/admin consume one contract.

### W4 — Gate e2e (DB-gated SKIP pattern)

- `backend/test/e2e/ingest.e2e-spec.ts`: runs the full on-demand path against real Postgres — ingesting a GDACS fixture creates a `VALIDATED` alert with a traceable `RawSourceRecord`; ingesting a CAP fixture creates/updates by `externalRef`; a quarantined CAP record lands in the admin review queue and is publishable only through the Phase 2 decide endpoint; a replay of the same fetch is idempotent (`fetchRef` + `payloadHash`). With `DATABASE_URL` unset the spec runs, every DB-backed assertion logs `SKIP: DATABASE_URL not configured` instead of counting as a pass, and the unauthenticated/unknown-adapter cases still execute (same pattern as the Phase 2 e2e specs).

### Integration step (lead, after workstreams return)

- Register `IngestModule` in `backend/src/app.module.ts`. That file is owned by the lead; no workstream edits it.
- Full validation: `pnpm typecheck`, `pnpm lint`, `pnpm test` (unit), e2e without a database, e2e against local Postgres via `infrastructure/docker` + `prisma migrate deploy`, and `pnpm build`.

## 5. Evidence status

Status vocabulary: PASS, NOT RUN, FAIL.

- Unit fixture tests (`test/cap-parser.spec.ts`, `test/integrations/gdacs.adapter.spec.ts`, `test/integrations/cap.adapter.spec.ts`, `test/integrations/ingest.service.spec.ts`, `test/alerts-api.spec.ts`): PASS — run via `pnpm --filter @sentravyn/backend test` (backend unit suite 104 passed).
- Gate e2e, DB-gated (`test/e2e/ingest.e2e-spec.ts` against local Postgres `postgis/postgis:16-3.4` on host port 5434): PASS — all 7 DB-gated cases passed after `prisma migrate deploy`; the 3 non-DB e2e suites (`api`, `auth`, `admin`) also PASS. Without `DATABASE_URL` the suite logs `SKIP:` per gated case and still passes its unauthenticated-fail-closed checks.
- Provenance verification (every alert row traces to a `RawSourceRecord`; replay idempotency via `fetchRef` + `payloadHash`): PASS — asserted in `ingest.e2e-spec.ts` (exactly one immutable raw record per fetch, verbatim payload, sha256 `payloadHash`, preserved `fetchedAt`; a replay writes no new alert/revision/record).
- Full validation commands (typecheck, lint, unit, e2e without DB, e2e against Postgres, build): PASS — `pnpm typecheck`/`lint`/`build` green across all 8 workspaces; `pnpm test` green (backend 104).

The Phase 3 roadmap gate ("Fixtures, integration tests and source provenance verified") is satisfied by the above. Production enablement of any provider remains controlled (ADR-015): ingestion is on-demand and scheduled fetching is a Phase 6 item, so this evidence does not claim a provider is live in production.

## 6. Known limitations / deferred

Recorded here and mirrored in the `docs/ROADMAP.md` Phase 3 status paragraph:

- On-demand ingestion only: no scheduled fetching in Phase 3; the BullMQ scheduler is Phase 6 scope per `docs/ROADMAP.md` (ADR-015).
- Single-process idempotency: the `RawSourceRecord` composite unique (`providerId, sourceId, payloadHash`) is the write backstop; read-path re-hash-and-verify of `payloadHash` remains deferred per `docs/PHASE-2-PLAN.md` section 6.
- CAP coverage is parse + validate only: CAP 1.2 semantics may vary by authority (`docs/DATA-SOURCES.md` section 4 warning — not all authorities publish CAP, and messages that do are not guaranteed identical semantics). The parser's `validateCAPAlert` is the ceiling; per-authority semantic differences are review-time concerns, not parser-time guesses.
- Provider enablement stays controlled: auto-registration upserts with `enabled: false`; only the Phase 2 ADMIN enable path activates a provider.

## 7. Exit criteria

Mirrors the `docs/ROADMAP.md` Phase 3 gate: "Fixtures, integration tests and source provenance verified".

- [ ] CAP 1.2 parser shipped with fixtures and parser tests (Gate C, per ADR-007); unknown `msgType` normalises to `'unknown'`.
- [ ] GDACS and CAP adapters registered under `PROVIDER_ADAPTERS`; the registry degrades to empty, not failing bootstrap.
- [ ] Quarantine-by-default: malformed/suspicious/test records are quarantined, never published; quarantine audit rows captured.
- [ ] Dedup / update / cancel lifecycle over `Alert` + `AlertRevision` keyed on the namespaced `externalRef`.
- [ ] Every alert row traces to an immutable `RawSourceRecord` (verbatim payload + sha256); replay of a fetch is idempotent.
- [ ] Freshness metadata: expired/stale alerts render stale/expired via the Phase 1 helper, never live.
- [ ] Admin publication reuses the Phase 2 decide endpoint; no new admin route.
- [ ] Durable alert detail API (`GET /alerts/:id`) with revisions + provenance + freshness policy.
- [ ] Gate e2e (DB-gated SKIP pattern) passes against local Postgres.
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` green; evidence recorded in section 5 with PASS/NOT RUN/FAIL vocabulary.
