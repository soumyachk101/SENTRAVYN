/**
 * CAP (Common Alerting Protocol 1.2) parser and validator.
 *
 * Pure module: no NestJS, no Prisma, no I/O. Parses a raw CAP 1.2 document
 * into a `CapAlert`, and validates the parsed alert against the stable
 * machine reasons defined in SAFETY-POLICY.md 7. Parse errors
 * (`CapParseError`) are distinct from validation failures
 * (`CapValidationResult`): a malformed document is a parse error; a
 * well-formed document with a missing headline or out-of-order times is
 * quarantinable, not a parse error.
 *
 * All field values from the document are treated as untrusted data: trimmed,
 * never interpreted (DATA-SOURCES.md 4, SAFETY-POLICY.md 2).
 *
 * Dependency note: fast-xml-parser is pinned ^5.2.5 in backend/package.json;
 * the installed copy confirmed at 5.12.0. In v5 the library no longer ships a
 * `JSDocumentNode` type (that API is v4-only) and `XMLParser.parse()` is
 * declared to return `any`, so a single structural cast (`asXml`) bounds the
 * untyped surface. `XMLValidator.validate`, `ignoreAttributes: false`,
 * `attributeNamePrefix`, and `parseTagValue: false` were all verified against
 * the installed 5.12.0 typings and runtime before coding.
 */
import { XMLParser, XMLValidator, ValidationError } from 'fast-xml-parser';
import type {
  CapMsgType,
  NormalizedAlert,
  ParseResult,
  ProviderAdapter,
} from '../types';

/**
 * Phase 3 shared-seam re-exports (ADR-007): adapter and ingest modules take
 * the provider-agnostic contract from here, so the parser file stays the
 * single import point for it.
 */
export type { NormalizedAlert, ParseResult, ProviderAdapter };

/** Structural shape of fast-xml-parser's JSON output (v5 types it as `any`). */
type XmlValue =
  string | number | boolean | XmlValue[] | { [key: string]: XmlValue };

/** The four msgType values the OASIS CAP 1.2 schema permits. */
const CAP_MSG_TYPES: readonly string[] = ['alert', 'update', 'cancel', 'test'];

/**
 * Parse error with a stable machine code. `rawSnippet` is the first 120 chars
 * of the offending input (never more, so untrusted text stays bounded).
 */
export class CapParseError extends Error {
  code: 'MALFORMED_XML' | 'MISSING_ROOT' | 'MISSING_ID';
  rawSnippet: string;

  constructor(
    code: CapParseError['code'],
    rawSnippet: string,
    message: string,
  ) {
    super(message);
    this.name = 'CapParseError';
    this.code = code;
    this.rawSnippet = rawSnippet;
  }
}

/**
 * One parsed CAP alert. All string fields come straight from the document
 * (trimmed, untrusted). Timestamps are trimmed ISO strings when present,
 * null when absent, and are NOT reformatted or validated at parse time.
 */
export interface CapAlert {
  id: string;
  /** Mapped from CAP <msgType>; 'unknown' for absent or non-schema values. */
  msgType: CapMsgType;
  scope: string | null;
  /**
   * From <info><headline>; falls back to <info><description> truncated to
   * 500 chars; '' when neither exists (MISSING_HEADLINE is a validation
   * failure, not a parse failure).
   */
  headline: string;
  issuer: string | null;
  severity: string | null;
  urgency: string | null;
  certainty: string | null;
  issuedAt: string | null;
  effectiveAt: string | null;
  expiresAt: string | null;
  /** From <info><description>; untrusted free text. */
  body: string | null;
  /**
   * Msg ids referenced by <reference>/<references>/<inProg>/<cancel>,
   * deduped, document order preserved.
   */
  references: string[];
}

/** Bound the library's `any` parse output to our structural shape. */
function asXml(value: unknown): XmlValue | undefined {
  return value as XmlValue | undefined;
}

/** First string value of an XmlValue: text, a single-item array, or a node with one child. */
function firstString(v: XmlValue | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    return v.length === 1 ? firstString(v[0]) : undefined;
  }
  if (typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length === 1) return firstString(v[keys[0]]);
  }
  return undefined;
}

