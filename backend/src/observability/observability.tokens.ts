/**
 * Dependency-injection tokens + structural types for the observability
 * module. They let a test module substitute a fake tracer factory / fake
 * Sentry slice without touching the network or importing the real SDKs.
 *
 * Production wires the real implementations (lazy dynamic imports of the
 * @opentelemetry and @sentry packages — no import-time cost when disabled).
 * When the observability env vars are unset nothing is built and every
 * consumer degrades to a no-op, so these tokens carry no default value.
 *
 * Tokens are plain string literals: @nestjs/common v11 exports
 * `InjectionToken` as a type only, so class-boundary injection tokens are
 * declared as string constants (the same pattern Nest's own APP_* tokens
 * use under the hood).
 */

/** Minimal structural span: enough to name, attribute, record and close. */
export interface OtelSpan {
  spanContext(): { traceId: string; spanId: string };
  setStatus(status: { code: number; message?: string }): void;
  updateName(name: string): void;
  setAttribute(key: string, value: unknown): void;
  end(endTime?: number): void;
}

/** Minimal structural tracer (one method used by the request middleware). */
export interface OtelTracer {
  startSpan(name: string, options?: unknown): OtelSpan;
}

/**
 * The tracer-provider half a factory builds. In OTel 2.x the provider takes
 * its span processors via constructor options (there is no
 * addSpanProcessor/register method), and global registration is
 * `trace.setGlobalTracerProvider(provider)`, so the slice only needs the
 * provider's public surface plus a working tracer.
 */
export interface TracerProviderSlice {
  shutdown(): Promise<unknown>;
  getTracer(name: string, version?: string): OtelTracer;
}

export interface TracerFactoryInput {
  otlpUrl: string;
  serviceName: string;
  environment: string;
}

export interface TracerFactoryResult {
  /** The tracer provider, shut down on application stop. */
  provider: TracerProviderSlice;
  /** Register the provider as the global tracer provider. */
  register(): void;
  /** A live tracer whose spans are real, not the unregistered proxy. */
  tracer: OtelTracer;
}

/**
 * A tracer-provider factory: builds the provider (exporter + batch
 * processor + resource) and returns a working tracer. May be async (the
 * production implementation lazy-imports the SDK packages); tests inject a
 * synchronous fake to assert span production without a collector.
 */
export type TracerProviderFactory = (
  input: TracerFactoryInput,
) => TracerFactoryResult | Promise<TracerFactoryResult>;

export const TRACING_PROVIDER_FACTORY = 'TRACING_PROVIDER_FACTORY' as const;

/**
 * A fake Sentry module namespace, typed structurally (init / capture /
 * flush / close) so a test can assert capture was attempted without
 * loading the real SDK.
 */
export interface SentryModuleSlice {
  init(options: unknown): void;
  captureException(err: unknown): void;
  flush(timeoutMs?: number): Promise<unknown>;
  close(): Promise<unknown>;
}

export const SENTRY_MODULE = 'SENTRY_MODULE' as const;
