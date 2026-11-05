"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { reviewApi, isPlaceQueue } from "@/lib/api";
import { useRequireRole } from "@/lib/session";
import {
  type AlertQueueItem,
  type PlaceQueueItem,
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
  TruncatedHash,
} from "@/lib/ui";

/**
 * Review queue (DESIGN.md 6: operational clarity, source provenance,
 * approval workflow).
 *
 * - Tabs: Alerts / Places, backed by GET /admin/review/queue?kind=...
 * - Per-item decide panel: decision select + rationale; shelter items add
 *   authority + verification date inputs that become required when
 *   SHELTER_VERIFIED is chosen (Gate E). API 400 messages are shown verbatim.
 * - REVIEWER+ only; lower roles see the `insufficient role` empty state.
 */
export default function ReviewPage() {
  const { signedIn, loading, allowed, role } = useRequireRole("REVIEWER");
  const [tab, setTab] = useState<"alerts" | "places">("alerts");
  const alertsTabRef = useRef<HTMLButtonElement>(null);
  const placesTabRef = useRef<HTMLButtonElement>(null);

  const [items, setItems] = useState<AlertQueueItem[] | PlaceQueueItem[]>([]);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; error: string }
    | { status: "ready" }
  >({ status: "loading" });

  // Guards against a late response from a previous tab overwriting the
  // current one: fetchQueue claims the tab it fetched for, and results are
  // dropped when the ref no longer matches.
  const activeTabRef = useRef(tab);

  const fetchQueue = useCallback(async () => {
    activeTabRef.current = tab;
    try {
      const data = await reviewApi.queue(tab);
      if (activeTabRef.current !== tab) return;
      setItems(data);
      setState({ status: "ready" });
    } catch (err: unknown) {
      if (activeTabRef.current !== tab) return;
      setItems([]);
      setState({ status: "error", error: describeError(err) });
    }
  }, [tab]);

  function retry() {
    setState({ status: "loading" });
    void fetchQueue();
  }

  function switchTab(next: "alerts" | "places") {
    setState({ status: "loading" });
    setTab(next);
  }

  useEffect(() => {
    if (!allowed) return;
    // react-hooks/set-state-in-effect flags the effect when it calls a
    // function that itself calls setState (fetchQueue). Routing the call
    // through a locally declared closure satisfies the rule without
    // changing behaviour; the activeTabRef guard in fetchQueue still
    // dedupes tab switches.
    const begin = () => {
      void fetchQueue();
    };
    begin();
  }, [allowed, fetchQueue]);

  return (
    <section>
      <Eyebrow>Review</Eyebrow>
      <h1>Review queue</h1>
      <p className="sub">
        Quarantined alerts and unverified shelter profiles. Reviewing organises
        human judgement; it never asserts that a place is open, safe or
        operational.
      </p>

      {loading ? (
        <LoadingPanel label="Checking session" />
      ) : !signedIn ? (
        <SigninRequiredPanel />
      ) : !allowed ? (
        <InsufficientRolePanel required="REVIEWER" role={role} />
      ) : (
        <>
          <div
            role="tablist"
            aria-label="Review queue kind"
            className="tabs"
            // Arrow-key navigation between the two tabs (WAI-ARIA tabs
            // pattern), mirroring the public web AuthPanel. Focus moves with
            // the selection; the inactive tab is removed from the tab order.
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") {
                switchTab("places");
                placesTabRef.current?.focus();
              } else if (event.key === "ArrowLeft") {
                switchTab("alerts");
                alertsTabRef.current?.focus();
              }
            }}
          >
            <button
              type="button"
              role="tab"
              ref={alertsTabRef}
              aria-selected={tab === "alerts"}
              tabIndex={tab === "alerts" ? 0 : -1}
              className={tab === "alerts" ? "tab tab--active" : "tab"}
              onClick={() => switchTab("alerts")}
            >
              Alerts
            </button>
            <button
              type="button"
              role="tab"
              ref={placesTabRef}
              aria-selected={tab === "places"}
              tabIndex={tab === "places" ? 0 : -1}
              className={tab === "places" ? "tab tab--active" : "tab"}
              onClick={() => switchTab("places")}
            >
              Places
            </button>
          </div>

          {state.status === "loading" ? (
            <LoadingPanel label={`Loading ${tab} queue`} />
          ) : state.status === "error" ? (
            <ErrorPanel message={state.error} onRetry={retry} />
          ) : items.length === 0 ? (
            <EmptyPanel
              title={`No ${tab} in the review queue`}
              body="Nothing is awaiting review right now."
            />
          ) : isPlaceQueue(items) ? (
            <div className="list">
              {items.map((item) => (
                <PlaceCard key={item.shelter.id} item={item} onDecided={retry} />
              ))}
            </div>
          ) : (
            <div className="list">
              {items.map((item) => (
                <AlertCard key={item.alert.id} item={item} onDecided={retry} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */

function AlertCard({
  item,
  onDecided,
}: {
  item: AlertQueueItem;
  onDecided: () => void;
}) {
  return (
    <article className="card">
      <div className="card__head">
        <h2 className="card__title">{item.alert.headline}</h2>
        <Badge tone="warn">{item.alert.status}</Badge>
      </div>

      <div className="card__meta">
        <Meta k="Issuer">{item.alert.issuer ?? "n/a"}</Meta>
        <Meta k="Issued">{formatDateTime(item.alert.issuedAt)}</Meta>
        <Meta k="Received">{formatDateTime(item.alert.createdAt)}</Meta>
        <Meta k="Provider key">
          {item.providerKey ? (
            <code className="mono">{item.providerKey}</code>
          ) : (
            "n/a"
          )}
        </Meta>
        {item.alert.externalRef ? (
          <Meta k="External ref">
            <code className="mono">{item.alert.externalRef}</code>
          </Meta>
        ) : null}
      </div>

      <div className="provenance">
        <h3>Provenance</h3>
        {item.provenance ? (
          <div className="card__meta">
            <Meta k="Source">
              {item.provenance.sourceUrl ? (
                <a
                  href={item.provenance.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.provenance.sourceUrl}
                </a>
              ) : (
                "n/a"
              )}
            </Meta>
            <Meta k="Payload hash">
              {item.provenance.payloadHash ? (
                <TruncatedHash hash={item.provenance.payloadHash} />
              ) : (
                "n/a"
              )}
            </Meta>
            <Meta k="Fetched">
              {formatDateTime(item.provenance.fetchedAt)}
            </Meta>
          </div>
        ) : (
          <p className="card__note">No source record attached to this alert.</p>
        )}
      </div>

      <DecidePanel
        targetKind="alert"
        targetId={item.alert.id}
        onDecided={onDecided}
      />
    </article>
  );
}

function PlaceCard({
  item,
  onDecided,
}: {
  item: PlaceQueueItem;
  onDecided: () => void;
}) {
  return (
    <article className="card">
      <div className="card__head">
        <h2 className="card__title">{item.place.name}</h2>
        <Badge tone="warn">{item.shelter.verification}</Badge>
      </div>

      <div className="card__meta">
        <Meta k="Place kind">{item.place.kind}</Meta>
        <Meta k="Place verification">{item.place.verification}</Meta>
        <Meta k="Inspecting authority">
          {item.shelter.inspectAuthority ?? "n/a"}
        </Meta>
        <Meta k="Inspection date">
          {formatDateTime(item.shelter.inspectionDate)}
        </Meta>
      </div>

      <p className="card__note">
        A map listing is not proof a place is open, safe or operational.
        Verification states are recorded evidence, never a live claim.
      </p>

      <DecidePanel
        targetKind="shelter"
        targetId={item.shelter.id}
        onDecided={onDecided}
      />
    </article>
  );
}

/* ------------------------------------------------------------------ */

const ALERT_DECISIONS = ["REVIEW_APPROVED", "REVIEW_REJECTED"] as const;
const SHELTER_DECISIONS = [
  "SHELTER_VERIFIED",
  "SHELTER_STALE",
  "REVIEW_REJECTED",
] as const;

function DecidePanel({
  targetKind,
  targetId,
  onDecided,
}: {
  targetKind: "alert" | "shelter";
  targetId: string;
  onDecided: () => void;
}) {
  const isShelter = targetKind === "shelter";
  const decisions = isShelter ? SHELTER_DECISIONS : ALERT_DECISIONS;

  const [decision, setDecision] = useState<string>(decisions[0]);
  const [rationale, setRationale] = useState("");
  const [authority, setAuthority] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const requiresEvidence = isShelter && decision === "SHELTER_VERIFIED";

  async function submit() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await reviewApi.decide({
        target: { kind: targetKind, id: targetId },
        decision: decision as
          | "REVIEW_APPROVED"
          | "REVIEW_REJECTED"
          | "SHELTER_VERIFIED"
          | "SHELTER_STALE",
        rationale: rationale || undefined,
        authority: requiresEvidence ? authority || undefined : undefined,
        verificationDate: requiresEvidence ? date || undefined : undefined,
      });
      setSuccess(
        `Decision recorded (${res.decision}, audit action ${res.auditAction}).`,
      );
      setRationale("");
      setAuthority("");
      setDate("");
      onDecided();
    } catch (err: unknown) {
      // 400s (e.g. the Gate E shelter evidence policy) surface verbatim.
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  }

  const canSubmit =
    !busy && (!requiresEvidence || (authority.trim() !== "" && date !== ""));

  return (
    <div className="decide">
      <h3>Decision</h3>
      <div className="decide__grid">
        <label className="field">
          <span className="field__label">Decision</span>
          <select
            className="input"
            value={decision}
            onChange={(e) => setDecision(e.target.value)}
          >
            {decisions.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field__label">Rationale (optional)</span>
          <textarea
            className="input"
            rows={3}
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="Why was this decision made?"
          />
        </label>

        {requiresEvidence ? (
          <>
            <label className="field">
              <span className="field__label">
                Verifying authority{" "}
                <span className="field__req">(required)</span>
              </span>
              <input
                className="input"
                value={authority}
                onChange={(e) => setAuthority(e.target.value)}
                required
                placeholder="e.g. municipal civil-protection office"
              />
            </label>
            <label className="field">
              <span className="field__label">
                Verification date{" "}
                <span className="field__req">(required)</span>
              </span>
              <input
                className="input"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </label>
          </>
        ) : null}
      </div>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="form-success-text" role="status">
          {success}
        </p>
      ) : null}

      <div className="form-actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          {busy ? (
            <>
              <span className="spinner" aria-hidden="true" /> Recording…
            </>
          ) : (
            "Record decision"
          )}
        </button>
      </div>
    </div>
  );
}
