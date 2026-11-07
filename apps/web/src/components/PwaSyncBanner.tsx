'use client';

import { formatLastSync, usePwaState } from '@/lib/pwa';

/**
 * Visible offline / last-sync state for a data surface (Phase 6;
 * docs/ROADMAP.md "Visible last-sync state" + "cached alerts clearly labelled
 * not-live").
 *
 * This is the small, honest status strip the offline PWA shows under a
 * data-driven view (e.g. a cached alerts list):
 *   - online + recent sync: "Last synced <time>. Live data available."
 *   - offline or no sync yet: "Not live: showing cached / last-synced data."
 *   - stale: the not-live note is reinforced with the sync age.
 *
 * It never asserts a cached alert is current (SAFETY-POLICY.md 8): any
 * non-live state is labelled explicitly. The element uses an `aria-live`
 * region so screen readers hear the online/offline transition. No emoji,
 * no neon (DESIGN.md), no motion.
 */
export function PwaSyncBanner({ className = '' }: { className?: string }) {
  const pwa = usePwaState();
  const notLive = pwa.offline || pwa.cachedNotLive;

  let message: string;
  if (pwa.supported && pwa.offline) {
    message =
      'Offline. SENTRAVYN is showing the last synced data on this device — it may be stale.';
  } else if (notLive) {
    message =
      'Not live: no successful sync yet on this device. Live data has not been confirmed.';
  } else if (pwa.stale) {
    message =
      'Connection available, but the last sync is older than an hour. Treat data as possibly stale.';
  } else {
    message = 'Live data is available.';
  }

  return (
    <div
      className={`pwa-sync ${className}`}
      role="status"
      aria-live="polite"
      data-not-live={notLive ? 'true' : 'false'}
      data-offline={pwa.offline ? 'true' : 'false'}
      data-stale={pwa.stale ? 'true' : 'false'}
    >
      <span className="pwa-sync__state" aria-hidden="true">
        {pwa.offline
          ? 'OFFLINE'
          : pwa.stale
            ? 'POSSIBLY STALE'
            : notLive
              ? 'NOT LIVE'
              : 'LIVE'}
      </span>
      <p className="pwa-sync__message">{message}</p>
      <p className="pwa-sync__lastsync">{formatLastSync(pwa.lastSyncedAt)}</p>
    </div>
  );
}
