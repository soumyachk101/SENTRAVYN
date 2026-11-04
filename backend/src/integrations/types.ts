/**
 * Phase 3 ingestion seam (ADR-007 quarantine-by-default; DATA-SOURCES.md 4).
 *
 * These types are the provider-agnostic contract every integration module
 * builds against. They are intentionally free of NestJS/Prisma so the pure
 * parser, the adapter framework, and the ingest service can be developed and
 * tested independently. Heads: import from here; do NOT re-declare these
 * shapes in module-local files.
 *
 * Trust rules encoded here (SAFETY-POLICY.md 2, 7, 8; PRODUCT-SPEC.md 6):
 * - Feed content is untrusted data, never instructions.
 * - A record is either normalised and VALIDATED, or quarantined with a reason.
 * - Provenance (provider, source id, verbatim payload, fetch time) is preserved.
 */

/** Provider-native identifier, preserved verbatim for provenance + dedup. */
export type ProviderKey = string; // stable key, e.g. "gdacs", "usgs", "cap"

/**
 * Provider-adapter injection token. Provider modules expose their adapters
 * under this token; the registry consumes the merged set.
 *
 * Registration is via a single useFactory provider that returns an explicit
 * `ProviderAdapter[]` (see ingest.module.ts). Repeated `multi: true`
 * registrations are NOT used: in the installed @nestjs/common each `multi`
 * registration overwrites the prior one rather than accumulating, so the
 * registry would see only the last adapter. The factory keeps the set
 * explicit and version-independent.
 */
export const PROVIDER_ADAPTERS = Symbol('PROVIDER_ADAPTERS');

/**
 * One ingest call targets a single fetch. `fetchRef` is the stable
 * provider-scoped identifier used as the RawSourceRecord sourceId so that a
 * replay of the same fetch is idempotent (ADR-007). Defaults to
 * `${providerKey}-${fetchedAt ISO}` when the caller omits it.
 */
export interface IngestOptions {
  /** Stable fetch-scoped source id (see above). */
  fetchRef?: string;
}

/** CAP message semantics (DATA-SOURCES.md 4). 'unknown' means not parseable. */
export type CapMsgType = 'alert' | 'update' | 'cancel' | 'test' | 'unknown';

/**
 * One canonical, provider-agnostic alert event a parser produces from a
 * single source record. All timestamps are ISO 8601 strings; null where the
 * source omits the value. No DB types, no framework types.
 */
export interface NormalizedAlert {
  /** Stable provider key the record came from. */
  providerKey: ProviderKey;
  /** Provider-native identifier (CAP <id> / source event id), preserved. */
  sourceId: string;
  /**
   * Dedup/update/cancel reference (CAP <id> used as externalRef). The key
   * that lets an update/cancel find the canonical alert (ADR-005).
   */
  externalRef: string;
  /** CAP message type; 'unknown' when the source has no/invalid msgType. */
  msgType: CapMsgType;
  /** Human headline/title. */
  headline: string;
  issuer: string | null;
  severity: string | null;
  urgency: string | null;
  certainty: string | null;
  scope: string | null;
  issuedAt: string | null;
  effectiveAt: string | null;
  expiresAt: string | null;
  /** Message body/description, untrusted free text. */
  body: string | null;
  /** Msg ids this update/cancel references (CAP <reference> / <inProg>). */
  references: string[];
  /** The verbatim original payload (ADR-007 immutable raw record). */
  rawPayload: string;
  /** ISO time the record was fetched. */
  fetchedAt: string;
  /** Set only when this event is quarantined rather than validated. */
  quarantine?: {
    /** Machine code, e.g. 'MALFORMED', 'MISSING_ID', 'BAD_TIME'. */
    code: string;
    /** Human reason, used in the audit/review trail. */
    reason: string;
  };
}

/** A record the parser could not normalise, with the reason it was rejected. */
export interface RejectedRecord {
  sourceId: string;
  code: string;
  reason: string;
  rawPayload: string;
  fetchedAt: string;
}

/** The result of running one raw payload through a provider parser. */
export interface ParseResult {
  providerKey: ProviderKey;
  /** Events that normalised to VALIDATED alerts (msgType not forced to unknown). */
  events: NormalizedAlert[];
  /** Events that normalised but failed validation and are quarantined. */
  quarantined: NormalizedAlert[];
  /** Records that could not even be parsed. */
  rejected: RejectedRecord[];
}

/**
 * Provider-agnostic adapter contract (ADR-007). A parser is pure: it takes a
 * raw payload + fetch time and returns a ParseResult. No Prisma, no DI, no
 * network in the parser itself (fetching is a separate concern, Phase 6
 * scheduling). Concrete adapters (GDACS, CAP) implement this.
 */
export interface ProviderAdapter {
  readonly key: ProviderKey;
  /** Display name, e.g. 'GDACS'. */
  readonly name: string;
  /** Parse one raw payload. Must not throw on bad input; surface rejects. */
  parse(rawPayload: string, fetchedAt: Date): ParseResult;
}

/**
 * Look up an adapter by provider key. The ingest service depends on this
 * interface (not a concrete registry) so it can be developed and tested
 * independently of any concrete provider (see integrations module wiring).
 */
export interface ProviderAdapterRegistry {
  get(key: ProviderKey): ProviderAdapter | undefined;
  keys(): ProviderKey[];
}

/** Outcome of ingesting one payload through the pipeline (DB-backed). */
export interface IngestOutcome {
  providerKey: ProviderKey;
  /** How many alerts were created vs updated vs cancelled vs quarantined. */
  created: number;
  updated: number;
  cancelled: number;
  quarantined: number;
  /** Canonical alert ids that were touched (created/updated/cancelled), not quarantined. */
  alertIds: string[];
  /** Quarantined event ids (source-record ids) for the review queue. */
  quarantinedIds: string[];
  /** Whether a new canonical Alert row was created for a brand-new externalRef. */
  deduped: number;
}

/** Lifecycle action an ingest step can take for a given externalRef. */
export type IngestAction = 'create' | 'update' | 'cancel' | 'quarantine' | 'duplicate';
