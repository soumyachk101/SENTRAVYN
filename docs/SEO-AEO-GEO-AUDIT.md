# SEO / AEO / GEO Audit — SENTRAVYN Web

Audit of `apps/web` (public site) against `docs/SEO-AEO-GEO.md`.
Base: `feat/phase2-4-trust-review-geo` @ `7ae8573`, audit performed on branch
`b2-seo`. Findings are evidence-based only; items that require a live
deployment, an owner-controlled domain, or a browser run are explicitly
marked `NOT RUN` / `NOT CONFIGURED` — no indexing, ranking, verification or
citation is claimed anywhere in this document.

## Scope and method

- Static audit of the route files, layout, robots, sitemap, structured data,
  OG metadata and `llms.txt` in `apps/web`.
- The admin app (`apps/admin`) is a separate deployable and is **excluded
  from the public sitemap and indexable surface** by design. Its routes
  (login, review, audit, provider/security configuration, account) are never
  indexable.
- Core Web Vitals, crawler runs and webmaster-account actions are
  `NOT RUN` / `NOT CONFIGURED` for the reasons listed at the bottom of each
  section.

## Page-by-page findings

Coverage legend: "title" = per-route `<title>` (via the layout template
`%s — SENTRAVYN`); "description" = meta description; "H1" = a semantic
`<h1>` present in the served HTML; "canonical" = an explicit
`<link rel="canonical">` tag (the site relies on stable absolute URLs, the
sitemap and `metadataBase`; no explicit canonical tags are emitted today).

| Route | Title | Description | H1 | Canonical | Indexable (robots/sitemap) | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `/` | PASS (default) | PASS (layout + page) | PASS (hero) | WARN (none explicit) | PASS | Organization + WebSite JSON-LD site-wide; OG type/siteName set |
| `/guides` | PASS | PASS | WARN (client-rendered; pre-hydration HTML is the Suspense loading fallback) | WARN | PASS | H1 exists in the hydrated DOM (`GuideIndexClient`) |
| `/guides/[id]` | WARN (static `Safety guide`; the record loads client-side, so the per-guide title is not server-rendered) | PASS (page-level) | WARN (client-rendered from the real record) | WARN | PASS (guides fetched from the public API in `sitemap.ts`) | TechArticle + BreadcrumbList JSON-LD emitted when the record loads; `instant = false` (blocking, non-prerendered route under `cacheComponents`) |
| `/map` | PASS | PASS (states dev-only tiles honestly) | WARN (page uses an `h2` + `aria-label`, no semantic `<h1>`) | WARN | PASS | Map UI; no structured data appropriate — correctly none |
| `/alerts`, `/prepare`, `/about`, `/contact`, `/data-sources`, `/verification`, `/privacy`, `/terms` | n/a (not in this build) | n/a | n/a | n/a | PASS as constant sitemap entries | Public content pages owned by sibling workstream `b1-web-pages`; `robots.ts`/`sitemap.ts` carry them as constant URL entries (a sitemap entry is a URL, not a guarantee the page already renders) |
| `apps/admin` (login, guides, review, audit, providers, security, account) | — | — | — | — | EXCLUDED | Disallowed in robots (`/admin/`, `/login`, `/account/`); separate deployable; never indexable (SECURITY.md 5) |

Excluded by design (never sitemap, never crawlable): `/api/*` (the versioned
backend API, disallowed in robots), user-specific location and private
contacts (SECURITY.md 5), transient search-result query pages.

## robots.txt (`apps/web/src/app/robots.ts`)

- `User-agent: *` with `Allow: /` (the whole public site is crawlable) and
  `Disallow: /admin/`, `/login`, `/account/`, `/api/` (the more-specific
  disallow wins over the wildcard allow).
- `Sitemap:` line is env-driven from the shared `webBaseUrl()`
  (`NEXT_PUBLIC_WEB_BASE_URL`, fallback `https://sentravyn.example`) — the
  same single source of truth as the layout's `metadataBase`, so the origin
  can never drift. No fabricated production domain.
- Honest policy note: public preparedness content is indexable; stale or
  unverified data is labelled on the page; page text, not URL structure, is
  the source of record.

## Sitemap (`apps/web/src/app/sitemap.ts`)

- Constant entries: `/`, `/guides`, `/map`, `/alerts`, `/prepare`, `/about`,
  `/contact`, `/data-sources`, `/verification`, `/privacy`, `/terms` — the
  public indexable routes, with **no `lastmod`** (the doc forbids a fake
  "every build" date; the real content date for a constant route is not
  available at runtime).
- Dynamic entries: one per **published guide** (`GET /guides`, which the
  backend already constrains to APPROVED/PUBLISHED via `publicOnly`),
  `lastmod` = the guide's real `updatedAt`. Fetched at request time with a
  3 s timeout; on any failure (offline, non-200, malformed row) the sitemap
  degrades to the constant routes and logs a warning — it never blocks and
  never invents entries.

## Structured data (JSON-LD, `apps/web/src/lib/jsonld.ts`)

