## Approved project brand

**Brand name: SENTRAVYN.** Do not use the former working name in new product UI, documentation, metadata, package names or generated assets. Existing historic references may be retained only when needed for migration history.

# Claude Code — SENTRAVYN Master Implementation Prompt

You are responsible for implementing SENTRAVYN as a production-grade global emergency intelligence and public-safety platform.

Before implementation, read the repository's `CLAUDE.md`, `DESIGN.md`, `README.md` and every specification under `docs/`.

## Product

SENTRAVYN helps people access authoritative emergency alerts, understand reviewed protective guidance, discover nearby emergency services and prepare households.

Surfaces:
- Next.js website and PWA.
- Expo React Native iOS/Android app.
- Next.js admin console.
- NestJS backend.

## Mandatory stack

Use TypeScript throughout the application ecosystem:
- Next.js.
- Expo React Native.
- NestJS.
- PostgreSQL + PostGIS.
- Redis + BullMQ.
- Socket.IO.
- Docker, AWS and Terraform.
- Vercel for suitable Next.js deployments.

Do not use Python as the backend or introduce a Python service without explicit approval.

## First task: audit, do not code blindly

Inspect the existing repository, tool versions, dependencies, routes, modules, database, tests, environment, deployment, design and security.

Produce:
1. Current-state audit.
2. Confirmed issues with file references.
3. Architecture proposal.
4. Dependency and risk register.
5. Phased implementation plan.
6. Proposed repository structure.
7. Acceptance criteria for each phase.

Do not invent repository contents or claim a check was run if it was not.

## Implementation

After the audit gate, implement phase by phase according to `docs/ROADMAP.md`.

Build real functionality, not a visual mockup:
- Source-backed alerts.
- CAP-compatible parsing where available.
- Provenance and freshness.
- Geospatial service discovery.
- Explicit shelter verification.
- Reviewed safety guides.
- Durable notifications.
- Offline PWA behaviour.
- Consent-based family sharing.
- Role-controlled admin review.
- Audit trail.

Handle external provider failures, malformed data, rate limits, stale records and duplicate events.

## Design

Follow `DESIGN.md` exactly.

Preserve:
- Original custom background system.
- Premium custom typography.
- Intentional compact spacing.
- No neon.
- Zero emojis.
- No generic AI-generated layouts.
- Cinematic ASCII nuclear-explosion footer sequence.

Do not remove custom backgrounds or ASCII artwork in the name of anti-slop. Anti-slop is the quality filter; `DESIGN.md` defines SENTRAVYN's visual direction.

The ASCII artwork must be an artistic educational visualization, not a real event or scientific simulation. It must support reduced motion, pause/replay and static fallback.

## Safety

Follow `docs/SAFETY-POLICY.md` and `docs/DATA-SOURCES.md`.

Never:
- Invent an alert.
- Mark an unverified place as a safe shelter.
- Claim a hospital is operational without current evidence.
- Present stale data as live.
- Generate official evacuation instructions.
- Let AI certify safety.
- Confuse general guidance with local official instructions.

## Security

Follow `docs/SECURITY.md`. Implement least privilege, secure sessions, input validation, rate limiting, secrets management, audit logs, location privacy and threat mitigations.

## Testing

Run all applicable format, lint, typecheck, unit, integration, E2E, build, security, accessibility and performance checks.

Inspect browser screenshots at 360, 390, 768, 1024, 1440 and 1920 CSS pixels. Test mobile on actual or suitable emulated devices.

Do not claim success for checks not executed.

## Final acceptance

Use `docs/DELIVERY-GATES.md`.

For every phase report:
- Implemented scope.
- Files changed.
- Commands run.
- PASS/FAIL/NOT RUN results.
- Screenshots or other evidence.
- Known issues.
- Safety and security implications.
- Next phase.

Do not declare the platform production-ready until critical safety, security, operational, data licensing, reliability and delivery gates pass.

Start by auditing the repository and producing the implementation plan. Do not generate the entire application in one unreviewed pass.


## SEO / AEO / GEO / webmaster tools
Implement `docs/SEO-AEO-GEO.md` fully, including metadata, canonicals, sitemap, robots, structured data, internationalization, content provenance, performance, and indexing QA. Prepare Google Search Console and Bing Webmaster Tools onboarding, but request owner access and DNS verification values; never claim registration or verification without evidence. Read `docs/BRAND-NAME-RESEARCH.md`; the brand remains SENTRAVYN until approved.

## Naming and search discoverability
Read `docs/BRAND-NAMING.md` and `docs/SEO-AEO-GEO.md`. Treat SENTRAVYN as internal codename until brand/domain clearance. Implement production SEO, AEO, GEO, Search Console, Bing Webmaster and IndexNow readiness, and test the results. Never fabricate verification codes or claim a site has been submitted without evidence.
