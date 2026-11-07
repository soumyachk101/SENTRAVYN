/**
 * jsonld.ts — schema.org JSON-LD builders + the shared metadata-base URL for
 * the SENTRAVYN web app.
 *
 * These emit structured data ONLY from real, visible factual content
 * (docs/SEO-AEO-GEO.md; CLAUDE.md rule 3: never fabricate):
 *
 *   - Organization + WebSite describe the actual publisher. No logo, no
 *     founding data, no invented credentials or ratings.
 *   - TechArticle is produced ONLY from a genuine published-guide record, and
 *     each optional field is included just when the record actually carries
 *     it — missing values are omitted, never invented or null-padded.
 *   - BreadcrumbList mirrors the visible "All guides" back-link on the guide
 *     detail page (Home > Safety guides > this guide).
 *   - There is NO FAQPage: the public surface has no visible FAQ content, so
 *     none is emitted (no invented Q&A; docs/SEO-AEO-GEO.md).
 *
 * The builders return a single embedding-ready `@graph` object so the caller
 * can hand it to an inline <script type="application/ld+json"> tag. Keeping
 * them pure functions with no JSX makes them trivially unit-testable.
 */

/** The approved brand name (CLAUDE.md) — the organization is "SENTRAVYN". */
export const ORG_NAME = 'SENTRAVYN';

/** A minimal, factual description of the publisher (no invented claims). */
export const ORG_DESCRIPTION =
  'SENTRAVYN is a global public-safety information and preparedness platform: ' +
  'authoritative emergency alerts, reviewed protective guidance, nearby ' +
  'emergency services and household preparedness. It is an information and ' +
  'preparedness platform, not an operational emergency service.';

/**
 * The absolute origin for every generated absolute-URL (canonical, sitemap,
 * robots, JSON-LD). A real deployment sets NEXT_PUBLIC_WEB_BASE_URL; until
 * then we fall back to the example domain rather than fabricate a production
 * host (CLAUDE.md: never claim a domain without evidence). Single source of
 * truth so layout / robots / sitemap / pages never drift.
 */
export function webBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_WEB_BASE_URL ?? 'https://sentravyn.example'
  ).replace(/\/+$/, '');
}

/** One node inside a JSON-LD graph. */
export interface JsonLdNode {
  '@type': string;
  [key: string]: unknown;
}

/** A single `@graph` document, ready to inline as application/ld+json. */
export interface JsonLdGraph {
  '@context': string;
  '@graph': JsonLdNode[];
}

/**
 * Organization + WebSite for the publisher. Each node is self-contained
 * (no cross-`@id` links to other graph files) so it validates on its own.
 */
export function siteGraph(base: string): JsonLdGraph {
  const origin = base.replace(/\/+$/, '');
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${origin}/#organization`,
        name: ORG_NAME,
        description: ORG_DESCRIPTION,
        url: origin,
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}/#website`,
        name: ORG_NAME,
        url: origin,
        // Inline the publisher (rather than a cross-graph @id) so this graph
        // is valid when rendered on its own.
        publisher: {
          '@type': 'Organization',
          name: ORG_NAME,
          url: origin,
        },
      },
    ],
  };
}

/**
 * The fields of a guide that map to schema.org, taken straight from the
 * published-guide record. Nullable/optional fields are optional on purpose —
 * the caller only passes what the record actually has, so a builder emits a
 * key only when it is present.
 *
 * Field honesty (docs/SEO-AEO-GEO.md; CLAUDE.md rule 3):
 *   - author / reviewer / authority / lastReviewedAt are null when the guide
 *     carries no value, and the builder omits the corresponding key in that
 *     case — it never invents an author, reviewer, authority or review date.
 *   - `references` are the guide's recorded source citations; only genuine
 *     http(s) URLs are carried (schema.org `isBasedOn`), non-URL strings are
 *     dropped rather than forced into a false property.
 */
export interface GuideArticleInput {
  /** Absolute canonical URL of the guide page. */
  url: string;
  /** Human-readable headline, e.g. "Earthquake — Berlin". */
  headline: string;
  /** ISO 8601 real creation timestamp of the guide. */
  datePublished: string;
  /** ISO 8601 real last-modification timestamp of the guide. */
  dateModified: string;
  /** BCP-47 style code, e.g. "en". */
  language: string;
  /** Named author, when the record carries one (null otherwise -> omitted). */
  author?: string | null;
  /** Named responsible reviewer, when recorded (null otherwise -> omitted). */
  reviewer?: string | null;
  /**
   * The verifying authority name, when recorded (null otherwise ->
   * omitted). Carried as an Organization extension property.
   */
  authority?: string | null;
  /**
   * The guide's real last review timestamp, when it has ever been reviewed
   * (null otherwise -> omitted). Emitted as the `lastReviewed` extension.
   */
  lastReviewedAt?: string | null;
  /** Authoritative source references (the guide's visible citations). */
  references: string[];
}

/**
 * Build the embedding-ready TechArticle graph for ONE published guide.
 *
 * Field presence rules (never fabricate):
 *   - author / reviewer -> a `Person` with the recorded name; the key is
 *     omitted entirely when null (no empty `Person` placeholders).
 *   - authority -> an `Organization` extension property; omitted when null.
 *   - lastReviewedAt -> `lastReviewed` (ISO date string); omitted when null.
 *   - references -> `isBasedOn` (valid on TechArticle via CreativeWork) as
 *     an array of the recorded http(s) URLs. Omitted when there are none.
 *   - publisher -> inlined Organization, always (we are the publisher).
 */
export function guideArticleGraph(guide: GuideArticleInput): JsonLdGraph {
  const article: JsonLdNode = {
    '@type': 'TechArticle',
    headline: guide.headline,
    url: guide.url,
    inLanguage: guide.language,
    datePublished: guide.datePublished,
    dateModified: guide.dateModified,
    publisher: { '@type': 'Organization', name: ORG_NAME },
  };

  if (guide.author) {
    article.author = [{ '@type': 'Person', name: guide.author }];
  }
  if (guide.reviewer) {
    article.reviewer = [{ '@type': 'Person', name: guide.reviewer }];
  }
  if (guide.authority) {
    article.authority = { '@type': 'Organization', name: guide.authority };
  }
  if (guide.lastReviewedAt) {
    article.lastReviewed = guide.lastReviewedAt;
  }

  const urlRefs = guide.references.filter((r) =>
    /^https?:\/\//i.test(r.trim()),
  );
  if (urlRefs.length > 0) {
    article.isBasedOn = urlRefs.map((r) => ({
      '@type': 'URL',
      value: r,
    }));
  }

  return {
    '@context': 'https://schema.org',
    '@graph': [article],
  };
}

/**
 * BreadcrumbList for a guide detail page, mirroring the visible navigation
 * (Home > Safety guides > this guide). `guideLabel` is the same human-
 * readable headline the page shows as its H1.
 */
export function guideBreadcrumbGraph(
  base: string,
  guideUrl: string,
  guideLabel: string,
): JsonLdGraph {
  const origin = base.replace(/\/+$/, '');
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Home',
            item: origin,
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Safety guides',
            item: `${origin}/guides`,
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: guideLabel,
            item: guideUrl,
          },
        ],
      },
    ],
  };
}
