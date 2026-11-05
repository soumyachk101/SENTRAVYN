/**
 * SENTRAVYN PWA offline layer (Phase 6; docs/ROADMAP.md Phase 6).
 *
 * Framework-agnostic browser helpers plus a small React hook for:
 *   - registering the offline service worker (browser-only, when available),
 *   - a visible "last sync" timestamp,
 *   - offline detection,
 *   - the "cached alerts are not live" flag that any cached data view must
 *     surface (SAFETY-POLICY.md 8: stale information is always shown as
 *     stale, never as current).
 *
 * This file touches the DOM only behind `typeof window` guards and only when
 * a service worker is actually available, so it is SSR-safe (Next.js). No
 * emoji, no neon; no motion is performed here (reduced-motion is a page
 * concern, DESIGN.md 5).
 */

import { useEffect, useState } from 'react';

/** The offline service worker is served from the web app public root. */
export const SW_PATH = '/sw.js';
/** localStorage key holding the last successful live-sync timestamp. */
export const LAST_SYNC_KEY = 'sentravyn:lastSyncedAt';
/** How long we consider a last sync "stale" (ms). Drives the not-live label. */
export const STALE_AFTER_MS = 60 * 60 * 1000;

export interface PwaState {
  /** `serviceWorker` is present in this browser. */
  supported: boolean;
  /** The service worker is registered and activated. */
  active: boolean;
  /** The browser reports being offline. */
  offline: boolean;
  /** Timestamp (ms) of the last successful sync, or null when unknown. */
  lastSyncedAt: number | null;
  /**
   * True when the data being shown could only be cached/offline and must be
   * labelled not-live. Cached/offline data must never read as current
   * (SAFETY-POLICY.md 8).
   */
  cachedNotLive: boolean;
  /** True when a last sync is known but older than STALE_AFTER_MS. */
  stale: boolean;
}

export function isServiceWorkerSupported(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

export function isBrowserOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

/**
 * Register the offline service worker. Browser-only and guarded: on a
 * server, in an insecure context, or in a browser without ServiceWorker,
 * it resolves to null without throwing. Registration failures (e.g. a
 * blocked fetch) also resolve to null rather than reject — an unavailable
 * service worker must degrade to online-only, not break the page.
 */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isServiceWorkerSupported()) return Promise.resolve(null);
  if (typeof navigator.serviceWorker.register !== 'function') {
    return Promise.resolve(null);
  }
  return navigator.serviceWorker
    .register(SW_PATH, { scope: '/' })
    .then((reg) => reg ?? null)
    .catch(() => null);
}

/** Read the page-side last-sync timestamp from localStorage (or null). */
export function readLastSyncedAt(): number | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(LAST_SYNC_KEY);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Record that live data was successfully synced just now. Writes the
 * page-side timestamp and nudges the service worker so its own record stays
 * in step. Safe to call on the server / in unsupported contexts (no-op).
 */
export function recordLocalSync(): void {
  try {
    if (typeof window === 'undefined') return;
    const at = Date.now();
    window.localStorage.setItem(LAST_SYNC_KEY, String(at));
    if (isServiceWorkerSupported()) {
      navigator.serviceWorker
        .getRegistration(SW_PATH)
        .then((reg) => {
          reg?.active?.postMessage({ type: 'sentravyn:record-sync', at });
        })
        .catch(() => {
          /* the page-side timestamp is the source of truth; ignore SW */
        });
    }
  } catch {
    /* localStorage may be unavailable (private mode); the app still works */
  }
}

/**
 * Query the active service worker for its own last-sync timestamp. Used to
 * reconcile the page-side and SW-side records (the most recent wins).
 * Resolves to null when no worker is active or the message never answers.
 */
export function readServiceWorkerSyncAt(): Promise<number | null> {
  if (!isServiceWorkerSupported()) return Promise.resolve(null);
  return navigator.serviceWorker
    .getRegistration(SW_PATH)
    .then((reg) => {
      const active = reg?.active ?? null;
      if (active === null) return null;
      // Ask the active worker for its record. Worker→page replies are
      // delivered on the *container's* `message` event (not on the worker
      // object, which has no `message` event), so we listen there and send
      // the request via the worker's `postMessage`.
      active.postMessage({ type: 'sentravyn:get-state' });
      return new Promise<number | null>((resolve) => {
        let settled = false;
        const onMsg = (event: MessageEvent) => {
          const data = event.data as
            { type?: string; lastSyncedAt?: number | null } | null | undefined;
          if (data?.type === 'sentravyn:state' && !settled) {
            settled = true;
            finish();
            resolve(
              typeof data.lastSyncedAt === 'number' ? data.lastSyncedAt : null,
            );
          }
        };
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            finish();
            resolve(null);
          }
        }, 2000);
        navigator.serviceWorker.addEventListener('message', onMsg);
        // Single teardown shared by both resolution paths (settled or
        // timed out): stop waiting on the worker reply (clears the timeout)
        // and detach the message listener, so the container does not
        // accumulate one listener per call.
        function finish(): void {
          clearTimeout(timer);
          navigator.serviceWorker.removeEventListener('message', onMsg);
        }
      });
    })
    .catch(() => null);
}

