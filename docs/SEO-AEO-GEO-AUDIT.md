# SEO / AEO / GEO Audit — SENTRAVYN Web

Audit of `apps/web` (public site) against `docs/SEO-AEO-GEO.md`.
Base: `feat/phase2-4-trust-review-geo` @ `7ae8573`, audit performed on branch
`b2-seo`. Findings are evidence-based only; items that require a live
deployment, an owner-controlled domain, or a browser run are explicitly
marked `NOT RUN` / `NOT CONFIGURED` — no indexing, ranking, verification or
citation is claimed anywhere in this document.

## Scope and method

- Static audit of the route files, layouts, robots, sitemap and structured
  data in `apps/web`.
- The admin app (`apps/admin`) is a separate deployable and is **excluded
  from the public sitemap and indexable surface** by design. Its routes
  (login, review, audit, provider/security configuration, account) are
  never indexable.
- Core Web Vitals, crawler runs and webmaster-account actions are
  `NOT RUN` / `NOT CONFIGURED` for the reasons listed at the bottom of each
  section.

## Page-by-page findings

### `/` (home — `src/app/page.tsx`)

| Item | Status | Evidence / note |
| --- | --- | --- |
| Title | PASS | Inherited default + template from `layout.tsx`: `SENTRAVYN — Global Emergency Intelligence & Public Safety` |
| Meta description | PASS | Present in `layout.tsx` (site-wide), plus `metadata.description` on the page |
| H1 | PASS | Single H1 in the hero ("Know Where to Go. / Know What to Do. / Stay Prepared.") |
| Canonical | WARN | No per-page `canonical` tag; absolute URLs derive from `metadataBase` (env-driven, never fabricated). Acceptable but not explicit |
| robots directives | PASS | Indexable; no `noindex` set |
| Structured data | PASS (b2-seo) | `Organization` + `WebSite` emitted site-wide via `layout.tsx` `jsonLd` (`@/lib/jsonld` `siteGraph`), so the home page carries it |
| OG card | PASS (b2-seo) | `openGraph` added to `layout.tsx` metadata (siteName, type, factual title/description) |
| Empty/error states | PASS | Preparedness static content, no data-driven panel; limitation copy present |

### `/guides` (guide index — `src/app/guides/page.tsx`)

| Item | Status | Evidence / note |
| --- | --- | --- |
| Title | PASS | `Safety guides — SENTRAVYN` (template applied) |
| Meta description | PASS | Page-level `metadata.description` |
| H1 | PASS (client) | H1 rendered by `GuideIndexClient` (`guide-page__title`); server HTML contains the Suspense fallback, so a JS-disabled crawler sees the loading fallback, not the H1 — known limitation of the client-fetched index |
| Canonical | WARN | None set explicitly |
| robots directives | PASS | Indexable; `/guides` allowed in `robots.ts` |
| Structured data | PASS (b2-seo) | No article-level data on the index (correct: no single article); `CollectionPage` intentionally not asserted |
| Data states | PASS | Loading/empty/error/offline/stale panels in `GuideIndexClient` |

### `/guides/[id]` (guide detail — `src/app/guides/[id]/page.tsx`)

| Item | Status | Evidence / note |
| --- | --- | --- |
| Title | PASS | `Safety guide — SENTRAVYN` (page-level metadata); per-guide dynamic title not set at build time because the record loads client-side (`instant = false` escaping `cacheComponents`) |
| Meta description | PASS | Page-level `metadata.description` |
| H1 | PASS (client) | Rendered from the real record in `GuideDetailBody` (hazard + jurisdiction); empty/error states have no H1 by design (nothing to title) |
| Canonical | WARN | URL is stable and in the sitemap (added per published guide in `sitemap.ts`), but no explicit `<link rel="canonical">` tag |
| robots directives | PASS | Allowed via `/guides/` in `robots.ts`; dynamic route is `instant = false` (rendered per request) |
| Structured data | PASS (b2-seo) | `TechArticle` emitted by `GuideDetailClient` via `JsonLdScript` **only when the real record has loaded**: author/reviewer only when present, references only when they are genuine URLs, `datePublished`/`dateModified` from the record's `createdAt`/`updatedAt`. No FAQPage, no invented ratings/credentials |
| Data states | PASS | Loading / error / offline / not-found / stale panels |

