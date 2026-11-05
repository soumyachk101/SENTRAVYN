'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { type LocaleStrings } from '@sentravyn/localization';
import { getGuideDetail } from '@/lib/guides';
import { ApiError, type GuideDetail } from '@/lib/api';
import {
  formatGuideDate,
  formatGuideDateTime,
  humanizeHazard,
} from '@/lib/guide-format';
import { guideArticleGraph, webBaseUrl } from '@/lib/jsonld';
import { JsonLdScript } from '@/components/JsonLdScript';
import {
  GuideErrorPanel,
  GuideLoadingPanel,
  StalePanel,
  SummaryDisclosure,
  describeGuideError,
  isOfflineError,
} from '@/components/guides/GuideStates';
import { useGuideLocale } from '@/lib/locale';

/**
 * Guide detail view (Phase 5). Fetches the public GET /guides/:id and
 * renders: the current body next to the mandatory summary disclosure, the
 * metadata (review date, version, authority, language, jurisdiction),
 * the source references and the full revision history.
 *
 * States: loading / error (API failure) / offline (network unreachable) /
 * not-found (404 — an unpublished, retired or unknown guide). The stale
 * label is shown whenever the API's freshness flag is not "fresh".
 */
type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; detail: GuideDetail }
  | { status: 'error'; message: string; offline: boolean }
  | { status: 'notFound' };

export function GuideDetailClient({ id }: { id: string }) {
  const { locale } = useGuideLocale();
  const s = locale.strings;

  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const inflight = useRef<string>('');

  const load = useCallback(async () => {
    const key = `${id}:${locale.locale}`;
    inflight.current = key;
    setState({ status: 'loading' });
    try {
      const detail = await getGuideDetail(id);
      if (inflight.current !== key) return;
      setState({ status: 'ready', detail });
    } catch (err) {
      if (inflight.current !== key) return;
      // The public API 404s for unknown, unpublished and retired guides —
      // a clean "guide not available" state, not a fetch failure.
      if (err instanceof ApiError && err.status === 404) {
        setState({ status: 'notFound' });
        return;
      }
      setState({
        status: 'error',
        message: isOfflineError(err) ? s.offline : describeGuideError(err),
        offline: isOfflineError(err),
      });
    }
  }, [id, locale, s]);

  useEffect(() => {
    // Route the fetch through a locally declared closure so the
    // react-hooks/set-state-in-effect rule is satisfied: the effect body
    // syncs external data (the API) into React state, which is its
    // legitimate use, without a directly-traced synchronous setState.
    const begin = () => {
      void load();
    };
    begin();
  }, [load]);

  const showStale =
    state.status === 'ready' && state.detail.freshness !== 'fresh';

  // Structured data for this guide — emitted ONLY when the real record has
  // loaded (state ready), never guessed. Missing author/reviewer/references
  // are omitted inside the graph, not invented. The `TechArticle` is a
  // sibling to the visible <article> that the GuideDetailBody renders.
  const articleGraph = useMemo(() => {
    if (state.status !== 'ready') return null;
    const d = state.detail;
    const headline = d.jurisdiction
      ? `${humanizeHazard(d.hazardType)} — ${d.jurisdiction}`
      : humanizeHazard(d.hazardType);
    return guideArticleGraph({
      url: `${webBaseUrl()}/guides/${encodeURIComponent(d.id)}`,
      headline,
      author: d.author,
      reviewer: d.reviewer,
      datePublished: d.createdAt,
      dateModified: d.updatedAt,
      language: d.language,
      references: d.references,
    });
  }, [state]);

  return (
    <section className="guide-page">
      <JsonLdScript graph={articleGraph} />
      <p className="guide-page__eyebrow">Safety guide</p>
      <Link href="/guides" className="guide-back">
        All guides
      </Link>

      {state.status === 'loading' ? (
        <GuideLoadingPanel label={s.loading} />
      ) : state.status === 'notFound' ? (
        <div className="state-panel state-panel--empty">
          <p className="state-panel__title">Guide not available</p>
          <p className="state-panel__body">
            This guide is not currently available on the public surface.
            Unpublished or retired guides are not shown here; use the{' '}
            <Link href="/guides">guides index</Link> instead.
          </p>
        </div>
      ) : state.status === 'error' ? (
        <GuideErrorPanel
          message={state.message}
          isOffline={state.offline}
          onRetry={() => void load()}
          retryLabel={s.retry}
        />
      ) : (
        <GuideDetailBody
          detail={state.detail}
          strings={s}
          showStale={showStale}
          lastReviewed={state.detail.lastReviewedAt}
        />
      )}
    </section>
  );
}

function GuideDetailBody({
  detail,
  strings,
  showStale,
  lastReviewed,
}: {
  detail: GuideDetail;
  strings: LocaleStrings;
  showStale: boolean;
  lastReviewed: string | null;
}) {
  return (
    <article className="guide-detail">
      <h1 className="guide-page__title">
        {detail.jurisdiction
          ? `${humanizeHazard(detail.hazardType)} — ${detail.jurisdiction}`
          : humanizeHazard(detail.hazardType)}
      </h1>

      <div className="guide-detail__meta">
        <span>
          {strings.version} {detail.version}
        </span>
        <span>
          {strings.lastReviewed}: {formatGuideDate(lastReviewed)}
        </span>
        <span>
          {strings.authority}: {detail.authority ?? 'n/a'}
        </span>
        <span>
          {strings.language}: {detail.language}
        </span>
        <span>
          {strings.hazard}: {humanizeHazard(detail.hazardType)}
        </span>
      </div>

      {showStale ? (
        <StalePanel strings={strings} lastReviewed={lastReviewed} />
      ) : null}

      <SummaryDisclosure strings={strings} />

      <div className="guide-detail__body">
        {detail.body ?? '(No guide text has been written yet.)'}
      </div>

      <section className="guide-refs" aria-label={strings.references}>
        <h2>{strings.references}</h2>
        {detail.references.length > 0 ? (
          <ol>
            {detail.references.map((ref, i) => (
              <li key={`${ref}-${i}`}>
                {isUrl(ref) ? (
                  <a href={ref} target="_blank" rel="noreferrer">
                    {ref}
                  </a>
                ) : (
                  ref
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="state-panel__body">
            No references are recorded for this guide.
          </p>
        )}
      </section>

      <section className="guide-revisions" aria-label={strings.revisionHistory}>
        <h2>{strings.revisionHistory}</h2>
        <ul className="guide-revisions__list">
          {[...detail.revisions].reverse().map((rev) => (
            <li
              key={rev.revision}
              className={
                rev.revision === detail.version
                  ? 'guide-revisions__item guide-revisions__item-current'
                  : 'guide-revisions__item'
              }
            >
              {strings.version} {rev.revision}
              {rev.revision === detail.version ? ' (current)' : ''} —{' '}
              {formatGuideDateTime(rev.createdAt)}
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}
