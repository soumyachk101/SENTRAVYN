import {
  ApiError,
  type AuditEvent,
  type AuditQuery,
  type AuthTokenPair,
  type DecideInput,
  type DecideResult,
  type PlaceQueueItem,
  type AlertQueueItem,
  type ProviderUpsertInput,
  type ProviderView,
  type PublicUser,
  type QueueKind,
  type SeedResult,
} from "./types";

/**
 * Minimal typed fetch client for the SENTRAVYN admin API (Phase 2).
 *
 * - baseUrl: NEXT_PUBLIC_API_BASE_URL, default http://localhost:4000/api/v1.
 * - Stores the { accessToken, refreshToken, user } session in localStorage
 *   and attaches `Authorization: Bearer <accessToken>`.
 * - On 401: attempts exactly ONE refresh-and-retry (POST /auth/refresh,
 *   which rotates and invalidates the old refresh token). If that fails or
 *   the retried request 401s again, the session is cleared and the ApiError
 *   propagates.
 * - Never silently swallows API errors; callers surface them verbatim.
 */

const BASE_URL =
  (typeof process !== "undefined" &&
    process.env.NEXT_PUBLIC_API_BASE_URL) ||
  "http://localhost:4000/api/v1";

const SESSION_KEY = "sentravyn-admin-session";

