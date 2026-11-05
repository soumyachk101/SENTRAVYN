'use client';

import { useCallback, useEffect, useState } from 'react';
import { auditApi } from '@/lib/api';
import { useRequireRole } from '@/lib/session';
import { type AuditEvent } from '@/lib/types';
import {
  Badge,
  describeError,
  EmptyPanel,
  ErrorPanel,
  Eyebrow,
  formatDateTime,
  InsufficientRolePanel,
  LoadingPanel,
  SigninRequiredPanel,
} from '@/lib/ui';

/**
 * Audit trail (SECURITY.md 6). ADMIN-only; the API enforces it too and the
 * 403 body is surfaced verbatim if a junior role reaches this view by URL.
 *
 * Newest first (the API orders by createdAt desc). The limit control is
 * constrained to the API's 1-200 range; the entity filter matches the
 * entity strings the audit layer records today (free-text also accepted).
 */

const LIMIT_OPTIONS = [25, 50, 100, 200] as const;

const KNOWN_ENTITIES = ['alert', 'place', 'shelter', 'dataProvider'] as const;

export default function AuditPage() {
  const { signedIn, loading, allowed, role } = useRequireRole('ADMIN');

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; error: string }
    | { status: 'ready' }
  >({ status: 'loading' });

  const [limit, setLimit] = useState<number>(100);
  const [entityFilter, setEntityFilter] = useState<string>('');
  const [entityDraft, setEntityDraft] = useState<string>('');

  const fetchEvents = useCallback(async () => {
    const filter = entityFilter.trim() === '' ? undefined : entityFilter.trim();
    auditApi
      .list({ limit, entity: filter })
      .then((data) => {
        setEvents(data);
        setState({ status: 'ready' });
      })
      .catch((err: unknown) => {
        setEvents([]);
        setState({ status: 'error', error: describeError(err) });
      });
  }, [limit, entityFilter]);

  const load = useCallback(() => {
    if (!allowed) return;
    setState({ status: 'loading' });
    void fetchEvents();
  }, [allowed, fetchEvents]);

  useEffect(() => {
    if (allowed) void fetchEvents();
  }, [allowed, fetchEvents]);

  function applyEntity() {
    if (entityDraft === entityFilter) return;
    setEntityFilter(entityDraft);
    setState({ status: 'loading' });
  }

  return (
    <section>
      <Eyebrow>Audit</Eyebrow>
      <h1>Audit trail</h1>
      <p className="sub">
        Immutable record of privileged changes to alerts, providers, shelters,
        verification state and user access. Newest first.
      </p>

      {loading ? (
        <LoadingPanel label="Checking session" />
      ) : !signedIn ? (
        <SigninRequiredPanel />
      ) : !allowed ? (
        <InsufficientRolePanel required="ADMIN" role={role} />
      ) : (
        <>
          <div className="toolbar">
            <label className="field field--inline">
              <span className="field__label" id="audit-limit-label">
                Limit
              </span>
              <select
                className="input input--sm"
                aria-labelledby="audit-limit-label"
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setState({ status: 'loading' });
                }}
              >
                {LIMIT_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            <label className="field field--inline">
              <span className="field__label" id="audit-entity-label">
                Entity filter
              </span>
              <input
                className="input input--sm"
                list="audit-entity-options"
                aria-labelledby="audit-entity-label"
                value={entityDraft}
                onChange={(e) => setEntityDraft(e.target.value)}
                placeholder="All entities"
              />
              <datalist id="audit-entity-options">
                {KNOWN_ENTITIES.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </datalist>
            </label>

            <button type="button" className="btn btn--sm" onClick={applyEntity}>
              Apply filter
            </button>
          </div>

          {state.status === 'loading' ? (
            <LoadingPanel label="Loading audit events" />
          ) : state.status === 'error' ? (
            <ErrorPanel message={state.error} onRetry={load} />
          ) : events.length === 0 ? (
            <EmptyPanel
              title="No audit events"
              body={
                entityFilter
                  ? `No events recorded for entity "${entityFilter}" yet.`
                  : 'No privileged changes have been recorded yet.'
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Time</th>
                    <th scope="col">Action</th>
                    <th scope="col">Entity</th>
                    <th scope="col">Actor</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.id}>
                      <td className="cell-time">
                        {formatDateTime(ev.createdAt)}
                      </td>
                      <td>
                        <Badge tone="neutral">{ev.action}</Badge>
                      </td>
                      <td>
                        <code className="mono">{ev.entity}</code>
                        {ev.entityId ? (
                          <div className="cell-sub">
                            <code className="mono">{ev.entityId}</code>
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {ev.actorUserId ? (
                          <code className="mono">{ev.actorUserId}</code>
                        ) : (
                          <span className="cell-muted">system</span>
                        )}
                      </td>
                      <td>
                        {ev.detail ? (
                          <code className="mono mono--wrap" title={ev.detail}>
                            {ev.detail}
                          </code>
                        ) : (
                          <span className="cell-muted">n/a</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
