import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { GuideDetailClient } from '@/components/guides/GuideDetailClient';

export const metadata: Metadata = {
  title: 'Safety guide',
  description:
    'A reviewed, cited safety guide from SENTRAVYN: summary only, with ' +
    'authoritative source references, review date and version. Not a ' +
    'substitute for official emergency instructions.',
};

// The guide id is per-request data (the user's chosen guide), so the route
// is inherently dynamic and its content comes from the client fetch at
// request time. `instant = false` makes this a blocking (non-prerendered)
// route, which is the documented escape hatch when `cacheComponents` is on
// and a dynamic route's data access would otherwise fail the static build.
export const instant = false;

/**
 * Guide detail (Phase 5). The server page validates the param shape and
 * hands the id to the client component, which fetches GET /guides/:id
 * (public: only APPROVED/PUBLISHED guides are readable; anything else is a
 * 404 from the API). The page shows the body next to the mandatory
 * "summaries only" disclosure, the full metadata, the source references
 * and the revision history (DESIGN.md 6: editorial, source-backed).
 */
export default async function GuideDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!id || id.length > 128) {
    notFound();
  }
  return <GuideDetailClient id={id} />;
}
