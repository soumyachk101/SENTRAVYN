import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  coordinateToSend,
  roundCoarse,
  type ShareDraft,
} from '../family/location-utils.ts';

/**
 * Unit tests for the location-precision helper (Phase 7, SECURITY.md 5).
 * The guarantee under test: a precise coordinate is only ever emitted when
 * the share is active AND explicit precise consent is given; otherwise only
 * a coarse (~110 m) value is produced. No precise value reaches analytics.
 */

const now = new Date('2026-11-04T12:00:00Z');

function draft(overrides: Partial<ShareDraft> = {}): ShareDraft {
  return {
    recipient: 'partner',
    purpose: 'household check-in',
    expiresAtIso: '2026-11-04T18:00:00Z',
    precision: 'approximate',
    consented: true,
    revoked: false,
    ...overrides,
  };
}

const RAW = { lat: 51.50042, lng: -0.12345 };

test('roundCoarse reduces a coordinate to ~110m resolution', () => {
  assert.equal(roundCoarse(51.50042), 51.5);
  assert.equal(roundCoarse(-0.12345), -0.123);
});

test('a precise, active, consented share transmits the full coordinate', () => {
  const sent = coordinateToSend(
    RAW,
    draft({ precision: 'precise', consented: true, revoked: false }),
    now,
  );
  assert.deepEqual(sent, RAW);
});

test('a coarse share never transmits a precise coordinate', () => {
  const sent = coordinateToSend(
    RAW,
    draft({ precision: 'approximate', consented: true }),
    now,
  );
  assert.equal(sent.lat, 51.5);
  assert.equal(sent.lng, -0.123);
});

test('a revoked share transmits only a coarse coordinate', () => {
  const sent = coordinateToSend(
    RAW,
    draft({ precision: 'precise', consented: true, revoked: true }),
    now,
  );
  assert.equal(sent.lat, 51.5);
  assert.equal(sent.lng, -0.123);
});

test('an expired share transmits only a coarse coordinate', () => {
  const sent = coordinateToSend(
    RAW,
    draft({ precision: 'precise', consented: true, expiresAtIso: '2026-11-04T11:00:00Z' }),
    now,
  );
  assert.equal(sent.lat, 51.5);
  assert.equal(sent.lng, -0.123);
});

test('a not-consented share transmits only a coarse coordinate', () => {
  const sent = coordinateToSend(
    RAW,
    draft({ precision: 'precise', consented: false }),
    now,
  );
  assert.equal(sent.lat, 51.5);
  assert.equal(sent.lng, -0.123);
});
