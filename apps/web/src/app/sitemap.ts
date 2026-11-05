/**
 * sitemap.ts — XML sitemap for the SENTRAVYN public web app.
 *
 * Follows docs/SEO-AEO-GEO.md: only published, indexable, canonical routes
 * are included. The admin console, sign-in/account routes, user-specific
 * location pages and the API are never indexable, so none of them appear
 * here (CLAUDE.md: the admin app is excluded from the sitemap).
 *
 * The site origin is env-driven via `webBaseUrl()` (NEXT_PUBLIC_WEB_BASE_URL,
 * same fallback as the root layout's `metadataBase`) — a real deployment sets
 * the variable; we never fabricate a production host.
 */
import type { MetadataRoute } from 'next';
import { webBaseUrl } from '@/lib/jsonld';

/**
 * The public API the web app talks to. Same env var `@/lib/api` reads.
 * `NEXT_PUBLIC_` vars are inlined at build time; resolving the live value at
 * request time keeps a deployment with a different host working.
 */
const API_BASE_URL: string =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1';

/** Keep sitemap generation bounded: a hung API must never stall a crawl. */
const API_TIMEOUT_MS = 3000;

/**
 * The constant public, indexable routes (docs/SEO-AEO-GEO.md).
 *
 * `/`, `/guides` and `/map` exist in this build. The public content pages
 * `/alerts`, `/prepare`, `/about`, `/contact`, `/data-sources`,
 * `/verification`, `/privacy` and `/terms` are being built by a sibling
 * workstream; they are listed as constant URL entries (a sitemap entry is a
 * URL, not a guarantee the page already renders). No static route carries a
 * lastmod — the doc forbids a fake "every build" date, and the real content
 * date for a constant route is not available at runtime.
 */
const PUBLIC_ROUTES: readonly string[] = [
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

interface SitemapGuide {
  id: string;
  /** ISO 8601; the real last content modification of the guide. */
  updatedAt: string;
}

/**
 * Best-effort fetch of published guide ids. Returns an empty list on ANY
 * failure (API unreachable, non-200, schema mismatch, timeout) so the
 * sitemap still ships the constant routes — an unreachable API must not
 * break crawl discovery of the site, and it must not invent guide entries.
 *
 * The public GET /guides is already constrained to APPROVED/PUBLISHED by the
 * backend (publicOnly), so the default view is exactly the indexable set;
 * pageSize=100 (the API maximum) keeps the common case to one request.
 */
async function fetchPublicGuides(): Promise<SitemapGuide[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}/guides?pageSize=100`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      throw new Error(`guides list returned ${response.status}`);
    }
    const body = (await response.json()) as {
      items?: Array<{ id?: unknown; updatedAt?: unknown }>;
    };
    const items = Array.isArray(body.items) ? body.items : [];
    // Keep only well-formed rows; a malformed row is dropped, not guessed at.
    return items
      .filter(
        (g): g is SitemapGuide =>
          typeof g.id === 'string' &&
          g.id.length > 0 &&
          typeof g.updatedAt === 'string' &&
          Number.isFinite(Date.parse(g.updatedAt)),
      )
      .map((g) => ({ id: g.id, updatedAt: g.updatedAt }));
  } catch (error) {
    console.warn(
      '[sitemap] published guides not included; constant routes only.',
      error instanceof Error ? error.message : error,
    );
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = webBaseUrl();

  // Constant public routes. No lastmod is attached: the real content date is
  // not available at runtime, and the doc forbids stamping a fake
  // "every build" date (docs/SEO-AEO-GEO.md).
  const routeEntries: MetadataRoute.Sitemap = PUBLIC_ROUTES.map((path) => ({
    url: `${origin}${path}`,
  }));

  // One entry per published guide; `lastModified` is the guide's real last
  // content change (updatedAt from the API), never a fabricated build date.
  const guides = await fetchPublicGuides();
  const guideEntries: MetadataRoute.Sitemap = guides.map((g) => ({
    url: `${origin}/guides/${encodeURIComponent(g.id)}`,
    lastModified: g.updatedAt,
  }));

  return [...routeEntries, ...guideEntries];
}
