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
    /** A URL identifying the push service user (e.g. `https://...` or `mailto:`). */
    subject: string;
    /**
     * VAPID public key, **URL-safe base64** (base64url, unpadded) — the
     * encoding `generateVAPIDKeys()` produces and `setVapidDetails` expects
     * in web-push@3.x. (The v5/v6 API switched to `setServerKeys` +
     * standard base64; this project pins 3.6.7, which does not have it.)
     */
    publicKey: string;
    /** VAPID private key, URL-safe base64 (base64url, unpadded). */
    privateKey: string;
  }

  /**
   * Generate a new VAPID keypair (P-256 / ECDSA). `publicKey` and
   * `privateKey` are base64url-encoded in web-push@3.x.
   */
  export function generateVAPIDKeys(): VAPIDDetails;

  /**
   * Set the VAPID identity + keys used to send notifications. web-push@3.x
   * API: three positional args (subject, base64url public key, base64url
   * private key). Pass `null` to clear. This is the v3 surface the pinned
   * `web-push@3.6.7` actually exports — the newer `setServerKeys({...})`
   * shape (v5/v6) is NOT available here.
   */
  export function setVapidDetails(
    subject: string,
    publicKey: string,
    privateKey: string,
  ): void;
  export function setVapidDetails(details: null): void;

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
    setVapidDetails: typeof setVapidDetails;
    sendNotification: typeof sendNotification;
  };
  export default webPush;
}
