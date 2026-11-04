import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  parseCapDocument,
  CapParseError,
  validateCapAlert,
} from '../src/integrations/cap/cap.parser';
import type { CapAlert } from '../src/integrations/cap/cap.parser';

const FIXTURES = path.join(__dirname, 'fixtures', 'cap');

function fixture(name: string): string {
  return fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
}

describe('parseCapDocument (CAP 1.2, DATA-SOURCES.md 4)', () => {
  it('parses the valid sample alert with all fields', () => {
    const alert = parseCapDocument(fixture('sample-alert.xml'));
    expect(alert).toEqual({
      id: 'urn:oid:1.1.2.3-456',
      msgType: 'alert',
      scope: 'Public',
      headline: 'Severe weather warning in effect',
      issuer: 'test@alert.test',
      severity: 'Extreme',
      urgency: 'Immediate',
      certainty: 'Observed',
      issuedAt: '2026-09-01T12:00:00+00:00',
      effectiveAt: '2026-09-01T12:30:00+00:00',
      expiresAt: '2026-09-01T18:00:00+00:00',
      body: 'A severe weather warning is in effect for the test region. Monitor official channels.',
      references: ['urn:oid:1.1.2.3-455'],
    });
  });

  it('maps an unknown <msgType> value to unknown without guessing', () => {
    const alert = parseCapDocument(fixture('drill.xml'));
    expect(alert.msgType).toBe('unknown');
  });

  it('maps a capitalized schema msgType (Alert) to the lowercase CapMsgType', () => {
    expect(parseCapDocument(fixture('sample-alert.xml')).msgType).toBe('alert');
  });

  it('parses msgType test and treats test as a first-class message type', () => {
    const alert = parseCapDocument(fixture('test-message.xml'));
    expect(alert.msgType).toBe('test');
    expect(validateCapAlert(alert, new Date('2026-09-01T09:00:00Z')).valid).toBe(true);
  });

  it('parses a cancel: references the cancelled alert and omits times', () => {
    const alert = parseCapDocument(fixture('cancel.xml'));
    expect(alert.msgType).toBe('cancel');
    expect(alert.references).toEqual(['urn:oid:1.1.2.3-456']);
    expect(alert.effectiveAt).toBeNull();
    expect(alert.expiresAt).toBeNull();
  });

  it('dedupes <inProg> references while preserving document order', () => {
    const alert = parseCapDocument(fixture('update.xml'));
    expect(alert.msgType).toBe('update');
    expect(alert.references).toEqual(['urn:oid:1.1.2.3-456', 'urn:oid:1.1.2.3-455']);
  });

  it('parses to headline "" and body null when only an empty <description> exists', () => {
    // no-headline.xml: <info> carries only an empty <description> and no
    // <headline>; the parse succeeds, the empty headline is a validation failure.
    const alert = parseCapDocument(fixture('no-headline.xml'));
    expect(alert.headline).toBe('');
    expect(alert.body).toBeNull();
  });

  it('falls back to the 500-char-truncated description when no headline exists', () => {
    const longDesc = 'x'.repeat(600);
    const xml = `<cap version="2.0" xmlns="urn:us:government:fema"><alert><id>a</id><msgType>Alert</msgType><info><language>en-US</language><description>${longDesc}</description></info></alert></cap>`;
    const alert = parseCapDocument(xml);
    expect(alert.headline).toBe('x'.repeat(500));
  });

  it('keeps time elements as trimmed ISO strings, not reformatted', () => {
    const alert = parseCapDocument(fixture('sample-alert.xml'));
    expect(alert.issuedAt).toBe('2026-09-01T12:00:00+00:00');
  });

  it('throws MALFORMED_XML for empty and whitespace input', () => {
    for (const raw of ['', '   \n ']) {
      expect(() => parseCapDocument(raw)).toThrow(CapParseError);
      try {
        parseCapDocument(raw);
      } catch (e) {
        expect(e).toBeInstanceOf(CapParseError);
        expect((e as CapParseError).code).toBe('MALFORMED_XML');
        expect((e as CapParseError).rawSnippet).toEqual(raw.slice(0, 120));
      }
    }
  });

  it('throws MALFORMED_XML for the truncated fixture', () => {
    try {
      parseCapDocument(fixture('malformed.xml'));
      fail('expected CapParseError');
    } catch (e) {
      expect(e).toBeInstanceOf(CapParseError);
      expect((e as CapParseError).code).toBe('MALFORMED_XML');
      expect((e as CapParseError).rawSnippet.length).toBeLessThanOrEqual(120);
    }
  });

  it('throws MISSING_ROOT when the CAP root element is absent', () => {
    try {
      parseCapDocument('<foo><bar/></foo>');
      fail('expected CapParseError');
    } catch (e) {
      expect(e).toBeInstanceOf(CapParseError);
      expect((e as CapParseError).code).toBe('MISSING_ROOT');
    }
  });

  it('throws MISSING_ID for the fixture without <id>', () => {
    try {
      parseCapDocument(fixture('missing-id.xml'));
      fail('expected CapParseError');
    } catch (e) {
      expect(e).toBeInstanceOf(CapParseError);
      expect((e as CapParseError).code).toBe('MISSING_ID');
    }
  });
});

