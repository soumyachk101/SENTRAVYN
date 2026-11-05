'use client';

import { useMemo } from 'react';
import type { JsonLdGraph } from '@/lib/jsonld';

/**
 * Renders a JSON-LD graph as an inline <script type="application/ld+json">
 * tag (the pattern Next.js documents for structured data). Emits nothing
 * when `graph` is null, so a caller can pass "only when the data exists"
 * without a separate branch.
 *
 * Client component on purpose: guide detail data arrives from a client-side
 * fetch, so the TechArticle graph is emitted when the record loads, never
 * guessed at build time.
 *
 * The payload is the graph's JSON with `<` encoded as `<` (the scrub
 * Next.js's JSON-LD guide prescribes): the guide fields we embed (author,
 * reviewer, references) are external data, and an unescaped `<` inside a
 * script tag is an XSS surface even though JSON.stringify escapes quotes.
 */
export function JsonLdScript({ graph }: { graph: JsonLdGraph | null }) {
  const payload = useMemo(
    () =>
      graph === null ? null : JSON.stringify(graph).replace(/</g, '\\u003c'),
    [graph],
  );
  if (payload === null) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: payload }}
    />
  );
}
