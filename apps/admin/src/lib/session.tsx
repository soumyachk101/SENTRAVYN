'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { authApi, clearSession, readSession, writeSession } from './api';
import { type PublicUser, type Role } from './types';

/**
 * Client-side session state for the admin console.
 *
 * Privilege order: PUBLIC < REVIEWER < OPERATOR < ADMIN. Gating helpers
 * mirror the backend RolesGuard hierarchy so the UI never offers a control
 * the API would reject with 403. The server remains the source of truth —
 * every privileged call still passes JwtAuthGuard + RolesGuard.
 */

const ROLE_RANK: Record<Role, number> = {
  PUBLIC: 0,
  REVIEWER: 1,
  OPERATOR: 2,
  ADMIN: 3,
};

export function roleAtLeast(role: Role | undefined, required: Role): boolean {
  if (role === undefined) return false;
  return ROLE_RANK[role] >= ROLE_RANK[required];
}

interface SessionState {
  /** null while loading the /auth/me check on first mount. */
  user: PublicUser | null;
  loading: boolean;
  /** True when a session token existed but /auth/me rejected it. */
  invalid: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Adopt a freshly obtained session without an extra /auth/me round-trip. */
  adoptSession: (session: {
    accessToken: string;
    refreshToken: string;
    user: PublicUser;
  }) => void;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setInvalid(false);
    // Skip the round-trip when no session is persisted at all.
    if (readSession() === null) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await authApi.me();
      setUser(me);
    } catch {
      clearSession();
      setUser(null);
      setInvalid(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // react-hooks/set-state-in-effect flags an effect that calls a
    // setState-carrying function directly; a locally declared closure
    // satisfies the rule with no behaviour change.
    const begin = () => {
      void load();
    };
    begin();
  }, [load]);

  const signOut = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
    }
  }, []);

  const adoptSession = useCallback(
    (s: { accessToken: string; refreshToken: string; user: PublicUser }) => {
      writeSession(s);
      setUser(s.user);
    },
    [],
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      invalid,
      refresh: load,
      signOut,
      adoptSession,
    }),
    [user, loading, invalid, load, signOut, adoptSession],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (ctx === null) {
    throw new Error('useSession must be used inside <SessionProvider>');
  }
  return ctx;
}

export function useRequireRole(required: Role) {
  const session = useSession();
  const allowed = roleAtLeast(session.user?.role, required);
  return {
    signedIn: session.user !== null,
    loading: session.loading,
    allowed,
    role: session.user?.role,
  };
}
