import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AlertsDetailClient } from '@/components/alerts/AlertsDetailClient';

export const metadata: Metadata = {
  title: 'Alert record',
  description:
    'One public alert record: issuer, times, severity, urgency, certainty, ' +
    'revision history and source provenance, with an explicit freshness ' +
    'label. Preserved by SENTRAVYN from its source — never re-issued.',
};

// The alert id is per-request data (the user's chosen record), so the route
// is inherently dynamic and its content comes from the client fetch at
// request time. `instant = false` makes this a blocking (non-prerendered)
// route, the documented escape hatch when `cacheComponents` is on and a
// dynamic route's data access would otherwise fail the static build.
// (Same idiom as the guide detail route.)
export const instant = false;

/**
 * Alert detail (Phase 3). The server page validates the param shape and
 * hands the id to the client component, which fetches the AlertDetail
 * envelope (GET /api/v1/alerts/:id: the record, its ADR-005 revision
 * chain and its ADR-007 source provenance). Unknown ids surface the API's
 * 404 as the not-found state in the panel — the page never fabricates an
 * alert.
 */
export default async function AlertDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!id || id.length > 128) {
    notFound();
  }
  return <AlertsDetailClient alertId={id} />;
}
