/**
 * Typed fetch client for the SENTRAVYN auth API (backend, /api/v1).
 *
 * Self-contained on purpose: the web app does not import @sentravyn/api-client
 * or @sentravyn/shared-types. The response types below mirror the auth
 * contract verbatim:
 *
 *   POST /auth/login    { email, password }        -> { accessToken, refreshToken, user }
 *   POST /auth/register { email, displayName?, password } -> 201 user
 *   POST /auth/refresh  { refreshToken }           -> new pair (old refresh invalidated)
 *   POST /auth/logout   { refreshToken }           -> revokes the backing session
 *   GET  /auth/me       (Bearer access token)      -> user; 401 when missing/invalid
 *
 * Session handling:
 * - The token pair is kept in localStorage.
 * - Authenticated requests attach the access token as a Bearer header.
 * - A 401 from an authenticated request triggers exactly one refresh +
 *   retry; when the refresh fails, the local session is cleared and the
 *   original error propagates.
 * - Refresh-token rotation is deduplicated: concurrent callers share a
 *   single in-flight request.
 */

export interface PublicUser {
  id: string;
  email: string;
  role: string;
  displayName: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  displayName?: string;
  password: string;
}

export class ApiError extends Error {
  /** HTTP status code, or 0 for network-level failures (API unreachable). */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const API_BASE_URL: string =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000/api/v1";

const ACCESS_TOKEN_KEY = "sentravyn.accessToken";
const REFRESH_TOKEN_KEY = "sentravyn.refreshToken";

interface StoredSession {
  accessToken: string | null;
  refreshToken: string | null;
}

export function getStoredSession(): StoredSession {
  if (typeof window === "undefined") {
    return { accessToken: null, refreshToken: null };
  }
  return {
    accessToken: window.localStorage.getItem(ACCESS_TOKEN_KEY),
    refreshToken: window.localStorage.getItem(REFRESH_TOKEN_KEY),
  };
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
}

function saveTokens(
  tokens: Pick<AuthTokens, "accessToken" | "refreshToken">,
): void {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  window.localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
}

interface RequestOptions {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  authToken?: string;
}

async function readApiError(response: Response): Promise<ApiError> {
  let message = `Request failed with status ${response.status}`;
  try {
    const text = await response.text();
    if (text.length > 0) {
      const parsed: unknown = JSON.parse(text);
      if (parsed !== null && typeof parsed === "object") {
        const body = parsed as { message?: string | string[] };
        if (typeof body.message === "string" && body.message.length > 0) {
          message = body.message;
        } else if (Array.isArray(body.message) && body.message.length > 0) {
          message = body.message.join("; ");
        }
      }
    }
  } catch {
    // Non-JSON error body: keep the HTTP-level fallback message.
  }
  return new ApiError(response.status, message);
}

export async function apiRequest<T>(options: RequestOptions): Promise<T> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (options.authToken !== undefined) {
    headers["Authorization"] = `Bearer ${options.authToken}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${options.path}`, {
      method: options.method,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    // fetch rejects (offline, DNS, CORS failure): the API is unreachable.
    throw new ApiError(0, "The SENTRAVYN API could not be reached.");
  }

  if (!response.ok) {
    throw await readApiError(response);
  }

  const text = await response.text();
  if (text.length === 0) {
    return undefined as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(response.status, "The API returned an unexpected response.");
  }
}

/* ----------------------------- endpoints ------------------------------ */

export async function login(request: LoginRequest): Promise<AuthTokens> {
  const tokens = await apiRequest<AuthTokens>({
    method: "POST",
    path: "/auth/login",
    body: request,
  });
  saveTokens(tokens);
  return tokens;
}

export async function register(request: RegisterRequest): Promise<PublicUser> {
  return apiRequest<PublicUser>({
    method: "POST",
    path: "/auth/register",
    body: request,
  });
}

/**
 * Revoke the session backing the stored refresh token, then clear local
 * storage. Returns true when the remote revocation succeeded (or there was
 * nothing to revoke); false when the API was unreachable, so the caller can
 * say the local sign-out was not mirrored on the server.
 */
export async function logout(): Promise<boolean> {
  const { refreshToken } = getStoredSession();
  if (refreshToken === null) {
    clearSession();
    return true;
  }
  let revoked = false;
  try {
    await apiRequest<unknown>({
      method: "POST",
      path: "/auth/logout",
      body: { refreshToken },
    });
    revoked = true;
  } catch {
    // Remote revocation failed (API unreachable or token already invalid).
    // The local session must not stay usable; the caller still signs out and
    // reports that the server was not reached.
  }
  clearSession();
  return revoked;
}

async function authenticatedRequest<T>(path: string): Promise<T> {
  const { accessToken } = getStoredSession();
  return apiRequest<T>({ method: "GET", path, authToken: accessToken ?? undefined });
}

export async function getMe(): Promise<PublicUser> {
  try {
    return await authenticatedRequest<PublicUser>("/auth/me");
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    // Exactly one refresh + retry; a second 401 propagates to the caller.
    const refreshed = await refreshStoredSession();
    if (refreshed === null) throw error;
    return authenticatedRequest<PublicUser>("/auth/me");
  }
}

let pendingRefresh: Promise<AuthTokens | null> | null = null;

/**
 * Rotate the stored refresh token. On success the new pair replaces the
 * stored one; on any failure the local session is cleared and null is
 * returned so callers can fall back to the signed-out state.
 */
export function refreshStoredSession(): Promise<AuthTokens | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const { refreshToken } = getStoredSession();
  if (refreshToken === null) return Promise.resolve(null);
  if (pendingRefresh === null) {
    pendingRefresh = rotateStoredSession(refreshToken).finally(() => {
      pendingRefresh = null;
    });
  }
  return pendingRefresh;
}

async function rotateStoredSession(
  refreshToken: string,
): Promise<AuthTokens | null> {
  try {
    const tokens = await apiRequest<AuthTokens>({
      method: "POST",
      path: "/auth/refresh",
      body: { refreshToken },
    });
    saveTokens(tokens);
    return tokens;
  } catch {
    clearSession();
    return null;
  }
}
