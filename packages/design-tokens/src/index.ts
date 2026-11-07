/**
 * SENTRAVYN design tokens (DESIGN.md).
 *
 * Palette is deliberately restrained: deep atmospheric neutrals, warm
 * off-whites, slate tones and muted, semantic accents. No neon, no
 * oversaturated gradients. Emergency colors are semantic and are never the
 * only channel used to communicate state (DESIGN.md 3).
 */

export const color = {
  // Atmospheric neutrals.
  ink900: '#101418',
  ink800: '#1b232b',
  ink700: '#2a3540',
  slate500: '#55606c',
  slate300: '#aab3bf',
  // Warm off-whites.
  paper50: '#f7f5f1',
  paper100: '#efece5',
  paper200: '#e3ded4',
  // Muted semantic accents.
  accentCalm: '#4a6b82', // composed blue-slate (non-neon)
  alertAmber: '#b07d2b', // warning
  alertRed: '#a13a34', // critical / danger (muted, accessible)
  okGreen: '#4e7d5a', // confirmed / safe-state accent (muted)
  focusRing: '#4a6b82',
} as const;

export const typography = {
  // Display + body stack (DESIGN.md 3 candidate families).
  display: "'Geist', 'Inter', system-ui, -apple-system, sans-serif",
  body: "'Inter', system-ui, -apple-system, sans-serif",
  mono: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  // Token scale (rem).
  size12: '0.75rem',
  size14: '0.875rem',
  size16: '1rem',
  size20: '1.25rem',
  size28: '1.75rem',
  size40: '2.5rem',
  weightRegular: 400,
  weightMedium: 500,
  weightSemibold: 600,
} as const;

export const spacing = {
  xxs: '0.25rem',
  xs: '0.5rem',
  sm: '0.75rem',
  md: '1rem',
  lg: '1.5rem',
  xl: '2rem',
  xxl: '3rem',
} as const;

export const radius = {
  sm: '4px',
  md: '8px',
  lg: '12px',
  full: '9999px',
} as const;

export const elevation = {
  shadow1: '0 1px 2px rgba(16,20,24,0.08)',
  shadow2: '0 4px 12px rgba(16,20,24,0.12)',
} as const;

export interface DesignTokens {
  color: typeof color;
  typography: typeof typography;
  spacing: typeof spacing;
  radius: typeof radius;
  elevation: typeof elevation;
}

export const tokens: DesignTokens = {
  color,
  typography,
  spacing,
  radius,
  elevation,
};

/**
 * The signature cinematic footer's required closing message (DESIGN.md 4).
 */
export const footerClosingMessage = 'PREPAREDNESS SAVES LIVES.';
export const footerSupportingCopy =
  'Understand the risks. Follow verified guidance. Protect what matters.';
