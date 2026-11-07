import {
  guideArticleGraph,
  guideBreadcrumbGraph,
  siteGraph,
  webBaseUrl,
  type GuideArticleInput,
  type JsonLdNode,
} from '@/lib/jsonld';

/**
 * JSON-LD helper tests (docs/SEO-AEO-GEO.md structured-data rules;
 * CLAUDE.md: no fabricated structured data).
 *
 *   - Organization + WebSite are emitted with the real publisher facts.
 *   - TechArticle omits missing optional fields (author/reviewer/references)
 *     instead of inventing them.
 *   - No FAQPage is ever emitted (there is no visible FAQ content).
 */

function firstNode(graph: { '@graph': JsonLdNode[] }): JsonLdNode {
  return graph['@graph'][0];
}

describe('webBaseUrl', () => {
  it('falls back to the example domain when the env var is unset', () => {
    const prev = process.env.NEXT_PUBLIC_WEB_BASE_URL;
    delete process.env.NEXT_PUBLIC_WEB_BASE_URL;
    try {
      expect(webBaseUrl()).toBe('https://sentravyn.example');
    } finally {
      if (prev !== undefined) {
        process.env.NEXT_PUBLIC_WEB_BASE_URL = prev;
      }
    }
  });

  it('uses the env var and strips a trailing slash', () => {
    const prev = process.env.NEXT_PUBLIC_WEB_BASE_URL;
    process.env.NEXT_PUBLIC_WEB_BASE_URL = 'https://sentravyn.example/';
    try {
      expect(webBaseUrl()).toBe('https://sentravyn.example');
    } finally {
      if (prev !== undefined) {
        process.env.NEXT_PUBLIC_WEB_BASE_URL = prev;
      } else {
        delete process.env.NEXT_PUBLIC_WEB_BASE_URL;
      }
    }
  });
});

describe('siteGraph (Organization + WebSite)', () => {
  const graph = siteGraph('https://sentravyn.example');

  it('is a valid @graph document with Organization and WebSite nodes', () => {
    expect(graph['@context']).toBe('https://schema.org');
    const types = graph['@graph'].map((n) => n['@type']);
    expect(types).toContain('Organization');
    expect(types).toContain('WebSite');
    expect(types).not.toContain('FAQPage');
  });

  it('carries the real publisher name and the exact origin as url', () => {
    const org = firstNode(graph);
    expect(org.name).toBe('SENTRAVYN');
    expect(org.url).toBe('https://sentravyn.example');
    const site = graph['@graph'].find((n) => n['@type'] === 'WebSite')!;
    expect(site.url).toBe('https://sentravyn.example');
    expect(site.publisher).toEqual({
      '@type': 'Organization',
      name: 'SENTRAVYN',
      url: 'https://sentravyn.example',
    });
  });
});

describe('guideArticleGraph (TechArticle)', () => {
  const baseGuide: GuideArticleInput = {
    url: 'https://sentravyn.example/guides/guide-1',
    headline: 'Earthquake — Berlin',
    author: 'Author One',
    reviewer: 'Reviewer Two',
    authority: 'Berlin Civil Protection',
    lastReviewedAt: '2026-11-01T00:00:00Z',
    datePublished: '2026-10-01T00:00:00Z',
    dateModified: '2026-11-01T00:00:00Z',
    language: 'en',
    references: ['https://example.org/official-source'],
  };

  it('emits a TechArticle with the recorded fields present', () => {
    const article = firstNode(guideArticleGraph(baseGuide));
    expect(article['@type']).toBe('TechArticle');
    expect(article.headline).toBe('Earthquake — Berlin');
    expect(article.datePublished).toBe('2026-10-01T00:00:00Z');
    expect(article.dateModified).toBe('2026-11-01T00:00:00Z');
    expect(article.inLanguage).toBe('en');
    expect(article.author).toEqual([{ '@type': 'Person', name: 'Author One' }]);
    expect(article.reviewer).toEqual([
      { '@type': 'Person', name: 'Reviewer Two' },
    ]);
    expect(article.authority).toEqual({
      '@type': 'Organization',
      name: 'Berlin Civil Protection',
    });
    expect(article.lastReviewed).toBe('2026-11-01T00:00:00Z');
    expect(article.isBasedOn).toEqual([
      { '@type': 'URL', value: 'https://example.org/official-source' },
    ]);
  });

  it('omits author and reviewer when the record has none', () => {
    const article = firstNode(
      guideArticleGraph({ ...baseGuide, author: null, reviewer: null }),
    );
    expect(article).not.toHaveProperty('author');
    expect(article).not.toHaveProperty('reviewer');
  });

  it('omits authority and lastReviewed when the record has none', () => {
    const article = firstNode(
      guideArticleGraph({
        ...baseGuide,
        authority: null,
        lastReviewedAt: null,
      }),
    );
    expect(article).not.toHaveProperty('authority');
    expect(article).not.toHaveProperty('lastReviewed');
  });

  it('omits reference fields entirely when there are no URLs', () => {
    const article = firstNode(
      guideArticleGraph({ ...baseGuide, references: [] }),
    );
    expect(article).not.toHaveProperty('isBasedOn');
  });

  it('drops non-URL reference strings instead of inventing URLs', () => {
    const article = firstNode(
      guideArticleGraph({
        ...baseGuide,
        references: ['See §3 of the local civil-protection code'],
      }),
    );
    expect(article).not.toHaveProperty('isBasedOn');
  });

  it('never emits a FAQPage or invented rating fields', () => {
    const article = firstNode(guideArticleGraph(baseGuide));
    expect(article['@type']).not.toBe('FAQPage');
    expect(article).not.toHaveProperty('ratingValue');
    expect(article).not.toHaveProperty('aggregateRating');
  });
});

describe('guideBreadcrumbGraph (BreadcrumbList)', () => {
  it('mirrors the visible navigation Home > Safety guides > this guide', () => {
    const graph = guideBreadcrumbGraph(
      'https://sentravyn.example',
      'https://sentravyn.example/guides/guide-1',
      'Earthquake — Berlin',
    );
    expect(graph['@context']).toBe('https://schema.org');
    const crumb = firstNode(graph);
    expect(crumb['@type']).toBe('BreadcrumbList');
    const items = crumb.itemListElement as Array<{
      '@type': string;
      position: number;
      name: string;
      item: string;
    }>;
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      '@type': 'ListItem',
      position: 1,
      name: 'Home',
      item: 'https://sentravyn.example',
    });
    expect(items[1]).toEqual({
      '@type': 'ListItem',
      position: 2,
      name: 'Safety guides',
      item: 'https://sentravyn.example/guides',
    });
    expect(items[2]).toEqual({
      '@type': 'ListItem',
      position: 3,
      name: 'Earthquake — Berlin',
      item: 'https://sentravyn.example/guides/guide-1',
    });
  });
});
