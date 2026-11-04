import type {
  AuthRegisterInput,
  AuthTokens,
  PublicUser,
} from '@sentravyn/shared-types';
import type { Requester } from './http';

/** Body for POST /auth/login (backend/src/auth/auth.controller.ts LoginDto). */
export interface LoginInput {
  /** Email, up to 320 chars; the API lowercases it. */
  email: string;
  /** 1-128 chars. */
  password: string;
}

/**
 * Auth endpoints (backend/src/auth/auth.controller.ts).
 *
 * The client is dependency-free and stores no tokens: the caller keeps the
 * refresh token and passes access tokens per request. `me` takes the stored
 * Bearer access token directly.
 */
export interface AuthClient {
  /**
   * POST /auth/register. Creates a PUBLIC account. Rejects 409 (email in
   * use) and 422 (schema violation).
   */
  register(input: AuthRegisterInput): Promise<PublicUser>;

  /**
   * POST /auth/login. Returns a fresh 15-minute access token plus a
   * 30-day refresh token. Rejects 401 for unknown account or wrong
   * password (same error text for both).
   */
  login(input: LoginInput): Promise<AuthTokens>;

  /**
   * POST /auth/refresh. Rotates the refresh token in place and returns a
   * new token pair. Rejects 401 for revoked, expired or unknown tokens
   * (indistinguishable on purpose).
   */
  refresh(refreshToken: string): Promise<AuthTokens>;

  /** POST /auth/logout. Revokes the backing session; idempotent, no body. */
  logout(refreshToken: string): Promise<void>;

  /** GET /auth/me. Current user for the supplied Bearer access token. */
  me(accessToken: string): Promise<PublicUser>;
}

export function createAuthClient(req: Requester): AuthClient {
  return {
    register: (input) =>
      // JSON.stringify drops the key when displayName is undefined, so the
      // forbidNonWhitelisted pipe never sees it.
      req.request<PublicUser>('POST', '/api/v1/auth/register', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: input.email,
          displayName: input.displayName,
          password: input.password,
        }),
      }),
    login: (input) =>
      req.request<AuthTokens>('POST', '/api/v1/auth/login', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
    refresh: (refreshToken) =>
      req.request<AuthTokens>('POST', '/api/v1/auth/refresh', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }),
    logout: (refreshToken) =>
      req.request<void>('POST', '/api/v1/auth/logout', {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      }),
    me: (accessToken) =>
      req.requestAuthed<PublicUser>('GET', '/api/v1/auth/me', accessToken),
  };
}
