"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authApi } from "@/lib/api";
import { useSession } from "@/lib/session";
import {
  Badge,
  describeError,
  Eyebrow,
  Field,
} from "@/lib/ui";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Sign-in surface. Login + register tabs, inline validation, error and
 * loading states (CLAUDE.md rule 9-10). On success the token pair is
 * persisted to localStorage, the session context adopts it immediately,
 * and the user is returned to where they came from, or / when navigation
 * has no context.
 */
export default function LoginPage() {
  const router = useRouter();
  const pathname = usePathname();
  const session = useSession();
  const [tab, setTab] = useState<"login" | "register">("login");

  // Login form
  const [lEmail, setLEmail] = useState("");
  const [lPassword, setLPassword] = useState("");
  const [lErrors, setLErrors] = useState<{ email?: string; password?: string }>({});
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Register form
  const [rEmail, setREmail] = useState("");
  const [rName, setRName] = useState("");
  const [rPassword, setRPassword] = useState("");
  const [rErrors, setRErrors] = useState<{
    email?: string;
    name?: string;
    password?: string;
  }>({});
  const [registerBusy, setRegisterBusy] = useState(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);

  const redirect = (to: string) => {
    // Only return to admin paths; never to a foreign route.
    const target = to && to.startsWith("/") && !to.startsWith("/login") ? to : "/";
    router.replace(target);
  };

  function validateLogin(): boolean {
    const e: typeof lErrors = {};
    if (!EMAIL_RE.test(lEmail)) e.email = "Enter a valid email address.";
    if (lPassword.length === 0) e.password = "Enter your password.";
    setLErrors(e);
    return Object.keys(e).length === 0;
  }

  async function onLogin(ev: FormEvent) {
    ev.preventDefault();
    if (!validateLogin()) return;
    setLoginBusy(true);
    setLoginError(null);
    try {
      const res = await authApi.login({ email: lEmail, password: lPassword });
      session.adoptSession(res);
      redirect(pathname);
    } catch (err) {
      setLoginError(describeError(err));
      setLoginBusy(false);
    }
  }

  function validateRegister(): boolean {
    const e: typeof rErrors = {};
    if (!EMAIL_RE.test(rEmail)) e.email = "Enter a valid email address.";
    if (rName.length > 120) e.name = "Display name is limited to 120 characters.";
    if (rPassword.length < 12) e.password = "Password must be at least 12 characters.";
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
      setTab("login");
      setLEmail(user.email);
    } catch (err) {
      setRegisterError(describeError(err));
    } finally {
      setRegisterBusy(false);
    }
  }

  const inputClass = "input";
  const inputErrorClass = "input input--error";

  return (
    <section>
      <Eyebrow>Restricted</Eyebrow>
      <h1>Sign in</h1>
      <p className="sub">
        Access to the admin console requires an authorised account. Privileged
        roles (OPERATOR, ADMIN) are also subject to MFA at the account layer.
      </p>

      {registeredEmail ? (
        <div className="form-success" role="status">
          <p>
            Account created for {registeredEmail}. Continue below to sign in.
          </p>
          <Badge tone="ok">Account created</Badge>
        </div>
      ) : null}

      <div role="tablist" aria-label="Authentication method" className="tabs">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "login"}
          className={tab === "login" ? "tab tab--active" : "tab"}
          onClick={() => setTab("login")}
        >
          Sign in
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "register"}
          className={tab === "register" ? "tab tab--active" : "tab"}
          onClick={() => setTab("register")}
        >
          Register
        </button>
      </div>

      {tab === "login" ? (
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
              aria-describedby={lErrors.email ? "l-email-error" : undefined}
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
              aria-describedby={
                lErrors.password ? "l-password-error" : undefined
              }
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
                "Sign in"
              )}
            </button>
          </div>
        </form>
      ) : (
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
              aria-describedby={rErrors.email ? "r-email-error" : undefined}
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
              aria-describedby={rErrors.name ? "r-name-error" : undefined}
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
              aria-describedby={rErrors.password ? "r-password-error" : undefined}
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
                "Register"
              )}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
