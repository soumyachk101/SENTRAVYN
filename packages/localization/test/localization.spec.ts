import {
  DEFAULT_LOCALE,
  RESOURCES,
  getResource,
  parseAcceptLanguage,
  selectLocale,
} from '../src/index';

/**
 * Unit tests for the Phase 5 localization foundation
 * (packages/localization; docs/ROADMAP.md Phase 5 "localization foundation").
 * No infrastructure: pure functions against the shipped resource set.
 */

describe('selectLocale', () => {
  it('returns the English resource for an exact supported code', () => {
    const resolved = selectLocale('en');
    expect(resolved.fellBack).toBe(false);
    expect(resolved.resource.locale).toBe('en');
  });

  it('base-matches an unsupported region code to its shipped base language', () => {
    const resolved = selectLocale('es-MX');
    expect(resolved.fellBack).toBe(true);
    expect(resolved.resource.locale).toBe('es');
  });

  it('falls back to the default locale for an unknown code', () => {
    const resolved = selectLocale('fr');
    expect(resolved.fellBack).toBe(true);
    expect(resolved.resource.locale).toBe(DEFAULT_LOCALE);
  });

  it('returns the default resource when no locale is requested', () => {
    const resolved = selectLocale(undefined);
    expect(resolved.fellBack).toBe(false);
    expect(resolved.resource.locale).toBe(DEFAULT_LOCALE);
  });

  it('honors an Accept-Language-style candidate list, most-specific first', () => {
    // 'fr' is unavailable, 'es' is the best remaining candidate.
    const resolved = selectLocale(['fr', 'es']);
    expect(resolved.fellBack).toBe(false);
    expect(resolved.resource.locale).toBe('es');
  });

  it('always returns a resource — a caller never renders empty labels', () => {
    for (const code of ['xx', 'yy', 'zz']) {
      expect(getResource(code)).toBeUndefined();
      expect(selectLocale(code).resource.locale).toBe(DEFAULT_LOCALE);
    }
  });
});

describe('parseAcceptLanguage', () => {
  it('orders codes by quality value, ties keep header order', () => {
    expect(parseAcceptLanguage('en;q=0.9, es, fr;q=0.5')).toEqual([
      'es',
      'en',
      'fr',
    ]);
  });

  it('skips malformed entries and returns [] for empty input', () => {
    expect(parseAcceptLanguage(',,,')).toEqual([]);
    expect(parseAcceptLanguage(null)).toEqual([]);
    expect(parseAcceptLanguage(undefined)).toEqual([]);
    expect(parseAcceptLanguage('   ')).toEqual([]);
  });

  it('handles a single code with no quality', () => {
    expect(parseAcceptLanguage('en')).toEqual(['en']);
  });
});

describe('resource completeness (total, not partial)', () => {
  it('every shipped locale provides every key in LocaleStrings', () => {
    // The en resource is the shape reference; es must define the same keys.
    const enKeys = Object.keys(RESOURCES.en.strings);
    const esKeys = Object.keys(RESOURCES.es.strings);
    expect(esKeys).toEqual(enKeys);
  });

  it('no shipped string is empty or contains a placeholder marker', () => {
    for (const resource of Object.values(RESOURCES)) {
      for (const [key, value] of Object.entries(resource.strings)) {
        expect(typeof value).toBe('string');
        expect(value.trim().length).toBeGreaterThan(0);
        expect(value).not.toContain('TODO');
        expect(value).not.toContain('lorem');
        expect(value).not.toContain('lorem ipsum');
        // key is only used in the assertion to keep the loop total.
        expect(key).toBeTruthy();
      }
    }
  });
});
