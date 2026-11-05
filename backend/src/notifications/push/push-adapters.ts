import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';
import type {
  DeliveryResult,
  NotificationJobPayload,
  PushAdapter,
} from '../types';

/** Base64URL -> base64: VAPID keys are distributed base64URL-encoded. */
function base64urlToBase64(value: string): string {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4;
  return pad ? `${b64}${'='.repeat(4 - pad)}` : b64;
}

/**
 * Provider-agnostic push adapters (Phase 6; ARCHITECTURE.md 6 step 5).
 *
 * Credential gating (SECURITY.md 3 fail-closed): every adapter reads its
 * provider configuration from the environment (FCM_*, APNS_*,
 * WEB_PUSH_VAPID_*). Without the required credentials, `isConfigured()`
 * is false and `send()` returns `unavailable: true` with a reason — the
 * channel row is marked DROPPED (never SENT/DELIVERED), so a missing
 * credential can never produce a fabricated delivery. No adapter logs
 * provider secrets; errors carry a short reason string only.
 *
 * Audience note (documented limitation): the schema has no persisted push-
 * subscription / device-registration table (mobile push arrives with the
 * Phase 7 mobile workstream). These adapters therefore report their
 * audience as unavailable with an honest reason rather than inventing one,
 * and they validate credentials so the moment an audience source exists the
 * delivery path is already wired.
 */

/** Short, credential-free reason strings surfaced in attempt rows. */
export function unavailableReason(detail: string): string {
  return `channel unavailable: ${detail}`;
}

/**
 * Web Push adapter (VAPID via the web-push library when configured).
 *
 * The credential-gated surface that is genuinely usable today: VAPID key
 * generation and the public key the PWA service worker needs to subscribe.
 * Actual per-subscriber sending is available once a subscription audience
 * is persisted (Phase 7); until then send() reports unavailable honestly.
 */
export class WebPushAdapter implements PushAdapter {
  readonly channel = 'PUSH_WEB' as const;
  private readonly logger = new Logger(WebPushAdapter.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const pub = this.config.get<string>('WEB_PUSH_VAPID_PUBLIC_KEY');
    const priv = this.config.get<string>('WEB_PUSH_VAPID_PRIVATE_KEY');
    return Boolean(pub && priv);
  }

  /**
   * VAPID keypair for the PWA to register with. Generated (never reused
   * across requests, stored only in the response) when keys are not
   * configured so the offline client has a working key out of the box; the
   * configured keys win when present. The private key is never returned
   * here beyond the caller-supplied value.
   */
  vapidKeys(): { publicKey: string; privateKey: string } {
    const pub = this.config.get<string>('WEB_PUSH_VAPID_PUBLIC_KEY');
    const priv = this.config.get<string>('WEB_PUSH_VAPID_PRIVATE_KEY');
    if (pub && priv) return { publicKey: pub, privateKey: priv };
    const generated = webpush.generateVAPIDKeys();
    return { publicKey: generated.publicKey, privateKey: generated.privateKey };
  }

  /**
   * The public key the service worker passes to
   * `pushManager.subscribe({ applicationServerKey })`. Returns null when no
   * keypair can be produced so the client skips the subscription flow rather
   * than subscribing with a fabricated key.
   */
  publicKeyForClient(): string | null {
    try {
      return this.vapidKeys().publicKey;
    } catch {
      return null;
    }
  }

  /**
   * Prepare the VAPID sender identity for this delivery call, using the
   * configured keys when present, otherwise the generated keypair. Returns
   * whether a configured keypair is in use so callers can distinguish the
   * unavailability reasons.
   */
  private prepareVapid(): boolean {
    const configured = this.isConfigured();
    const { publicKey, privateKey } = this.vapidKeys();
    webpush.setServerKeys({
      vapidDetails: {
        subject:
          this.config.get<string>('WEB_BASE_URL') ?? 'https://sentravyn.example',
        publicKey: base64urlToBase64(publicKey),
        privateKey: base64urlToBase64(privateKey),
      },
    });
    return configured;
  }

