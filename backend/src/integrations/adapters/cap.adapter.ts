import { Injectable } from '@nestjs/common';
import type {
  NormalizedAlert,
  ParseResult,
  ProviderAdapter,
  RejectedRecord,
} from '../types';
import type { CapAlert } from '../cap/cap.parser';
import {
  CapParseError,
  parseCapDocument,
  validateCapAlert,
} from '../cap/cap.parser';

/**
 * Generic CAP parser adapter. The parsing and validation logic lives in the
 * shared ../cap/cap.parser module (ADR-007: every provider ships fixtures +
 * parser tests). This adapter only wraps it in the ProviderAdapter seam so
 * the ingest service stays provider-agnostic.
 *
 * rawPayload is stored in full on every event / quarantined / rejected item
 * (ADR-007 immutable raw record) — it is never trimmed to per-event.
 */
@Injectable()
export class CapAdapter implements ProviderAdapter {
  readonly key = 'cap';
  readonly name = 'CAP (generic)';

  parse(rawPayload: string, fetchedAt: Date): ParseResult {
    const result: ParseResult = {
      providerKey: this.key,
      events: [],
      quarantined: [],
      rejected: [],
    };
    const fetchedAtIso = fetchedAt.toISOString();

    let alert: CapAlert;
    try {
      alert = parseCapDocument(rawPayload);
    } catch (error) {
      if (error instanceof CapParseError) {
        result.rejected.push(
          this.rejected(
            'unknown',
            error.code,
            rawPayload,
            fetchedAtIso,
            error.message,
          ),
        );
      } else {
        // Any non-CAPParseError is a parser bug, not untrusted-data shape.
        result.rejected.push(
          this.rejected(
            'unknown',
            'MALFORMED_XML',
            rawPayload,
            fetchedAtIso,
            `unexpected parser error: ${String(error)}`,
          ),
        );
      }
      return result;
    }

    const normalized = this.normalized(alert, rawPayload, fetchedAtIso);
    // Validate against the fetch time, not the wall clock: at ingest the raw
    // record was current at `fetchedAt`; a document whose expiry had already
    // passed by fetch time is quarantined, not silently dropped or treated
    // as live later (SAFETY-POLICY.md 8).
    const validation = validateCapAlert(alert, fetchedAt);

    if (validation.valid) {
      result.events.push(normalized);
    } else {
      // Normalised but failed validation → quarantine with the parser's
      // reason(s), not reject (ADR-007 quarantine-by-default).
      result.quarantined.push({
        ...normalized,
        quarantine: {
          code: validation.reasons[0] ?? 'VALIDATION_FAILED',
          reason: validation.reasons.join(', '),
        },
      });
    }

    return result;
  }

  private normalized(
    alert: CapAlert,
    rawPayload: string,
    fetchedAtIso: string,
  ): NormalizedAlert {
    return {
      providerKey: this.key,
      sourceId: alert.id,
      externalRef: alert.id,
      msgType: alert.msgType,
      headline: alert.headline,
      issuer: alert.issuer,
      severity: alert.severity,
      urgency: alert.urgency,
      certainty: alert.certainty,
      scope: alert.scope,
      issuedAt: alert.issuedAt,
      effectiveAt: alert.effectiveAt,
      expiresAt: alert.expiresAt,
      body: alert.body,
      references: alert.references,
      rawPayload,
      fetchedAt: fetchedAtIso,
    };
  }

  private rejected(
    sourceId: string,
    code: string,
    rawPayload: string,
    fetchedAtIso: string,
    reason: string,
  ): RejectedRecord {
    return { sourceId, code, reason, rawPayload, fetchedAt: fetchedAtIso };
  }
}
