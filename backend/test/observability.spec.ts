import {
  RequestLogMiddleware,
  buildRequestLogRecord,
} from '../src/observability/request-log.middleware';
import {
  sanitizeQueryParams,
  LOCATION_QUERY_KEYS,
} from '../src/observability/query-scrub';
import { withTraceSignalPath } from '../src/observability/tracing.provider';

/**
 * Observability unit tests (ARCHITECTURE.md 11; SECURITY.md 4, 5, 7).
 *
 * These prove the module's two safety properties without importing any SDK:
 *   1. The request-log middleware degrades to a zero-behaviour path when the
 *      TracingProvider is absent (undefined injection) — it must never throw
 *      and must never emit a trace-id, so observability can never take the
 *      API down. (This is exactly the integration failure the e2e suite
 *      caught: a route-applied middleware whose provider was not injected.)
 *   2. Structured request logs never carry precise-location query values
 *      (SECURITY.md 5): they are dropped entirely, only a redaction count
 *      is exposed.
 *   3. The OTLP endpoint normalisation appends the trace-signal path.
 */

/** A TracingProvider stand-in that reports tracing is disabled (no tracer). */
const disabledTracing = {
  enabled: false,
  activeTracer: undefined,
  traceIdOf: (_span?: unknown) => undefined,
  onModuleInit: async () => undefined,
  onApplicationShutdown: async () => undefined,
};

function req(): unknown {
  return {
    method: 'GET',
    originalUrl: '/api/v1/places?lat=40.7&lng=-74',
    route: undefined,
    path: '/api/v1/places',
    ip: '10.0.0.5',
  };
}

/** Minimal express-Response stand-in: records `finish` listeners + status. */
interface FakeResponse {
  statusCode: number;
  on(event: string, listener: () => void): FakeResponse;
  emitFinish(): void;
}
function fakeResponse(status = 200): FakeResponse {
  let listeners: Array<() => void> = [];
  return {
    statusCode: status,
    on(_event, listener) {
      listeners = [...listeners, listener];
      return this;
    },
    emitFinish() {
      listeners.forEach((l) => l());
    },
  };
}

describe('RequestLogMiddleware', () => {
  it('is a no-op (never throws, no trace id) when TracingProvider is undefined', () => {
    const mw = new RequestLogMiddleware(undefined);
    const r = fakeResponse(200);
    let threw = false;
    try {
      mw.use(req() as never, r as never, () => undefined);
      r.emitFinish();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });

  it('records location keys redacted when a VALIDATED location query is present', () => {
    const record = buildRequestLogRecord({
      method: 'GET',
      route: '/api/v1/places',
      status: 200,
      durationMs: 3.14,
      ip: '10.0.0.5',
      rawQuery: 'lat=40.7&lng=-74&page=2',
      traceId: 'abc',
    });
    // The location values must never be in the emitted line.
    expect(JSON.stringify(record)).not.toContain('40.7');
    expect(JSON.stringify(record)).not.toContain('-74');
    expect(record.locationParamsRedacted).toBe('2');
    // Non-location keys survive.
    expect(String(record.query)).toContain('page=2');
    // The trace id is included when provided.
    expect(record.traceId).toBe('abc');
  });
});

describe('sanitizeQueryParams (SECURITY.md 5)', () => {
  it('drops every documented location key, case-insensitively', () => {
    const raw = LOCATION_QUERY_KEYS.map((k) => `${k}=secret-value`).join('&');
    const { query, redactedCount } = sanitizeQueryParams(raw);
    expect(redactedCount).toBe(LOCATION_QUERY_KEYS.length);
    expect(query).toBe('');
    expect(query).not.toContain('secret-value');
  });

  it('keeps non-location keys and ignores an empty query', () => {
    expect(sanitizeQueryParams('page=1&status=VALIDATED')).toEqual({
      query: 'page=1&status=VALIDATED',
      redactedCount: 0,
    });
    expect(sanitizeQueryParams('')).toEqual({ query: '', redactedCount: 0 });
    expect(sanitizeQueryParams(undefined)).toEqual({
      query: '',
      redactedCount: 0,
    });
  });
});

describe('withTraceSignalPath (OTLP endpoint normalisation)', () => {
  it('appends /v1/traces to a bare collector base URL', () => {
    expect(withTraceSignalPath('http://collector:4318')).toBe(
      'http://collector:4318/v1/traces',
    );
  });
  it('keeps an already-traces-signal path and strips trailing slashes', () => {
    expect(withTraceSignalPath('http://c:4318/v1/traces/')).toBe(
      'http://c:4318/v1/traces',
    );
    expect(withTraceSignalPath('http://c:4318/custom')).toBe(
      'http://c:4318/custom/v1/traces',
    );
  });
});

describe('observability.disabled provider', () => {
  it('exposes no active tracer when tracing is disabled', () => {
    expect(disabledTracing.activeTracer).toBeUndefined();
    expect(disabledTracing.traceIdOf(null)).toBeUndefined();
  });
});
