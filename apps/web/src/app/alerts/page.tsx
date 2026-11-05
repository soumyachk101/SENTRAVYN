import type { Metadata } from 'next';
import { Suspense } from 'react';
import { AlertsClient } from '@/components/alerts/AlertsClient';

/**
 * `/alerts` (Phase 3 public alert surface).
 *
 * The data, every state (loading / empty / error-retry / offline / stale)
 * and the per-row freshness + information-class labels live in the client
 * component, which fetches GET /api/v1/alerts via @sentravyn/api-client
 * (public-safe statuses only; the server guarantees quarantined/unreviewed
 * records never reach the public list). The component only reads
 * `?status=`/`?page=` inside the client when extended later, so the
 * Suspense boundary below also covers the future useSearchParams.
 */
export const metadata: Metadata = {
  title: 'Emergency alerts',
  description:
    'Public, source-backed emergency alerts with issuer, times, severity, ' +
    'urgency, certainty and original source links. Every record carries an ' +
    'explicit freshness label; stale information is shown as stale, never ' +
    'as current.',
};

export default function AlertsPage() {
  return (
    <Suspense
      fallback={
        <div className="state-panel" role="status" aria-live="polite">
          <span className="state-panel__spinner" aria-hidden="true" />
          <span>Loading public alerts…</span>
        </div>
      }
    >
      <AlertsClient />
    </Suspense>
  );
}
