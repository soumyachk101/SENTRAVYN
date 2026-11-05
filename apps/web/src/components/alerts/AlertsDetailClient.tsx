'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { Alert, AlertDetail } from '@sentravyn/shared-types';
import {
  FRESHNESS_LABELS,
  getPublicAlertDetail,
  INFORMATION_CLASS_LABELS,
} from '@/lib/alerts';
import '@/components/alerts/alerts.css';

/**
 * Alert detail route (`/alerts/[id]`, Phase 3). Fetches the AlertDetail
 * envelope (GET /api/v1/alerts/:id): the alert itself, its revision
 * history (ADR-005 update/cancel chain) and its source-record provenance
 * (ADR-007 — sourceUrl, provider attribution, payload hash, fetch time).
 *
 * The detail route is the "original source" of a list row: it is where the
 * provenance sourceUrl (the link back to the issuing authority) is shown,
 * alongside the source attribution and the fetch time. A list row never
 * fabricates a source URL.
 *
 * States: loading, not-found (404), error (retry), and the same freshness /
 * information-class labelling as the list (SAFETY-POLICY.md 2, 8).
 */

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; detail: AlertDetail }
  | { status: 'error'; message: string; notFound: boolean };

function describeError(err: unknown): string {
  const e = err as { status?: number; message?: string };
  if (typeof e?.status === 'number' && e.status === 404) {
    return 'This alert record was not found in the public API.';
  }
  if (typeof e?.status === 'number' && e.status > 0) {
    return e.message ?? `Request failed with status ${e.status}`;
  }
  if (typeof e?.message === 'string' && e.message.length > 0) {
    return e.message;
  }
  return 'An unexpected error occurred while loading this alert.';
}

