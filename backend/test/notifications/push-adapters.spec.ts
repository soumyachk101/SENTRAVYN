import { ConfigService } from '@nestjs/config';
import {
  WebPushAdapter,
  FcmAdapter,
  ApnsAdapter,
  buildPushAdapters,
} from '../../src/notifications/push/push-adapters';
import type {
  DeliveryResult,
  NotificationJobPayload,
} from '../../src/notifications/types';

/**
 * Regression spec for the push adapters (Phase 6) — specifically the defect
 * that made the notification worker dead-letter 100% of jobs:
 *
 *   WebPushAdapter.prepareVapid() called web-push@5's `setServerKeys({...})`,
 *   but the repo pins web-push@3.6.7, which exports `setVapidDetails(subject,
 *   pub, priv)`. prepareVapid() runs unconditionally at the top of send(), so
 *   every PUSH_WEB delivery threw "setServerKeys is not a function"; the
 *   processor's `await adapter.send()` propagated the throw, BullMQ retried,
 *   and every notification job dead-lettered instead of reaching its honest
 *   DROPPED (unavailable) terminal state.
 *
 * These tests pin the contract that must hold: an adapter NEVER throws out of
 * send() for a configuration problem — it reports `unavailable: true`
 * (ARCHITECTURE.md 6 step 5, SECURITY.md 3 fail-closed: a missing credential
 * or audience must read as "not delivered", never a fabricated delivery and
 * never an unhandled crash). No DB or Redis required.
 */

function job(
  overrides: Partial<NotificationJobPayload> = {},
): NotificationJobPayload {
  return {
    alertId: 'al-1',
    nextStatus: 'PUBLISHED',
    dedupKey: 'alert:al-1:PUBLISHED',
    headline: 'Flood warning',
    severity: 'Severe',
    urgency: 'Immediate',
    issuer: 'Test Authority',
    channels: ['PUSH_WEB'],
    issuedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function configOf(
  vars: Record<string, string | undefined> = {},
): ConfigService {
  return new ConfigService(vars);
}

describe('WebPushAdapter (web-push@3.6.7 API contract)', () => {
  it('send() returns unavailable (DROPPED-eligible) and does NOT throw when no VAPID is configured', async () => {
    const adapter = new WebPushAdapter(configOf({}));
    expect(adapter.isConfigured()).toBe(false);

    // This is the exact line that used to throw `setServerKeys is not a
    // function`. It must now resolve to an honest unavailable result.
    const result: DeliveryResult = await adapter.send(job());

    expect(result.delivered).toBe(false);
    expect(result.unavailable).toBe(true);
    expect(result.error).toMatch(/no persisted push subscriptions/i);
  });

  it('send() does NOT throw when VAPID keys ARE configured (base64url form the 3.x API expects)', async () => {
    // A real 32-byte ECDSA private key + 65-byte public key in base64url, the
    // same shape `generateVAPIDKeys()` produces — the exact inputs the
    // adapter's `vapidKeys()` returns.
    const pub =
      'BDWU9wfrh217sOFTFRXeiMPYck--oFhJJ2rXAeY3Ge2akrZWH7n6TV8h65vHsOt9DvgyfSEPeB7KZICk_ED_-_g';
    const priv = '-9XjaObyfYPoSL18DjP_6k8FG5Jw5O7ICehMNB8IrIo';
    const adapter = new WebPushAdapter(
      configOf({
        WEB_PUSH_VAPID_PUBLIC_KEY: pub,
        WEB_PUSH_VAPID_PRIVATE_KEY: priv,
        WEB_BASE_URL: 'https://example.com',
      }),
    );
    expect(adapter.isConfigured()).toBe(true);

    // Resolving (not throwing) is the regression: the configured keypair now
    // flows through web-push@3's setVapidDetails(subject, pub, priv).
    const result: DeliveryResult = await adapter.send(job());
    expect(result.delivered).toBe(false);
    expect(result.unavailable).toBe(true);
    // Still no persisted audience -> unavailable, but the VAPID setup did not
    // crash the pipeline.
    expect(result.error).toMatch(/no persisted push subscriptions/i);
  });

  it('publicKeyForClient() returns a key from the generated pair, never null when generation works', () => {
    const adapter = new WebPushAdapter(configOf({}));
    const key = adapter.publicKeyForClient();
    expect(typeof key).toBe('string');
    expect(key!.length).toBeGreaterThan(0);
  });
});

describe('FcmAdapter + ApnsAdapter (credential-gated, never throw)', () => {
  it('FCM send() is unavailable without credentials and does not throw', async () => {
    const adapter = new FcmAdapter(configOf({}));
    const r = await adapter.send(job());
    expect(r.unavailable).toBe(true);
    expect(r.delivered).toBe(false);
    expect(r.error).toMatch(/FCM_.* not configured/i);
  });

  it('FCM send() reports configured-but-no-audience as unavailable, not delivered', async () => {
    const adapter = new FcmAdapter(
      configOf({
        FCM_PROJECT_ID: 'proj',
        FCM_CLIENT_EMAIL: 'svc@proj.iam.gserviceaccount.com',
        FCM_PRIVATE_KEY: 'fake-key-material',
      }),
    );
    expect(adapter.isConfigured()).toBe(true);
    const r = await adapter.send(job());
    expect(r.delivered).toBe(false);
    expect(r.unavailable).toBe(true);
  });

  it('APNS send() is unavailable without credentials and does not throw', async () => {
    const adapter = new ApnsAdapter(configOf({}));
    const r = await adapter.send(job());
    expect(r.unavailable).toBe(true);
    expect(r.delivered).toBe(false);
  });
});

describe('buildPushAdapters registry', () => {
  it('routes each channel to its adapter', () => {
    const registry = buildPushAdapters(configOf({}));
    expect(registry.forChannel('PUSH_WEB')?.channel).toBe('PUSH_WEB');
    expect(registry.forChannel('PUSH_FCM')?.channel).toBe('PUSH_FCM');
    expect(registry.forChannel('PUSH_APNS')?.channel).toBe('PUSH_APNS');
    expect(registry.forChannel('NOT_A_CHANNEL')).toBeUndefined();
  });
});