describe('validateCapAlert (SAFETY-POLICY.md 7)', () => {
  const withinExpiry = new Date('2026-09-01T15:00:00Z');

  it('flags the valid sample alert clean before its expiry', () => {
    const alert: CapAlert = parseCapDocument(fixture('sample-alert.xml'));
    const r = validateCapAlert(alert, withinExpiry);
    expect(r.valid).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  it('flags a past expiresAt as EXPIRED_AT_VALIDATION_TIME (quarantinable, not a parse error)', () => {
    const alert = parseCapDocument(fixture('sample-alert.xml'));
    const r = validateCapAlert(alert, new Date('2026-11-04T12:00:00Z'));
    expect(r.valid).toBe(false);
    expect(r.reasons).toEqual(['EXPIRED_AT_VALIDATION_TIME']);
  });

  it('flags the bad-times fixture with TIME_ORDER_VIOLATION:issuedAt', () => {
    const alert = parseCapDocument(fixture('bad-times.xml'));
    const r = validateCapAlert(alert, withinExpiry);
    expect(r.valid).toBe(false);
    expect(r.reasons).toEqual(
      expect.arrayContaining(['TIME_ORDER_VIOLATION:issuedAt']),
    );
  });

  it('flags a missing headline with MISSING_HEADLINE', () => {
    const alert = parseCapDocument(fixture('no-headline.xml'));
    const r = validateCapAlert(alert, withinExpiry);
    expect(r.valid).toBe(false);
    expect(r.reasons).toEqual(expect.arrayContaining(['MISSING_HEADLINE']));
  });

  it('flags an unknown msgType with UNKNOWN_MSGTYPE', () => {
    const alert = parseCapDocument(fixture('drill.xml'));
    const r = validateCapAlert(alert, new Date('2026-09-01T15:00:00Z'));
    expect(r.valid).toBe(false);
    expect(r.reasons).toEqual(['UNKNOWN_MSGTYPE']);
  });

  it('flags unparseable timestamp strings with BAD_TIME_FORMAT:<field>', () => {
    const alert: CapAlert = {
      id: 'x',
      msgType: 'alert',
      scope: 'Public',
      headline: 'h',
      issuer: null,
      severity: null,
      urgency: null,
      certainty: null,
      issuedAt: 'not-a-time',
      effectiveAt: null,
      expiresAt: null,
      body: null,
      references: [],
    };
    const r = validateCapAlert(alert, withinExpiry);
    expect(r.valid).toBe(false);
    expect(r.reasons).toEqual(['BAD_TIME_FORMAT:issuedAt']);
  });

  it('ignores null times in the issued > effective > expires chain', () => {
    const alert: CapAlert = {
      id: 'x',
      msgType: 'alert',
      scope: null,
      headline: 'h',
      issuer: null,
      severity: null,
      urgency: null,
      certainty: null,
      issuedAt: null,
      effectiveAt: '2026-09-01T18:00:00Z', // later than issued, but issued is null
      expiresAt: null,
      body: null,
      references: [],
    };
    expect(validateCapAlert(alert, withinExpiry).valid).toBe(true);
  });
});
