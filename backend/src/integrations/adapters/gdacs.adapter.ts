import { Injectable } from '@nestjs/common';
import type { ParseResult, ProviderAdapter, RejectedRecord } from '../types';

/**
 * One element of the GDACS event feed as documented in docs/DATA-SOURCES.md:
 * a minimal JSON array of `{ eventid, title, datetime, description? }`.
 *
 * The element shape is intentionally the smallest contract we trust:
 * anything else is surfaced as a rejection, not guessed at.
 */
interface GdacsEvent {
  eventid?: unknown;
  title?: unknown;
  datetime?: unknown;
  description?: unknown;
}

@Injectable()
export class GdacsAdapter implements ProviderAdapter {
  readonly key = 'gdacs';
  readonly name = 'GDACS';

  parse(rawPayload: string, fetchedAt: Date): ParseResult {
    const result: ParseResult = {
      providerKey: this.key,
      events: [],
      quarantined: [],
      rejected: [],
    };
    const fetchedAtIso = fetchedAt.toISOString();

    let payload: unknown;
    try {
      payload = JSON.parse(rawPayload);
    } catch {
      result.rejected.push(
        this.rejected(
          'unknown',
          'MALFORMED_JSON',
          rawPayload,
          fetchedAtIso,
          'payload is not valid JSON',
        ),
      );
      return result;
    }

    // A GDACS feed is a JSON array of event objects; anything else (an object,
    // a string, ...) is one rejection for the whole fetch, not per-element.
    if (!Array.isArray(payload)) {
      result.rejected.push(
        this.rejected(
          'unknown',
          'MALFORMED_JSON',
          rawPayload,
          fetchedAtIso,
          'payload is not a JSON array',
        ),
      );
      return result;
    }

    for (const element of payload) {
      const event = (element ?? {}) as GdacsEvent;
      const eventid = event.eventid;

      if (eventid === undefined || eventid === null || eventid === '') {
        result.rejected.push(
          this.rejected(
            'unknown',
            'MISSING_EVENTID',
            rawPayload,
            fetchedAtIso,
            'element has no eventid',
          ),
        );
        continue;
      }
      // The provider-native identifier must be a string or a number, preserved
      // verbatim for provenance + dedup (DATA-SOURCES.md 1). An object/array/
      // boolean eventid is not a usable identifier: reject it rather than
      // stringify it to a garbage "gdacs:[object Object]" externalRef.
      if (typeof eventid !== 'string' && typeof eventid !== 'number') {
        result.rejected.push(
          this.rejected(
            'unknown',
            'INVALID_EVENTID',
            rawPayload,
            fetchedAtIso,
            'eventid must be a string or number',
          ),
        );
        continue;
      }
      const sourceId = String(eventid);

      if (typeof event.title !== 'string' || event.title.length === 0) {
        result.rejected.push(
          this.rejected(
            sourceId,
            'MISSING_TITLE',
            rawPayload,
            fetchedAtIso,
            'element has no usable title',
          ),
        );
        continue;
      }

      const issuedAt = this.parseIsoTime(event.datetime);
      if (issuedAt === null) {
        // A GDACS element with an unparseable datetime is rejected, not
        // quarantined: there is no canonical event we could even store
        // (ADR-007 quarantine is for records that normalised but failed
        // validation — only the CAP parser has that category this phase).
        result.rejected.push(
          this.rejected(
            sourceId,
            'BAD_TIME',
            rawPayload,
            fetchedAtIso,
            'datetime is not parseable ISO 8601',
          ),
        );
        continue;
      }

      result.events.push({
        providerKey: this.key,
        sourceId,
        // Namespaced so a GDACS event id can never collide with a CAP <id>
        // (CAP uses bare, globally-unique urn:uuid ids; the "gdacs:" prefix
        // keeps the two externalRef spaces disjoint).
        externalRef: `gdacs:${sourceId}`,
        msgType: 'alert',
        headline: event.title,
        issuer: 'GDACS',
        severity: null,
        urgency: null,
        certainty: null,
        scope: null,
        issuedAt,
        effectiveAt: null,
        expiresAt: null,
        body: typeof event.description === 'string' ? event.description : null,
        references: [],
        rawPayload,
        fetchedAt: fetchedAtIso,
      });
    }

    return result;
  }

  /** Returns the ISO string when the value is a parseable ISO 8601 time, else null. */
  private parseIsoTime(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed.toISOString();
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
