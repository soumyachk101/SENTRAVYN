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
 * The public, indexable routes that exist in this build.
 *
 * NOTE: the /alerts, /prepare, /about, /contact, /data-sources, /verification,
 * /privacy and /terms pages are being built by a sibling workstream. They are
 * NOT listed here yet — add each one (with its real lastmod, when available)
 * in a follow-up once the route exists. Never ship a sitemap entry for a page
 * that does not exist.
 */
const STATIC_ROUTES: readonly string[] = ['/', '/guides', '/map'];

interface SitemapGuide {
  id: string;
  /** ISO 8601; the real last content modification of the guide. */
  updatedAt: string;
}

/**
 * Best-effort fetch of published guide ids. Returns an empty list on ANY
 * failure (API unreachable, non-200, schema mismatch, timeout) so the
 * sitemap still ships the static routes — an unreachable API must not break
 * crawl discovery of the site.
 */
async function fetchPublicGuides(): Promise<SitemapGuide[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}/guides`, {
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
      '[sitemap] public guides not included; static routes only.',
      error instanceof Error ? error.message : error,
    );
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = webBaseUrl();

  // Static routes exist at build time; their content date is not available at
  // runtime, so `lastModified` is omitted rather than stamped with a fake
  // "every build" date (docs/SEO-AEO-GEO.md: real content modification only).
  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map((path) => ({
    url: `${origin}${path}`,
  }));

  // One entry per published guide; `lastModified` is the guide's real last
  // content change (updatedAt from the API), never a fabricated build date.
  const guides = await fetchPublicGuides();
  const guideEntries: MetadataRoute.Sitemap = guides.map((g) => ({
    url: `${origin}/guides/${encodeURIComponent(g.id)}`,
    lastModified: g.updatedAt,
  }));

  return [...staticEntries, ...guideEntries];
}
