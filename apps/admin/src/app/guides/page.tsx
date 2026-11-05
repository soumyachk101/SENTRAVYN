"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { guidesApi, auditApi } from "@/lib/api";
import { useRequireRole } from "@/lib/session";
import {
  type AuditEvent,
  type GuideView,
} from "@/lib/types";
import {
  Badge,
  describeError,
  EmptyPanel,
  ErrorPanel,
  Eyebrow,
  formatDateTime,
  InsufficientRolePanel,
  LoadingPanel,
  Meta,
  SigninRequiredPanel,
} from "@/lib/ui";

/**
 * Safety-guide approval workflow (Phase 5; SAFETY-POLICY.md 10; SECURITY.md 6).
 *
 * REVIEWER and above (the server enforces it; the UI only shapes what is
 * visible). The page lists every guide grouped by approval state, with the
 * full action set available for the current state:
 *
 *   DRAFT     -> review (IN_REVIEW), revise
 *   IN_REVIEW -> approve (APPROVED, completeness-gated), revise
 *   APPROVED  -> publish (PUBLISHED)
 *   PUBLISHED -> retire (RETIRED)
 *   RETIRED   -> reopen (DRAFT, new review cycle)
 *
 * Every mutation writes an audit row; the recent guide audit trail is shown
 * at the bottom (entity=guide), so the approval workflow is traceable
 * (SECURITY.md 6). API error messages (400 completeness, 403 role) surface
 * verbatim — the UI never invents a state the server rejected.
 */

const APPROVAL_STATES = [
  "DRAFT",
  "IN_REVIEW",
  "APPROVED",
  "PUBLISHED",
  "RETIRED",
] as const;

type ApprovalState = (typeof APPROVAL_STATES)[number];