export interface Session {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

/** Reads the persisted session. SSR-safe (returns null on the server). */
export function readSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      "accessToken" in parsed &&
      "refreshToken" in parsed &&
      "user" in parsed
    ) {
      const s = parsed as {
        accessToken: unknown;
        refreshToken: unknown;
        user: unknown;
      };
      if (
        typeof s.accessToken === "string" &&
        typeof s.refreshToken === "string" &&
        s.user &&
        typeof s.user === "object"
      ) {
        const user = s.user as Partial<PublicUser>;
        if (
          typeof user.id === "string" &&
          typeof user.email === "string" &&
          typeof user.role === "string"
        ) {
          return {
            accessToken: s.accessToken,
            refreshToken: s.refreshToken,
            user: {
              id: user.id,
              email: user.email,
              role: user.role as PublicUser["role"],
              displayName:
                typeof user.displayName === "string"
                  ? user.displayName
                  : null,
            },
          };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function writeSession(session: Session): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_KEY);
}

interface RequestOptions {
  /** Session already refreshed; do not attempt another refresh on 401. */
  noRetry?: boolean;
}

async function parseError(res: Response): Promise<ApiError> {
  let body = "";
  try {
    body = (await res.text()) || "";
  } catch {
    body = "";
  }
  // NestJS error bodies: { message: ... } or a bare string. Prefer the
  // server message when present; fall back to the raw body otherwise.
  let message = body;
  try {
    const json: unknown = JSON.parse(body);
    if (json && typeof json === "object" && "message" in json) {
      const m = (json as { message: unknown }).message;
      message = Array.isArray(m) ? m.join("; ") : String(m);
    }
  } catch {
    // Not JSON; keep the raw body.
  }
  return new ApiError(res.status, message, body);
}

async function rawRequest(
  method: "GET" | "POST" | "PATCH",
  path: string,
  init: { body?: unknown; token?: string | null } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.token) headers.Authorization = `Bearer ${init.token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    // Network failure (offline, unreachable, CORS) — not an API error.
    throw new ApiError(0, "The API is unreachable. Check your connection.", "");
  }
  return res;
}

function refreshFromStoredRefreshToken(
  refreshToken: string,
): Promise<AuthTokenPair> {
  return request<AuthTokenPair>(
    "POST",
    "/auth/refresh",
    { refreshToken },
    { noRetry: true },
  );
}

/**
 * Authenticated request with exactly one refresh-and-retry on 401.
 * The retried request is never retried again.
 */
async function request<T>(
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const session = readSession();
  const res = await rawRequest(method, path, {
    body,
    token: session?.accessToken ?? null,
  });

  if (!res.ok) {
    if (res.status === 401 && !opts.noRetry && session) {
      try {
        const refreshed = await refreshFromStoredRefreshToken(
          session.refreshToken,
        );
        writeSession({
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          user: refreshed.user,
        });
      } catch {
        clearSession();
        throw new ApiError(401, "Session expired. Please sign in again.", "");
      }
      // Exactly one retry, with the fresh access token.
      const retried = await rawRequest(method, path, {
        body,
        token: readSession()?.accessToken ?? null,
      });
      if (retried.ok) {
        return (await retried.json()) as T;
      }
      clearSession();
      throw await parseError(retried);
    }
    throw await parseError(res);
  }

  if (res.status === 204) return undefined as T;
  // Some NestJS endpoints may return an empty body; only parse when there
  // is something to parse.
  const text = await res.text();
  if (text === "") return undefined as T;
  return JSON.parse(text) as T;
}

/* ------------------------------------------------------------------ */
/* Auth */
/* ------------------------------------------------------------------ */

export interface RegisterInput {
  email: string;
  displayName?: string;
  /** Minimum 12 characters (enforced client- and server-side). */
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export const authApi = {
  /**
   * 201 on success; 409 when the email is already registered.
   * NOTE: the backend returns only the public user, not a token pair —
   * the caller is directed to the sign-in tab after registration.
   */
  register(input: RegisterInput): Promise<PublicUser> {
    return request<PublicUser>("POST", "/auth/register", input, {
      noRetry: true,
    });
  },

  login(input: LoginInput): Promise<AuthTokenPair> {
    return request<AuthTokenPair>("POST", "/auth/login", input, {
      noRetry: true,
    });
  },

  /** Revalidates the current session and returns the fresh user. */
  me(): Promise<PublicUser> {
    return request<PublicUser>("GET", "/auth/me");
  },

  logout(): Promise<void> {
    const session = readSession();
    if (!session) {
      clearSession();
      return Promise.resolve();
    }
    // noRetry: an expired access token must not trigger a refresh that the
    // caller is about to invalidate anyway. The local session ends either way.
    return request<void>(
      "POST",
      "/auth/logout",
      { refreshToken: session.refreshToken },
      { noRetry: true },
    ).catch(() => {
      // A revoked/invalid refresh token must still end the local session.
      clearSession();
    });
  },
};

/* ------------------------------------------------------------------ */
/* Providers */
/* ------------------------------------------------------------------ */

export const providersApi = {
  list(): Promise<ProviderView[]> {
    return request<ProviderView[]>("GET", "/providers");
  },

  upsert(input: ProviderUpsertInput): Promise<ProviderView> {
    return request<ProviderView>("POST", "/providers", input);
  },

  seed(providers?: ProviderUpsertInput[]): Promise<SeedResult> {
    return request<SeedResult>(
      "POST",
      "/providers/seed",
      providers ? { providers } : undefined,
    );
  },

  setEnabled(key: string, enabled: boolean): Promise<ProviderView> {
    const path = enabled ? `/providers/${key}/enable` : `/providers/${key}/disable`;
    return request<ProviderView>("PATCH", path);
  },
};

/* ------------------------------------------------------------------ */
/* Admin review */
/* ------------------------------------------------------------------ */

export const reviewApi = {
  queue(kind: QueueKind): Promise<AlertQueueItem[] | PlaceQueueItem[]> {
    return request<AlertQueueItem[] | PlaceQueueItem[]>(
      "GET",
      `/admin/review/queue?kind=${encodeURIComponent(kind)}`,
    );
  },

  decide(input: DecideInput): Promise<DecideResult> {
    return request<DecideResult>("POST", "/admin/review/decide", input);
  },
};

export function isPlaceQueue(
  items: AlertQueueItem[] | PlaceQueueItem[],
): items is PlaceQueueItem[] {
  return items.length > 0 && "place" in items[0];
}

/* ------------------------------------------------------------------ */
/* Audit */
/* ------------------------------------------------------------------ */

export const auditApi = {
  list(query: AuditQuery = {}): Promise<AuditEvent[]> {
    const params = new URLSearchParams();
    if (query.limit !== undefined) {
      params.set("limit", String(query.limit));
    }
    if (query.entity) {
      params.set("entity", query.entity);
    }
    const qs = params.toString();
    return request<AuditEvent[]>(
      "GET",
      `/admin/audit${qs ? `?${qs}` : ""}`,
    );
  },
};
