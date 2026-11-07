import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, HttpAdapterHost } from '@nestjs/core';
import {
  TRACING_PROVIDER_FACTORY,
  TracerFactoryInput,
  TracerFactoryResult,
} from './observability.tokens';
import { ObservabilityExceptionFilter } from './observability-exception.filter';
import { RequestLogMiddleware } from './request-log.middleware';
import { SentryProvider } from './sentry.provider';
import { TracingProvider } from './tracing.provider';

/**
 * Observability module (ARCHITECTURE.md 11; SECURITY.md 4, 5, 7).
 *
 * Imported by AppModule. Contributes:
 *
 *   - TracingProvider: OpenTelemetry spans to an OTLP/HTTP collector,
 *     active only when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 *   - SentryProvider: error capture, active only when SENTRY_DSN is set.
 *   - ObservabilityExceptionFilter (global APP_FILTER): structured error
 *     log + Sentry capture of unhandled 5xx; delegates response writing to
 *     Nest's base filter so client-visible responses are unchanged.
 *   - RequestLogMiddleware (application-wide via configure()): one
 *     structured log line per request — method, route, status, duration
 *     and trace id when tracing is enabled — with precise-location query
 *     params scrubbed before the line is written.
 *
 * Zero-behaviour guarantee: with both env vars unset (local dev, CI, tests)
 * no SDK is imported, no exporter or network client is created, and both
 * providers are inert; the middleware then emits one structured line per
 * request with no trace-id field and no spans.
 *
 * The tracer is built by the production factory below (lazy dynamic imports
 * of the @opentelemetry packages — no import-time cost when tracing is off).
 * A test module may override TRACING_PROVIDER_FACTORY / SENTRY_MODULE with
 * fakes to assert span production and capture without a collector or the
 * real SDK.
 */

/**
 * The real tracer factory. Registered under the TRACING_PROVIDER_FACTORY
 * token; invoked (and awaited) by TracingProvider only when the endpoint is
 * set, so the zero-behaviour path never loads the SDK packages.
 */
export async function buildRealTracer(
  input: TracerFactoryInput,
): Promise<TracerFactoryResult> {
  const [api, sdkTrace, exporter, resources] = await Promise.all([
    import('@opentelemetry/api'),
    import('@opentelemetry/sdk-trace-base'),
    import('@opentelemetry/exporter-trace-otlp-http'),
    import('@opentelemetry/resources'),
  ]);
  // Resource attribute keys per the OTel semantic conventions. In the
  // installed @opentelemetry/resources 2.x there is no Resource constructor;
  // resources are built with resourceFromAttributes.
  const resource = resources.resourceFromAttributes({
    'service.name': input.serviceName,
    'deployment.environment.name': input.environment,
  });
  // OTEL 2.x: span processors are passed via the constructor options (the
  // 1.x addSpanProcessor/register methods no longer exist).
  const tracerProvider = new sdkTrace.BasicTracerProvider({
    resource,
    spanProcessors: [
      new sdkTrace.BatchSpanProcessor(
        new exporter.OTLPTraceExporter({
          url: input.otlpUrl,
          timeoutMillis: 5000,
        }),
      ),
    ],
  });
  // Set this provider as the global tracer so the tracer obtained from the
  // api module afterwards produces real spans (the unregistered global
  // proxy would return no-op spans).
  api.trace.setGlobalTracerProvider(tracerProvider);
  const tracer = api.trace.getTracer('sentravyn-api');
  return {
    provider: tracerProvider,
    register: () => {
      api.trace.setGlobalTracerProvider(tracerProvider);
    },
    tracer,
  };
}

@Module({
  providers: [
    TracingProvider,
    SentryProvider,
    // Registered as a provider so Nest instantiates the middleware through
    // the module injector and can inject TracingProvider into it. `configure`
    // applies the class to routes; the instance used is this one.
    RequestLogMiddleware,
    {
      provide: TRACING_PROVIDER_FACTORY,
      useValue: buildRealTracer,
    },
    {
      provide: APP_FILTER,
      useFactory: (sentry: SentryProvider, adapterHost: HttpAdapterHost) =>
        new ObservabilityExceptionFilter(sentry, adapterHost),
      inject: [SentryProvider, HttpAdapterHost],
    },
  ],
  exports: [TracingProvider, SentryProvider],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Nest applies a module's `forRoutes('*')` middleware to every route in
    // the router (all modules' controllers); only the middleware instance's
    // dependency resolution is module-scoped, and TracingProvider is a
    // provider of this module. Health probes are excluded: they fire
    // constantly and would dominate the request log.
    consumer
      .apply(RequestLogMiddleware)
      .exclude('health', 'health/*')
      .forRoutes('*');
  }
}
