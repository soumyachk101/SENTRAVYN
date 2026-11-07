# SENTRAVYN Safety Guides — Review Policy (Phase 5)

Implementation of SAFETY-POLICY.md 5 and 10: hazard-specific guidance must be
independently reviewed, and safety guides require a named responsible role, a
qualified review process, authoritative references, version history and a
review date, with an auditable record of changes and approvals.

This document is the review policy for the `SafetyGuide` / `GuideRevision`
schema and the `GET /guides` + `/admin/guides` API surface. It defines the
responsible role, the review process, the versioning model and the
freshness/retirement rules that the code enforces.

## 1. Responsible role

The responsible role for safety-guide content is the **REVIEWER** (or above,
per the RBAC hierarchy PUBLIC < REVIEWER < OPERATOR < ADMIN,
`backend/src/common/rbac/rbac.constants.ts`).

- A REVIEWER owns the review: they record themselves (and the reviewing
  authority) on the guide, so every guide has a **named responsible reviewer**
  (SAFETY-POLICY.md 10). The `reviewer` and `authority` columns are required
  before a guide may be approved or published.
- The OPERATOR and ADMIN roles inherit the REVIEWER privilege and may also
  run the workflow; the hierarchy makes the junior role available to senior
  roles, so any of the three may act, and the audit trail records *who* did.
- The API enforces this server-side (`@Roles('REVIEWER','OPERATOR','ADMIN')`
  on every `/admin/guides` route, `backend/src/guides/guides-admin.controller.ts`);
  the admin UI only shapes what is visible.

## 2. Content rules (summary-only, cited)

Per SAFETY-POLICY.md 5 and 6 and ADR-009:

- A guide is a **summary of authoritative guidance**, never original
  instruction. The body is labelled as a summary at render time
  (`SummaryDisclosure` in the web surface); a placeholder body must say so
  explicitly — it is never blank.
- Guidance is **hazard-specific** and is not reused across hazard types
  (SAFETY-POLICY.md 5). The closed set of hazard categories is
  `HAZARD_TYPES` (`packages/shared-types`, `backend/src/guides/guides.dto.ts`).
- Every guide carries **authoritative source references** (`references`,
  a non-empty string array) and the **reviewing authority** on record.
- SENTRAVYN is not a substitute for official instructions. A summary never
  becomes an official order, and the surfaces say so next to every body.

## 3. Review process and versioning

The approval state machine has five states (`GuideApprovalState`):

```
DRAFT -> IN_REVIEW -> APPROVED -> PUBLISHED -> RETIRED
                                       (reopen)
                                        |
                                        v
                                       DRAFT
```

| Transition | Route | Actor | Records |
|------------|-------|-------|---------|
| create       | POST /admin/guides | REVIEWER+ | `GUIDE_UPDATED` (event: created) |
| revise       | PATCH /admin/guides/:id | REVIEWER+ | `GUIDE_UPDATED` (event: revised, version bump) |
| DRAFT -> IN_REVIEW | POST /admin/guides/:id/review | REVIEWER+ | `GUIDE_REVIEWED` (stamps `lastReviewedAt`, names reviewer/authority) |
| IN_REVIEW -> APPROVED | POST /admin/guides/:id/approve | REVIEWER+ | `GUIDE_APPROVED` (completeness-gated) |
| APPROVED -> PUBLISHED | POST /admin/guides/:id/publish | REVIEWER+ | `GUIDE_PUBLISHED` |
| PUBLISHED -> RETIRED | POST /admin/guides/:id/retire | REVIEWER+ | `GUIDE_RETIRED` (stamps `lastReviewedAt`) |
| RETIRED -> DRAFT | POST /admin/guides/:id/reopen | REVIEWER+ | `GUIDE_UPDATED` (event: reopened) |

**Versioning.** A new revision write always bumps `version` and adds a
`GuideRevision` row in one transaction
(`backend/src/guides/guides.service.ts`), so the full version history is
retained. A guide is only editable while DRAFT or IN_REVIEW; once APPROVED
(or PUBLISHED/RETIRED) it is immutable — to change it, retire it, re-open it
and run a fresh review cycle. This is the "version history" requirement of
SAFETY-POLICY.md 10.

**Completeness gate.** Approving or publishing a guide requires, at minimum:
a `hazardType`, a named `reviewer`, a reviewing `authority`, and a
non-empty `references` array. Any missing element is rejected 400 with a
clear, actionable message before any state change. An uncited or
unattributed summary is never published (SAFETY-POLICY.md 6, 10).

## 4. Freshness and retirement

Per SAFETY-POLICY.md 8 (stale data must be labelled, never presented as
current) and the `lastReviewedAt`-based review window:

- The review window is **365 days** (`GUIDE_REVIEW_WINDOW_DAYS`,
  `backend/src/guides/guides.service.ts`). A guide whose `lastReviewedAt` is
  older than the window is labelled **stale** in every view
  (`evaluateGuideFreshness`), and a never-reviewed guide is **unknown**.
- Stale guides are **surfaced, never auto-hidden**. The listing exposes a
  `stale` query flag (`GET /guides?stale=true|false`) computed against
  `lastReviewedAt`; a `freshness` label (`fresh` / `stale` / `unknown`)
  accompanies every guide view so a surface can always show the label.
- **Retirement** moves a PUBLISHED guide to RETIRED: it drops out of the
  public default listing and its public detail endpoint 404s, but it remains
  readable through the admin surface with the RETIRED label and is re-openable
  for a new review cycle.

## 5. Public exposure

`GET /guides` and `GET /guides/:id` are public and surface **only**
APPROVED and PUBLISHED guides. DRAFT, IN_REVIEW and RETIRED guides are
invisible to the public surface (the public listing defaults to PUBLISHED).
The admin surface `GET /admin/guides` can address any state.

## 6. Audit

Every privileged guide mutation writes an `AuditEvent` row under
`entity = "guide"` (SECURITY.md 6), using the canonical `GUIDE_*` actions
(`AUDIT_ACTIONS` in `backend/src/audit/audit.service.ts`). The audit detail
is self-describing JSON: the previous/next state, the named reviewer, the
authority on record, the review date and the version at the time of the
change. The admin `/guides` page and the `/audit` trail both render these.

## 7. Localization

The schema's `language` column drives a `language` filter on the guide API
(`GET /guides?language=...`). The UI chrome is localized through
`@sentravyn/localization` (Phase 5 foundation): a total, typed
`LocaleStrings` resource per locale (a missing key is a compile error), a
locale selector, and an Accept-Language parser. `en` and `es` are the shipped
locales; content itself is localized server-side through the `language`
filter, not by the UI.

## 8. Evidence / gates

- Unit tests: `backend/test/guides.spec.ts` (transitions, version bump,
  incomplete-guide rejection, public-only exposure, stale flag, audit wiring)
  and `backend/test/audit.spec.ts` (the `GUIDE_*` canonical actions).
- E2E (DB-gated): `backend/test/e2e/guides.e2e-spec.ts`
  (create -> review -> approve -> publish -> list -> retire -> reopen, audit
  rows, version bumps, public visibility, RBAC 403).
- api-client: `packages/api-client/test/guides.spec.ts`.
- Localization: `packages/localization/test/localization.spec.ts`.

A guide is only "complete" when its content passes the completeness gate,
its review has been recorded by a named reviewer with the reviewing
authority, and its version history and audit trail are intact.
