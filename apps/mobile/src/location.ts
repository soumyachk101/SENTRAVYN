/**
 * Location consent model (SECURITY.md 5, PRODUCT-SPEC.md 5 & 8).
 *
 * Precise location is highly sensitive. These pure helpers define when
 * location may be collected and shared: always with explicit, informed
 * consent, for a bounded scope and duration, and always revocable. There is
 * no default continuous tracking.
 */

export type LocationPrecision = 'approximate' | 'precise';

export interface LocationShare {
  id: string;
  /** Who may receive the location. */
  recipient: string;
  /** Why. */
  purpose: string;
  precision: LocationPrecision;
  /** Consent granted by the user. */
  consented: boolean;
  /** ISO expiry; when now >= expiry the share is no longer active. */
  expiresAt: string;
  /** Revoked by the user. */
  revoked: boolean;
}

export function isActiveShare(share: LocationShare, now: Date): boolean {
  if (!share.consented || share.revoked) return false;
  const expiry = new Date(share.expiresAt).getTime();
  return now.getTime() < expiry;
}

export function canCollectPreciseLocation(
  share: LocationShare,
  now: Date,
): boolean {
  return isActiveShare(share, now) && share.precision === 'precise';
}

export function revokeShare(share: LocationShare): LocationShare {
  return { ...share, revoked: true, consented: false };
}
