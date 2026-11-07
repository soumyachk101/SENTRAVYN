import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { Inject, Optional } from '@nestjs/common';
import type { Request } from 'express';
import { SentryProvider } from './sentry.provider';

/**
 * Terminal exception filter (SECURITY.md 4, 7).
 *
 * Adds two things on top of Nest's default exception handling:
 *
 * 1. A structured error log line (method, path, status, message) for every
 *    thrown exception.
 * 2. Sentry capture of unexpected server errors (status >= 500) — but ONLY
 *    when Sentry is enabled (SENTRY_DSN set); the provider is a no-op
 *    otherwise.
 *
 * Response behaviour is byte-identical to a bare Nest app: after logging and
 * capture, the filter delegates to @nestjs/core's BaseExceptionFilter
 * (constructed with the application's HTTP adapter), which produces the
 * standard error bodies. Expected 4xx outcomes are NOT Sentry events — that
 * keeps the signal-to-noise ratio of error capture high. No request body,
 * cookie or precise-location material is logged (SECURITY.md 5).
 */
@Catch()
export class ObservabilityExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ObservabilityExceptionFilter.name);

  constructor(
    private readonly sentry: SentryProvider,
    @Optional()
    @Inject(HttpAdapterHost)
    private readonly adapterHost: HttpAdapterHost,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const req = host.switchToHttp().getRequest<Request>();
    const status =
      'getStatus' in (exception as object)
        ? (exception as { getStatus: () => number }).getStatus()
        : 500;

    const record: Record<string, string | number> = {
      event: 'http.error',
      method: req.method,
      path: req.originalUrl ?? req.url ?? '',
      status,
      message:
        exception instanceof Error ? exception.message : String(exception),
    };
    if (status >= 500 && exception instanceof Error && exception.stack) {
      // Internal log only — never part of the client response body.
      record.stack = exception.stack;
    }
    this.logger.error(JSON.stringify(record));

    // Unexpected server errors become Sentry events; handled 4xx outcomes do
    // not. captureError resolves immediately when Sentry is not enabled.
    if (status >= 500) {
      void this.sentry.captureError(exception);
    }

    // Delegate so the client sees exactly what the default Nest filter
    // would have sent. base is a no-op fallback if the adapter is missing
    // (it will still log; responses in that case are written by Nest's own
    // terminal handler).
    const base = new BaseExceptionFilter(this.adapterHost?.httpAdapter);
    base.catch(exception as never, host);
  }
}
