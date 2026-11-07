import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  canCollectPreciseLocation,
  isActiveShare,
  revokeShare,
  type LocationShare,
} from '../location.ts';

const now = new Date('2026-11-04T12:00:00Z');

function share(overrides: Partial<LocationShare> = {}): LocationShare {
  return {
    id: 'share-1',
    recipient: 'family-member-1',
    purpose: 'Household check-in during a declared emergency',
    precision: 'approximate',
    consented: true,
    expiresAt: '2026-11-04T18:00:00Z',
    revoked: false,
    ...overrides,
  };
}

test('a consented, unexpired share is active', () => {
  assert.equal(isActiveShare(share(), now), true);
});

test('precise location is not collected without explicit consent', () => {
  assert.equal(
    canCollectPreciseLocation(
      share({ consented: false, precision: 'precise' }),
      now,
    ),
    false,
  );
});

test('precise location is not collected after expiry', () => {
  assert.equal(
    canCollectPreciseLocation(
      share({ precision: 'precise', expiresAt: '2026-11-04T11:00:00Z' }),
      now,
    ),
    false,
  );
});

test('approximate precision never permits precise collection', () => {
  assert.equal(
    canCollectPreciseLocation(share({ precision: 'approximate' }), now),
    false,
  );
});

test('revocation stops the share immediately', () => {
  const revoked = revokeShare(share());
  assert.equal(revoked.revoked, true);
  assert.equal(isActiveShare(revoked, now), false);
});
