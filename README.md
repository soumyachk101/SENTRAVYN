## Approved project brand

**Brand name: SENTRAVYN.** Do not use the former working name in new product UI, documentation, metadata, package names or generated assets. Existing historic references may be retained only when needed for migration history.

# SENTRAVYN — Global Emergency Intelligence & Public Safety

**Product:** SENTRAVYN  
**Positioning:** Global Emergency Intelligence & Public Safety Platform  
**Tagline:** Know Where to Go. Know What to Do. Stay Prepared.  
**Reference site:** https://veylqorix.vercel.app  
**Design reference:** https://www.ditto.site/  
**Anti-slop reference:** https://github.com/miqdadbadjuber/anti-slop

This kit is the product, design, safety, architecture, security, and delivery specification for building SENTRAVYN with Claude Code.

## Product surfaces

- `apps/web`: Next.js public website and PWA
- `apps/mobile`: Expo React Native application for iOS and Android
- `apps/admin`: Next.js restricted administration console
- `backend`: NestJS API and background workers
- `packages`: shared types, API client, design tokens, localization and reusable UI

## Non-negotiable decisions

1. Backend: TypeScript + NestJS. Do not introduce Python.
2. Database: PostgreSQL + PostGIS.
3. Cache and queues: Redis + BullMQ.
4. Real-time delivery: Socket.IO plus durable notification delivery.
5. Web: Next.js + TypeScript.
6. Mobile: Expo + React Native + TypeScript.
7. Infrastructure: Docker, AWS and Terraform, with Vercel for suitable web surfaces.
8. Emergency information must be source-backed, timestamped and explicit about uncertainty.
9. A nearby place is not automatically a safe shelter.
10. Custom backgrounds and the cinematic ASCII footer are required product design features.
11. No neon colors and no emojis anywhere in the product.
12. No feature may be called complete without evidence from tests and, where applicable, browser/device inspection.

## Start here

1. Read `CLAUDE.md`.
2. Read `DESIGN.md`.
3. Read `docs/PRODUCT-SPEC.md`.
4. Read `docs/ARCHITECTURE.md`.
5. Read `docs/SAFETY-POLICY.md`, `docs/DATA-SOURCES.md` and `docs/SECURITY.md`.
6. Create an implementation plan using `docs/ROADMAP.md`.
7. Do not start broad implementation until the repository audit and planning gate pass.

## Important

This is an engineering specification, not an operational emergency service. Do not publish the platform as an authoritative emergency-response service until its data agreements, safety review, operational processes, incident response, legal review and reliability requirements are genuinely in place.


## Brand and search visibility additions
- Read `docs/BRAND-NAME-RESEARCH.md` before choosing a final brand.
- Read and implement `docs/SEO-AEO-GEO.md`.
- Track Google Search Console and Bing Webmaster Tools in `docs/SEARCH-CONSOLE-SETUP.md`.
- Do not claim any domain, trademark, verification, indexing or ranking is confirmed without evidence.
- Preserve custom backgrounds, cinematic ASCII footer, no-neon, no-emoji and premium anti-slop design rules.

## Brand and search
See `docs/BRAND-NAMING.md` for provisional names and clearance gates, and `docs/SEO-AEO-GEO.md` for Google Search Console, Bing Webmaster, IndexNow, SEO, AEO and GEO requirements.
# SENTRAVYN
