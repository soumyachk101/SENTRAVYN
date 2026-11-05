/**
 * Mobile family-safety theme (Phase 7). Mirrors the web/admin design tokens
 * (DESIGN.md 3): deep atmospheric neutrals, warm off-whites, muted semantic
 * accents. No neon, no oversaturated color. Monospace for technical metadata
 * (timestamps, ids, state labels) — the ASCII/technical voice of the design.
 *
 * Shared by every family screen so the surfaces present one system and no
 * emoji / neon ever appear.
 */
export const colors = {
  ink900: '#101418',
  ink800: '#1b232b',
  ink700: '#2a3540',
  slate500: '#55606c',
  slate300: '#aab3bf',
  paper50: '#f7f5f1',
  paper100: '#efece5',
  paper200: '#e3ded4',
  accentCalm: '#4a6b82',
  alertAmber: '#b07d2b',
  alertRed: '#a13a34',
  okGreen: '#4e7d5a',
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

/** Verification-state colours: muted, semantic, never the only signal. */
export const verificationColor: Record<string, string> = {
  VERIFIED: colors.okGreen,
  REVIEWED: colors.accentCalm,
  UNVERIFIED: colors.slate300,
  STALE: colors.alertAmber,
  EXPIRED: colors.alertRed,
  INCOMPLETE: colors.alertAmber,
};

/** The API's fixed coverage disclosure (Phase 4, SAFETY-POLICY.md 1 & 6). */
export const DISCLAIMER =
  'SENTRAVYN is an information and preparedness platform, not an operational ' +
  'emergency service. A nearby place is not automatically a safe shelter.';
