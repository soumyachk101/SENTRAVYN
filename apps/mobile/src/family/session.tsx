import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { SentravynApiClient, ApiError } from '@sentravyn/api-client';

/**
 * App session (Phase 7 mobile). A minimal sign-in gate: the user enters an
 * existing SENTRAVYN account and we keep the access token in memory for the
 * family-safety calls.
 *
 * Privacy (SECURITY.md 5 / CLAUDE.md): the token is held in React state only
 * for the lifetime of the app process — it is NOT written to persistent
 * storage, NOT sent to analytics, and NOT logged. A real auth UX (local
 * token vault, refresh rotation) is a separate, out-of-scope concern; this
 * is the smallest thing that lets the family screens call the API honestly.
 */

const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

export type SessionState =
  | { status: 'signed-out' }
  | { status: 'loading' }
  | { status: 'signed-in'; accessToken: string; email: string }
  | { status: 'error'; message: string };

interface SessionValue {
  state: SessionState;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'signed-out' });

  const signIn = useCallback(async (email: string, password: string) => {
    setState({ status: 'loading' });
    try {
      const client = new SentravynApiClient({ baseUrl: API_BASE });
      const tokens = await client.authLogin({ email, password });
      setState({
        status: 'signed-in',
        accessToken: tokens.accessToken,
        email,
      });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? `Sign-in failed (HTTP ${err.status}).`
          : 'The API could not be reached.';
      setState({ status: 'error', message });
    }
  }, []);

  const signOut = useCallback(() => {
    setState({ status: 'signed-out' });
  }, []);

  const value = useMemo<SessionValue>(
    () => ({ state, signIn, signOut }),
    [state, signIn, signOut],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (ctx === null) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return ctx;
}
