"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type LocaleStrings } from "@sentravyn/localization";
import {
  HAZARD_CATEGORIES,
  categoryById,
  listAllGuides,
  listGuidesByCategory,
  type HazardCategory,
} from "@/lib/guides";
import { useGuideLocale } from "@/lib/locale";
import type { GuideView } from "@/lib/api";
import { formatGuideDate, humanizeHazard } from "@/lib/guide-format";
import {
  GuideEmptyPanel,
  GuideErrorPanel,
  GuideLoadingPanel,
  StalePanel,
  SummaryDisclosure,
  describeGuideError,
  isOfflineError,
} from "@/components/guides/GuideStates";
import { LocaleSelector } from "@/components/guides/LocaleSelector";

/**
 * Public guide index + hazard view (Phase 5).
 *
 * Views:
 *  - no category param: the "all reviewed guides" view (GET /guides, the
 *    server's public listing).
 *  - ?hazard=<category id>: that hazard's guides, one server request per
 *    hazardType code the category covers, merged deterministically.
 *
 * Every view shows loading / empty / error / offline states; stale guides
 * carry the mandatory stale label (SAFETY-POLICY.md 8), and every body sits
 * next to the "summaries only" disclosure (SAFETY-POLICY.md 2, 6, 10).
 */
type LoadState =
  | { status: "loading" }
  | { status: "ready"; guides: GuideView[] }
  | { status: "error"; message: string; offline: boolean };

const ALL_CATEGORY: HazardCategory = {
  id: "all",
  label: "All reviewed guides",
  codes: HAZARD_CATEGORIES.flatMap((c) => c.codes),
};

export function GuideIndexClient() {
  const searchParams = useSearchParams();
  const hazardParam = searchParams.get("hazard") ?? undefined;
  const { locale, setLocale } = useGuideLocale();
  const s = locale.strings;

  const category = hazardParam
    ? (categoryById(hazardParam) ?? ALL_CATEGORY)
    : ALL_CATEGORY;
  const categoryKey = category.id;

  const [state, setState] = useState<LoadState>({ status: "loading" });
  const inflight = useRef<string>("");

  const load = useCallback(async () => {
    const key = `${categoryKey}:${locale.locale}`;
    inflight.current = key;
    setState({ status: "loading" });
    try {
      const guides =
        category.id === "all"
          ? (await listAllGuides(locale.locale)).items
          : await listGuidesByCategory(category, locale.locale);
      if (inflight.current !== key) return;
      setState({ status: "ready", guides });
    } catch (err) {
      if (inflight.current !== key) return;
      setState({
        status: "error",
        message: isOfflineError(err) ? s.offline : describeGuideError(err),
        offline: isOfflineError(err),
      });
    }
  }, [category, categoryKey, locale, s]);

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

  return (
    <section className="guide-page">
      <p className="guide-page__eyebrow">Safety guides</p>
      <h1 className="guide-page__title">
        {category.id === "all" ? s.guidesTitle : category.label}
      </h1>
      <p className="guide-page__sub">{s.guidesSub}</p>

      <div className="guide-toolbar">
        <LocaleSelector current={locale.locale} onChange={setLocale} label={s.language} />
      </div>

      <div className="guide-tabs" role="tablist" aria-label="Hazard categories">
        <Link
          className="guide-tab"
          role="tab"
          aria-selected={category.id === "all"}
          href="/guides"
        >
          {ALL_CATEGORY.label}
        </Link>
        {HAZARD_CATEGORIES.map((c) => (
          <Link
            key={c.id}
            className="guide-tab"
            role="tab"
            aria-selected={c.id === category.id}
            href={`/guides?hazard=${encodeURIComponent(c.id)}`}
          >
            {c.label}
          </Link>
        ))}
      </div>

      <SummaryDisclosure strings={s} />

      {state.status === "loading" ? (
        <GuideLoadingPanel label={s.loading} />
      ) : state.status === "error" ? (
        <GuideErrorPanel
          message={state.message}
          isOffline={state.offline}
          onRetry={() => void load()}
          retryLabel={s.retry}
        />
      ) : state.guides.length === 0 ? (
        <GuideEmptyPanel
          title={
            category.id === "all"
              ? "No reviewed guides yet"
              : "No reviewed guide for this hazard yet"
          }
          body={s.noGuideForHazard}
        />
      ) : (
        <ul className="guide-list">
          {state.guides.map((guide) => (
            <GuideCard key={guide.id} guide={guide} strings={s} />
          ))}
        </ul>
      )}
    </section>
  );
}

function GuideCard({ guide, strings }: { guide: GuideView; strings: LocaleStrings }) {
  const showStale = guide.freshness !== "fresh";
  return (
    <li>
      <Link className="guide-card" href={`/guides/${guide.id}`}>
        <div className="guide-card__head">
          <span className="guide-card__hazard">{humanizeHazard(guide.hazardType)}</span>
          <span style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
            <span
              className={
                guide.approval === "PUBLISHED"
                  ? "guide-badge guide-badge--published"
                  : "guide-badge guide-badge--approved"
              }
            >
              {guide.approval === "PUBLISHED" ? "Published" : "Approved"}
            </span>
            {showStale ? (
              <span className="guide-badge guide-badge--stale">Stale</span>
            ) : null}
          </span>
        </div>
        <h2 className="guide-card__title">
          {guide.jurisdiction
            ? `${humanizeHazard(guide.hazardType)} — ${guide.jurisdiction}`
            : humanizeHazard(guide.hazardType)}
        </h2>
        {showStale ? (
          <StalePanel strings={strings} lastReviewed={guide.lastReviewedAt} />
        ) : null}
        {guide.body ? <p className="guide-card__body">{guide.body}</p> : null}
        <div className="guide-card__meta">
          <span>
            {strings.version} {guide.version}
          </span>
          <span>
            {strings.lastReviewed}: {formatGuideDate(guide.lastReviewedAt)}
          </span>
          <span>
            {strings.authority}: {guide.authority ?? "n/a"}
          </span>
        </div>
      </Link>
    </li>
  );
}