- **Organization + WebSite** (the actual publisher): emitted site-wide in
  the root layout as an inline `<script type="application/ld+json">`
  (`JsonLdScript`), so every served page carries it in the HTML. Factual
  only — no logo, founding data, ratings or invented credentials.
- **TechArticle** on `/guides/[id]`, emitted only when the real record has
  loaded (client fetch, `GuideDetailClient`): `headline`, `url`,
  `inLanguage`, `datePublished` (`createdAt`), `dateModified` (`updatedAt`),
  `publisher` (inlined Organization), plus **only when the record carries
  them**: `author`, `reviewer`, `authority`, `lastReviewed`
  (`lastReviewedAt`) and `isBasedOn` (the guide's recorded http(s) source
  references — non-URL citation strings are dropped, never forced into a
  false property). Null fields are omitted, never invented.
- **BreadcrumbList** on `/guides/[id]`: mirrors the visible "All guides"
  back-link (Home > Safety guides > this guide).
- **No FAQPage**: there is no visible FAQ content on the public surface, so
  none is emitted (the doc requires FAQPage only where actual visible Q&A
  exists; inventing one is decorative and was rejected).
- Shape is covered by `apps/web/src/lib/__tests__/jsonld.test.ts` (asserts
  null optional fields are omitted; asserts no FAQPage/rating fields are
  ever emitted).
- Validation in the Rich Results Test / Schema Markup Validator: **NOT RUN**
  (no live deployment).

## Open Graph / social cards

- `layout.tsx` `openGraph`: `type: 'website'`, `siteName: 'SENTRAVYN'`,
  factual title/description, all absolute URLs resolving against the
  env-driven `metadataBase`.
- `og:image`: **intentionally omitted.** The only real image asset is the
  SVG manifest icon (`/icons/icon.svg`), which social platforms do not
  render as an og:image; generating a branded PNG placeholder would
  fabricate an asset that does not exist, so the tag is left out and a real
  branded OG asset is a follow-up. No fake image is referenced.
- No invented ratings, reviews or organization credentials anywhere.

## llms.txt (`apps/web/public/llms.txt`)

Short, informational: what SENTRAVYN is, the public route list, the
preparedness disclaimer, and an explicit statement that the file is
informational for language-model and human readers — **not** a crawler
contract and not a guarantee that any AI engine or search engine will
index, rank or cite the content. The authoritative crawling policy remains
`robots.txt` + `sitemap.xml`.

## Core Web Vitals

**NOT RUN.** No browser or deployment is available in this environment.
Checks to perform when deployed: LCP, INP and CLS on `/`, `/guides` and
`/map` across 360px–desktop viewports, plus the JS-disabled HTML pass.
The map page is the likely LCP risk (canvas + tiles); nothing here claims a
metric.

## Search engines & discovery — owner steps (copied from docs/SEARCH-CONSOLE-SETUP.md; all NOT CONFIGURED)

| Item | Status |
| --- | --- |
| Production domain | **NOT SELECTED** (owner action: purchase/control a real domain, then set `NEXT_PUBLIC_WEB_BASE_URL`) |
| Google Search Console | **NOT CONFIGURED — PENDING OWNER** (domain property + DNS TXT token or URL-prefix verification at search.google.com/search-console; never invent a token; store issued values in env only after issuance) |
| Bing Webmaster Tools | **NOT CONFIGURED — PENDING OWNER** (import the verified GSC property, or verify via supported DNS/meta/file methods at bing.com/webmasters) |
| Sitemap submission | **PENDING DOMAIN** (submit `https://<domain>/sitemap.xml` after real domain control; confirm `/robots.txt` and `/sitemap.xml` respond correctly first) |
| IndexNow | **NOT CONFIGURED — PENDING OWNER** (generate the key securely, host the key verification file, send changed canonical public URLs only; must be implemented *after* the real domain and key exist; Bing/IndexNow submission does not notify Google and does not guarantee indexing) |

No verification token is stored or claimed; no indexing, ranking,
verification or AI-citation status is asserted anywhere in this document.

## Limitations and open items

1. Per-page explicit `canonical` tags are not emitted (stable absolute URLs,
   the sitemap and `metadataBase` cover canonicalization today; explicit
   tags are a follow-up).
2. Per-guide dynamic `<title>`/description are not server-rendered because
   the guide record loads client-side (`instant = false`); the guide's
   TechArticle and BreadcrumbList JSON-LD are emitted client-side with the
   same record, so that structured data only exists in the hydrated DOM —
   not in the pre-hydration HTML.
3. `/guides` and `/guides/[id]` H1s are client-rendered (the pre-hydration
   HTML carries the Suspense loading fallback).
4. `og:image` is omitted pending a real branded asset (see OG section).
5. The eight public content pages are not in this build (sibling
   workstream); the sitemap/robots reference them as URL entries.
6. Crawl of the live site, Core Web Vitals measurement, Rich Results
   validation and all webmaster-account actions remain `NOT RUN` /
   `NOT CONFIGURED` until a real deployment and owner domain exist.
