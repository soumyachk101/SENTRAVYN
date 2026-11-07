# @sentravyn/admin

SENTRAVYN restricted administration console (Next.js, App Router).

Phase 1 foundation shell only. It documents the role model (PUBLIC / REVIEWER /
OPERATOR / ADMIN) and the audit requirement, and sets the operational-clarity
visual direction from `DESIGN.md` 6. It is **not** functional yet: sign-in,
RBAC enforcement, source configuration, alert review, place verification and
guide approval arrive in Phase 2 (docs/ROADMAP.md). No privileged capability
is enabled in this shell.

## Commands

Run from the repository root:

```bash
pnpm dev:admin              # next dev on :3001
pnpm --filter @sentravyn/admin build
pnpm --filter @sentravyn/admin typecheck
pnpm --filter @sentravyn/admin lint
```

## Security

Privileged roles require MFA and every privileged change is recorded in the
audit log (SECURITY.md 2 and 6). The console is intentionally
`noindex` so it is not searchable.
