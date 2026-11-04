/**
 * Carries the HTTP status and the parsed response body of a failed API
 * call. The client rejects 401/403/409/422 (and any other non-2xx) with
 * an ApiError; network failures reject with the underlying fetch error
 * (a TypeError), so callers can distinguish the two classes of failure.
 */
export class ApiError extends Error {
  /** HTTP status code of the failed response. */
  readonly status: number;
  /**
   * The response body: parsed JSON when the response was JSON, otherwise
   * the raw text. Parsed bodies let callers inspect validation errors
   * (422) without re-fetching.
   */
  readonly body: unknown;

  constructor(status: number, path: string, body: unknown) {
    super(`SENTRAVYN API ${status}: ${path}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}
