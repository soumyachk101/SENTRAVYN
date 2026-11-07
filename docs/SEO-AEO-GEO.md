# Production SEO, AEO, GEO & Webmaster Integration

## Scope
Implement technical SEO for Next.js web pages and discoverability of *verified* public safety guidance. AEO = answer-engine optimization; GEO = generative-engine optimization. Neither implies guaranteed placement or citation in AI answers.

## Site architecture
- Use an approved `SITE_URL` from environment configuration, not a guessed domain.
- Server-render or statically render meaningful public pages. No empty client-only HTML shells for indexable content.
- Semantic headings, accessible navigation, unique title/meta description and accurate page copy.
- Canonical absolute URLs, consistent HTTPS, redirect policy, proper status codes, and no duplicate query-parameter pages.
- `robots.txt` and XML sitemap index generated from published canonical routes.
- Include only approved, indexable pages; exclude login, account, admin, user-specific location, private contacts, transient search results, internal APIs, staging and draft content.
- Correct `lastmod` based on real content modification, not every build.
- Hreflang with reciprocal links for genuinely translated pages; language-aware metadata.
- Open Graph and social card metadata with original branded images.
- Icons, web app manifest, favicons, appropriate app deep links.
- Internal links and descriptive anchor text; breadcrumb navigation where helpful.
- Optimise Core Web Vitals and mobile performance; avoid blocking emergency UI.
- No invented FAQs, ratings, review stars, organization credentials or fake structured data.

## Structured data
Use relevant schema.org JSON-LD only when supported by visible factual content:
- `Organization` and `WebSite` for the actual publisher.
- `BreadcrumbList` for appropriate navigational pages.
- `Article` or `TechArticle` only for genuine published guides.
- `FAQPage` only where actual visible Q&A exists and eligible use is appropriate; do not assume Google will show rich results.
- Include author/reviewer, `datePublished`, `dateModified`, references and publisher only when verified.
- Validate using Google Rich Results Test and Schema Markup Validator.

## AEO / GEO content strategy
- Lead guide pages with concise, directly useful answers followed by detailed reviewed guidance.
- Show explicit jurisdiction applicability, hazard scope, source citations, reviewed date and revision history.
- Separate official quotations, reviewed summaries and derived data.
- Explain uncertainty, outdated information and regional coverage gaps.
- Provide stable public source pages with human-readable HTML; optional `llms.txt` may be maintained but is not an official ranking requirement or guaranteed crawler interface.
- Never expose personal, precise-location or emergency contact data to AI crawlers.
- Never publish unreviewed or AI-hallucinated emergency advice.
- Do not claim any AI crawler or search engine will index/cite content.

## Google Search Console
1. Deploy the production website on a domain actually controlled by the owner.
2. Create a property at https://search.google.com/search-console/
3. Prefer domain verification via the DNS TXT token issued by Google; alternatively use a supported URL-prefix method.
4. Never invent verification tokens. Store public HTML meta verification values in env/config only after issuance; DNS changes require actual domain access.
5. Confirm `https://<domain>/robots.txt` and `https://<domain>/sitemap.xml` respond correctly.
6. Submit the sitemap through Search Console and inspect Pages, Sitemaps, Core Web Vitals, manual actions and URL Inspection.
7. Record verified property and submission evidence. Do not mark complete before verified ownership and successful processing.

Official docs: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap

## Bing Webmaster Tools
1. Visit https://www.bing.com/webmasters/
2. Import the verified Google Search Console property, or verify via supported DNS/meta/file methods.
3. Submit the same canonical sitemap and inspect URL coverage.
4. Implement IndexNow for public page additions, updates and deletions *only after* the real domain and key are configured.
5. Generate the IndexNow key securely, host the key verification file per specification, and send changed canonical URLs only.
6. Protect against submission spam and monitor responses; do not submit private routes.
7. Bing/IndexNow submission does not notify Google and does not guarantee indexing.

Official docs:
- https://www2.bing.com/webmasters/help/add-and-verify-site-12184f8b
- https://www.bing.com/indexnow/getstarted

## Implementation artifacts
- `apps/web/app/robots.ts`
- `apps/web/app/sitemap.ts` (or scalable sitemap index/segmentation)
- `apps/web/app/layout.tsx` metadata and verification config
- Shared metadata and JSON-LD utilities with tests
- Content route metadata and language alternates
- `apps/web/public/manifest.webmanifest` or Next.js manifest route
- `apps/web/public/` icons and OG assets
- Secure IndexNow publishing worker/job for changed URLs
- `docs/SEO-AEO-GEO-AUDIT.md` reporting page-by-page findings

These are required implementation targets, not files falsely represented as already implemented.

## Audit gates
- Crawl all indexable routes using an appropriate crawler.
- Detect missing/duplicate titles, descriptions, canonicals, H1s, alt text, broken links, orphan pages, redirects and status errors.
- Verify robots, sitemap, hreflang, structured data, OG cards and indexing directives.
- Test 360px mobile through desktop, JS-disabled HTML where relevant, and Core Web Vitals.
- Ensure no source maps or secrets are publicly exposed inadvertently.
- Record Google/Bing verification as `NOT CONFIGURED` until actual account/domain actions succeed.
- No fabricated performance, search ranking or AI citation claims.
