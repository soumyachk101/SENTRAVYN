# @sentravyn/web

SENTRAVYN public website and PWA (Next.js, App Router).

SENTRAVYN is an information and preparedness platform. It is **not** an
operational emergency service — see `README.md` at the repository root and
`docs/SAFETY-POLICY.md`.

## Status

Phase 1 foundation shell: branded landing surface with the custom background
system, premium typography tokens, the mandatory cinematic ASCII footer, and
the PWA manifest + icons. No live data is fetched on the landing page. Feature
surfaces (alerts, map, guides, offline, family safety) arrive in Phases 3–7.

## Commands

Run from the repository root:

```bash
pnpm dev:web              # next dev on :3000
pnpm --filter @sentravyn/web build
pnpm --filter @sentravyn/web typecheck
pnpm --filter @sentravyn/web lint
```

## Design

Follows `DESIGN.md`: custom backgrounds, premium typography, no neon, zero
emoji, and the cinematic ASCII footer sequence (reduced-motion + pause/replay
+ static fallback). The background and footer begin here (Phase 1) so that
Phase 8 is a completion pass rather than a rewrite.

## PWA

`public/manifest.webmanifest` + `public/icons/`. Service worker and offline
caching arrive in Phase 6 (docs/ROADMAP.md).
