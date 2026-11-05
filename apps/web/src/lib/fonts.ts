import localFont from "next/font/local";

/**
 * SENTRAVYN font system (Phase 8 / DESIGN.md 3).
 *
 * Chosen approach: self-hosted `.woff2` via next/font/local, loaded from
 * `public/fonts/`. Rationale (documented):
 * - Deterministic: no build-time network fetch, no third-party CDN at build
 *   or runtime. The same bytes ship in `public/fonts/` and are referenced
 *   directly.
 * - Efficient: each family is a variable (or few-weight) file, so one
 *   request per family, `font-display: swap`.
 * - The exact same families are copied to apps/admin so web and admin share
 *   one visual system.
 *
 * Multilingual coverage is NOT claimed: these are latin subsets. Any
 * non-latin user is served the system fallbacks, which is an honest limit
 * (DESIGN.md 3 says to VERIFY coverage, so it is not asserted here).
 */

export const geist = localFont({
  src: "../../public/fonts/geist-var.woff2",
  variable: "--font-geist",
  weight: "100 900",
  display: "swap",
});

export const inter = localFont({
  src: "../../public/fonts/inter-var.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});

export const interLatinExt = localFont({
  src: "../../public/fonts/inter-latin-ext-var.woff2",
  variable: "--font-inter-ext",
  weight: "100 900",
  display: "swap",
});

export const plexMono400 = localFont({
  src: "../../public/fonts/ibm-plex-mono-400.woff2",
  variable: "--font-plex-mono",
  weight: "400",
  display: "swap",
});

export const plexMono500 = localFont({
  src: "../../public/fonts/ibm-plex-mono-500.woff2",
  variable: "--font-plex-mono-medium",
  weight: "500",
  display: "swap",
});

export const plexMono600 = localFont({
  src: "../../public/fonts/ibm-plex-mono-600.woff2",
  variable: "--font-plex-mono-semibold",
  weight: "600",
  display: "swap",
});

export const plexMono700 = localFont({
  src: "../../public/fonts/ibm-plex-mono-700.woff2",
  variable: "--font-plex-mono-bold",
  weight: "700",
  display: "swap",
});

export const plexMonoLatinExt = localFont({
  src: "../../public/fonts/ibm-plex-mono-latin-ext-400.woff2",
  variable: "--font-plex-mono-ext",
  weight: "400",
  display: "swap",
});

/** The three CSS vars DESIGN.md tokens reference, pointing at real families. */
export const FONT_VARS = {
  // Display: Geist variable.
  "--font-display": "var(--font-geist), Inter, system-ui, -apple-system, sans-serif",
  // Body: Inter variable (+ latin-ext subset for extended latin letters).
  "--font-body": "var(--font-inter), var(--font-inter-ext), system-ui, -apple-system, sans-serif",
  // Mono (metadata + the cinematic ASCII footer): IBM Plex Mono.
  "--font-mono":
    "var(--font-plex-mono), var(--font-plex-mono-medium), var(--font-plex-mono-semibold), var(--font-plex-mono-bold), var(--font-plex-mono-ext), ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;
