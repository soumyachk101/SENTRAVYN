/**
 * robots.ts — crawl directives for the SENTRAVYN public web app.
 *
 * Follows docs/SEO-AEO-GEO.md: allow all public pages, keep the admin console,
 * sign-in/account surfaces and the API off-limits to the index, and publish
 * the XML sitemap URL.
 *
 * The sitemap URL is derived from the shared env-driven origin
 * (`webBaseUrl()` in @/lib/jsonld, same fallback as the root layout's
 * `metadataBase`) — a real deployment sets the variable; we never fabricate a
 * production host.
 *
 * `robots()` is a plain, Next-independent function returning
 * `MetadataRoute.Robots` (Next renders it to /robots.txt), so a unit test
 * can assert on the exact rules without booting the framework.
 */
import type { MetadataRoute } from 'next';
import { webBaseUrl } from '@/lib/jsonld';

/**
 * Routes that are never indexable (SECURITY.md 5: user-specific location,
 * private contacts and operational data are off-limits to crawlers):
 * - /admin/   the separate admin console deployable
 * - /login    the sign-in surface
 * - /account/ account + user-specific profile data
 * - /api/     the versioned backend API (data, not page content)
 *
 * `Allow: /` + these `Disallow`s is the standard robots.txt contract: a
 * more-specific Disallow wins over the wildcard Allow, so the public pages
 * (/, /guides, /map and the public content pages) stay crawlable while the
 * protected paths are withheld.
 */
const DISALLOWED: readonly string[] = [
  '/admin/',
  '/login',
  '/account/',
  '/api/',
];

export default function robots(): MetadataRoute.Robots {
  const origin = webBaseUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [...DISALLOWED],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}
