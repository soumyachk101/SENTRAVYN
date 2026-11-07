import { ApiError } from './api-error';

/**
 * Construction options shared by the typed client modules: a base URL and
 * an injectable fetch (for tests). The client is dependency-free and
 * defaults to the global fetch; it targets browser + PWA runtimes
 * (standard fetch/URLSearchParams globals only).
 */
export interface SentravynRequestOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

/**
 * Per-request options used by the client modules. `headers` is a plain
 * record: none of the endpoints use multi-value headers, so the client
 * never needs a Headers instance.
 */
export interface RequestOptions {
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Request protocol shared by the Phase 2 client modules (auth, providers,
 * audit, review). Non-2xx responses reject with ApiError carrying the
 * status and parsed body; network failures reject with the fetch error.
 */
export interface Requester {
  request<T>(method: string, path: string, init?: RequestOptions): Promise<T>;
  requestAuthed<T>(
    method: string,
    path: string,
    accessToken: string,
    init?: RequestOptions,
  ): Promise<T>;
}

/**
 * Builds the shared request protocol. Empty 2xx bodies (e.g. logout)
 * resolve to undefined rather than a JSON parse failure.
 */
export function createRequester(options: SentravynRequestOptions): Requester {
  const baseUrl = options.baseUrl.replace(/\/$/, '');
  const fetchImpl = options.fetchImpl ?? fetch;

  async function request<T>(
    method: string,
    path: string,
    init: RequestOptions = {},
  ): Promise<T> {
    const res = await fetchImpl(`${baseUrl}${path}`, {
      ...init,
      method,
      cache: 'no-store',
    });

    if (res.ok) {
      const text = await res.text();
      if (text === '') {
        return undefined as unknown as T;
      }
      return JSON.parse(text) as T;
    }

    const isJson = res.headers
      .get('content-type')
      ?.includes('application/json');
    const body: unknown = isJson
      ? (JSON.parse(await res.text()) as unknown)
      : await res.text();
    throw new ApiError(res.status, path, body);
  }

  function requestAuthed<T>(
    method: string,
    path: string,
    accessToken: string,
    init: RequestOptions = {},
  ): Promise<T> {
    return request<T>(method, path, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${accessToken}`,
      },
    });
  }

  return { request, requestAuthed };
}
