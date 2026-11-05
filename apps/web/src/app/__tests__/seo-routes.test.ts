/**
 * Unit tests for the Next.js metadata routes in apps/web/src/app:
 * robots.ts and sitemap.ts (docs/SEO-AEO-GEO.md implementation artifacts).
 *
 * The route handlers are plain functions (Next renders them to
 * /robots.txt and /sitemap.xml), so the tests call them directly with an
 * injected fetch — no framework boot, no live API, no fabricated data
 * (CLAUDE.md rule 3).
 *
 * The jest environment is jsdom, which does not provide a global
 * `fetch`; the tests install a minimal fake on `globalThis` per test and
 * restore it afterwards. The fake only implements what `sitemap.ts`
 * consumes: `ok`, `status` and `json()`.
 *
 * Determinism: the route modules read NEXT_PUBLIC_WEB_BASE_URL and
 * NEXT_PUBLIC_API_BASE_URL at import time, and the default API base
 * (http://localhost:4000/api/v1) is unreachable in the test environment,
 * so the static-import assertions below run against the documented
 * example-domain fallback with the fetch fake — the unreachable-API
 * degradation path, which is exactly what the tests assert.
 */
import type { MetadataRoute } from 'next';
import robots from '@/app/robots';
import sitemap from '@/app/sitemap';

type SitemapHandler = () => Promise<MetadataRoute.Sitemap>;

/** The shape of a fetch response `sitemap.ts` actually consumes. */
interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

function fakeJsonResponse(body: unknown, status = 200): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/** The rule shape `robots.ts` emits (single wildcard rule object). */
type WildcardRule = {
  userAgent?: string;
  allow?: string;
  disallow?: string[];
};

/** `MetadataRoute.Robots.rules` is a single-object-or-array union; normalize. */
function firstRule(rules: MetadataRoute.Robots['rules']): WildcardRule {
  return (
    (Array.isArray(rules) ? rules : [rules]) as unknown as WildcardRule[]
  )[0];
}

function setFetch(implementation: unknown): void {
  (globalThis as { fetch: unknown }).fetch = implementation;
}

describe('seo routes', () => {
  let warnSpy: ReturnType<typeof jest.spyOn>;
  let originalFetch: unknown;

  beforeAll(() => {
    // Ensure the env-driven origin resolves to the documented fallback.
    delete process.env.NEXT_PUBLIC_WEB_BASE_URL;
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    originalFetch = (globalThis as { fetch?: unknown }).fetch;
  });

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    setFetch(originalFetch);
  });

  describe('robots()', () => {
    it('allows the public site and disallows the protected paths', () => {
      const r = robots();
      const rule = firstRule(r.rules);
      expect(rule.userAgent).toBe('*');
      expect(rule.allow).toBe('/');
      expect(rule.disallow).toEqual(
        expect.arrayContaining(['/admin/', '/login', '/account/', '/api/']),
      );
      expect(rule.disallow).toHaveLength(4);
    });

    it('publishes the env-driven sitemap URL (never a fabricated domain)', () => {
      const r = robots();
      expect(r.sitemap).toBe('https://sentravyn.example/sitemap.xml');
    });
  });

  describe('sitemap()', () => {
    const handler = sitemap as SitemapHandler;
    const CONSTANT_PATHS = [
      '/',
      '/guides',
      '/map',
      '/alerts',
      '/prepare',
      '/about',
      '/contact',
      '/data-sources',
      '/verification',
      '/privacy',
      '/terms',
    ];

    it('includes every constant public route without a fabricated lastmod', async () => {
      setFetch(async () => {
        throw new Error('offline');
      });
      const entries = await handler();
      const urls = entries.map((e) => e.url);
      for (const path of CONSTANT_PATHS) {
        expect(urls).toContain(`https://sentravyn.example${path}`);
      }
      // No constant route may carry a lastmod — the doc forbids a fake
      // "every build" date, and the real content date is unavailable.
      for (const entry of entries) {
        expect(entry).not.toHaveProperty('lastModified');
      }
      expect(entries).toHaveLength(CONSTANT_PATHS.length);
    });

    it('adds one entry per published guide, lastmod = the guide updatedAt', async () => {
      setFetch(async () =>
        fakeJsonResponse({
          items: [
            { id: 'g-1', updatedAt: '2026-05-01T08:00:00Z' },
            { id: 'g-2', updatedAt: '2026-05-02T08:00:00Z' },
          ],
          pagination: { page: 1, pageSize: 100, total: 2 },
        }),
      );
      const entries = await handler();
      const guideEntries = entries.filter((e) => e.url.includes('/guides/g-'));
      expect(guideEntries).toHaveLength(2);
      expect(guideEntries.map((e) => e.url)).toEqual([
        'https://sentravyn.example/guides/g-1',
        'https://sentravyn.example/guides/g-2',
      ]);
      expect(guideEntries.map((e) => e.lastModified)).toEqual([
        '2026-05-01T08:00:00Z',
        '2026-05-02T08:00:00Z',
      ]);
    });

    it('degrades to the constant routes when the API is unreachable, and warns', async () => {
      setFetch(async () => {
        throw new Error('down');
      });
      const entries = await handler();
      expect(entries).toHaveLength(CONSTANT_PATHS.length);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]?.[0])).toContain('sitemap');
    });

    it('degrades to the constant routes when the API returns a non-200', async () => {
      setFetch(async () => fakeJsonResponse('nope', 503));
      const entries = await handler();
      expect(entries).toHaveLength(CONSTANT_PATHS.length);
    });

    it('drops malformed guide rows instead of guessing', async () => {
      setFetch(async () =>
        fakeJsonResponse({
          items: [
            { id: 'g-1', updatedAt: '2026-05-01T08:00:00Z' },
            { id: '', updatedAt: '2026-05-01T08:00:00Z' },
            { id: 'g-2', updatedAt: 'not-a-date' },
            { updatedAt: '2026-05-01T08:00:00Z' },
          ],
        }),
      );
      const entries = await handler();
      const guideEntries = entries.filter((e) => e.url.includes('/guides/g-'));
      expect(guideEntries.map((e) => e.url)).toEqual([
        'https://sentravyn.example/guides/g-1',
      ]);
    });
  });
});
