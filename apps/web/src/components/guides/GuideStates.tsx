'use client';

/**
 * State components for the public guide surface (CLAUDE.md rule 10: every
 * data-driven view shows loading, empty, error, offline and stale states;
 * DESIGN.md 8 visual checklist). Reused by the index and detail pages.
 *
 * The error vs. offline distinction comes from the ApiError.status
 * (0 = network-level unreachable; non-0 = the API answered). The retry
 * control re-runs the fetch; a broken fetch never renders a blank page.
 */

import type { LocaleResource } from '@sentravyn/localization';
import { ApiError } from '@/lib/api';

export function describeGuideError(err: unknown): string {
  if (err instanceof ApiError) {
    // status 0 is a network-level failure (offline / unreachable / CORS).
    if (err.status === 0) return err.message;
    return err.message || `Request failed with status ${err.status}`;
  }
  if (err instanceof Error) return err.message;
  return 'An unexpected error occurred.';
}

export function isOfflineError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0;
}

export function GuideLoadingPanel({ label }: { label: string }) {
  return (
    <div className="state-panel" role="status" aria-live="polite">
      <span className="state-panel__spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function GuideEmptyPanel({
  title,
  body,
}: {
  title: string;
  body?: string;
}) {
  return (
    <div className="state-panel state-panel--empty">
      <p className="state-panel__title">{title}</p>
      {body ? <p className="state-panel__body">{body}</p> : null}
    </div>
  );
}

export function GuideErrorPanel({
  message,
  isOffline,
  onRetry,
  retryLabel,
}: {
  message: string;
  isOffline: boolean;
  onRetry: () => void;
  retryLabel: string;
}) {
  return (
    <div
      className="state-panel state-panel--error"
      role="alert"
      aria-live="assertive"
    >
      <p className="state-panel__title">
        {isOffline ? 'Offline' : 'Request failed'}
      </p>
      <p className="state-panel__body">{message}</p>
      <button type="button" className="state-panel__retry" onClick={onRetry}>
        {retryLabel}
      </button>
    </div>
  );
}

/**
 * The mandatory "summaries only / not official instructions" disclosure
 * (SAFETY-POLICY.md 1, 2, 6, 10; ADR-009: enforced at render time).
 * Shown next to every guide body — it is not an optional decoration.
 */
export function SummaryDisclosure({
  strings,
}: {
  strings: LocaleResource['strings'];
}) {
  return (
    <div className="guide-disclosure" role="note">
      <p className="guide-disclosure__title">{strings.summariesOnly}</p>
      <p className="guide-disclosure__sub">{strings.notOfficial}</p>
    </div>
  );
}

/**
 * The stale-content label (SAFETY-POLICY.md 8: surfaced, never hidden).
 * Rendered when the API's computed freshness flag is "stale" or
 * "unknown" (never-reviewed). Fresh guides show no stale panel.
 */
export function StalePanel({
  strings,
  lastReviewed,
}: {
  strings: LocaleResource['strings'];
  lastReviewed: string | null;
}) {
  return (
    <div className="stale-panel" role="status">
      <p className="stale-panel__title">{strings.staleLabel}</p>
      <p className="stale-panel__sub">
        {strings.lastReviewed}:{' '}
        {lastReviewed ? formatShort(lastReviewed) : 'n/a'}
      </p>
    </div>
  );
}

function formatShort(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 'n/a';
  return new Date(t).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
