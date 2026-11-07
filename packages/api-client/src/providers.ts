import type {
  CoverageView,
  ProviderUpsertInput,
  ProviderView,
  SeedResult,
} from '@sentravyn/shared-types';
import type { Requester } from './http';

/**
 * Body for POST /providers/seed (backend/src/providers/providers.dto.ts
 * ProvidersSeedDto). Omitting `providers` seeds the documented Phase 2
 * fixture providers instead.
 */
export interface ProvidersSeedInput {
  providers?: ProviderUpsertInput[];
}

/**
 * Data-provider registry endpoints (backend/src/providers/).
 *
 * GET /providers accepts any authenticated role; the mutating routes are
 * ADMIN-only and reject 403 for lesser roles. Access tokens are supplied
 * per call so the client stays token-agnostic.
 */
export interface ProvidersClient {
  /** GET /providers. Registry metadata only; no credential material. */
  list(accessToken: string): Promise<ProviderView[]>;

  /**
   * GET /coverage. Public, unauthenticated registry-derived disclosure
   * (Phase 10 section 1). No access token: this is the one read on the
   * providers surface that does not require auth, so it carries no token.
   * The landing/footer/terms read this to state real coverage; an
   * all-disabled registry is the `hasCoverage: false` "no coverage" state.
   */
  coverage(): Promise<CoverageView>;

  /** POST /providers. Upserts one provider by its stable key. */
  upsert(
    input: ProviderUpsertInput,
    accessToken: string,
  ): Promise<ProviderView>;

  /** POST /providers/seed. Idempotent: re-seeds without flipping enabled. */
  seed(
    input: ProvidersSeedInput | undefined,
    accessToken: string,
  ): Promise<SeedResult>;

  /**
   * Maps to PATCH /providers/:key/enable and :key/disable (the split-route
   * design keeps intent in the URL and the audit record).
   */
  setEnabled(
    key: string,
    enabled: boolean,
    accessToken: string,
  ): Promise<ProviderView>;
}

export function createProvidersClient(req: Requester): ProvidersClient {
  const upsertJson = (input: ProviderUpsertInput) => ({
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });

  return {
    list: (accessToken) =>
      req.requestAuthed<ProviderView[]>(
        'GET',
        '/api/v1/providers',
        accessToken,
      ),
    // GET /coverage is the public, unauthenticated read — it reuses the plain
    // `request` (no Bearer header), unlike the auth-gated registry routes.
    coverage: () => req.request<CoverageView>('GET', '/api/v1/coverage'),
    upsert: (input, accessToken) =>
      req.requestAuthed<ProviderView>(
        'POST',
        '/api/v1/providers',
        accessToken,
        upsertJson(input),
      ),
    seed: (input, accessToken) => {
      const rows = input?.providers;
      return req.requestAuthed<SeedResult>(
        'POST',
        '/api/v1/providers/seed',
        accessToken,
        {
          headers: { 'content-type': 'application/json' },
          // An omitted `providers` array means "seed the documented fixtures".
          body:
            rows === undefined
              ? undefined
              : JSON.stringify({ providers: rows }),
        },
      );
    },
    setEnabled: (key, enabled, accessToken) =>
      req.requestAuthed<ProviderView>(
        'PATCH',
        `/api/v1/providers/${encodeURIComponent(key)}/${enabled ? 'enable' : 'disable'}`,
        accessToken,
      ),
  };
}
