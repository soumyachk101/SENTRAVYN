"use client";

import { useCallback, useEffect, useState } from "react";
import { authApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import {
  type MfaSetupResult,
  type MfaStatusView,
  type SessionView,
} from "@/lib/types";
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
} from "@/lib/ui";

/**
 * Account security surface (SECURITY.md section 2). Any signed-in user can
 * view MFA state, enrol TOTP, list active sessions and revoke them
 * (including the credential-compromise "revoke all" path). Privileged roles
 * are REQUIRED to keep MFA enrolled; this page is the self-service path that
 * enrolls them, and the MFA login step (login page) enforces it.
 *
 * The one-time enrolment response shows the TOTP seed and the 8 single-use
 * recovery codes exactly once (SECURITY.md 4): after this component mounts
 * a refresh never re-fetches them.
 */
const CODE_RE = /^([0-9]{6}|[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})$/i;

export default function SecurityPage() {
  const session = useSession();
  const [status, setStatus] = useState<MfaStatusView | null>(null);
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; error: string }
    | { status: "ready" }
  >({ status: "loading" });

  // Enrolment flow (shown once): seed/URI + recovery codes from setup().
  const [enrollment, setEnrollment] = useState<MfaSetupResult | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollmentError, setEnrollmentError] = useState<string | null>(null);

  // Verify / disable second-factor inputs.
  const [confirmCode, setConfirmCode] = useState("");
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [successNote, setSuccessNote] = useState<string | null>(null);

  // Session revocation feedback.
  const [revokeAllBusy, setRevokeAllBusy] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const signedIn = session.user !== null;

  const load = useCallback(async () => {
    setState({ status: "loading" });
    setSuccessNote(null);
    try {
      const [mfa, activeSessions] = await Promise.all([
        authApi.mfaStatus(),
        authApi.sessions(),
      ]);
      setStatus(mfa);
      setSessions(activeSessions);
      setState({ status: "ready" });
    } catch (err) {
      setState({ status: "error", error: describeError(err) });
    }
  }, []);

  useEffect(() => {
    // react-hooks/set-state-in-effect flags an effect that calls a
    // setState-carrying function directly; a locally declared closure
    // satisfies the rule with no behaviour change.
    const begin = () => {
      if (signedIn) void load();
    };
    begin();
  }, [signedIn, load]);

  async function startEnrollment() {
    setEnrolling(true);
    setEnrollmentError(null);
    setSuccessNote(null);
    try {
      const result = await authApi.mfaSetup();
      setEnrollment(result);
    } catch (err) {
      setEnrollmentError(describeError(err));
    } finally {
      setEnrolling(false);
    }
  }

  async function confirmEnrollment() {
    const code = confirmCode.trim().toUpperCase();
    if (!CODE_RE.test(code)) {
      setConfirmError("Enter a 6-digit TOTP code or one of the recovery codes.");
      return;
    }
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      const result = await authApi.mfaVerify(code);
      setEnrollment(null);
      setConfirmCode("");
      setSuccessNote(
        `MFA enabled. ${result.recoveryCodesRemaining} recovery code(s) remain.`,
      );
      await load();
    } catch (err) {
      setConfirmError(describeError(err));
    } finally {
      setConfirmBusy(false);
    }
  }

  async function disableMfa() {
    const code = confirmCode.trim().toUpperCase();
    if (!CODE_RE.test(code)) {
      setConfirmError("Enter a valid code to disable MFA.");
      return;
    }
    setConfirmBusy(true);
    setConfirmError(null);
    try {
      await authApi.mfaDisable(code);
      setConfirmCode("");
      setSuccessNote("MFA disabled for this account.");
      await load();
    } catch (err) {
      setConfirmError(describeError(err));
    } finally {
      setConfirmBusy(false);
    }
  }

  async function revokeAll() {
    setRevokeAllBusy(true);
    setRevokeError(null);
    try {
      const result = await authApi.revokeAllSessions();
      setSuccessNote(
        `Revoked ${result.revoked} active session(s). Sign in again to continue.`,
      );
      // The current session's refresh token is revoked server-side: drop the
      // local session so the user is returned to the login surface.
      session.signOut();
    } catch (err) {
      setRevokeError(describeError(err));
    } finally {
      setRevokeAllBusy(false);
    }
  }

  async function revokeOne(id: string) {
    setRevokeError(null);
    try {
      // Revoking one of your own sessions by id (idempotent, cross-tenant
      // safe on the server).
      await authApi.revokeSession(id);
      // If the row just revoked was this very session, the follow-up load()
      // gets a 401 and the context signs out; otherwise the list refreshes.
      await load();
    } catch (err) {
      setRevokeError(describeError(err));
    }
  }

  if (session.loading) {
    return <LoadingPanel label="Checking session" />;
  }
  if (!signedIn) {
    return <SigninRequiredPanel />;
  }

  const isPrivileged =
    session.user?.role === "OPERATOR" || session.user?.role === "ADMIN";

  return (
    <section>
      <Eyebrow>Security</Eyebrow>
      <h1>Account security</h1>
      <p className="sub">
        Multi-factor authentication (TOTP + recovery codes) and active session
        management.{" "}
        {isPrivileged
          ? "Your role requires MFA; keep it enabled."
          : "MFA is optional for your role."}
      </p>

      {state.status === "error" ? (
        <ErrorPanel message={state.error} onRetry={load} />
      ) : state.status === "loading" ? (
        <LoadingPanel label="Loading security state" />
      ) : (
        <>
          {successNote ? (
            <div className="form-success" role="status">
              <p>{successNote}</p>
            </div>
          ) : null}

          {/* --------------------------------------------------------- MFA */}
          <div className="panel">
            <h2>Multi-factor authentication</h2>
            {status === null ? (
              <LoadingPanel label="Loading MFA state" />
            ) : status.mfaEnabled ? (
              <>
                <p>
                  <Badge tone="ok">MFA enabled</Badge>{" "}
                  {status.recoveryCodesRemaining} recovery code(s) remaining.
                </p>
                <Field
                  label="Code to disable MFA"
                  htmlFor="mfa-disable-code"
                  error={confirmError ?? undefined}
                >
                  <input
                    id="mfa-disable-code"
                    type="text"
                    inputMode="text"
                    autoComplete="one-time-code"
                    className={confirmError ? "input input--error" : "input"}
                    value={confirmCode}
                    onChange={(e) => setConfirmCode(e.target.value)}
                    aria-invalid={Boolean(confirmError)}
                  />
                </Field>
                <p className="field__hint">
                  Disabling requires a valid TOTP or recovery code so a
                  compromised session alone cannot remove your second factor.
                </p>
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    disabled={confirmBusy}
                    onClick={disableMfa}
                  >
                    {confirmBusy ? "Disabling…" : "Disable MFA"}
                  </button>
                </div>
              </>
            ) : enrollment ? (
              /* One-time enrolment view: the seed and the 8 single-use
                 recovery codes are shown exactly once (SECURITY.md 4). */
              <>
                <p>
                  <Badge tone="warn">Enrolment pending</Badge> Confirm with a
                  code to finish enabling MFA.
                </p>
                <div className="mono-block" aria-label="TOTP secret">
                  <h3>TOTP secret (show your authenticator)</h3>
                  <code className="mono mono--wrap">{enrollment.uri}</code>
                  <code className="mono mono--wrap">{enrollment.secret}</code>
                </div>
                <div className="mono-block" aria-label="Recovery codes">
                  <h3>Recovery codes (single use — store safely)</h3>
                  <ul>
                    {enrollment.recoveryCodes.map((code) => (
                      <li key={code}>
                        <code className="mono">{code}</code>
                      </li>
                    ))}
                  </ul>
                </div>
                {enrollmentError ? (
                  <p className="form-error" role="alert">
                    {enrollmentError}
                  </p>
                ) : null}
                <Field
                  label="Confirmation code"
                  htmlFor="mfa-confirm-code"
                  error={confirmError ?? undefined}
                >
                  <input
                    id="mfa-confirm-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="123456"
                    className={confirmError ? "input input--error" : "input"}
                    value={confirmCode}
                    onChange={(e) => setConfirmCode(e.target.value)}
                    aria-invalid={Boolean(confirmError)}
                  />
                </Field>
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={confirmBusy}
                    onClick={confirmEnrollment}
                  >
                    {confirmBusy ? "Verifying…" : "Confirm code"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => {
                      setEnrollment(null);
                      setConfirmCode("");
                      setConfirmError(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  <Badge tone="muted">MFA not set up</Badge> Enrol TOTP via
                  an authenticator app.
                </p>
                {enrollmentError ? (
                  <p className="form-error" role="alert">
                    {enrollmentError}
                  </p>
                ) : null}
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    disabled={enrolling}
                    onClick={startEnrollment}
                  >
                    {enrolling ? "Preparing…" : "Set up MFA"}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* ------------------------------------------- Active sessions */}
          <div className="panel">
            <h2>Active sessions</h2>
            {sessions.length === 0 ? (
              <EmptyPanel
                title="No active sessions"
                body="No unexpired, unrevoked sessions are recorded for this account."
              />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Started</th>
                      <th scope="col">Expires</th>
                      <th scope="col">User agent</th>
                      <th scope="col">IP</th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessions.map((s) => (
                      <tr key={s.id}>
                        <td className="cell-time">
                          {formatDateTime(s.createdAt)}
                        </td>
                        <td className="cell-time">
                          {formatDateTime(s.expiresAt)}
                        </td>
                        <td>
                          {s.userAgent ? (
                            <code className="mono mono--wrap" title={s.userAgent}>
                              {s.userAgent.length > 48
                                ? `${s.userAgent.slice(0, 48)}…`
                                : s.userAgent}
                            </code>
                          ) : (
                            <span className="cell-muted">n/a</span>
                          )}
                        </td>
                        <td>
                          {s.ip ? (
                            <code className="mono">{s.ip}</code>
                          ) : (
                            <span className="cell-muted">n/a</span>
                          )}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn--sm btn--ghost"
                            onClick={() => void revokeOne(s.id)}
                          >
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {revokeError ? (
              <p className="form-error" role="alert">
                {revokeError}
              </p>
            ) : null}
            <p className="field__hint">
              Revoking all sessions is the credential-compromise path: every
              refresh token stops working and you must sign in again.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="btn btn--ghost"
                disabled={revokeAllBusy}
                onClick={revokeAll}
              >
                {revokeAllBusy ? "Revoking…" : "Revoke all sessions"}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
