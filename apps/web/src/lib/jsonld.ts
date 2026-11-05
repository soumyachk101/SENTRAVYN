/**
 * jsonld.ts — schema.org JSON-LD builders + the shared metadata-base URL for
 * the SENTRAVYN web app.
 *
 * These emit structured data ONLY from real, visible factual content
 * (docs/SEO-AEO-GEO.md; CLAUDE.md rule 3: never fabricate):
 *
 *   - Organization + WebSite describe the actual publisher. No logo, no
 *     founding data, no invented credentials or ratings.
 *   - TechArticle is produced ONLY from a genuine guide record, and each
 *     optional field is included just when the record actually carries it —
 *     missing values are omitted, never invented or null-padded.
 *   - There is NO FAQPage: the public surface has no visible FAQ content, so
 *     none is emitted (no invented Q&A).
 *
 * The builders return a single embedding-ready `@graph` object so the caller
 * can hand it to Next's `metadata.jsonLd` (which renders a
 * <script type="application/ld+json"> tag). Keeping them pure functions with
 * no JSX makes them trivially unit-testable.
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

/** A single `@graph` document, ready for `metadata.jsonLd`. */
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
 * The fields of a guide that map cleanly to schema.org. Mirrors the public
 * surface shape (`@/lib/api` `GuideDetail` / api-client `GuidesClient.one`).
 * `author` / `reviewer` / `references` are nullable/optional on purpose —
 * the caller only passes what the record actually has.
 */
export interface GuideArticleInput {
  /** Absolute canonical URL of the guide page. */
  url: string;
  /** Human-readable headline, e.g. "Earthquake — Berlin". */
  headline: string;
  /** Named author, when the record carries one (else omit). */
  author?: string | null;
  /** Named responsible reviewer, when recorded (else omit). */
  reviewer?: string | null;
  /** ISO 8601 real creation timestamp of the guide. */
  datePublished: string;
  /** ISO 8601 real last-modification timestamp of the guide. */
  dateModified: string;
  /** BCP-47 style code, e.g. "en". */
  language: string;
  /**
   * Authoritative source references (the guide's visible citations). Only
   * genuine http(s) URLs are carried; non-URL strings are dropped rather
   * than forced into a false property.
   */
  references: string[];
}

/**
 * Build the embedding-ready TechArticle graph for ONE published guide.
 *
 * Field presence rules (never fabricate):
 *   - author / reviewer → a `Person` with the recorded name, else the key is
 *     omitted entirely (no empty `Person` placeholders).
 *   - source references → `isBasedOn` (valid on TechArticle via CreativeWork)
 *     as an array of the recorded URLs. Omitted when there are no URLs.
 *   - publisher → inlined Organization, always (we are the verified
 *     publisher). No ratings, no invented credentials.
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
