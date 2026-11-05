import localFont from "next/font/local";

/**
 * SENTRAVYN font system for the admin console (Phase 8 / DESIGN.md 3).
 *
 * Same approach as apps/web/src/lib/fonts.ts: self-hosted `.woff2` via
 * next/font/local (deterministic, no build-time network, no third-party
 * CDN). The identical families are shared with the public web surface so
 * the two apps present one visual system.
 *
 * Multilingual coverage is NOT claimed: latin subsets; non-latin users get
 * the system fallbacks (an honest limit, not asserted coverage).
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

/**
 * The three DESIGN.md token vars, re-pointed at the real loaded families so
 * `--font-display/-body/-mono` are not just system fallbacks.
 */
export const FONT_VARS = {
  "--font-display":
    "var(--font-geist), Inter, system-ui, -apple-system, sans-serif",
  "--font-body":
    "var(--font-inter), var(--font-inter-ext), system-ui, -apple-system, sans-serif",
  "--font-mono":
    "var(--font-plex-mono), var(--font-plex-mono-medium), var(--font-plex-mono-semibold), var(--font-plex-mono-bold), var(--font-plex-mono-ext), ui-monospace, SFMono-Regular, Menlo, monospace",
} as const;
