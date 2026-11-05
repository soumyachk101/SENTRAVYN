'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { authApi } from '@/lib/api';
import { useSession } from '@/lib/session';
import { isMfaPending, type MfaPendingLogin } from '@/lib/types';
import {
  Badge,
  describeError,
  Eyebrow,
  Field,
} from '@/lib/ui';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A TOTP code is 6 digits; a recovery code is 4-4-4 (13 chars). */
const CODE_RE = /^([0-9]{6}|[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})$/i;

/**
 * Sign-in surface. Login + register tabs, inline validation, error and
 * loading states (CLAUDE.md rule 9-10). A privileged account that has
 * enrolled MFA returns a pending MFA token from login; this surface then
 * requires a TOTP or single-use recovery code (SECURITY.md section 2) before
 * the full session is adopted. On success the token pair is persisted to
 * localStorage, the session context adopts it immediately, and the user is
 * returned to where they came from, or / when navigation has no context.
 */
export default function LoginPage() {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSession();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  // Roving tabindex on the tabs (WAI-ARIA tabs pattern), mirroring the
  // public web AuthPanel: focus moves with the selection; the inactive tab
  // is removed from the tab order.
  const loginTabRef = useRef<HTMLButtonElement>(null);
  const registerTabRef = useRef<HTMLButtonElement>(null);

  // Login form
  const [lEmail, setLEmail] = useState('');
  const [lPassword, setLPassword] = useState('');
  const [lErrors, setLErrors] = useState<{ email?: string; password?: string }>(
    {},
  );
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // MFA step (only when login returned a pending token)
  const [mfaPending, setMfaPending] = useState<MfaPendingLogin | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [mfaError, setMfaError] = useState<string | null>(null);

  // Register form
  const [rEmail, setREmail] = useState('');
  const [rName, setRName] = useState('');
  const [rPassword, setRPassword] = useState('');
  const [rErrors, setRErrors] = useState<{
    email?: string;
    name?: string;
    password?: string;
  }>({});
  const [registerBusy, setRegisterBusy] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);

  const inputClass = 'input';
  const inputErrorClass = 'input input--error';

  const redirect = (to: string) => {
    // Only return to admin paths; never to a foreign route.
    const target =
      to && to.startsWith('/') && !to.startsWith('/login') ? to : '/';
    router.replace(target);
  };

  function validateLogin(): boolean {
    const e: typeof lErrors = {};
    if (!EMAIL_RE.test(lEmail)) e.email = 'Enter a valid email address.';
    if (lPassword.length === 0) e.password = 'Enter your password.';
    setLErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onLogin(ev: FormEvent) {
    ev.preventDefault();
    if (!validateLogin()) return;
    setLoginBusy(true);
    setLoginError(null);
    setMfaCode('');
    setMfaError(null);
    try {
      const res = await authApi.login({ email: lEmail, password: lPassword });
      if (isMfaPending(res)) {
        // Privileged + MFA-enrolled account: hold the pending token and ask
        // for the second factor before a session is adopted.
        setMfaPending(res);
        setLoginBusy(false);
        return;
      }
      // Non-privileged or MFA-not-enrolled: straight token pair.
      setMfaPending(null);
      session.adoptSession(res);
      redirect(pathname);
    } catch (err) {
      setLoginError(describeError(err));
      setLoginBusy(false);
    }
  }

  async function onMfa(ev: FormEvent) {
    ev.preventDefault();
    if (!mfaPending) return;
    const code = mfaCode.trim().toUpperCase();
    if (!CODE_RE.test(code)) {
      setMfaError('Enter a 6-digit TOTP code or one of your recovery codes.');
      return;
    }
    setMfaBusy(true);
    setMfaError(null);
    try {
      const tokens = await authApi.completeMfa({
        mfaTempToken: mfaPending.mfaTempToken,
        code,
      });
      setMfaPending(null);
      session.adoptSession(tokens);
      redirect(pathname);
    } catch (err) {
      setMfaError(describeError(err));
    } finally {
      setMfaBusy(false);
    }
  }

  function validateRegister(): boolean {
    const e: typeof rErrors = {};
    if (!EMAIL_RE.test(rEmail)) e.email = 'Enter a valid email address.';
    if (rName.length > 120)
      e.name = 'Display name is limited to 120 characters.';
    if (rPassword.length < 12)
      e.password = 'Password must be at least 12 characters.';
    setRErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onRegister(ev: FormEvent) {
    ev.preventDefault();
    if (!validateRegister()) return;
    setRegisterBusy(true);
    setRegisterError(null);
    try {
      const user = await authApi.register({
        email: rEmail,
        displayName: rName || undefined,
        password: rPassword,
      });
      // Registration creates a PUBLIC account only; the user still needs to
      // sign in to obtain a session. Offer a direct path to that.
      setRegisteredEmail(user.email);
      setTab('login');
      setLEmail(user.email);
    } catch (err) {
      setRegisterError(describeError(err));
    } finally {
      setRegisterBusy(false);
    }
  }

  /** MFA step: valid credentials returned a pending token; a TOTP or a
   *  single-use recovery code is required to complete the login. */
  function mfaStep() {
    return (
      <form onSubmit={onMfa} noValidate className="panel">
        <div className="form-success" role="status">
          <p>Second factor required for this account.</p>
          <Badge tone="warn">Multi-factor authentication</Badge>
        </div>

        <Field
          label="Authentication code"
          htmlFor="mfa-code"
          error={mfaError ?? undefined}
          required
        >
          <input
            id="mfa-code"
            type="text"
            inputMode="text"
            autoComplete="one-time-code"
            placeholder="123456"
            required
            className={mfaError ? inputErrorClass : inputClass}
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            aria-invalid={Boolean(mfaError)}
            aria-describedby={mfaError ? 'mfa-code-error' : 'mfa-code-hint'}
          />
        </Field>
        <p className="field__hint" id="mfa-code-hint">
          Enter the current 6-digit code from your authenticator app, or one of
          your single-use recovery codes.{' '}
          {mfaPending
            ? mfaPending.recoveryCodesRemaining > 0
              ? `${mfaPending.recoveryCodesRemaining} recovery code(s) remain.`
              : 'No recovery codes remain.'
            : ''}
        </p>

        {mfaError ? (
          <p className="form-error" role="alert">
            {mfaError}
          </p>
        ) : null}

        <div className="form-actions">
          <button type="submit" className="btn btn--primary" disabled={mfaBusy}>
            {mfaBusy ? (
              <>
                <span className="spinner" aria-hidden="true" /> Verifying…
              </>
            ) : (
              'Continue'
            )}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setMfaPending(null);
              setMfaCode('');
              setMfaError(null);
            }}
          >
            Back
          </button>
        </div>
      </form>
    );
  }

  /** Sign-in form (credentials only; the MFA step, if required, follows). */
  function loginForm() {
    return (
      <form onSubmit={onLogin} noValidate className="panel">
        <Field label="Email" htmlFor="l-email" error={lErrors.email}>
          <input
            id="l-email"
            type="email"
            autoComplete="email"
            required
            className={lErrors.email ? inputErrorClass : inputClass}
            value={lEmail}
            onChange={(e) => setLEmail(e.target.value)}
            aria-invalid={Boolean(lErrors.email)}
            aria-describedby={lErrors.email ? 'l-email-error' : undefined}
          />
        </Field>

        <Field label="Password" htmlFor="l-password" error={lErrors.password}>
          <input
            id="l-password"
            type="password"
            autoComplete="current-password"
            required
            className={lErrors.password ? inputErrorClass : inputClass}
            value={lPassword}
            onChange={(e) => setLPassword(e.target.value)}
            aria-invalid={Boolean(lErrors.password)}
            aria-describedby={lErrors.password ? 'l-password-error' : undefined}
          />
        </Field>

        {loginError ? (
          <p className="form-error" role="alert">
            {loginError}
          </p>
        ) : null}

        <div className="form-actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={loginBusy}
          >
            {loginBusy ? (
              <>
                <span className="spinner" aria-hidden="true" /> Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </div>
      </form>
    );
  }

  /** Registration form: creates a PUBLIC account (role is assigned by an
   *  administrator; MFA is enabled per-account, not at registration). */
  function registerForm() {
    return (
      <form onSubmit={onRegister} noValidate className="panel">
        <Field label="Email" htmlFor="r-email" error={rErrors.email}>
          <input
            id="r-email"
            type="email"
            autoComplete="email"
            required
            className={rErrors.email ? inputErrorClass : inputClass}
            value={rEmail}
            onChange={(e) => setREmail(e.target.value)}
            aria-invalid={Boolean(rErrors.email)}
            aria-describedby={rErrors.email ? 'r-email-error' : undefined}
          />
        </Field>

        <Field
          label="Display name (optional)"
          htmlFor="r-name"
          error={rErrors.name}
        >
          <input
            id="r-name"
            type="text"
            autoComplete="name"
            className={rErrors.name ? inputErrorClass : inputClass}
            value={rName}
            onChange={(e) => setRName(e.target.value)}
            aria-invalid={Boolean(rErrors.name)}
            aria-describedby={rErrors.name ? 'r-name-error' : undefined}
          />
        </Field>

        <Field label="Password" htmlFor="r-password" error={rErrors.password}>
          <input
            id="r-password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            className={rErrors.password ? inputErrorClass : inputClass}
            value={rPassword}
            onChange={(e) => setRPassword(e.target.value)}
            aria-invalid={Boolean(rErrors.password)}
            aria-describedby={rErrors.password ? 'r-password-error' : undefined}
          />
          <p className="field__hint">
            Minimum 12 characters. Registration creates a PUBLIC account;
            privileged roles are assigned by an administrator.
          </p>
        </Field>

        {registerError ? (
          <p className="form-error" role="alert">
            {registerError}
          </p>
        ) : null}

        <div className="form-actions">
          <button
            type="submit"
            className="btn btn--primary"
            disabled={registerBusy}
          >
            {registerBusy ? (
              <>
                <span className="spinner" aria-hidden="true" /> Creating…
              </>
            ) : (
              'Register'
            )}
          </button>
        </div>
      </form>
    );
  }

  return (
    <section>
      <Eyebrow>Restricted</Eyebrow>
      <h1>Sign in</h1>
      <p className="sub">
        Access to the admin console requires an authorised account. Privileged
        roles (OPERATOR, ADMIN) that have enrolled MFA are required to complete
        the second-factor step after entering their password.
      </p>

      {registeredEmail ? (
        <div className="form-success" role="status">
          <p>
            Account created for {registeredEmail}. Continue below to sign in.
          </p>
          <Badge tone="ok">Account created</Badge>
        </div>
      ) : null}

      {mfaPending ? (
        mfaStep()
      ) : (
        <>
          <div
            role="tablist"
            aria-label="Authentication method"
            className="tabs"
            // Arrow-key navigation between the two tabs (WAI-ARIA tabs pattern),
            // mirroring the public web AuthPanel. Focus moves with the selection;
            // the inactive tab is removed from the tab order.
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') {
                setTab('register');
                registerTabRef.current?.focus();
              } else if (event.key === 'ArrowLeft') {
                setTab('login');
                loginTabRef.current?.focus();
              }
            }}
          >
            <button
              type="button"
              role="tab"
              ref={loginTabRef}
              aria-selected={tab === 'login'}
              tabIndex={tab === 'login' ? 0 : -1}
              className={tab === 'login' ? 'tab tab--active' : 'tab'}
              onClick={() => setTab('login')}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              ref={registerTabRef}
              aria-selected={tab === 'register'}
              tabIndex={tab === 'register' ? 0 : -1}
              className={tab === 'register' ? 'tab tab--active' : 'tab'}
              onClick={() => setTab('register')}
            >
              Register
            </button>
          </div>
          {tab === 'login' ? loginForm() : registerForm()}
        </>
      )}
    </section>
  );
}
