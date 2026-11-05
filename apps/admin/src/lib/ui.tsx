'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ApiError, type Role } from './types';

/**
 * Shared state components for the admin console.
 *
 * Every data-driven view must show loading, empty, error and
 * unreachable/offline states (CLAUDE.md rule 10, DESIGN.md 8). A broken
 * fetch renders an error panel with a retry control — never a blank page.
 */

/** Human-readable, API-verbatim where the contract says so. */
export function describeError(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred.';
}

export function LoadingPanel({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="state-panel" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}…</span>
    </div>
  );
}

export function EmptyPanel({ title, body }: { title: string; body?: string }) {
  return (
    <div className="state-panel state-panel--empty">
      <p className="state-panel__title">{title}</p>
      {body ? <p className="state-panel__body">{body}</p> : null}
    </div>
  );
}

export function ErrorPanel({
  message,
  onRetry,
  retryLabel = 'Retry',
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const unreachable = /unreachable|connection|network/i.test(message);
  return (
    <div
      className="state-panel state-panel--error"
      role="alert"
      aria-live="assertive"
    >
      <p className="state-panel__title">
        {unreachable ? 'API unreachable' : 'Request failed'}
      </p>
      <p className="state-panel__body">{message}</p>
      {onRetry ? (
        <button type="button" className="btn" onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

/**
 * 403 "insufficient role" panel — shown when a signed-in user lacks the
 * role a route requires, so the UI states the real restriction instead of
 * surfacing a fake success state or a raw error.
 */
export function InsufficientRolePanel({
  required,
  role,
}: {
  required: Role;
  role?: Role;
}) {
  return (
    <div className="state-panel state-panel--denied">
      <p className="state-panel__title">Insufficient role</p>
      <p className="state-panel__body">
        This view requires the {required} role.
        {role ? ` Your current role is ${role}.` : ''} The API enforces this
        restriction; sign in with an authorised account to continue.
      </p>
    </div>
  );
}

/**
 * Sign-in required panel — shown when the visitor has no session at all,
 * and points them at the login surface. Distinct from the role-denied
 * panel above, which applies to signed-in users with a junior role.
 */
export function SigninRequiredPanel() {
  return (
    <div className="state-panel state-panel--denied">
      <p className="state-panel__title">Sign in required</p>
      <p className="state-panel__body">
        This view requires an authorised session.
      </p>
      <Link className="btn btn--primary" href="/login">
        Sign in
      </Link>
    </div>
  );
}

/** Small monospace label used above headings and data blocks. */
export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="eyebrow">{children}</p>;
}

export function Badge({
  tone = 'neutral',
  children,
}: {
  tone?: 'neutral' | 'ok' | 'warn' | 'muted';
  children: ReactNode;
}) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

/** Key/value metadata row for provenance and provider notes. */
export function Meta({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="meta">
      <span className="meta__k">{k}</span>
      <span className="meta__v">{children}</span>
    </div>
  );
}

/**
 * Truncates a hex payload hash to 12 chars, exposing the full hash in the
 * accessible name and title attribute.
 */
export function TruncatedHash({ hash }: { hash: string }) {
  const short = hash.slice(0, 12);
  return (
    <code className="mono" title={hash} aria-label={`Payload hash ${hash}`}>
      {short}…
    </code>
  );
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return 'n/a';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'n/a';
  return d.toLocaleString();
}

/**
 * Field wrapper with label + inline validation message. The message is
 * rendered even when empty so the layout is stable (a11y: no shift on
 * error).
 */
export function Field({
  label,
  htmlFor,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="field__req" aria-hidden="true">
            {' '}
            (required)
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p className="field__error" id={`${htmlFor}-error`} role="alert">
          {error}
        </p>
      ) : (
        <p className="field__error field__error--idle" aria-hidden="true">
          &nbsp;
        </p>
      )}
    </div>
  );
}
