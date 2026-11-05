import type { Metadata } from 'next';
import { Suspense } from 'react';
import { GuideIndexClient } from '@/components/guides/GuideIndexClient';

export const metadata: Metadata = {
  title: 'Safety guides',
  description:
    'Reviewed, hazard-specific protective guidance from SENTRAVYN: summaries ' +
    'of official guidance with source references, review dates, versions and ' +
    'jurisdiction applicability. Summaries only — not official instructions.',
};

/**
 * Guide index (Phase 5). The data, category tabs, locale selector and all
 * the state panels live in the client component, which fetches GET /guides
 * (public, APPROVED/PUBLISHED only). A hazard with no reviewed guide shows
 * the empty state — never fabricated content (SAFETY-POLICY.md 1, 5, 10).
 *
 * The `?hazard=` query param is read inside the client component via
 * useSearchParams, so the client is wrapped in a Suspense boundary (the
 * hook requires one for static rendering).
 */
export default function GuidesIndexPage() {
  return (
    <Suspense
      fallback={
        <div className="state-panel" role="status" aria-live="polite">
          <span className="state-panel__spinner" aria-hidden="true" />
          <span>Loading guides…</span>
        </div>
      }
    >
      <GuideIndexClient />
    </Suspense>
  );
}
