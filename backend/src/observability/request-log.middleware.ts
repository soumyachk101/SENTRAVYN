import { Logger, NestMiddleware, Optional } from '@nestjs/common';
import type { Request, Response } from 'express';
import { sanitizeQueryParams } from './query-scrub';
import type { TracingProvider } from './tracing.provider';

/**
 * Structured request-log middleware (SECURITY.md 4, 5, 7).
 *
 * For every HTTP request it records method, matched route, response status,
 * duration and — when OpenTelemetry tracing is enabled — the active trace
 * id, as a single-line JSON log entry. It also records one request span so
 * the collector has a root to hang downstream work on.
 *
 * SECURITY.md section 5 (location privacy): the query string is scrubbed of
 * precise-location keys before it is logged. The values are dropped
 * entirely; only a redaction count is recorded, never the location data.
 *
 * Zero-behaviour when tracing is disabled: the middleware still emits one
 * structured line per request but with no trace-id field and no span.
 */
export class RequestLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  /**
   * Optional so the middleware can never be a hard failure: Nest instantiates
   * route middleware through the module injector (the class is registered in
   * ObservabilityModule's providers), and a missing TracingProvider must
   * degrade to the zero-behaviour path — one structured line, no trace id —
   * rather than 500 the whole API (observability must not take the service
   * down).
   */
  constructor(
    @Optional() private readonly tracing: TracingProvider | undefined,
  ) {}

  use(req: Request, res: Response, next: (error?: unknown) => void): void {
    const startedAt = process.hrtime.bigint();
    // Start one span for the request when tracing is on; when it is off the
    // tracer is undefined and no span is recorded.
    const tracer = this.tracing?.activeTracer;
    const span = tracer ? tracer.startSpan('http.request') : undefined;

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

      // Route path: express sets req.route after matching; fall back to the
      // request path so an unmatched request still logs something sensible.
      const route = req.route?.path ?? req.path;

      // SECURITY.md 5: never write precise-location query values to logs.
      const originalUrl = req.originalUrl ?? req.url ?? '';
      const qIndex = originalUrl.indexOf('?');
      const rawQuery = qIndex === -1 ? '' : originalUrl.slice(qIndex + 1);

      const record = buildRequestLogRecord({
        method: req.method,
        route,
        // Express 5 types the status code as string | number; normalise.
        status: Number(res.statusCode),
        durationMs,
        ip: req.ip,
        rawQuery,
        traceId: span ? this.tracing?.traceIdOf(span) : undefined,
      });
      const statusCode = Number(record.status);
      if (span) {
        // OTel span status codes: 0 OK, 1 ERROR, 2 unknown/uncertain.
        span.setStatus({
          code: statusCode >= 500 ? 2 : statusCode >= 400 ? 1 : 0,
        });
        span.setAttribute('http.response.status_code', statusCode);
        span.end();
      }

      const line = JSON.stringify(record);
      if (statusCode >= 500) this.logger.warn(line);
      else this.logger.log(line);
    });

    next();
  }
}

/**
 * Pure log-line builder. Exported so the scrubbing behaviour (in
 * particular: location query params never reaching the emitted line) can be
 * unit-tested without a Nest app or an HTTP server.
 */
export function buildRequestLogRecord(input: {
  method: string;
  route: string;
  status: number;
  durationMs: number;
  ip?: string;
  rawQuery: string;
  traceId?: string;
}): Record<string, string | number> {
  const { query: safeQuery, redactedCount } = sanitizeQueryParams(
    input.rawQuery,
  );
  const record: Record<string, string | number> = {
    event: 'http.request',
    method: input.method,
    route: input.route,
    status: input.status,
    durationMs: Math.round(input.durationMs * 100) / 100,
    ip: redactIp(input.ip),
  };
  if (safeQuery.length > 0) record.query = safeQuery;
  if (input.traceId !== undefined) record.traceId = input.traceId;
  if (redactedCount > 0) {
    // A count only — never the scrubbed location values.
    record.locationParamsRedacted = String(redactedCount);
  }
  return record;
}

/**
 * Masks the host part of a client IP so the log carries the network segment
 * (useful for correlation and abuse triage) but never a full host address
 * (privacy minimisation, SECURITY.md 5). IPv4 keeps /16; IPv6 keeps /48.
 */
function redactIp(ip: string | undefined): string {
  if (!ip) return 'unknown';
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) return `${v4[1]}.${v4[2]}.*`;
  const v6 = ip.match(/^(?:[0-9a-fA-F]{1,4}:){4}[0-9a-fA-F:]*$/);
  if (v6) return `${ip.split(':').slice(0, 4).join(':')}::*`;
  return 'unknown';
}
