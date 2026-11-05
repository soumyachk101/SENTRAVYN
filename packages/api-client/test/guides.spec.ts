import { SentravynApiClient } from '../src/index';

/**
 * Unit tests for the api-client guides methods (Phase 5).
 *
 * The client's request protocol accepts an injectable fetch, so these
 * assert the exact URL, method, auth header and body each method sends —
 * no network, no infrastructure. The DB-gated end-to-end assertions live
 * in backend/test/e2e/guides.e2e-spec.ts.
 */

interface CapturedCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/**
 * Builds a client whose fetch is captured, not executed. Every call the
 * client makes lands in `calls`; responses are a fixed 200 JSON envelope so
 * the methods resolve.
 */
function makeClient(calls: CapturedCall[]) {
  return new SentravynApiClient({
    baseUrl: 'http://api.test',
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        method: (init?.method as string) ?? 'GET',
        url: String(input).replace(/^http:\/\/api\.test/, ''),
        headers: (init?.headers as Record<string, string>) ?? {},
        body: typeof init?.body === 'string' ? init.body : undefined,
      });
      return new Response(JSON.stringify({ id: 'g-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as unknown as typeof fetch,
  });
}

describe('api-client guides methods', () => {
  it('guidesList sends the query params on the public GET, no auth header', async () => {
    const calls: CapturedCall[] = [];
    const client = makeClient(calls);
    await client.guidesList({
      hazardType: 'EARTHQUAKE',
      approval: 'PUBLISHED',
      language: 'en',
      stale: true,
      page: 2,
      pageSize: 25,
    });
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.method).toBe('GET');
    const url = new URL(call.url, 'http://api.test');
    expect(url.pathname).toBe('/api/v1/guides');
    expect(url.searchParams.get('hazardType')).toBe('EARTHQUAKE');
    expect(url.searchParams.get('approval')).toBe('PUBLISHED');
    expect(url.searchParams.get('language')).toBe('en');
    expect(url.searchParams.get('stale')).toBe('true');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('pageSize')).toBe('25');
    expect(call.headers).not.toHaveProperty('authorization');
  });

  it('guidesList with no params hits the bare path (no query string)', async () => {
    const calls: CapturedCall[] = [];
    const client = makeClient(calls);
    await client.guidesList();
    expect(calls[0].url).toBe('/api/v1/guides');
  });

  it('guidesOne percent-encodes the id and is public', async () => {
    const calls: CapturedCall[] = [];
    const client = makeClient(calls);
    await client.guidesOne('abc/def');
    expect(calls[0].url).toBe('/api/v1/guides/abc%2Fdef');
    expect(calls[0].headers).not.toHaveProperty('authorization');
  });

  it('guidesCreate POSTs the body to /admin/guides with the Bearer token', async () => {
    const calls: CapturedCall[] = [];
    const client = makeClient(calls);
    await client.guidesCreate(
      { hazardType: 'FLOOD', body: 'x', references: ['r'] },
      'token-abc',
    );
    const call = calls[0];
    expect(call.method).toBe('POST');
    expect(call.url).toBe('/api/v1/admin/guides');
    expect(call.headers.authorization).toBe('Bearer token-abc');
    expect(JSON.parse(call.body ?? '')).toMatchObject({
      hazardType: 'FLOOD',
      body: 'x',
      references: ['r'],
    });
  });

  it('guidesUpdate PATCHes /admin/guides/:id with the new revision', async () => {
    const calls: CapturedCall[] = [];
    const client = makeClient(calls);
    await client.guidesUpdate('g-1', { body: 'y' }, 'token-abc');
    const call = calls[0];
    expect(call.method).toBe('PATCH');
    expect(call.url).toBe('/api/v1/admin/guides/g-1');
    expect(call.headers.authorization).toBe('Bearer token-abc');
    expect(JSON.parse(call.body ?? '')).toEqual({ body: 'y' });
  });

  it.each([
    ['guidesReview', '/review'],
    ['guidesApprove', '/approve'],
    ['guidesPublish', '/publish'],
    ['guidesRetire', '/retire'],
    ['guidesReopen', '/reopen'],
  ] as const)(
    '%s POSTs to the %s sub-route with the Bearer token',
    async (method, subRoute) => {
      const calls: CapturedCall[] = [];
      const client = makeClient(calls);
      const input: Record<string, unknown> = { rationale: 'test' };
      switch (method) {
        case 'guidesReview':
          await client.guidesReview('g-1', input, 'token-abc');
          break;
        case 'guidesApprove':
          await client.guidesApprove('g-1', input, 'token-abc');
          break;
        case 'guidesPublish':
          await client.guidesPublish('g-1', input, 'token-abc');
          break;
        case 'guidesRetire':
          await client.guidesRetire('g-1', input, 'token-abc');
          break;
        case 'guidesReopen':
          await client.guidesReopen('g-1', 'token-abc');
          break;
      }
      const call = calls[0];
      expect(call.method).toBe('POST');
      expect(call.url).toBe(`/api/v1/admin/guides/g-1${subRoute}`);
      expect(call.headers.authorization).toBe('Bearer token-abc');
    },
  );

  it('admin methods send a JSON body with the content-type header', async () => {
    const calls: CapturedCall[] = [];
    const client = makeClient(calls);
    await client.guidesApprove('g-1', {}, 'token-abc');
    const call = calls[0];
    expect(call.headers['content-type']).toBe('application/json');
    expect(JSON.parse(call.body ?? '')).toEqual({});
  });
});
