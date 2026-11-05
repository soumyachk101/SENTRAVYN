# @sentravyn/web

SENTRAVYN public website and PWA (Next.js, App Router).

SENTRAVYN is an information and preparedness platform. It is **not** an
operational emergency service — see `README.md` at the repository root and
`docs/SAFETY-POLICY.md`.

## Status

Phase 1 foundation shell: branded landing surface with the custom background
system, premium typography, the mandatory cinematic ASCII footer, and the PWA
manifest + icons. The Phase 4 place-discovery map now lives at `/map` (see
below). Remaining feature surfaces (alerts, guides, offline) arrive in later
phases.

## Commands

Run from the repository root:

```bash
pnpm dev:web              # next dev on :3000
pnpm --filter @sentravyn/web build
pnpm --filter @sentravyn/web typecheck
pnpm --filter @sentravyn/web lint
pnpm --filter @sentravyn/web test   # jsdom map render test
```

## Emergency map (`/map`)

The Phase 4 place-discovery surface (`src/components/map/MapPanel.tsx`,
routed at `src/app/map/page.tsx`):

- **How it works.** MapLibre GL JS renders OpenStreetMap standard raster
  tiles. A manual centre preset + radius pick the search box; a category
  filter and a legend with per-category toggles control what is drawn. Each
  place shows a verification-state chip (VERIFIED / REVIEWED / UNVERIFIED /
  STALE / EXPIRED / INCOMPLETE) — the label is always shown as **text**, and
  colour is a supporting signal only. Distance is displayed as a calculation
  ("~445 m — a calculation, not a safety recommendation"), never a safety
  call.
- **Data source.** The panel calls `@sentravyn/api-client` `places`
  methods (`GET /api/v1/places` radius mode + `GET /api/v1/places/:id`).
  Set `NEXT_PUBLIC_API_BASE_URL` (default `http://localhost:4000`) to point
  at the backend. The route is built in the Phase 4 places workstream; if it
  is not up yet the panel shows its error/retry state rather than
  fabricating data.
- **States.** loading, empty ("no reviewed places in this area yet —
  coverage is not complete"), error + retry, stale and offline are all
  rendered; a place detail opens in a bottom sheet on mobile and a side card
  on larger screens.
- **Tiles + terms.** OSM tiles are **dev-only** (ODbL; attribution is
  mandatory and is shown in the UI). Production-scale OSM usage is pending a
  terms review — no production tile host is claimed. See `docs/DATA-SOURCES.md`
  §3 and `DESIGN.md`.
- **No geolocation by default.** The centre is always chosen manually. The
  panel never calls the browser geolocation API. This matches ADR-017 and
  `docs/SECURITY.md` §5 (no precise location is collected or sent anywhere).

## Design

Follows `DESIGN.md`: custom backgrounds, premium typography, no neon, zero
emoji, and the cinematic ASCII footer sequence (reduced-motion + pause/replay
+ static fallback). The mandated font system (Geist / Inter / IBM Plex Mono,
self-hosted `.woff2` via `next/font/local`, `src/lib/fonts.ts`) is loaded on
this surface; `--font-display/-body/-mono` point at the real fonts.

## PWA

`public/manifest.webmanifest` + `public/icons/`. Service worker and offline
caching arrive in Phase 6 (docs/ROADMAP.md).

