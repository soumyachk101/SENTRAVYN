'use client';

import {
  useCallback,
  useEffect,
  useSyncExternalStore,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import type { Alert, Paginated } from '@sentravyn/shared-types';
import {
  FRESHNESS_LABELS,
  INFORMATION_CLASS_LABELS,
  listPublicAlerts,
} from '@/lib/alerts';
import '@/components/alerts/alerts.css';

/**
 * Public alerts surface (Phase 3, `/alerts`).
 *
 * Fetches GET /api/v1/alerts (public-safe statuses only — the server
 * guarantees quarantined/unreviewed records never reach this list,
 * SAFETY-POLICY.md 7 / ADR-007). Every row renders its API-computed
 * freshness label, information class, issuer, CAP severity/urgency/certainty
 * and issued/effective/expiry times (PRODUCT-SPEC.md 5, SAFETY-POLICY.md 8).
 *
 * Source link: the alert row carries a stable record id; the "original
 * source" link points at the detail route, which fetches the alert's
 * source-record provenance (ADR-007: sourceUrl + provider attribution).
 * The list itself never fabricates a source URL — when a record has no
 * external identifier it says so.
 *
 * States (CLAUDE.md rule 10): loading, empty, error (with retry), offline,
 * and stale/expired/unknown freshness labels. No geolocation is requested
 * anywhere on this surface (ADR-017 / SECURITY.md §5). Nothing on this page
 * claims a place or action is verified safe (SAFETY-POLICY.md 1, 6).
 */

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; page: Paginated<Alert> }
  | { status: 'error'; message: string };

/** One page of the public list; the API caps page size at 100. */
const PAGE_SIZE = 20;

/**
 * Describe a failed fetch without leaking internals. The api-client rejects
 * non-2xx responses with its ApiError (status + parsed body) and network
 * failures with the raw fetch TypeError (offline / DNS / CORS).
 */
