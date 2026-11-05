/**
 * @sentravyn/localization — Phase 5 localization foundation.
 *
 * A reviewed, typed minimum: the locale/resource structure and a locale
 * selector shape that the public guide pages (apps/web /safety) consume.
 * It is deliberately NOT a full i18n framework (docs/ROADMAP.md Phase 5:
 * "localization foundation"):
 *
 * - Resources are flat, typed key -> string maps per locale, so a missing
 *   key is a compile-time error, not a silent runtime fallthrough.
 * - Locale selection is a pure, documented function (requested code or
 *   Accept-Language list -> the best available locale), with the fallback
 *   to the default locale made explicit.
 * - The guide API wires `language` through its filter
 *   (GET /guides?language=...), so content in the selected locale is a
 *   server-side concern; these resources translate the UI chrome only.
 *
 * No framework dependency: the package is plain TypeScript that both the
 * web and the admin surfaces can import.
 */

// ---------------------------------------------------------------------------
// Locale codes
// ---------------------------------------------------------------------------

/** BCP-47 locale code, e.g. 'en', 'de', 'pt-BR'. */
export type LocaleCode = string;

/**
 * Locales with shipped resources. The union stays small on purpose:
 * every added locale is a reviewed resource file, not a copy (ADR-009:
 * translations of reviewed guidance only).
 */
export const SUPPORTED_LOCALES = ['en', 'es'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Fallback locale when no requested locale is available. */
export const DEFAULT_LOCALE: SupportedLocale = 'en';

// ---------------------------------------------------------------------------
// Resource structure
// ---------------------------------------------------------------------------

/**
 * The closed set of UI strings a SENTRAVYN surface localizes. A resource
 * file for a locale must provide every key (the record is total, not
 * partial): a gap is a type error at build time.
 */
export interface LocaleStrings {
  /** Human-readable locale name in its own language. */
  localeName: string;
  /** Left-to-right or right-to-left text direction. */
  direction: 'ltr' | 'rtl';
  // -- Safety guide pages (apps/web /safety) ------------------------------
  guidesTitle: string;
  guidesSub: string;
  /** Prominent label next to every guide body (SAFETY-POLICY.md 2, 6). */
  summariesOnly: string;
  /** The "not a substitute for official instructions" disclosure. */
  notOfficial: string;
  /** Empty state: never fabricate a guide for a hazard without one. */
  noGuideForHazard: string;
  /** Stale content label (SAFETY-POLICY.md 8: labelled, never hidden). */
  staleLabel: string;
  lastReviewed: string;
  version: string;
  authority: string;
  references: string;
  revisionHistory: string;
  hazard: string;
  language: string;
  loading: string;
  error: string;
  offline: string;
  retry: string;
}

/**
 * A locale resource: the strings plus the locale metadata that consumers
 * need to render correctly (direction, native name).
 */
export interface LocaleResource {
  locale: LocaleCode;
  strings: LocaleStrings;
}

// ---------------------------------------------------------------------------
// Shipped resources (reviewed; en + es as the real seed pair)
// ---------------------------------------------------------------------------

import { en } from './locales/en';
import { es } from './locales/es';

export const RESOURCES: Record<SupportedLocale, LocaleResource> = {
  en,
  es,
};

// ---------------------------------------------------------------------------
// Accessors + the locale selector shape
// ---------------------------------------------------------------------------

/** The resource for a supported locale; undefined for codes we do not ship. */
export function getResource(
  locale: LocaleCode,
): LocaleResource | undefined {
  // Strict structural check, no `any`: the code must be a known key.
  return (RESOURCES as Record<string, LocaleResource | undefined>)[locale];
}

/**
 * Selector shape: resolve a requested locale (or a list, e.g. parsed
 * Accept-Language, most-specific first) against the shipped resources.
 *
 * - exact supported code -> that resource;
 * - base language match ('pt-BR' when only 'pt' existed would match; here
 *   'es-MX' matches 'es');
 * - otherwise -> the default locale resource, with the fallback reported.
 *
 * Pure and total: it always returns a resource, so a caller never renders
 * an empty label set.
 */
export interface ResolvedLocale {
  resource: LocaleResource;
  /** True when the requested locale was not available and we fell back. */
  fellBack: boolean;
}

export function selectLocale(
  requested: LocaleCode | readonly LocaleCode[] | undefined,
): ResolvedLocale {
  const candidates = Array.isArray(requested)
    ? requested
    : requested === undefined
      ? []
      : [requested];

  for (const code of candidates) {
    const resource = getResource(code);
    if (resource) {
      return { resource, fellBack: false };
    }
    // Base-language match: 'es-MX' -> 'es'. Only the subtag before the
    // first hyphen is considered (script/region do not change direction
    // or vocabulary in the shipped set). A base match is still a fallback:
    // the exact requested code was not available.
    const base = code.split('-')[0]?.toLowerCase();
    if (base && base !== code) {
      const baseResource = getResource(base);
      if (baseResource) {
        return { resource: baseResource, fellBack: true };
      }
    }
  }

  return { resource: RESOURCES[DEFAULT_LOCALE], fellBack: candidates.length > 0 };
}

/**
 * Parses an Accept-Language header (or any "en,es;q=0.8" style list) into
 * the most-specific-first code list selectLocale expects. Quality values
 * are respected; ties keep header order. The input is untrusted browser
 * data: malformed entries are skipped, never thrown on.
 */
export function parseAcceptLanguage(
  header: string | null | undefined,
): LocaleCode[] {
  if (!header || header.trim() === '') {
    return [];
  }
  const parts = header.split(',').map((part) => {
    const [code, ...params] = part.trim().split(';');
    let quality = 1;
    for (const param of params) {
      const m = /^q=([0-9.]+)$/.exec(param.trim());
      if (m) {
        const parsed = Number(m[1]);
        if (Number.isFinite(parsed)) quality = parsed;
      }
    }
    const trimmed = (code ?? '').trim();
    return trimmed === '' ? null : { code: trimmed, quality };
  });
  const clean = parts.filter(
    (p): p is { code: LocaleCode; quality: number } => p !== null,
  );
  clean.sort((a, b) => b.quality - a.quality);
  return clean.map((p) => p.code);
}