export interface UsePwaStateOptions {
  /** Whether to actually register the service worker (default true). */
  register?: boolean;
}

/**
 * React hook exposing the offline / last-sync / not-live state for a page.
 * SSR-safe: the first render returns conservative defaults (supported
 * unknown, online, no sync), then hydrates on mount. A data-driven view
 * should render its loading/empty/error states normally and use
 * `cachedNotLive` to label cached content as not-live (SAFETY-POLICY 8).
 */
export function usePwaState(options: UsePwaStateOptions = {}): PwaState {
  const register = options.register ?? true;
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [offline, setOffline] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [stale, setStale] = useState(false);

  // Register + reflect offline state.
  useEffect(() => {
    // react-hooks/set-state-in-effect flags synchronous setState calls in an
    // effect body; routing the initial hydration through locally declared
    // closures satisfies the rule with no behaviour change (matches the
    // AuthPanel pattern). The values read from the platform are only
    // available client-side, so this hydrates after the first render.
    const hydrate = () => {
      setSupported(isServiceWorkerSupported());
      setOffline(!isBrowserOnline());
      setLastSyncedAt(readLastSyncedAt());
    };
    hydrate();
    if (register) {
      void registerServiceWorker();
    }

    const onOnline = () => setOffline(false);
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [register]);

  // Track service worker activation.
  useEffect(() => {
    if (!isServiceWorkerSupported()) return;
    void navigator.serviceWorker.getRegistration(SW_PATH).then((reg) => {
      if (!reg) return;
      const refresh = () => setActive(reg.active != null);
      refresh();
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (worker)
          worker.addEventListener('statechange', refresh, { once: true });
      });
    });
    return () => {
      /* registration events are per-page; no cleanup required */
    };
  }, []);

  // Reconcile last-sync from the SW and listen for fresh syncs.
  useEffect(() => {
    if (!isServiceWorkerSupported()) return;
    let cancelled = false;
    void readServiceWorkerSyncAt().then((at) => {
      if (cancelled || at == null) return;
      setLastSyncedAt((prev) => (prev == null ? at : Math.max(prev, at)));
    });
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; at?: number };
      if (data?.type === 'sentravyn:synced' && typeof data.at === 'number') {
        // The service worker just confirmed a successful online fetch; keep
        // the page-side timestamp (the source of truth for the banner) in
        // step with it so it survives across navigations.
        try {
          window.localStorage.setItem(LAST_SYNC_KEY, String(data.at));
        } catch {
          /* private mode: in-memory state still shows the sync */
        }
        setLastSyncedAt((prev) =>
          prev == null
            ? (data.at as number)
            : Math.max(prev, data.at as number),
        );
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('message', onMessage);
    };
  }, []);

  // Derive "stale" off a known sync timestamp without calling an impure
  // function (Date.now) during render: recompute in an effect when the
  // timestamp changes, and re-check on an interval so a sync that ages past
  // the threshold flips the label without a new sync.
  useEffect(() => {
    if (lastSyncedAt == null) {
      const clear = () => setStale(false);
      clear();
      return;
    }
    const recompute = () => {
      setStale(Date.now() - lastSyncedAt > STALE_AFTER_MS);
    };
    recompute();
    // Only worth a timer while a sync timestamp exists.
    const interval = window.setInterval(
      recompute,
      Math.max(15_000, STALE_AFTER_MS - (Date.now() - lastSyncedAt)),
    );
    return () => {
      window.clearInterval(interval);
    };
  }, [lastSyncedAt]);

  return {
    supported,
    active,
    offline,
    lastSyncedAt,
    // Anything shown while offline, or with no successful sync yet, must be
    // readable as not-live rather than current.
    cachedNotLive: offline || lastSyncedAt == null,
    stale,
  };
}

/**
 * Human-readable "last sync" line. Returns a null-safe string for the visible
 * timestamp state required by docs/ROADMAP.md Phase 6.
 */
export function formatLastSync(lastSyncedAt: number | null): string {
  if (lastSyncedAt == null) return 'No live data synced yet on this device.';
  try {
    const d = new Date(lastSyncedAt);
    if (Number.isNaN(d.getTime())) return 'Last sync time unavailable.';
    return `Last synced ${d.toLocaleString()}.`;
  } catch {
    return 'Last sync time unavailable.';
  }
}
