import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SENTRY_MODULE, SentryModuleSlice } from './observability.tokens';

/**
 * Sentry error-capture provider (SECURITY.md 4, 7).
 *
 * Env-gated: active only when SENTRY_DSN is set. The @sentry/node SDK is
 * loaded lazily inside onModuleInit, so with the DSN unset (local
 * development, CI) the module costs nothing: no SDK import, no HTTP
 * client, no network. captureError() is always a safe no-op when the SDK
 * has not been initialised.
 *
 * PII policy (SECURITY.md 5): sendDefaultPii is false; stack traces are
 * collected, request payloads and user PII are not.
 *
 * Testability: a test module may provide the SENTRY_MODULE token (a fake
 * SentryModuleSlice) so capture can be asserted without the real SDK;
 * otherwise the production path lazy-imports @sentry/node.
 */
@Injectable()
export class SentryProvider implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SentryProvider.name);
  private sdk: SentryModuleSlice | null = null;

  constructor(
    private readonly config: ConfigService,
    @Optional()
    @Inject(SENTRY_MODULE)
    private readonly sdkOverride: SentryModuleSlice | null,
  ) {}

  /** True when SENTRY_DSN is set and the SDK was successfully initialised. */
  get enabled(): boolean {
    return this.sdk !== null;
  }

  async onModuleInit(): Promise<void> {
    const dsn = (this.config.get<string>('SENTRY_DSN') ?? '').trim();
    if (dsn.length === 0) {
      // Zero-behaviour path: local/CI with SENTRY_DSN unset. No import of
      // the SDK package happens on this branch.
      this.logger.debug('SENTRY_DSN unset; error capture disabled.');
      return;
    }
    try {
      const environment =
        this.config.get<string>('APP_ENV') ??
        this.config.get<string>('NODE_ENV') ??
        'unknown';
      const options: Record<string, unknown> = {
        dsn,
        environment,
        sendDefaultPii: false,
        stackTraces: true,
        // Keep the SDK's own OTel tracer provider off so it never competes
        // with the explicit provider in TracingProvider; the SDK still
        // captures JS exceptions without OTel setup.
        enableOpenTelemetrySetup: false,
        // OTEL carries our spans; Sentry is the error-capture channel
        // (ARCHITECTURE.md 11), so disable its own tracing.
        enableTracing: false,
      };
      if (this.sdkOverride !== null) {
        this.sdkOverride.init(options);
        this.sdk = this.sdkOverride;
      } else {
        // Loaded lazily so the dependency has no import-time effect when
        // observability is not configured.
        const sentry = await import('@sentry/node');
        sentry.init(options as Parameters<typeof sentry.init>[0]);
        this.sdk = sentry as unknown as SentryModuleSlice;
      }
      this.logger.log(
        `Sentry error capture enabled (environment: ${environment})`,
      );
    } catch (error) {
      // Observability must never take the service down: degrade to no-op.
      this.sdk = null;
      this.logger.error(
        `Sentry initialisation failed; error capture disabled: ${String(error)}`,
      );
    }
  }

  /**
   * Captures an exception when Sentry is enabled; always resolves and never
   * throws. Callers may rely on this being a pure no-op when unset.
   */
  async captureError(error: unknown): Promise<void> {
    if (this.sdk === null) return;
    const exception =
      error instanceof Error
        ? error
        : new Error(typeof error === 'string' ? error : 'Uncaught exception');
    try {
      this.sdk.captureException(exception);
    } catch (captureError) {
      this.logger.warn(`Sentry capture skipped: ${String(captureError)}`);
    }
  }

  /** Flush and close the SDK on shutdown so queued events are not lost. */
  async onApplicationShutdown(): Promise<void> {
    if (this.sdk === null) return;
    try {
      await this.sdk.flush(2000);
      await this.sdk.close();
    } catch (error) {
      this.logger.warn(`Sentry shutdown flush failed: ${String(error)}`);
    }
  }
}
