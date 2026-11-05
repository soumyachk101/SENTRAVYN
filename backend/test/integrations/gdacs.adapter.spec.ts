import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GdacsAdapter } from '../../src/integrations/adapters/gdacs.adapter';

const fixturePath = resolve(__dirname, '..', 'fixtures', 'gdacs', 'sample-events.json');
const samplePayload = readFileSync(fixturePath, 'utf8');

const FETCHED_AT = new Date('2026-02-12T08:00:00Z');

describe('GdacsAdapter (Phase 3, ADR-007)', () => {
  const adapter = new GdacsAdapter();

  it('exposes the gdacs provider key and display name', () => {
    expect(adapter.key).toBe('gdacs');
    expect(adapter.name).toBe('GDACS');
  });

  it('parses the documented sample feed into one event per element', () => {
    const result = adapter.parse(samplePayload, FETCHED_AT);

    expect(result.providerKey).toBe('gdacs');
    expect(result.events).toHaveLength(2);
    expect(result.rejected).toHaveLength(0);
    // GDACS elements are either valid or rejected this phase: there is no
    // normalised-but-failed category, so quarantined stays empty.
    expect(result.quarantined).toHaveLength(0);

    const [first, second] = result.events;
    expect(first.sourceId).toBe('4242');
    // Namespaced externalRef: "gdacs:<eventid>" never collides with a CAP <id>.
    expect(first.externalRef).toBe('gdacs:4242');
    expect(first.headline).toBe('M 5.1 earthquake - off the Pacific coast');
    expect(first.issuer).toBe('GDACS');
    expect(first.msgType).toBe('alert');
    expect(first.issuedAt).toBe('2026-02-12T06:00:00.000Z');
    expect(first.body).toBe('Magnitude 5.1 earthquake reported near the continental shelf.');
    expect(first.rawPayload).toBe(samplePayload);
    expect(first.fetchedAt).toBe(FETCHED_AT.toISOString());

    // Second element has no description → body is null, not a missing field.
    expect(second.sourceId).toBe('4243');
    expect(second.externalRef).toBe('gdacs:4243');
    expect(second.body).toBeNull();
    expect(second.effectiveAt).toBeNull();
    expect(second.expiresAt).toBeNull();
  });

  it('rejects a non-JSON payload with a single MALFORMED_JSON rejection', () => {
    const result = adapter.parse('not valid json', FETCHED_AT);

    expect(result.events).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].code).toBe('MALFORMED_JSON');
  });

  it('rejects a JSON payload that is not an array with one MALFORMED_JSON rejection', () => {
    const result = adapter.parse('{"eventid": 1}', FETCHED_AT);

    expect(result.events).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].code).toBe('MALFORMED_JSON');
  });

  it('rejects an element missing eventid with MISSING_EVENTID', () => {
    const result = adapter.parse(
      '[{"title": "no event id", "datetime": "2026-01-01T00:00:00Z"}]',
      FETCHED_AT,
    );

    expect(result.events).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].code).toBe('MISSING_EVENTID');
    expect(result.rejected[0].sourceId).toBe('unknown');
  });

  it('rejects an element whose eventid is an object/array/boolean (INVALID_EVENTID, never stringified to garbage)', () => {
    const result = adapter.parse(
      JSON.stringify([
        { eventid: { nested: 'object' }, title: 'T', datetime: '2026-01-01T00:00:00Z' },
      ]),
      FETCHED_AT,
    );

    expect(result.events).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].code).toBe('INVALID_EVENTID');
  });

  it('rejects an element missing a usable title with MISSING_TITLE', () => {
    const result = adapter.parse(
      '[{"eventid": 7, "datetime": "2026-01-01T00:00:00Z"}]',
      FETCHED_AT,
    );

    expect(result.events).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].code).toBe('MISSING_TITLE');
    expect(result.rejected[0].sourceId).toBe('7');
  });

  it('rejects an element with an unparseable datetime as BAD_TIME while the other elements still parse', () => {
    const result = adapter.parse(
      JSON.stringify([
        { eventid: 1, title: 'A', datetime: 'not-a-time' },
        { eventid: 2, title: 'B', datetime: '2026-01-01T00:00:00Z' },
      ]),
      FETCHED_AT,
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0].sourceId).toBe('2');
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].code).toBe('BAD_TIME');
    expect(result.rejected[0].sourceId).toBe('1');
    // All rejections carry the verbatim payload for provenance (ADR-007).
    expect(result.rejected[0].rawPayload).toBeDefined();
    expect(result.rejected[0].fetchedAt).toBe(FETCHED_AT.toISOString());
  });
});