/** Trimmed string or null when absent/blank; never interprets the text. */
function trimOrNull(v: XmlValue | undefined): string | null {
  const s = firstString(v);
  if (s === undefined) return null;
  const t = s.trim();
  return t === '' ? null : t;
}

/**
 * Parse a raw CAP 1.2 document into a CapAlert.
 *
 * Multi-<alert> documents: the FIRST <alert> is taken (documented choice —
 * CAP 1.2 carries one <alert> per document; a feed serving a container of
 * several should split it into one payload per alert at the ingest layer).
 *
 * Throws CapParseError for: empty/whitespace input, unparseable XML
 * (code MALFORMED_XML), missing CAP root (MISSING_ROOT), or missing <id>
 * (MISSING_ID).
 */
export function parseCapDocument(raw: string): CapAlert {
  const snippet = raw.slice(0, 120); // bounded rawSnippet for errors
  if (raw.trim() === '') {
    throw new CapParseError(
      'MALFORMED_XML',
      snippet,
      'CAP input is empty or whitespace',
    );
  }

  // Strict pre-validation catches truncated/unbalanced documents that the
  // lenient parser would silently accept.
  const v: true | ValidationError = XMLValidator.validate(raw);
  if (v !== true) {
    throw new CapParseError(
      'MALFORMED_XML',
      snippet,
      `Malformed XML: ${v.err.msg}`,
    );
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    // Keep tag values as strings: the default strnum coercion would turn ids
    // like "123" into 123, losing the verbatim source identifier.
    parseTagValue: false,
  });
  let doc: unknown;
  try {
    doc = parser.parse(raw); // `any` in v5 typings — the sole untyped seam, bounded by asXml.
  } catch (e) {
    throw new CapParseError(
      'MALFORMED_XML',
      snippet,
      `Unparseable XML: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  const root = asXml(doc);
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    throw new CapParseError(
      'MISSING_ROOT',
      snippet,
      'Missing CAP root element',
    );
  }
  const rootObj = root as Record<string, XmlValue>;

  // Two documented root shapes, both accepted (DATA-SOURCES.md 4, OASIS CAP 1.2):
  //   * container  <cap><alert>…</alert></cap>  → fast-xml: doc.cap.alert
  //   * bare root  <alert>…</alert>             → fast-xml: doc.alert
  // The alert node is whichever of these exists; a root that is neither is not
  // CAP and is rejected, not guessed at.
  const capChild = rootObj.cap;
  let alertNode: XmlValue | undefined;
  if (capChild !== undefined) {
    // Container form: <cap> may hold several <alert>.
    const capObj =
      capChild !== null &&
      typeof capChild === 'object' &&
      !Array.isArray(capChild)
        ? (capChild as Record<string, XmlValue>)
        : undefined;
    const capAlerts = capObj?.alert;
    alertNode = Array.isArray(capAlerts) ? capAlerts[0] : capAlerts;
  } else {
    // Bare-root form: the document root is the single <alert> element.
    alertNode = rootObj.alert;
  }

  if (
    alertNode === null ||
    alertNode === undefined ||
    typeof alertNode !== 'object' ||
    Array.isArray(alertNode)
  ) {
    throw new CapParseError('MISSING_ROOT', snippet, 'Missing <alert> element');
  }
  const alert = alertNode as Record<string, XmlValue>;

  const id = trimOrNull(alert.id);
  if (id === null) {
    throw new CapParseError('MISSING_ID', snippet, 'Missing <id>');
  }

  // msgType: absent or non-schema → 'unknown' (never guessed). The CAP enum
  // is case-sensitive, but real-world senders frequently capitalize values;
  // case-fold before the membership check so "Alert" still maps to 'alert'.
  const rawMsgType = trimOrNull(alert.msgType);
  let msgType: CapMsgType = 'unknown';
  if (rawMsgType !== null) {
    const folded = rawMsgType.toLowerCase();
    if (CAP_MSG_TYPES.includes(folded)) msgType = folded as CapMsgType;
  }

  // First <info> block only (a document may carry several language infos).
  let info: Record<string, XmlValue> | undefined;
  const infoVal = alert.info;
  if (Array.isArray(infoVal) && infoVal.length > 0) {
    const head = infoVal[0];
    if (typeof head === 'object' && head !== null && !Array.isArray(head)) {
      info = head as Record<string, XmlValue>;
    }
  } else if (
    typeof infoVal === 'object' &&
    infoVal !== null &&
    !Array.isArray(infoVal)
  ) {
    info = infoVal as Record<string, XmlValue>;
  }

  // headline, with description fallback truncated to 500 chars; '' when neither.
  let headline = trimOrNull(info?.headline);
  if (headline === null) {
    const desc = trimOrNull(info?.description);
    headline = desc !== null ? desc.slice(0, 500) : '';
  }

  const references: string[] = [];
  const seen = new Set<string>();
  const collectRefs = (v: XmlValue | undefined) => {
    if (v === undefined) return;
    const items = Array.isArray(v) ? v : [v];
    for (const item of items) {
      const refId = firstString(item);
      if (refId !== undefined && refId !== '' && !seen.has(refId)) {
        seen.add(refId);
        references.push(refId);
      }
    }
  };
  for (const key of ['reference', 'references', 'inProg', 'cancel'] as const) {
    collectRefs(alert[key]);
  }
  // <block> children (CAP 1.1 nesting of inProg/cancel)
  for (const key of ['block'] as const) {
    const b = alert[key];
    if (b === undefined) continue;
    const blocks = Array.isArray(b) ? b : [b];
    for (const item of blocks) {
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const blockNode = item as Record<string, XmlValue>;
        collectRefs(blockNode.inProg);
        collectRefs(blockNode.cancel);
      } else {
        collectRefs(item);
      }
    }
  }

  return {
    id,
    msgType,
    scope: trimOrNull(alert.scope),
    headline,
    issuer: trimOrNull(alert.sender),
    severity: trimOrNull(alert.severity),
    urgency: trimOrNull(alert.urgency),
    certainty: trimOrNull(alert.certainty),
    issuedAt: trimOrNull(alert.issued),
    effectiveAt: trimOrNull(alert.effective),
    expiresAt: trimOrNull(alert.expires),
    body: trimOrNull(info?.description),
    references,
  };
}

export interface CapValidationResult {
  valid: boolean;
  /** Stable machine strings: 'MISSING_HEADLINE', 'BAD_TIME_FORMAT:<field>', 'TIME_ORDER_VIOLATION:<field>', 'UNKNOWN_MSGTYPE', 'EXPIRED_AT_VALIDATION_TIME'. */
  reasons: string[];
}

/**
 * Validate a parsed CapAlert (SAFETY-POLICY.md 7). `now` defaults to
 * `new Date()` and is used only to flag a past `expiresAt`
 * (EXPIRED_AT_VALIDATION_TIME) — a past expiry is quarantinable, not a parse
 * error. `valid` is true when no reasons are present.
 */
export function validateCapAlert(
  alert: CapAlert,
  now?: Date,
): CapValidationResult {
  const reasons: string[] = [];
  const t = now ?? new Date();

  if (alert.headline === '') reasons.push('MISSING_HEADLINE');

  const timeFields = ['issuedAt', 'effectiveAt', 'expiresAt'] as const;
  const ms: Record<string, number | null> = {};
  for (const field of timeFields) {
    const raw = alert[field];
    if (raw === null) {
      ms[field] = null;
      continue;
    }
    const parsed = new Date(raw).getTime();
    if (Number.isNaN(parsed)) {
      reasons.push(`BAD_TIME_FORMAT:${field}`);
      ms[field] = null;
    } else {
      ms[field] = parsed;
    }
  }

  // issued > effective > expires chain, ignoring nulls (and bad-format nulls).
  if (
    ms.issuedAt !== null &&
    ms.effectiveAt !== null &&
    ms.issuedAt > ms.effectiveAt
  ) {
    reasons.push('TIME_ORDER_VIOLATION:issuedAt');
  }
  if (
    ms.effectiveAt !== null &&
    ms.expiresAt !== null &&
    ms.effectiveAt > ms.expiresAt
  ) {
    reasons.push('TIME_ORDER_VIOLATION:effectiveAt');
  }

  if (alert.msgType === 'unknown') reasons.push('UNKNOWN_MSGTYPE');

  if (ms.expiresAt !== null && ms.expiresAt < t.getTime()) {
    reasons.push('EXPIRED_AT_VALIDATION_TIME');
  }

  return { valid: reasons.length === 0, reasons };
}
