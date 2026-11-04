# SENTRAVYN Delivery Gates & Definition of Done

A task is complete only when its applicable checks have been executed and evidence is recorded.

## Gate A — Design

- [ ] `DESIGN.md` followed.
- [ ] Original SENTRAVYN identity maintained.
- [ ] Custom backgrounds implemented where specified.
- [ ] Typography and spacing consistent.
- [ ] No neon colors.
- [ ] Zero emojis.
- [ ] No generic/repetitive AI layouts.
- [ ] Cinematic ASCII footer works and remains accessible.
- [ ] Responsive inspection completed.
- [ ] Reduced-motion behaviour tested.
- [ ] Contrast and keyboard navigation checked.

## Gate B — Functionality

- [ ] Every button and link works.
- [ ] Forms validate and submit.
- [ ] Permissions are handled.
- [ ] Loading, empty, error and offline states exist.
- [ ] Stale data is visibly identified.
- [ ] API calls handle failure.
- [ ] No fabricated live data.
- [ ] No placeholder endpoint represented as complete.

## Gate C — Backend and data

- [ ] DTO/schema validation.
- [ ] Database constraints and migrations.
- [ ] Idempotent ingestion.
- [ ] Retry and dead-letter handling.
- [ ] Source provenance.
- [ ] Freshness checks.
- [ ] Authorisation tests.
- [ ] Geospatial correctness tests.
- [ ] Audit history.
- [ ] API documentation.

## Gate D — Quality

- [ ] Format.
- [ ] Lint.
- [ ] Typecheck.
- [ ] Unit tests.
- [ ] Integration tests.
- [ ] Relevant E2E tests.
- [ ] Production build.
- [ ] Dependency and secret scans.
- [ ] Performance checks.
- [ ] Accessibility checks.

## Gate E — Safety and security

- [ ] No unverified shelter marked safe.
- [ ] No unsupported hospital operational claim.
- [ ] No expired alert presented as active.
- [ ] No AI-generated official instruction.
- [ ] Source and timestamps visible.
- [ ] Privacy and location consent respected.
- [ ] Privileged actions audited.
- [ ] Critical threat-model findings addressed.

## Gate F — Evidence

Record:
- Commit or change identifier.
- Files changed.
- Commands run.
- Test output.
- Build output.
- Screenshots and viewport sizes.
- Device tests where applicable.
- Security findings.
- Known limitations.
- Deployment status and actual URL.

Use only:
- `PASS`
- `FAIL`
- `NOT RUN`
- `BLOCKED`

Never convert a skipped test into a pass. Never claim production readiness when a critical gate fails.
