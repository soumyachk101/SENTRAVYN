/**
 * Freshness and staleness rules (SAFETY-POLICY.md 8, PRODUCT-SPEC.md 7).
 *
 * Pure functions so they can be unit tested without a database, and reused by
 * both the API and the worker. Stale data must never be silently presented as
 * live, so these helpers return an explicit state plus the age in minutes.
 */

export const DEFAULT_FRESHNESS_POLICY_HOURS = 6;

export type FreshnessState = 'fresh' | 'stale' | 'expired' | 'unknown';

export interface FreshnessInput {
  /** Time the record was issued or last updated by the source. */
  updatedAt: Date | null | undefined;
  /** Optional explicit expiry supplied by the source (CAP expiry). */
  expiresAt?: Date | null;
  /** Per-provider freshness policy in hours. */
  policyHours?: number | null;
  /** Reference time, injectable for deterministic tests. */
  now?: Date;
}

export interface FreshnessResult {
  state: FreshnessState;
  ageMinutes: number | null;
  expiresAt: string | null;
  policyHours: number;
}

export function evaluateFreshness(input: FreshnessInput): FreshnessResult {
  const now = input.now ?? new Date();
  const policyHours = input.policyHours ?? DEFAULT_FRESHNESS_POLICY_HOURS;
  const expiresAt = input.expiresAt ?? null;

  if (!input.updatedAt) {
    return {
      state: 'unknown',
      ageMinutes: null,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      policyHours,
    };
  }

  const ageMinutes = Math.max(
    0,
    Math.round((now.getTime() - input.updatedAt.getTime()) / 60000),
  );

  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    return {
      state: 'expired',
      ageMinutes,
      expiresAt: expiresAt.toISOString(),
      policyHours,
    };
  }

  const state: FreshnessState =
    ageMinutes > policyHours * 60 ? 'stale' : 'fresh';
  return {
    state,
    ageMinutes,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    policyHours,
  };
}
