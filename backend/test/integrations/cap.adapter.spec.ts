import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CapAdapter } from '../../src/integrations/adapters/cap.adapter';

const FETCHED_AT = new Date('2026-02-12T08:00:00Z');

/**
 * CAP XML sample. The canonical fixture lives at test/fixtures/cap/ (written
 * by the parser head in parallel); we read it when present so the adapter and
 * parser tests agree on the exact bytes. The inline string below mirrors the
 * fixture for a checkout that does not carry the file yet.
 */
const fixturePath = resolve(__dirname, '..', 'fixtures', 'cap', 'sample-alert.xml');
const INLINE_CAP = `<?xml version="1.0" encoding="UTF-8"?>
<cap version="2.0" xmlns="urn:us:government:fema">
  <alert>
    <id>urn:oid:sentravyn-e2e-cap-1</id>
    <sender>noreply@sentravyn.example</sender>
    <issued>2026-02-12T06:00:00Z</issued>
    <msgType>Alert</msgType>
    <scope>Public</scope>
    <severity>Moderate</severity>
    <urgency>Immediate</urgency>
    <certainty>Observed</certainty>
    <info>
      <language>en-US</language>
      <headline>Storm warning - coastal lowlands</headline>
      <description>Severe storm warning in effect for the coastal lowlands.</description>
    </info>
    <effective>2026-02-12T06:00:00Z</effective>
    <expires>2026-02-13T06:00:00Z</expires>
  </alert>
</cap>
`;

// Normalises to a valid CAP alert but fails time validation: the <effective>
// value is not a timestamp, so the parser flags BAD_TIME_FORMAT:effectiveAt
// and the adapter quarantines (not rejects) the record (ADR-007).
const CAP_UPDATE_WITH_BAD_TIMES = `<?xml version="1.0" encoding="UTF-8"?>
<cap version="2.0" xmlns="urn:us:government:fema">
  <alert>
    <id>urn:oid:sentravyn-e2e-cap-badtimes</id>
    <sender>noreply@sentravyn.example</sender>
    <issued>2026-02-12T06:00:00Z</issued>
    <msgType>Update</msgType>
    <scope>Public</scope>
    <info>
      <language>en-US</language>
      <headline>Storm warning - coastal lowlands (updated)</headline>
      <description>Updated severe storm warning.</description>
    </info>
    <effective>not-a-timestamp</effective>
  </alert>
</cap>
`;

function capPayload(): string {
  if (existsSync(fixturePath)) {
    return readFileSync(fixturePath, 'utf8');
  }
  return INLINE_CAP;
}

describe('CapAdapter (Phase 3, ADR-007)', () => {
  const adapter = new CapAdapter();

  it('exposes the cap provider key and display name', () => {
    expect(adapter.key).toBe('cap');
    expect(adapter.name).toBe('CAP (generic)');
  });

  it('parses a CAP document into exactly one event', () => {
    const payload = capPayload();
    const result = adapter.parse(payload, FETCHED_AT);

    expect(result.providerKey).toBe('cap');
    expect(result.events).toHaveLength(1);
    expect(result.quarantined).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);

    const event = result.events[0];
    // CAP <identifier> is the externalRef: it is globally unique, so it is
    // not namespaced (unlike the GDACS "gdacs:" prefix).
    expect(event.externalRef).toBe(event.sourceId);
    expect(event.headline.length).toBeGreaterThan(0);
    // The full raw document is preserved verbatim (ADR-007 immutable record).
    expect(event.rawPayload).toBe(payload);
    expect(event.fetchedAt).toBe(FETCHED_AT.toISOString());
  });

  it('rejects a truncated document with one rejection carrying the parser error code', () => {
    const result = adapter.parse('<CAP><broken>', FETCHED_AT);

    expect(result.events).toHaveLength(0);
    expect(result.quarantined).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    // Unbalanced XML is a parse error, not a "not CAP" document.
    expect(result.rejected[0].code).toBe('MALFORMED_XML');
    expect(result.rejected[0].sourceId).toBe('unknown');
    expect(result.rejected[0].rawPayload).toBe('<CAP><broken>');
  });

  it('rejects a well-formed document that has no CAP root element', () => {
    const result = adapter.parse('<notcap></notcap>', FETCHED_AT);

    expect(result.events).toHaveLength(0);
    expect(result.quarantined).toHaveLength(0);
    expect(result.rejected).toHaveLength(1);
    // Parses cleanly but is not CAP: the parser reports a missing root.
    expect(result.rejected[0].code).toBe('MISSING_ROOT');
  });

  it('quarantines a document that normalises but fails validation', () => {
    const result = adapter.parse(CAP_UPDATE_WITH_BAD_TIMES, FETCHED_AT);

    expect(result.events).toHaveLength(0);
    expect(result.rejected).toHaveLength(0);
    expect(result.quarantined).toHaveLength(1);

    const quarantined = result.quarantined[0];
    expect(quarantined.quarantine).toBeDefined();
    expect(quarantined.quarantine?.code.length).toBeGreaterThan(0);
    expect(quarantined.quarantine?.reason.length).toBeGreaterThan(0);
    expect(quarantined.rawPayload).toBe(CAP_UPDATE_WITH_BAD_TIMES);
  });
});
