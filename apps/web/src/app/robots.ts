/**
 * robots.ts — crawl directives for the SENTRAVYN public web app.
 *
 * Follows docs/SEO-AEO-GEO.md: expose the published indexable routes, keep
 * the admin console, sign-in/account surfaces and the API off-limits to the
 * index, and publish the XML sitemap URL.
 *
 * The sitemap URL is derived from the shared env-driven origin
 * (`webBaseUrl()` in @/lib/jsonld, same fallback as the root layout's
 * `metadataBase`) — a real deployment sets the variable; we never fabricate a
 * production host.
 */
import type { MetadataRoute } from 'next';
import { webBaseUrl } from '@/lib/jsonld';

export default function robots(): MetadataRoute.Robots {
  const origin = webBaseUrl();

  return {
    rules: [
      {
        // Wildcard: applies to every crawler.
        userAgent: '*',
        // Public, indexable routes that exist in this build. The /alerts,
        // /prepare, /about, /contact, /data-sources, /verification, /privacy
        // and /terms pages land in a follow-up (sibling work); add them to
        // this allowlist once the routes exist.
        allow: ['/', '/guides', '/guides/', '/map'],
        // Never index the admin console, sign-in/account surfaces, or the
        // versioned API. User-specific location, private contacts and
        // operational data are off-limits to crawlers (SECURITY.md 5).
        disallow: ['/admin/', '/login', '/account/', '/api/'],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}
