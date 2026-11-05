"use client";

import { useEffect } from "react";
import { isServiceWorkerSupported, registerServiceWorker } from "@/lib/pwa";

/**
 * Registers the offline service worker on every page visit (Phase 6).
 *
 * A separate client component so the root layout (a server component) can
 * render it without pulling service-worker registration into the SSR path.
 * It is a no-op on the server and in any browser without ServiceWorker —
 * registration failure degrades to online-only and must never break the
 * page. Rendered once near the top of <body>; it produces no DOM of its
 * own.
 */
export function PwaRegistrar() {
  useEffect(() => {
    if (!isServiceWorkerSupported()) return;
    // Fire-and-forget: an unavailable worker must not block or error the UI.
    void registerServiceWorker();
  }, []);

  return null;
}