function formatStamp(iso: string | null): string {
  if (iso === null) return 'Not provided by the source';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'Not available';
  return new Date(t).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function DetailMeta({ alert }: { alert: Alert }) {
  const freshness = FRESHNESS_LABELS[alert.freshness.state];
  const cls = INFORMATION_CLASS_LABELS[alert.informationClass];

  return (
    <>
      <div className="alert-card__head">
        <h2 className="alert-card__headline">{alert.headline}</h2>
        <span
          className={`alert-card__freshness alert-card__freshness--${alert.freshness.state}`}
          role="status"
          data-testid={`freshness-${alert.freshness.state}`}
        >
          {freshness}
        </span>
      </div>

      <dl className="alert-card__meta">
        <div>
          <dt>Issuer</dt>
          <dd>{alert.issuer ?? 'Not named by the source'}</dd>
        </div>
        <div>
          <dt>Severity</dt>
          <dd>{alert.severity ?? 'Not provided'}</dd>
        </div>
        <div>
          <dt>Urgency</dt>
          <dd>{alert.urgency ?? 'Not provided'}</dd>
        </div>
        <div>
          <dt>Certainty</dt>
          <dd>{alert.certainty ?? 'Not provided'}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{alert.status}</dd>
        </div>
        <div>
          <dt>Verification</dt>
          <dd>{alert.verification}</dd>
        </div>
        <div>
          <dt>Issued</dt>
          <dd>{formatStamp(alert.issuedAt)}</dd>
        </div>
        <div>
          <dt>Effective</dt>
          <dd>{formatStamp(alert.effectiveAt)}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>{formatStamp(alert.expiresAt)}</dd>
        </div>
        <div>
          <dt>Information class</dt>
          <dd>{cls}</dd>
        </div>
        <div>
          <dt>External reference</dt>
          <dd>{alert.externalRef ?? 'No external identifier'}</dd>
        </div>
      </dl>
    </>
  );
}

export function AlertsDetailClient({ alertId }: { alertId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const inflight = useRef(0);

  const load = useCallback(async () => {
    inflight.current += 1;
    const seq = inflight.current;
    setState({ status: 'loading' });
    try {
      const detail = await getPublicAlertDetail(alertId);
      if (seq !== inflight.current) return;
      setState({ status: 'ready', detail });
    } catch (err) {
      if (seq !== inflight.current) return;
      const e = err as { status?: number };
      setState({
        status: 'error',
        message: describeError(err),
        notFound: typeof e?.status === 'number' && e.status === 404,
      });
    }
  }, [alertId]);

  useEffect(() => {
    // Local-closure idiom (same as the guide index): syncs external data
    // into React state without a directly-traced synchronous setState.
    const begin = () => {
      void load();
    };
    begin();
  }, [load]);

  const retry = useCallback(() => {
    void load();
  }, [load]);

  const provenance = state.status === 'ready' ? state.detail.provenance : null;

  return (
    <section className="alerts-page" aria-labelledby="alert-detail-heading">
      <p className="alerts-page__eyebrow">Emergency alert detail</p>
      <h1 id="alert-detail-heading" className="alerts-title">
        Alert record
      </h1>
      <p className="alerts-sub">
        <Link className="alerts-link" href="/alerts">
          Back to the public alert list
        </Link>
      </p>

      {state.status === 'loading' ? (
        <div className="state-panel" role="status" aria-live="polite">
          <span className="state-panel__spinner" aria-hidden="true" />
          <span>Loading this alert…</span>
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div
          className="state-panel state-panel--error"
          role="alert"
          aria-live="assertive"
        >
          <p className="state-panel__title">
            {state.notFound ? 'Alert not found' : 'Could not load this alert'}
          </p>
          <p className="state-panel__body">{state.message}</p>
          {!state.notFound ? (
            <button
              type="button"
              className="state-panel__retry"
              onClick={retry}
              data-testid="alert-retry"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}

      {state.status === 'ready' ? (
        <>
          <article className="alert-card">
            <DetailMeta alert={state.detail.alert} />
          </article>

          {provenance ? (
            <div className="alert-card alert-provenance">
              <h2 className="alert-provenance__title">Source provenance</h2>
              <dl className="alert-card__meta">
                <div>
                  <dt>Provider</dt>
                  <dd>
                    {provenance.provider?.name ??
                      'Provider record no longer available'}
                  </dd>
                </div>
                <div>
                  <dt>Fetched</dt>
                  <dd>{formatStamp(provenance.fetchedAt)}</dd>
                </div>
                <div>
                  <dt>Source record</dt>
                  <dd>{provenance.sourceRecordId}</dd>
                </div>
                {provenance.provider?.attribution ? (
                  <div>
                    <dt>Attribution</dt>
                    <dd>{provenance.provider.attribution}</dd>
                  </div>
                ) : null}
              </dl>
              {provenance.sourceUrl ? (
                <p className="alert-provenance__source">
                  Original source:{' '}
                  <a
                    className="alert-card__source"
                    href={provenance.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {provenance.sourceUrl}
                  </a>
                </p>
              ) : (
                <p className="alert-card__source-miss">
                  Source URL not recorded for this record.
                </p>
              )}
            </div>
          ) : (
            <div className="state-panel">
              <p className="state-panel__title">No provenance on record</p>
              <p className="state-panel__body">
                This alert was not ingested from a tracked source record, so
                there is no source identifier, fetch time or attribution to
                show.
              </p>
            </div>
          )}

          {state.detail.revisions.length > 0 ? (
            <div className="alert-card">
              <h2 className="alert-provenance__title">Revision history</h2>
              <ol className="alert-revisions">
                {state.detail.revisions.map((rev) => (
                  <li key={rev.revision} className="alert-revisions__item">
                    <span className="alert-revisions__rev">
                      Rev {rev.revision}
                    </span>{' '}
                    <span className="alert-revisions__status">
                      {rev.status}
                    </span>{' '}
                    <span className="alert-revisions__time">
                      {formatStamp(rev.createdAt)}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
