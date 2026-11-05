'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { providersApi } from '@/lib/api';
import { roleAtLeast, useSession } from '@/lib/session';
import { type ProviderView } from '@/lib/types';
import {
  Badge,
  describeError,
  EmptyPanel,
  ErrorPanel,
  Eyebrow,
  Field,
  formatDateTime,
  LoadingPanel,
  SigninRequiredPanel,
} from '@/lib/ui';

/**
 * Data-provider registry (docs/DATA-SOURCES.md 2, SECURITY.md 6).
 *
 * Any authenticated role may list providers (GET /providers is open to
 * PUBLIC+). Mutations (seed, upsert, enable/disable) are ADMIN-only: the
 * controls are hidden for junior roles and the API enforces it with a 403
 * regardless. 403/400 messages are shown verbatim — never masked as a
 * success.
 */
export default function ProvidersPage() {
  const { user, loading } = useSession();
  const isAdmin = roleAtLeast(user?.role, 'ADMIN');

  const [rows, setRows] = useState<ProviderView[]>([]);
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; error: string }
    | { status: 'ready' }
  >({ status: 'loading' });
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );

  const fetchProviders = useCallback(async () => {
    providersApi
      .list()
      .then((data) => {
        setRows(data);
        setState({ status: 'ready' });
      })
      .catch((err: unknown) => {
        setRows([]);
        setState({ status: 'error', error: describeError(err) });
      });
  }, []);

  const load = useCallback(() => {
    if (!user) return;
    setState({ status: 'loading' });
    void fetchProviders();
  }, [user, fetchProviders]);

  useEffect(() => {
    // state starts as "loading", so the first mount already renders the
    // loading panel; no synchronous reset is needed before the fetch.
    if (!user) return;
    void fetchProviders();
  }, [user, fetchProviders]);

  /* -- admin actions ------------------------------------------------ */

  async function onSeed() {
    const confirmed = window.confirm(
      'Seed the default fixture providers (gdacs, usgs, copernicus-emdat)? ' +
        'Seeded providers are disabled by default; re-seeding refreshes ' +
        'metadata and never flips an enabled provider off.',
    );
    if (!confirmed) return;
    setMessage(null);
    try {
      const res = await providersApi.seed();
      setMessage({
        ok: true,
        text: `Seeded: ${res.seededKeys.join(', ')} at ${formatDateTime(res.lastSeededAt)}.`,
      });
      load();
    } catch (err: unknown) {
      setMessage({ ok: false, text: describeError(err) });
    }
  }

  async function onSetEnabled(row: ProviderView, enabled: boolean) {
    setMessage(null);
    try {
      const updated = await providersApi.setEnabled(row.key, enabled);
      setRows((prev) => prev.map((r) => (r.key === updated.key ? updated : r)));
      setMessage({
        ok: true,
        text: `${updated.key} is now ${updated.enabled ? 'enabled' : 'disabled'}.`,
      });
    } catch (err: unknown) {
      setMessage({ ok: false, text: describeError(err) });
    }
  }

  return (
    <section>
      <Eyebrow>Providers</Eyebrow>
      <h1>Data providers</h1>
      <p className="sub">
        Registry of external data sources. Listing a provider here is not a
        claim that its data is open, reliable or currently available; production
        enablement is a controlled, audited step.
      </p>

      {loading ? (
        <LoadingPanel label="Checking session" />
      ) : !user ? (
        <SigninRequiredPanel />
      ) : (
        <>
          {isAdmin ? (
            <div className="toolbar">
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => void onSeed()}
              >
                Seed default providers
              </button>
            </div>
          ) : null}

          {message ? (
            <p
              className={message.ok ? 'form-success-text' : 'form-error'}
              role={message.ok ? 'status' : 'alert'}
            >
              {message.text}
            </p>
          ) : null}

          {state.status === 'loading' ? (
            <LoadingPanel label="Loading provider registry" />
          ) : state.status === 'error' ? (
            <ErrorPanel message={state.error} onRetry={load} />
          ) : rows.length === 0 ? (
            <EmptyPanel
              title="No providers registered"
              body={
                isAdmin
                  ? 'Seed the default fixture providers or add a provider below.'
                  : 'Ask an administrator to register providers.'
              }
            />
          ) : (
            <>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Key</th>
                      <th scope="col">Name / category</th>
                      <th scope="col">Docs</th>
                      <th scope="col">License / attribution</th>
                      <th scope="col">Freshness</th>
                      <th scope="col">Last seeded</th>
                      <th scope="col">State</th>
                      {isAdmin ? <th scope="col">Actions</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.key}>
                        <td>
                          <code className="mono">{row.key}</code>
                        </td>
                        <td>
                          <div>{row.name}</div>
                          <div className="cell-sub">{row.category}</div>
                        </td>
                        <td>
                          {row.docUrl ? (
                            <a
                              href={row.docUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Documentation
                            </a>
                          ) : (
                            <span className="cell-muted">n/a</span>
                          )}
                        </td>
                        <td>
                          <div>{row.license ?? 'license not asserted'}</div>
                          {row.attribution ? (
                            <div className="cell-sub">{row.attribution}</div>
                          ) : null}
                        </td>
                        <td>
                          {row.freshnessPolicyHours != null
                            ? `${row.freshnessPolicyHours} h`
                            : 'unset'}
                        </td>
                        <td>{formatDateTime(row.lastSeededAt)}</td>
                        <td>
                          <Badge tone={row.enabled ? 'ok' : 'muted'}>
                            {row.enabled ? 'Enabled' : 'Disabled'}
                          </Badge>
                        </td>
                        {isAdmin ? (
                          <td className="cell-actions">
                            <button
                              type="button"
                              className="btn btn--sm"
                              disabled={row.enabled}
                              onClick={() => void onSetEnabled(row, true)}
                            >
                              Enable
                            </button>
                            <button
                              type="button"
                              className="btn btn--sm"
                              disabled={!row.enabled}
                              onClick={() => void onSetEnabled(row, false)}
                            >
                              Disable
                            </button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {isAdmin ? <UpsertForm onSaved={() => load()} /> : null}
            </>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function UpsertForm({ onSaved }: { onSaved: () => void }) {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [category, setCategory] = useState('');
  const [license, setLicense] = useState('');
  const [attribution, setAttribution] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [hours, setHours] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!KEY_RE.test(key) || key.length < 2 || key.length > 63) {
      setError(
        'Key must be kebab-case (lowercase letters, digits, hyphens), 2-63 characters.',
      );
      return;
    }
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    try {
      new URL(docUrl);
    } catch {
      setError('docUrl must be a valid URL.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await providersApi.upsert({
        key: key.trim(),
        name: name.trim(),
        docUrl: docUrl.trim(),
        category: category.trim() || undefined,
        license: license.trim() || undefined,
        attribution: attribution.trim() || undefined,
        enabled,
        freshnessPolicyHours: hours ? Number(hours) : undefined,
      });
      setKey('');
      setName('');
      setDocUrl('');
      setCategory('');
      setLicense('');
      setAttribution('');
      setEnabled(false);
      setHours('');
      onSaved();
    } catch (err: unknown) {
      // API 400/403/409 messages shown verbatim.
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="panel">
      <h2>Register or update a provider</h2>
      <div className="decide__grid">
        <Field label="Key" htmlFor="p-key" error={undefined}>
          <input
            id="p-key"
            className="input"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
            placeholder="e.g. em-dac"
          />
        </Field>
        <Field label="Name" htmlFor="p-name" error={undefined}>
          <input
            id="p-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </Field>
        <Field label="Documentation URL" htmlFor="p-doc" error={undefined}>
          <input
            id="p-doc"
            className="input"
            type="url"
            value={docUrl}
            onChange={(e) => setDocUrl(e.target.value)}
            required
            placeholder="https://"
          />
        </Field>
        <Field label="Category" htmlFor="p-cat" error={undefined}>
          <input
            id="p-cat"
            className="input"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="e.g. alerts, events"
          />
        </Field>
        <Field label="License" htmlFor="p-lic" error={undefined}>
          <input
            id="p-lic"
            className="input"
            value={license}
            onChange={(e) => setLicense(e.target.value)}
          />
        </Field>
        <Field label="Attribution" htmlFor="p-attr" error={undefined}>
          <input
            id="p-attr"
            className="input"
            value={attribution}
            onChange={(e) => setAttribution(e.target.value)}
          />
        </Field>
        <Field
          label="Freshness policy (hours)"
          htmlFor="p-hours"
          error={undefined}
        >
          <input
            id="p-hours"
            className="input"
            type="number"
            min={1}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
        </Field>
        <label className="check">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          Enabled on save
        </label>
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="form-actions">
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? (
            <>
              <span className="spinner" aria-hidden="true" /> Saving…
            </>
          ) : (
            'Save provider'
          )}
        </button>
      </div>
      <p className="field__hint">
        The same key upserts the provider. Provider credentials are never stored
        in the registry (SECURITY.md).
      </p>
    </form>
  );
}