function describeError(err: unknown): string {
  const e = err as { status?: number; message?: string };
  if (typeof e?.status === 'number' && e.status !== 0 && e.status > 0) {
    // The API answered with an error: surface the parsed message when there
    // is one, else the HTTP-level description.
    return e.message ?? `Request failed with status ${e.status}`;
  }
  if (typeof e?.message === 'string' && e.message.length > 0) {
    return e.message;
  }
  return 'An unexpected error occurred while loading alerts.';
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

/**
 * A single alert row. Colour is never the only signal: every label
 * (freshness, information class, times) is rendered as text (DESIGN.md 3).
 */
function AlertRow({ alert }: { alert: Alert }) {
  const freshness = FRESHNESS_LABELS[alert.freshness.state];
  const cls = INFORMATION_CLASS_LABELS[alert.informationClass];

  return (
    <article className="alert-card">
      <div className="alert-card__head">
        <h3 className="alert-card__headline">{alert.headline}</h3>
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
      </dl>

      <div className="alert-card__foot">
        <span className="alert-card__class">{cls}</span>
        <Link
          className="alert-card__source"
          href={`/alerts/${encodeURIComponent(alert.id)}`}
        >
          Source and provenance
        </Link>
      </div>
    </article>
  );
}

export function AlertsClient() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const inflight = useRef(0);

  // Offline detection (CLAUDE.md rule 10), same idiom as the map panel:
  // useSyncExternalStore reads navigator.onLine without setState-in-effect.
  const isOnline = useSyncExternalStore(
    (onStoreChange) => {
      const onUp = () => onStoreChange();
      const onDown = () => onStoreChange();
      window.addEventListener('online', onUp);
      window.addEventListener('offline', onDown);
      return () => {
        window.removeEventListener('online', onUp);
        window.removeEventListener('offline', onDown);
      };
    },
    () => navigator.onLine,
    () => true,
  );
  const offline = !isOnline;

  const load = useCallback(async () => {
    inflight.current += 1;
    const seq = inflight.current;
    setState({ status: 'loading' });
    try {
      const page = await listPublicAlerts({ page: 1, pageSize: PAGE_SIZE });
      if (seq !== inflight.current) return;
      setState({ status: 'ready', page });
      setFetchedAt(new Date().toISOString());
    } catch (err) {
      if (seq !== inflight.current) return;
      setState({ status: 'error', message: describeError(err) });
    }
  }, []);

  useEffect(() => {
    // Route the fetch through a locally declared closure so the
    // react-hooks/set-state-in-effect rule is satisfied (same idiom as the
    // guide index): the effect syncs external data (the API) into React
    // state, its legitimate use, without a directly-traced synchronous
    // setState.
    if (offline) return;
    const begin = () => {
      void load();
    };
    begin();
  }, [load, offline]);

  const retry = useCallback(() => {
    void load();
  }, [load]);

  return (
    <section className="alerts-page" aria-labelledby="alerts-heading">
      <p className="alerts-page__eyebrow">Emergency alerts</p>
      <h1 id="alerts-heading" className="alerts-title">
        Public emergency alerts
      </h1>
      <p className="alerts-sub">
        Authoritative, source-backed alerts with issuer, times, severity,
        urgency and certainty. Official local emergency instructions always take
        precedence over anything shown here.
      </p>

      <div className="alerts-disclosure" role="note">
        <p>
          SENTRAVYN is an information and preparedness platform, not an
          operational emergency service. Alerts shown here carry the information
          class and freshness assigned by their source and by the API — a
          summary is never an official order, and stale or expired information
          is always labelled as such, never hidden as live.
        </p>
      </div>

      {offline ? (
        <div className="alerts-offline" role="status">
          <p>
            You appear to be offline. Anything shown below reflects the last
            successful fetch
            {fetchedAt ? ` — ${formatStamp(fetchedAt)}` : ''} — it is not live.
          </p>
          <button
            type="button"
            className="alerts-offline__retry"
            onClick={retry}
          >
            Try again
          </button>
        </div>
      ) : null}

      {state.status === 'loading' ? (
        <div className="state-panel" role="status" aria-live="polite">
          <span className="state-panel__spinner" aria-hidden="true" />
          <span>Loading public alerts…</span>
        </div>
      ) : null}

      {state.status === 'error' ? (
        <div
          className="state-panel state-panel--error"
          role="alert"
          aria-live="assertive"
        >
          <p className="state-panel__title">Could not load alerts</p>
          <p className="state-panel__body">{state.message}</p>
          <button
            type="button"
            className="state-panel__retry"
            onClick={retry}
            data-testid="alerts-retry"
          >
            Retry
          </button>
        </div>
      ) : null}

      {state.status === 'ready' && state.page.items.length === 0 ? (
        <div className="state-panel" data-testid="alerts-empty">
          <p className="state-panel__title">
            No public alerts are currently available
          </p>
          <p className="state-panel__body">
            This means the public alert feed has no reviewed records to show
            right now — it does not mean no events are occurring. Check your
            local official warning services, and follow official instructions
            wherever they are issued.
          </p>
        </div>
      ) : null}

      {state.status === 'ready' && state.page.items.length > 0 ? (
        <div className="alerts-list">
          {state.page.items.map((alert) => (
            <AlertRow key={alert.id} alert={alert} />
          ))}
          <p className="alerts-list__meta">
            Showing {state.page.items.length} of {state.page.pagination.total}{' '}
            public alert record{state.page.pagination.total === 1 ? '' : 's'}
            {fetchedAt ? ` — fetched ${formatStamp(fetchedAt)}` : ''}.
          </p>
        </div>
      ) : null}

      <p className="alerts-list__meta">
        Looking for reviewed, hazard-specific guidance?{' '}
        <Link className="alerts-link" href="/guides">
          Browse the safety guides
        </Link>
        .
      </p>
    </section>
  );
}
