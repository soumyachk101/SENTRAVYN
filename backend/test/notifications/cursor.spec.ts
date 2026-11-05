import { decodeCursor, encodeCursor } from '../../src/notifications/sync.service';
import type { SyncItem } from '../../src/notifications/types';

/**
 * Unit spec for the opaque sync cursor (Phase 6 reconnect sync).
 *
 * The cursor is a base64url-encoded JSON token over the composite order key
 * (createdAt, alertId, revision). These tests pin the round-trip contract:
 * a token encoded from an item decodes to the exact same fields, and
 * anything malformed (tampered, wrong encoding, truncated) decodes to null
 * so the server falls back to the latest tail instead of erroring.
 */

function item(overrides: Partial<SyncItem> = {}): SyncItem {
  return {
    alertId: 'al-1',
    revision: 3,
    status: 'UPDATED',
    headline: 'Flood warning',
    severity: 'Severe',
    urgency: 'Immediate',
    issuer: 'Test Authority',
    issuedAt: '2026-01-01T00:00:00.000Z',
    cursor: 'row-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('sync cursor codec (Phase 6 durable reconnect)', () => {
  it('round-trips a well-formed cursor token', () => {
    const token = encodeCursor(item());
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    const decoded = decodeCursor(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.c).toBe('2026-01-01T00:00:00.000Z');
    expect(decoded?.a).toBe('al-1');
    expect(decoded?.r).toBe(3);
  });

  it('decodes a different item distinctly', () => {
    const a = decodeCursor(encodeCursor(item()));
    const b = decodeCursor(
      encodeCursor(
        item({ alertId: 'al-2', revision: 4, createdAt: '2026-01-02T00:00:00.000Z' }),
      ),
    );
    expect(a).not.toEqual(b);
    expect(b?.a).toBe('al-2');
    expect(b?.r).toBe(4);
  });

  it.each([
    ['null', null],
    ['empty string', ''],
    ['garbage', 'not-a-cursor'],
    ['truncated base64url', 'eyJjIjoi'],
    ['valid base64 but not JSON', Buffer.from('hello').toString('base64url')],
    ['JSON with wrong field types', Buffer.from(JSON.stringify({ c: 1 })).toString('base64url')],
    [
      'JSON with an unparseable date',
      Buffer.from(JSON.stringify({ c: 'not-a-date', a: 'al-1', r: 1 })).toString('base64url'),
    ],
  ])('returns null for %s', (_label, raw: string | null) => {
    expect(decodeCursor(raw)).toBeNull();
  });
});
