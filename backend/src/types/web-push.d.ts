/**
 * Minimal local typings for the `web-push` package (Phase 6 Web Push adapter).
 *
 * `web-push` ships no bundled TypeScript declarations and @types/web-push
 * is not in the approved dependency set, so we declare the exact surface
 * this codebase uses: VAPID key generation / server-key configuration and
 * the sendNotification call the PWA offline layer will drive.
 *
 * This keeps the import typed (no `any`) without pulling in a transitive
 * type package. If the library adds official types later, this file can be
 * deleted in favour of the shipped declarations.
 */
declare module 'web-push' {
  export interface VAPIDDetails {
    /** A URL identifying the push service user (e.g. `mailto:...`). */
    subject: string;
    /** Base64-encoded VAPID public key. */
    publicKey: string;
    /** Base64-encoded VAPID private key. */
    privateKey: string;
  }

  export interface SetServerKeysOptions {
    vapidDetails: VAPIDDetails;
  }

  /**
   * Generate a new VAPID keypair (P-256 / ECDSA). The public key is
   * base64-encoded; the private key is base64-encoded too.
   */
  export function generateVAPIDKeys(): VAPIDDetails;

  /**
   * Set the VAPID identity + encryption keys used to send notifications.
   */
  export function setServerKeys(options: SetServerKeysOptions): void;

  /**
   * The payload + keys for a single push endpoint.
   */
  export interface PushSubscriptionJson {
    endpoint: string;
    keys: {
      p256dh: string;
      auth: string;
    };
  }

  /**
   * Options for sending a single push notification to a subscription.
   */
  export interface SendNotificationOptions {
    /** Time-to-live for the push message in seconds. */
    TTL?: number;
    /** VAPID push set / uapl identifiers. */
    uapush?: {
      headers?: string[];
      version?: number;
      useAes128Gcm?: boolean;
      cryptoSw2?: boolean;
    };
    /** Custom headers to include in the push message. */
    headers?: Record<string, string>;
  }

  /**
   * Send a Web Push notification to a subscription. Resolves with the
   * response status / body from the push service endpoint.
   */
  export function sendNotification(
    subscription: PushSubscriptionJson,
    data: string,
    options?: SendNotificationOptions,
  ): Promise<{
    statusCode: number;
    headers: Record<string, string>;
    body: string;
  }>;

  const webPush: {
    generateVAPIDKeys: typeof generateVAPIDKeys;
    setServerKeys: typeof setServerKeys;
    sendNotification: typeof sendNotification;
  };
  export default webPush;
}
