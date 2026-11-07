import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OtelSpan,
  OtelTracer,
  TRACING_PROVIDER_FACTORY,
  TracerProviderFactory,
  TracerProviderSlice,
} from './observability.tokens';

/**
 * OpenTelemetry tracing provider (ARCHITECTURE.md 11, SECURITY.md 7).
 *
 * Env-gated: active only when OTEL_EXPORTER_OTLP_ENDPOINT is set. With the
 * endpoint unset (local development, CI) the provider is a zero-behaviour
 * no-op: no SDK import, no exporter, no global tracer registration, and
 * the tracer getter returns undefined so the request-log middleware omits
 * the trace-id field entirely and records no spans.
 *
 * The endpoint is normalised per the OTLP/HTTP spec: a bare collector base
 * URL gets "/v1/traces" appended; an explicit trace-signal path is kept.
 *
 * Testability: the tracer provider is produced by a factory (the
 * TRACING_PROVIDER_FACTORY token). The module registers the production
 * factory (lazy dynamic imports of the SDK packages); a test module injects
 * a fake factory to assert spans are produced without a collector.
 */
@Injectable()
export class TracingProvider implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TracingProvider.name);
  private provider: TracerProviderSlice | null = null;
  private tracer: OtelTracer | null = null;

  constructor(
    private readonly config: ConfigService,
    @Optional()
    @Inject(TRACING_PROVIDER_FACTORY)
    private readonly factory: TracerProviderFactory | null,
  ) {}

  /** True when OTEL_EXPORTER_OTLP_ENDPOINT is set and tracing started. */
  get enabled(): boolean {
    return this.provider !== null;
  }

  /** The live tracer, or undefined when tracing is disabled. */
  get activeTracer(): OtelTracer | undefined {
    return this.tracer ?? undefined;
  }

  /**
   * Trace id of the given span, or undefined. The request-log middleware
   * passes its per-request span; when tracing is off there is no span.
   */
  traceIdOf(span: OtelSpan | null | undefined): string | undefined {
    if (!span) return undefined;
    try {
      return span.spanContext().traceId;
    } catch {
      return undefined;
    }
  }

  async onModuleInit(): Promise<void> {
    const endpoint = (
      this.config.get<string>('OTEL_EXPORTER_OTLP_ENDPOINT') ?? ''
    ).trim();
    if (endpoint.length === 0) {
      // Zero-behaviour path: local/CI with the endpoint unset. No import of
      // any SDK package happens on this branch.
      this.logger.debug('OTEL_EXPORTER_OTLP_ENDPOINT unset; tracing disabled.');
      return;
    }

    const environment =
      this.config.get<string>('APP_ENV') ??
      this.config.get<string>('NODE_ENV') ??
      'unknown';
    const otlpUrl = withTraceSignalPath(endpoint);
    const serviceName =
      environment === 'production' ? 'sentravyn-api' : 'sentravyn-api-local';

    try {
      if (this.factory === null) {
        throw new Error(
          'no tracer factory available (endpoint set but factory missing)',
        );
      }
      // The production factory is async (lazy SDK imports); a test fake is
      // synchronous. Await handles both. The factory returns an already
      // registered provider plus a live tracer.
      const { provider, tracer } = await this.factory({
        otlpUrl,
        serviceName,
        environment,
      });
      this.provider = provider;
      this.tracer = tracer;
      this.logger.log(
        `OpenTelemetry tracing enabled (OTLP/HTTP endpoint: ${otlpUrl})`,
      );
    } catch (error) {
      // Observability must never take the service down: degrade to no-op.
      this.provider = null;
      this.tracer = null;
      this.logger.error(
        `OpenTelemetry initialisation failed; tracing disabled: ${String(error)}`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.provider === null) return;
    try {
      await this.provider.shutdown();
    } catch (error) {
      this.logger.warn(`OpenTelemetry shutdown flush failed: ${String(error)}`);
    }
    this.provider = null;
    this.tracer = null;
  }
}

/**
 * OTLP/HTTP endpoint normalisation: when the configured endpoint does not
 * already target the traces signal, the collector's default trace path
 * (/v1/traces) is appended.
 */
export function withTraceSignalPath(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  if (trimmed.endsWith('/traces')) return trimmed;
  return `${trimmed}/v1/traces`;
}