### `/map` (place discovery — `src/app/map/page.tsx`)

| Item | Status | Evidence / note |
| --- | --- | --- |
| Title | PASS | `Emergency map — SENTRAVYN` |
| Meta description | PASS | Page-level `metadata.description` (states dev-only tiles honestly) |
| H1 | WARN | The panel uses an `aria-label="Emergency map"` section with an `h2` title; no semantic `<h1>` on the page |
| Canonical | WARN | None set explicitly |
| robots directives | PASS | Allowed in `robots.ts` |
| Structured data | PASS (n/a) | No structured data appropriate to a map UI; correctly none emitted |
| Data states | PASS | Loading / empty / error / stale / offline all present in `MapPanel` |

### Admin app (`apps/admin`) — excluded

- `apps/admin/src/app` contains `login`, `audit`, `guides`, `providers`,
  `review`, `security` and account-related routes.
- **Not** in the public sitemap; `/admin/`, `/login`, `/account/`, `/api/`
  are disallowed in `robots.ts` (the web app is a separate deployable, so the
  robots rules are defensive rather than load-bearing).
- Rationale (SECURITY.md 5): user-specific location, private contacts and
  operational data must not be indexed.

### Routes in flight (sibling workstream) — excluded on purpose

`/alerts`, `/prepare`, `/about`, `/contact`, `/data-sources`, `/verification`,
`/privacy`, `/terms` do **not exist** in this worktree. Neither `robots.ts`
nor `sitemap.ts` lists them; both carry a code comment to add each route in
a follow-up once it exists. No fabricated route entries.

## robots.txt and sitemap (`b2-seo` additions)

- `src/app/robots.ts` — `MetadataRoute.Robots`: allow the existing public
  routes (`/`, `/guides`, `/guides/`, `/map`); disallow `/admin/`, `/login`,
  `/account/`, `/api/`; sitemap URL env-driven from the shared
  `webBaseUrl()` (never a fabricated domain).
- `src/app/sitemap.ts` — static entries for `/`, `/guides`, `/map` with
  `lastModified` **omitted** (no real per-page content date is available at
  runtime; the doc forbids a fake "every build" date) + one entry per
  **published guide** with the guide's real `updatedAt`, fetched from
  `GET /guides` with a 3 s timeout; on any API failure the sitemap degrades
  to the static routes and logs a warning — it never blocks and never
  invents entries.

## Core Web Vitals

**NOT RUN.** No browser or deployment is available in this environment.
Checks to perform when deployed: LCP, INP and CLS on `/`, `/guides` and
`/map` across 360px–desktop viewports, plus the JS-disabled HTML pass.
The map page is the likely LCP risk (canvas + tiles); nothing here claims a
metric.

## Search engines & discovery — owner action required

- **Google Search Console:** `NOT CONFIGURED — pending owner`. Steps in
  `docs/SEO-AEO-GEO.md` (domain property, DNS TXT token). No verification
  token is stored or claimed; no indexing or ranking is asserted.
- **Bing Webmaster Tools:** `NOT CONFIGURED — pending owner`. Same rule;
  sitemap submission happens after real domain control.
- **IndexNow:** `NOT CONFIGURED — pending owner`. No key generated or
  hosted; the worker is out of this workstream's scope and must only ever
  send changed canonical URLs for public pages.
- `llms.txt`: optional per the doc; not shipped. No claim is made that any
  AI engine will index or cite SENTRAVYN content.

## Limitations and open items

1. Per-page `canonical` tags are not emitted on `/`, `/guides`, `/map`
   (they are indexable via the sitemap and stable URLs; explicit canonicals
   should land with the follow-up pages).
2. Per-guide dynamic `<title>`/description are not server-rendered because
   the guide record loads client-side; the guide-detail structured data is
   emitted client-side with the same record, so it only exists in the
   hydrated DOM.
3. `/guides` and `/guides/[id]` H1s are client-rendered (loading fallback in
   the pre-hydration HTML).
4. Crawl of the live site, CWV measurement and webmaster verification all
   remain `NOT RUN` / `NOT CONFIGURED` until a real deployment exists.
