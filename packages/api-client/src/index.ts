import type { Alert, Paginated } from '@sentravyn/shared-types';

/**
 * Typed REST client for the SENTRAVYN API.
 *
 * This is an information-and-preparedness platform. Every alert the client
 * returns carries a freshness label; the API, not the client, decides a
 * record is fresh/stale/expired (SAFETY-POLICY.md 8).
 */

export interface ListAlertsParams {
  page?: number;
  pageSize?: number;
  status?: string;
  verification?: string;
}

export interface SentravynRequestOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export class SentravynApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: SentravynRequestOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error(`SENTRAVYN API ${res.status}: ${path}`);
    }
    return (await res.json()) as T;
  }

  listAlerts(params: ListAlertsParams = {}): Promise<Paginated<Alert>> {
    const query = new URLSearchParams();
    if (params.page) query.set('page', String(params.page));
    if (params.pageSize) query.set('pageSize', String(params.pageSize));
    if (params.status) query.set('status', params.status);
    if (params.verification) query.set('verification', params.verification);
    const qs = query.toString();
    return this.getJson<Paginated<Alert>>(qs ? `/api/v1/alerts?${qs}` : '/api/v1/alerts');
  }

  getAlert(id: string): Promise<Alert> {
    return this.getJson<Alert>(`/api/v1/alerts/${encodeURIComponent(id)}`);
  }

  /**
   * API metadata and disclaimer. Surfaces must display this, since SENTRAVYN
   * is not an operational emergency service (README.md "Important").
   */
  meta(): Promise<{
    name: string;
    version: string;
    environment: string;
    disclaimer: string;
    safetyRules: string[];
  }> {
    return this.getJson('/api/v1/meta');
  }
}