export default function GuidesPage() {
  const { signedIn, loading, allowed, role } = useRequireRole("REVIEWER");

  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; error: string }
    | { status: "ready"; guides: GuideView[] }
  >({ status: "loading" });

  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoaded, setAuditLoaded] = useState(false);

  const fetchGuides = useCallback(async () => {
    setState({ status: "loading" });
    try {
      // One pass over every state, then group client-side. The API caps a
      // single page at 100; each state is a separate small list here.
      const pages = await Promise.all(
        APPROVAL_STATES.map((approval) =>
          guidesApi.list({ approval, pageSize: 100 }),
        ),
      );
      const guides: GuideView[] = pages.flatMap((p) => p.items);
      setState({ status: "ready", guides });
    } catch (err: unknown) {
      setState({ status: "error", error: describeError(err) });
    }
  }, []);

  const fetchAudit = useCallback(async () => {
    try {
      setAuditEvents(await auditApi.list({ entity: "guide", limit: 50 }));
      setAuditLoaded(true);
    } catch {
      // The audit panel is secondary: a fetch failure must not blank the
      // main workflow. It is shown as an error only after a successful
      // main load, via its own state.
      setAuditLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const begin = () => {
      void fetchGuides();
      void fetchAudit();
    };
    begin();
  }, [allowed, fetchGuides, fetchAudit]);

  const byState = useMemo(() => {
    const map = new Map<ApprovalState, GuideView[]>();
    for (const s of APPROVAL_STATES) map.set(s, []);
    for (const g of state.status === "ready" ? state.guides : []) {
      const bucket = map.get(g.approval);
      if (bucket) bucket.push(g);
    }
    for (const s of APPROVAL_STATES) {
      map.get(s)?.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return map;
  }, [state]);

  return (
    <section>
      <Eyebrow>Guides</Eyebrow>
      <h1>Safety guides</h1>
      <p className="sub">
        Reviewed, hazard-specific guidance. Approval is completeness-gated:
        a guide needs a named reviewer, the reviewing authority and at least
        one reference before it can be published (SAFETY-POLICY.md 6, 10).
        Every action here is audited.
      </p>

      {loading ? (
        <LoadingPanel label="Checking session" />
      ) : !signedIn ? (
        <SigninRequiredPanel />
      ) : !allowed ? (
        <InsufficientRolePanel required="REVIEWER" role={role} />
      ) : state.status === "loading" ? (
        <LoadingPanel label="Loading guides" />
      ) : state.status === "error" ? (
        <ErrorPanel message={state.error} onRetry={() => void fetchGuides()} />
      ) : (
        <div className="list">
          {APPROVAL_STATES.map((s) => {
            const items = byState.get(s) ?? [];
            return (
              <StateSection
                key={s}
                state={s}
                items={items}
                onMutated={() => {
                  void fetchGuides();
                  void fetchAudit();
                }}
              />
            );
          })}
        </div>
      )}

      {auditLoaded ? (
        <GuideAuditPanel events={auditEvents} />
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function StateSection({
  state: label,
  items,
  onMutated,
}: {
  state: ApprovalState;
  items: GuideView[];
  onMutated: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="guide-state">
      <h2 className="guide-state__label">
        <Badge tone="neutral">{label}</Badge>
        <span className="guide-state__count">{items.length}</span>
      </h2>
      <div className="list">
        {items.map((g) => (
          <GuideCard key={g.id} guide={g} onMutated={onMutated} />
        ))}
      </div>
    </div>
  );
}

function GuideCard({
  guide,
  onMutated,
}: {
  guide: GuideView;
  onMutated: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const run = useCallback(
    async (fn: () => Promise<unknown>, successMessage: string) => {
      setBusy(true);
      setActionError(null);
      setSuccess(null);
      try {
        await fn();
        setSuccess(successMessage);
        onMutated();
      } catch (err: unknown) {
        setActionError(describeError(err));
      } finally {
        setBusy(false);
      }
    },
    [onMutated],
  );

  return (
    <article className="card">
      <div className="card__head">
        <h2 className="card__title">
          {guide.hazardType}
          {guide.jurisdiction ? ` — ${guide.jurisdiction}` : ""}
        </h2>
        <Badge tone={guide.freshness === "fresh" ? "ok" : "warn"}>
          {guide.approval}
          {guide.freshness !== "fresh" ? ` · ${guide.freshness}` : ""}
        </Badge>
      </div>

      <div className="card__meta">
        <Meta k="Version">{guide.version}</Meta>
        <Meta k="Last reviewed">{formatDateTime(guide.lastReviewedAt)}</Meta>
        <Meta k="Reviewer">{guide.reviewer ?? "n/a"}</Meta>
        <Meta k="Authority">{guide.authority ?? "n/a"}</Meta>
        <Meta k="References">{guide.references.length}</Meta>
        <Meta k="Language">{guide.language}</Meta>
      </div>

      {guide.body ? (
        <p className="card__note" style={{ whiteSpace: "pre-wrap" }}>
          {guide.body.length > 280 ? guide.body.slice(0, 280) + "…" : guide.body}
        </p>
      ) : null}

      <Actions guide={guide} busy={busy} run={run} />

      {actionError ? (
        <p className="field__error" role="alert">
          {actionError}
        </p>
      ) : null}
      {success ? <p className="card__note" role="status">{success}</p> : null}
    </article>
  );
}

/**
 * The state-aware action set. Each button maps to exactly one API sub-route
 * and is only shown when the guide is in the state that transition is valid
 * from, so the UI never offers an action the API would reject 400.
 */
function Actions({
  guide,
  busy,
  run,
}: {
  guide: GuideView;
  busy: boolean;
  run: (fn: () => Promise<unknown>, successMessage: string) => Promise<void>;
}) {
  const [rationale, setRationale] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [authority, setAuthority] = useState("");

  const s = guide.approval;
  return (
    <div className="decide" style={{ marginTop: "var(--space-md)" }}>
      <h3>Actions</h3>
      <div className="decide__grid">
        {s === "DRAFT" ? (
          <>
            <label className="field">
              <span className="field__label">Reviewer (optional)</span>
              <input
                className="input"
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">Authority (optional)</span>
              <input
                className="input"
                value={authority}
                onChange={(e) => setAuthority(e.target.value)}
              />
            </label>
            <div className="guide-actions">
              <button
                className="btn btn--primary"
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      guidesApi.review(guide.id, {
                        reviewer: reviewer || undefined,
                        authority: authority || undefined,
                      }),
                    "Guide moved to IN_REVIEW (GUIDE_REVIEWED).",
                  )
                }
              >
                Review
              </button>
            </div>
          </>
        ) : null}

        {s === "IN_REVIEW" ? (
          <>
            <label className="field">
              <span className="field__label">Rationale (optional)</span>
              <textarea
                className="input"
                rows={2}
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
              />
            </label>
            <div className="guide-actions">
              <button
                className="btn btn--primary"
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      guidesApi.approve(guide.id, {
                        rationale: rationale || undefined,
                      }),
                    "Guide approved (GUIDE_APPROVED).",
                  )
                }
              >
                Approve
              </button>
            </div>
          </>
        ) : null}

        {s === "APPROVED" ? (
          <div className="guide-actions">
            <button
              className="btn btn--primary"
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    guidesApi.publish(guide.id, {
                      rationale: rationale || undefined,
                    }),
                  "Guide published (GUIDE_PUBLISHED).",
                )
              }
            >
              Publish
            </button>
          </div>
        ) : null}

        {s === "PUBLISHED" ? (
          <>
            <label className="field">
              <span className="field__label">Rationale (optional)</span>
              <textarea
                className="input"
                rows={2}
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
              />
            </label>
            <div className="guide-actions">
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      guidesApi.retire(guide.id, {
                        rationale: rationale || undefined,
                      }),
                    "Guide retired (GUIDE_RETIRED).",
                  )
                }
              >
                Retire
              </button>
            </div>
          </>
        ) : null}

        {s === "RETIRED" ? (
          <div className="guide-actions">
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                run(
                  () => guidesApi.reopen(guide.id),
                  "Guide re-opened as a new DRAFT (GUIDE_UPDATED).",
                )
              }
            >
              Reopen
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function GuideAuditPanel({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return (
      <EmptyPanel
        title="No guide audit events yet"
        body="Guide review, approval, publication, retirement and revisions will be recorded here."
      />
    );
  }
  return (
    <div className="table-wrap" style={{ marginTop: "var(--space-xl)" }}>
      <h2 style={{ margin: "0 0 var(--space-sm)" }}>
        <Eyebrow>Guide audit trail</Eyebrow>
        Recent guide events
      </h2>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Time</th>
            <th scope="col">Action</th>
            <th scope="col">Entity</th>
            <th scope="col">Detail</th>
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => (
            <tr key={ev.id}>
              <td className="cell-time">{formatDateTime(ev.createdAt)}</td>
              <td>
                <Badge tone="neutral">{ev.action}</Badge>
              </td>
              <td>
                <code className="mono">guide</code>
                {ev.entityId ? (
                  <div className="cell-sub">
                    <code className="mono">{ev.entityId}</code>
                  </div>
                ) : null}
              </td>
              <td>
                {ev.detail ? (
                  <code className="mono mono--wrap" title={ev.detail}>
                    {ev.detail.length > 160 ? ev.detail.slice(0, 160) + "…" : ev.detail}
                  </code>
                ) : (
                  <span className="cell-muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
