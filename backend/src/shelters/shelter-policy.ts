/**
 * Shelter and operational-status policy (SAFETY-POLICY.md 3, Gate E).
 *
 * A place existing on a map does NOT establish that it is open, operational,
 * accessible, safe or suitable as a shelter (PRODUCT-SPEC.md 6). This module
 * encodes the rule that a shelter may only be surfaced as VERIFIED when the
 * required evidence is present, the verification is still within its
 * revalidation window, and an authorised privileged approval is on record.
 *
 * It is a pure function so it can be unit tested without a database.
 */

export interface ShelterEvidence {
  /** Responsible verifying authority. */
  authority: string | null;
  /** Shelter classification and intended hazard applicability. */
  classification: string | null;
  /** Inspection / verification date. */
  verificationDate: string | null; // ISO
  /** Expiry / revalidation deadline. When set and passed, the record is EXPIRED. */
  expiresAt: string | null; // ISO
  /**
   * How often (in days) a verification must be revalidated. When omitted, a
   * documented default is applied. Within the window the record is VERIFIED;
   * past the window it is shown as STALE until revalidated (SAFETY-POLICY 8).
   */
  revalidationWindowDays?: number;
}

export interface ShelterApproval {
  /** The user id who authorised the publication. */
  approvedBy: string | null;
  /** Whether the approver held a privileged (REVIEWER or above) role. */
  approverPrivileged: boolean;
}

export interface ShelterPolicyInput {
  evidence: ShelterEvidence;
  approval: ShelterApproval;
  /** Reference time, injectable for deterministic tests. */
  now?: Date;
}

export interface ShelterPolicyResult {
  /** Whether this shelter may be displayed as VERIFIED. */
  canDisplayAsVerified: boolean;
  /**
   * The state the shelter must be displayed as, present only when it is NOT
   * verified. Absent when `canDisplayAsVerified` is true.
   */
  displayState?: 'UNVERIFIED' | 'STALE' | 'EXPIRED' | 'INCOMPLETE';
  /** Human-readable reasons (for audit + UI). */
  reasons: string[];
}

/**
 * Documented default revalidation interval for shelter verification, in days.
 * A shelter that has not been re-inspected within this window must be shown
 * as stale, not as currently verified (SAFETY-POLICY.md 3 + 8). This is a
 * conservative baseline; authorities may override it per shelter via
 * `revalidationWindowDays`.
 */
export const DEFAULT_REVALIDATION_WINDOW_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/**
 * Returns the required evidence gaps for a shelter to be VERIFIED.
 * An empty array means the evidence is complete (approval is separate).
 */
export function shelterEvidenceGaps(e: ShelterEvidence): string[] {
  const gaps: string[] = [];
  if (!e.authority) gaps.push('missing verifying authority');
  if (!e.classification) gaps.push('missing shelter classification');
  if (!e.verificationDate) gaps.push('missing verification date');
  return gaps;
}

export function evaluateShelterPolicy(
  input: ShelterPolicyInput,
): ShelterPolicyResult {
  const now = input.now ?? new Date();
  const { evidence, approval } = input;

  // 1) Expiry dominates: an explicit expiry in the past is never verified.
  if (evidence.expiresAt) {
    const exp = new Date(evidence.expiresAt);
    if (exp.getTime() <= now.getTime()) {
      return {
        canDisplayAsVerified: false,
        displayState: 'EXPIRED',
        reasons: ['verification has expired; must be revalidated'],
      };
    }
  }

  // 2) Evidence completeness: a map point with no authority / classification /
  //    date cannot be represented as a verified shelter (Gate E).
  const gaps = shelterEvidenceGaps(evidence);
  if (gaps.length > 0) {
    return {
      canDisplayAsVerified: false,
      displayState: 'INCOMPLETE',
      reasons: gaps,
    };
  }

  // 3) Authorised approval required (SECURITY.md 2; Gate E). A shelter is
  //    never verified by proximity, map category or rating alone.
  if (!approval.approvedBy || !approval.approverPrivileged) {
    return {
      canDisplayAsVerified: false,
      displayState: 'UNVERIFIED',
      reasons: [
        'publication requires an authorised (privileged) approval on record',
      ],
    };
  }

  // 4) Revalidation window: a verification older than the window is shown as
  //    STALE, not live (SAFETY-POLICY.md 8). Stale is a display label, not a
  //    safety claim.
  const windowDays =
    evidence.revalidationWindowDays ?? DEFAULT_REVALIDATION_WINDOW_DAYS;
  const ver = new Date(evidence.verificationDate as string);
  if (now.getTime() - ver.getTime() > windowDays * MS_PER_DAY) {
    return {
      canDisplayAsVerified: false,
      displayState: 'STALE',
      reasons: [
        `verification is older than the ${windowDays}-day revalidation window; ` +
          'label as stale until re-inspected',
      ],
    };
  }

  return {
    canDisplayAsVerified: true,
    reasons: [],
  };
}