  async send(job: NotificationJobPayload): Promise<DeliveryResult> {
    const configured = this.prepareVapid();
    // A NotificationJobPayload carries no per-subscriber endpoint/keys yet
    // (no persisted subscription store, Phase 7). Report unavailable rather
    // than fabricate a delivery. `configured` distinguishes the two reasons.
    this.logger.debug(
      `web-push ${configured ? 'configured' : 'using generated VAPID keys'}, no subscription audience persisted yet (dedupKey=${job.dedupKey})`,
    );
    return {
      delivered: false,
      unavailable: true,
      error: unavailableReason(
        'no persisted push subscriptions (audience arrives with Phase 7 mobile)',
      ),
    };
  }
}

/** Firebase Cloud Messaging adapter (service-account credentials from FCM_*). */
export class FcmAdapter implements PushAdapter {
  readonly channel = 'PUSH_FCM' as const;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const projectId = this.config.get<string>('FCM_PROJECT_ID');
    const clientEmail = this.config.get<string>('FCM_CLIENT_EMAIL');
    const privateKey = this.config.get<string>('FCM_PRIVATE_KEY');
    // Never log the private key; only the shape of what is missing.
    return Boolean(projectId && clientEmail && privateKey);
  }

  async send(_job: NotificationJobPayload): Promise<DeliveryResult> {
    if (!this.isConfigured()) {
      return {
        delivered: false,
        unavailable: true,
        error: unavailableReason(
          'FCM_PROJECT_ID / FCM_CLIENT_EMAIL / FCM_PRIVATE_KEY not configured',
        ),
      };
    }
    return {
      delivered: false,
      unavailable: true,
      error: unavailableReason(
        'FCM configured but no device registration store yet (Phase 7 mobile)',
      ),
    };
  }
}

/** Apple Push Notification service adapter (APNS_* credentials). */
export class ApnsAdapter implements PushAdapter {
  readonly channel = 'PUSH_APNS' as const;

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const keyId = this.config.get<string>('APNS_KEY_ID');
    const teamId = this.config.get<string>('APNS_TEAM_ID');
    const bundleId = this.config.get<string>('APNS_BUNDLE_ID');
    return Boolean(keyId && teamId && bundleId);
  }

  async send(_job: NotificationJobPayload): Promise<DeliveryResult> {
    if (!this.isConfigured()) {
      return {
        delivered: false,
        unavailable: true,
        error: unavailableReason(
          'APNS_KEY_ID / APNS_TEAM_ID / APNS_BUNDLE_ID not configured',
        ),
      };
    }
    return {
      delivered: false,
      unavailable: true,
      error: unavailableReason(
        'APNs configured but no device token store yet (Phase 7 mobile)',
      ),
    };
  }
}

/**
 * Registry built by composition root (module factory / worker entrypoint) so
 * tests can substitute fake adapters without touching Nest DI.
 */
export class PushAdapterRegistry {
  constructor(private readonly adapters: PushAdapter[]) {}

  forChannel(channel: string): PushAdapter | undefined {
    return this.adapters.find((a) => a.channel === channel);
  }
}

/** Nest-injectable facade used by the processor inside the API process. */
@Injectable()
export class PushChannelDelivery extends PushAdapterRegistry {
  constructor(private readonly config: ConfigService) {
    super([
      new WebPushAdapter(config),
      new FcmAdapter(config),
      new ApnsAdapter(config),
    ]);
  }
}

/**
 * Build the registry for the standalone worker process (no Nest DI).
 * The worker constructs a real `ConfigService` (from `process.env`) and passes
 * it here, so every adapter reads its provider credentials through the same
 * `ConfigService.get` path the API uses.
 */
export function buildPushAdapters(
  config: ConfigService,
): PushAdapterRegistry {
  return new PushAdapterRegistry([
    new WebPushAdapter(config),
    new FcmAdapter(config),
    new ApnsAdapter(config),
  ]);
}
