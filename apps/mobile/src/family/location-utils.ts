import {
  canCollectPreciseLocation,
  type LocationShare,
  type LocationPrecision,
} from '../location.ts';

/**
 * Location precision helpers (Phase 7, SECURITY.md 5).
 *
 * SECURITY.md 5 requires minimising precision and retention: location is
 * collected at the moment of need (never background), and a precise
 * coordinate is only ever permitted when the share is active AND
 * explicitly precision='precise' (the consent model in src/location.ts).
 *
 * These are pure functions so they are testable without any native module:
 * `coordinateToSend` returns exactly the coordinate the client may transmit
 * for a draft share. When precise collection is not permitted, only a coarse
 * (~110 m) value is sent — never a precise coordinate (and precise values
 * are never sent to analytics or logs).
 */

/** ~110 m of latitude/longitude; matches the server-side coarse rounding. */
export const COARSE_DEGREES = 0.001;

/** Round a decimal degree to the coarse share resolution. */
export function roundCoarse(degrees: number): number {
  return Math.round(degrees / COARSE_DEGREES) * COARSE_DEGREES;
}

export interface ShareDraft {
  recipient: string;
  purpose: string;
  /** ISO expiry. */
  expiresAtIso: string;
  precision: LocationPrecision;
  consented: boolean;
  revoked: boolean;
}

function draftAsShare(draft: ShareDraft): LocationShare {
  return {
    id: 'draft',
    recipient: draft.recipient,
    purpose: draft.purpose,
    precision: draft.precision,
    consented: draft.consented,
    expiresAt: draft.expiresAtIso,
    revoked: draft.revoked,
  };
}

/**
 * The coordinate the client may send for a draft share.
 *
 * - Precise collection is permitted only when the share is active (not
 *   revoked, not expired, consented) AND precision is 'precise'
 *   (location.ts `canCollectPreciseLocation`).
 * - When it is permitted, the full-precision value is returned; otherwise
 *   only a coarse (~110 m) value is returned.
 * - This is the single source of truth the location screen uses, so the
 *   "never send a precise coordinate without explicit consent" guarantee
 *   holds on the client as well as the server.
 */
export function coordinateToSend(
  raw: { lat: number; lng: number },
  draft: ShareDraft,
  now: Date,
): { lat: number; lng: number } {
  if (canCollectPreciseLocation(draftAsShare(draft), now)) {
    return { lat: raw.lat, lng: raw.lng };
  }
  return { lat: roundCoarse(raw.lat), lng: roundCoarse(raw.lng) };
}
