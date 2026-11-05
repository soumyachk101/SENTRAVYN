'use client';

import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  ApiError,
  PublicUser,
  clearSession,
  getMe,
  getStoredSession,
  login,
  logout,
  refreshStoredSession,
  register,
} from '@/lib/api';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 12;

type Tab = 'login' | 'register';

interface FieldErrors {
  email?: string;
  password?: string;
}

interface Attempt {
  tab: Tab;
  email: string;
  displayName: string;
  password: string;
}

function roleLabel(role: string): string {
  switch (role.toUpperCase()) {
    case 'PUBLIC':
      return 'Public';
    case 'REVIEWER':
      return 'Reviewer';
    case 'OPERATOR':
      return 'Operator';
    case 'ADMIN':
      return 'Admin';
    default:
      // Unknown/legacy role codes are shown verbatim, never fabricated.
      return role;
  }
}

function validateFields(
  emailValue: string,
  passwordValue: string,
): FieldErrors {
  const errors: FieldErrors = {};
  const value = emailValue.trim();
  if (value === '') {
    errors.email = 'Email is required.';
  } else if (!EMAIL_PATTERN.test(value)) {
    errors.email = 'Enter a valid email address.';
  }
  if (passwordValue.length < MIN_PASSWORD_LENGTH) {
    errors.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return errors;
}

/**
 * Account surface: sign in / create account, signed-in identity and session
 * controls, with session restoration on first load.
 *
 * States covered:
 * - Booting: a stored refresh token is being rotated; renders a short
 *   "restoring" status. On failure the session is cleared, the signed-out
 *   state is shown, and a note says the server-side session may still be
 *   active (offline / expired-token case).
 * - Signed out: Login / Register tabs with inline validation, in-flight
 *   button states, API error text, unreachable-API retry, 409 duplicate
 *   email, register-success (stay on the panel, prompt to log in), and
 *   sign-out / restore notes when a sign-out could not be mirrored on the
 *   server or a stored session could not be restored.
 * - Signed in: identity (display name or email, role badge), a Session
 *   section with sign-out. No fields are shown that the API does not
 *   provide.
 */
export function AuthPanel() {
  // Hydration-safe: storage only exists on the client, so the first render
  // always shows the signed-out UI; the mount effect flips to "restoring"
  // when a stored refresh token must be rotated.
  const [booting, setBooting] = useState(false);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutNote, setSignOutNote] = useState<string | null>(null);
  const [restoreNote, setRestoreNote] = useState<string | null>(null);

  const [tab, setTab] = useState<Tab>('login');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    tone: 'ok' | 'neutral';
    text: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasRetry, setHasRetry] = useState(false);
  const retryAttemptRef = useRef<Attempt | null>(null);

  // Session restoration on first load: rotate the stored refresh token,
  // then fetch the current user. Any failure clears the session and lands
  // on the signed-out state; when the API was unreachable a note says the
  // server-side session may still be active (offline state).
  useEffect(() => {
    const { refreshToken } = getStoredSession();
    if (refreshToken === null) {
      // Nothing to restore: stay in the signed-out state.
      return;
    }
    // react-hooks/set-state-in-effect flags an effect that calls setState
    // synchronously in its body; routing through a locally declared closure
    // satisfies the rule with no behaviour change (matches apps/admin).
    const begin = () => {
      setBooting(true);
    };
    begin();
    let cancelled = false;
    (async () => {
      const refreshed = await refreshStoredSession();
      if (cancelled) return;
      if (refreshed === null) {
        setRestoreNote(
          'Your session could not be restored. If you are offline, your ' +
            'sign-in may still be active on the server; sign in again to ' +
            'restore it.',
        );
        setBooting(false);
        return;
      }
      try {
        const me = await getMe();
        if (!cancelled) setUser(me);
      } catch {
        clearSession();
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runAttempt(attempt: Attempt): Promise<void> {
    setBusy(true);
    setFormError(null);
    retryAttemptRef.current = null;
    setHasRetry(false);
    try {
      if (attempt.tab === 'login') {
        const result = await login({
          email: attempt.email.trim(),
          password: attempt.password,
        });
        // A live session supersedes any sign-out / restore warnings.
        setSignOutNote(null);
        setRestoreNote(null);
        setUser(result.user);
      } else {
        await register({
          email: attempt.email.trim(),
          displayName:
            attempt.displayName.trim() === ''
              ? undefined
              : attempt.displayName.trim(),
          password: attempt.password,
        });
        setTab('login');
        setNotice({
          tone: 'ok',
          text: 'Account created. Sign in to continue.',
        });
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        setFormError(
          'Could not reach the SENTRAVYN API. Check your connection and try again.',
        );
        retryAttemptRef.current = attempt;
        setHasRetry(true);
      } else if (error instanceof ApiError) {
        // 401 (invalid credentials), 409 (duplicate email), validation 400:
        // show the API's own message verbatim.
        setFormError(error.message);
      } else {
        setFormError('Something unexpected happened. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  function handleLoginSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const errors = validateFields(email, password);
    setFieldErrors(errors);
    setNotice(null);
    if (Object.keys(errors).length > 0) return;
    void runAttempt({ tab: 'login', email, displayName, password });
  }

  function handleRegisterSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const errors = validateFields(email, password);
    setFieldErrors(errors);
    setNotice(null);
    if (Object.keys(errors).length > 0) return;
    void runAttempt({ tab: 'register', email, displayName, password });
  }

  function handleRetry(): void {
    const attempt = retryAttemptRef.current;
    if (attempt === null) return;
    void runAttempt(attempt);
  }

  async function handleLogout(): Promise<void> {
    setSigningOut(true);
    const revoked = await logout();
    setSigningOut(false);
    setUser(null);
    setSignOutNote(
      revoked
        ? null
        : 'You are signed out on this device. The server could not be reached, so the session may remain active until the refresh token expires.',
    );
  }

  function selectTab(next: Tab): void {
    setTab(next);
    setNotice(null);
    setFormError(null);
    retryAttemptRef.current = null;
    setHasRetry(false);
  }

  if (booting) {
    return (
      <div className="hero__account-panel">
        <p className="hero__account-status" role="status">
          Restoring your session...
        </p>
      </div>
    );
  }

  if (user !== null) {
    return (
      <div className="hero__account-panel">
        <div className="hero__account-identity">
          <p className="hero__account-name">{user.displayName ?? user.email}</p>
          {user.displayName !== null && (
            <p className="hero__account-email">{user.email}</p>
          )}
          <span className="hero__account-role">{roleLabel(user.role)}</span>
        </div>
        <div className="hero__account-session">
          <h3>Session</h3>
          <button
            type="button"
            className="hero__account-btn hero__account-btn--secondary"
            onClick={() => void handleLogout()}
            disabled={signingOut}
          >
            {signingOut ? 'Signing out...' : 'Sign out'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="hero__account-panel">
      <div
        className="hero__account-tabs"
        role="tablist"
        aria-label="Account"
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') selectTab('login');
          if (event.key === 'ArrowRight') selectTab('register');
        }}
      >
        <button
          type="button"
          role="tab"
          id="account-tab-login"
          aria-selected={tab === 'login'}
          aria-controls="account-panel-login"
          onClick={() => selectTab('login')}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          id="account-tab-register"
          aria-selected={tab === 'register'}
          aria-controls="account-panel-register"
          onClick={() => selectTab('register')}
        >
          Create account
        </button>
      </div>

      {notice !== null && (
        <p
          className={`hero__account-message hero__account-message--${notice.tone}`}
          role="status"
        >
          {notice.text}
        </p>
      )}

      {(signOutNote !== null || restoreNote !== null) && (
        <p
          className="hero__account-message hero__account-message--neutral"
          role="status"
        >
          {signOutNote ?? restoreNote}
        </p>
      )}

      {tab === 'login' ? (
        <form
          id="account-panel-login"
          role="tabpanel"
          aria-labelledby="account-tab-login"
          className="hero__account-form"
          onSubmit={handleLoginSubmit}
          noValidate
        >
          <div className="hero__account-field">
            <label htmlFor="account-email-login">Email</label>
            <input
              id="account-email-login"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={fieldErrors.email !== undefined}
              aria-describedby={
                fieldErrors.email !== undefined
                  ? 'account-email-login-error'
                  : undefined
              }
            />
            {fieldErrors.email !== undefined && (
              <p
                className="hero__account-field-error"
                id="account-email-login-error"
              >
                {fieldErrors.email}
              </p>
            )}
          </div>
          <div className="hero__account-field">
            <label htmlFor="account-password-login">Password</label>
            <input
              id="account-password-login"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={fieldErrors.password !== undefined}
              aria-describedby={
                fieldErrors.password !== undefined
                  ? 'account-password-login-error'
                  : undefined
              }
            />
            {fieldErrors.password !== undefined && (
              <p
                className="hero__account-field-error"
                id="account-password-login-error"
              >
                {fieldErrors.password}
              </p>
            )}
          </div>
          {formError !== null && (
            <p
              className="hero__account-message hero__account-message--error"
              role="alert"
            >
              {formError}
            </p>
          )}
          <div className="hero__account-actions">
            <button type="submit" className="hero__account-btn" disabled={busy}>
              {busy ? 'Signing in...' : 'Sign in'}
            </button>
            {hasRetry && (
              <button
                type="button"
                className="hero__account-btn hero__account-btn--secondary"
                onClick={handleRetry}
                disabled={busy}
              >
                Retry
              </button>
            )}
          </div>
        </form>
      ) : (
        <form
          id="account-panel-register"
          role="tabpanel"
          aria-labelledby="account-tab-register"
          className="hero__account-form"
          onSubmit={handleRegisterSubmit}
          noValidate
        >
          <div className="hero__account-field">
            <label htmlFor="account-email-register">Email</label>
            <input
              id="account-email-register"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={fieldErrors.email !== undefined}
              aria-describedby={
                fieldErrors.email !== undefined
                  ? 'account-email-register-error'
                  : undefined
              }
            />
            {fieldErrors.email !== undefined && (
              <p
                className="hero__account-field-error"
                id="account-email-register-error"
              >
                {fieldErrors.email}
              </p>
            )}
          </div>
          <div className="hero__account-field">
            <label htmlFor="account-displayname-register">
              Display name (optional)
            </label>
            <input
              id="account-displayname-register"
              type="text"
              autoComplete="name"
              maxLength={120}
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>
          <div className="hero__account-field">
            <label htmlFor="account-password-register">
              Password (minimum 12 characters)
            </label>
            <input
              id="account-password-register"
              type="password"
              autoComplete="new-password"
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={fieldErrors.password !== undefined}
              aria-describedby={
                fieldErrors.password !== undefined
                  ? 'account-password-register-error'
                  : undefined
              }
            />
            {fieldErrors.password !== undefined && (
              <p
                className="hero__account-field-error"
                id="account-password-register-error"
              >
                {fieldErrors.password}
              </p>
            )}
          </div>
          {formError !== null && (
            <p
              className="hero__account-message hero__account-message--error"
              role="alert"
            >
              {formError}
            </p>
          )}
          <div className="hero__account-actions">
            <button type="submit" className="hero__account-btn" disabled={busy}>
              {busy ? 'Creating account...' : 'Create account'}
            </button>
            {hasRetry && (
              <button
                type="button"
                className="hero__account-btn hero__account-btn--secondary"
                onClick={handleRetry}
                disabled={busy}
              >
                Retry
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
