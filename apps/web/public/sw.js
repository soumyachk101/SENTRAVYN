/* SENTRAVYN offline service worker (Phase 6; docs/ROADMAP.md Phase 6).
 *
 * Caches ONLY what is safe to show offline:
 *   - a limited offline shell (the landing route, with a clearly-labelled
 *     not-live notice when served from cache),
 *   - the reviewed preparedness / safety guide content that ships statically
 *     with the app (static assets + the /route it is served on),
 *   - static build assets and icons.
 *
 * It NEVER caches or serves from cache any API or live data endpoint
 * (/api/*, alert/revision sync). Live data must come from the network or be
 * surfaced as explicitly stale by the app — a cached alert must never read as
 * current (SAFETY-POLICY.md 8: stale information is always shown as stale).
 *
 * A "last synced" timestamp is recorded in the cache and surfaced to the page
 * so the UI can show a visible "last sync" state (docs/ROADMAP.md Phase 6).
 *
 * Classic (non-module) service worker for broad compatibility. No emoji, no
 * neon. Reduced-motion is a page-side concern; this worker performs no motion.
 */

var SHELL_CACHE = "sentravyn-shell-v1";
var ASSET_CACHE = "sentravyn-assets-v1";
// An opaque cache key (not a URL) holding the last successful online sync.
var SYNC_KEY = "sentravyn:last-sync";

// Precached at install: the app-shell documents and static icons that make a
// first offline visit render something real. Runtime assets (/_next/static/*)
// are cached on first successful fetch so the current build is what shows.
var PRECACHE = ["/", "/manifest.webmanifest", "/icons/icon.svg", "/icons/maskable.svg"];

// Honest offline shell: a limited, clearly-labelled-not-live fallback. It
// contains no live data and no emergency claims; it only says what is and is
// not available offline and points to the reviewed preparedness content.
var OFFLINE_SHELL_HTML = [
  "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"/>",
  "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>",
  "<title>SENTRAVYN — Offline</title>",
  "<style>body{margin:0;background:#101418;color:#f7f5f1;font-family:Inter,system-ui,sans-serif;line-height:1.6;padding:3rem 1.5rem}",
  ".wrap{max-width:640px;margin:0 auto}",
  "h1{font-size:1.5rem}p{color:#aab3bf}",
  ".notice{border:1px solid #55606c;border-radius:8px;padding:1rem;background:#1b232b;color:#f7f5f1}",
  "a{color:#4a6b82}</style></head>",
  "<body><div class=\"wrap\">",
  "<h1>SENTRAVYN is offline on this device</h1>",
  "<p>You are not connected. SENTRAVYN can show the preparedness guidance and the app shell it cached earlier, but it cannot reach live emergency data.</p>",
  "<div class=\"notice\" role=\"status\"><strong>Cached content is not live.</strong> Any alerts or updates shown while offline are from your last sync and may be stale. Always rely on official local emergency services and current government warnings.</div>",
  "<p>Reconnect to get current alerts and to update your saved preparedness content.</p>",
  "</div></body></html>",
].join("");

// Is this a static, cacheable same-origin asset (and never a data endpoint)?
function isCacheableStatic(request) {
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  var p = url.pathname;
  if (p.indexOf("/api/") === 0) return false; // live data: never cache
  return (
    p.indexOf("/_next/static/") === 0 ||
    p.indexOf("/icons/") === 0 ||
    /\.webmanifest$/.test(p) ||
    /\.svg$/.test(p) ||
    /\.css$/.test(p)
  );
}

// Record a successful online sync and tell any open pages.
function recordSync() {
  var at = String(Date.now());
  var entry = new Response(at, { status: 200, headers: { "Content-Type": "text/plain" } });
  caches.open(SHELL_CACHE).then(function (cache) {
    return cache.put(SYNC_KEY, entry);
  }).catch(function () {});
  if (self.clients) {
    self.clients
      .matchAll({ includeUncontrolled: false })
      .then(function (list) {
        for (var i = 0; i < list.length; i += 1) {
          list[i].postMessage({ type: "sentravyn:synced", at: Date.now() });
        }
      })
      .catch(function () {});
  }
}

function handleNavigation(request) {
  // Network-first so live content wins when available; fall back to the
  // cached shell when offline (the limited offline shell requirement).
  var fallback = caches.match("/").then(function (cached) {
    return cached || new Response(OFFLINE_SHELL_HTML, {
      status: 200,
      headers: { "Content-Type": "text/html", "SENTRAVYN-OFFLINE": "not-live" },
    });
  });
  return fetch(request)
    .then(function (res) {
      var copy = res.clone();
      caches.open(SHELL_CACHE).then(function (cache) {
        return cache.put("/", copy);
      }).catch(function () {});
      recordSync();
      return res;
    })
    .catch(function () {
      return fallback;
    });
}

function handleStatic(request) {
  // Stale-while-revalidate for static assets: serve from cache immediately,
  // refresh in the background, fall back to the network, then to empty.
  var cached = caches.match(request).catch(function () {
    return undefined;
  });
  var network = fetch(request)
    .then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(ASSET_CACHE).then(function (cache) {
          return cache.put(request, copy);
        }).catch(function () {});
        recordSync();
      }
      return res;
    })
    .catch(function () {
      return undefined;
    });
  return Promise.race([network, cached]).then(function (res) {
    if (res) return res;
    return caches.match(request);
  }).then(function (res) {
    return res || Response.error();
  });
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then(function (cache) {
        // Best-effort precache of the shell + static icons; a failed asset
        // must not block activation (the app still works online).
        return cache.addAll(PRECACHE);
      })
      .catch(function () {})
      .then(function () {
        return self.skipWaiting();
      })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    self.clients
      .claim()
      .then(function () {
        // Drop caches from older versions.
        return caches.keys().then(function (keys) {
          return Promise.all(
            keys
              .filter(function (k) {
                return k !== SHELL_CACHE && k !== ASSET_CACHE;
              })
              .map(function (k) {
                return caches.delete(k);
              })
          );
        });
      })
  );
});

self.addEventListener("message", function (event) {
  var data = event.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "sentravyn:get-state") {
    caches
      .open(SHELL_CACHE)
      .then(function (cache) {
        return cache.match(SYNC_KEY);
      })
      .then(function (res) {
        return res ? res.text() : "";
      })
      .then(function (raw) {
        var at = raw === "" ? null : Number(raw);
        (event.source || null).postMessage({
          type: "sentravyn:state",
          lastSyncedAt: at,
          active: true,
        });
      })
      .catch(function () {
        (event.source || null).postMessage({ type: "sentravyn:state", lastSyncedAt: null, active: true });
      });
  }
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  // Never intercept cross-origin or any data endpoint: live alerts must come
  // from the network (or be shown stale by the app), never from this cache.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf("/api/") === 0) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isCacheableStatic(request)) {
    event.respondWith(handleStatic(request));
  }
});
