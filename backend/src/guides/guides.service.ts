import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import type {
  ApproveGuideInput,
  CreateGuideInput,
  GuideApprovalState,
  GuideDetail,
  GuideListQuery,
  GuideRevisionView,
  GuideView,
  PaginatedGuideView,
  PublishGuideInput,
  ReviewGuideInput,
  RetireGuideInput,
  UpdateGuideInput,
} from './guides.dto';

/**
 * Content review window for safety guides (SAFETY-POLICY.md 8, 10;
 * docs/SAFETY-GUIDES.md).
 *
 * A guide whose lastReviewedAt is older than this many days is labelled
 * STALE in every view. It is never auto-hidden: stale content is surfaced
 * with an explicit label, never silently presented as current.
 */
export const GUIDE_REVIEW_WINDOW_DAYS = 365;

/** Freshness label computed for every guide view (SAFETY-POLICY.md 8). */
export type GuideFreshnessState = 'fresh' | 'stale' | 'unknown';

/**
 * Pure freshness helper so the label logic is unit-testable without a
 * database and reusable by the API and any future worker.
 * - null lastReviewedAt -> 'unknown' (never reviewed; the UI says so).
 * - within the window -> 'fresh'; past it -> 'stale'.
 */
export function evaluateGuideFreshness(input: {
  lastReviewedAt: Date | null;
  now?: Date;
}): GuideFreshnessState {
  if (input.lastReviewedAt === null) {
    return 'unknown';
  }
  const now = input.now ?? new Date();
  const ageDays = (now.getTime() - input.lastReviewedAt.getTime()) / 86_400_000;
  // `>=` (not `>`): once the review window has elapsed the guide is due for
  // re-review and is labelled stale. Safety-first: flag at the boundary
  // rather than silently past it.
  return ageDays >= GUIDE_REVIEW_WINDOW_DAYS ? 'stale' : 'fresh';
}

/**
 * Approval state machine for safety guides (SAFETY-POLICY.md 10;
 * docs/SAFETY-GUIDES.md). Uses the schema's five states:
 *
 *   DRAFT -> IN_REVIEW -> APPROVED -> PUBLISHED -> RETIRED
 *                                                  (reopen) |
 *                                                 v
 *                                                DRAFT
 *
 * - review:     DRAFT -> IN_REVIEW, stamps the review date (GUIDE_REVIEWED).
 * - approve:    IN_REVIEW -> APPROVED, completeness required (GUIDE_APPROVED).
 * - publish:    APPROVED -> PUBLISHED, re-checks completeness (GUIDE_PUBLISHED).
 * - retire:     PUBLISHED -> RETIRED, stamps the review date (GUIDE_RETIRED).
 * - reopen:     RETIRED -> DRAFT, starts a new review cycle (GUIDE_UPDATED).
 *
 * Public surfaces may only show APPROVED or PUBLISHED guides; the default
 * public listing is PUBLISHED.
 */
const GUIDE_REVIEW_FROM: readonly GuideApprovalState[] = ['DRAFT'];
const GUIDE_APPROVE_FROM: readonly GuideApprovalState[] = ['IN_REVIEW'];
const GUIDE_PUBLISH_FROM: readonly GuideApprovalState[] = ['APPROVED'];
const GUIDE_RETIRE_FROM: readonly GuideApprovalState[] = ['PUBLISHED'];
const GUIDE_REOPEN_FROM: readonly GuideApprovalState[] = ['RETIRED'];
/** A new revision may only be written while the guide is still editable. */
const GUIDE_UPDATE_FROM: readonly GuideApprovalState[] = ['DRAFT', 'IN_REVIEW'];
/** States readable through the unauthenticated public surface. */
export const GUIDE_PUBLIC_STATES: readonly GuideApprovalState[] = [
  'APPROVED',
  'PUBLISHED',
];

function assertTransition(
  from: GuideApprovalState,
  allowedFrom: readonly GuideApprovalState[],
  action: string,
): void {
  if (!allowedFrom.includes(from)) {
    throw new BadRequestException(
      `${action} is only possible from ${allowedFrom.join(' or ')}; ` +
        `current state is ${from}`,
    );
  }
}

/**
 * Canonical audit detail for guide state changes (SECURITY.md 6). Self-
 * describing JSON: the previous/next state, the named reviewer, the
 * authority on record, the review date stamped on the row and the version
 * at the time of the change.
 */
function guideAuditDetail(
  previousState: GuideApprovalState,
  nextState: GuideApprovalState,
  reviewer: string | null,
  authority: string | null,
  lastReviewedAt: Date,
  version: number,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    from: previousState,
    to: nextState,
    reviewer,
    authority,
    lastReviewedAt: lastReviewedAt.toISOString(),
    version,
    ...extra,
  });
}

/** The SafetyGuide columns the service reads. */
interface GuideRecord {
  id: string;
  hazardType: string;
  jurisdiction: string | null;
  language: string;
  author: string | null;
  reviewer: string | null;
  authority: string | null;
  approval: GuideApprovalState;
  version: number;
  lastReviewedAt: Date | null;
  references: string[];
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class GuidesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * GET /guides (public) and GET /admin/guides (privileged). Paginated,
   * filterable by hazardType, approval, language and a computed `stale`
   * flag. When `publicOnly` is set, the result is constrained to the public
   * states (APPROVED, PUBLISHED); requesting any other approval state is a
   * 400, so draft, in-review and retired content is never listed publicly.
   */
  async list(
    query: GuideListQuery,
    now: Date = new Date(),
    publicOnly = false,
  ): Promise<PaginatedGuideView> {
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)));

    const where: Prisma.SafetyGuideWhereInput = {};
    if (query.hazardType) where.hazardType = query.hazardType.trim();
    if (query.approval) where.approval = query.approval;
    if (query.language) where.language = query.language.trim();

    if (publicOnly) {
      if (query.approval && !GUIDE_PUBLIC_STATES.includes(query.approval)) {
        throw new BadRequestException(
          `approval must be one of ${GUIDE_PUBLIC_STATES.join(', ')} on the ` +
            'public surface; other states are admin-only.',
        );
      }
      // No explicit state requested: constrain to the public states.
      // With the Prisma WhereInput type, `in` over the readonly tuple needs
      // to be coerced to a mutable array.
      where.approval = { in: [...GUIDE_PUBLIC_STATES] };
    }

    const cutoff = new Date(
      now.getTime() - GUIDE_REVIEW_WINDOW_DAYS * 86_400_000,
    );
    if (query.stale === true) {
      // Stale = at or beyond the review window. A null lastReviewedAt is
      // 'unknown', not 'stale', so nulls are excluded. `lte` matches
      // evaluateGuideFreshness, which flags the exact boundary as stale.
      where.lastReviewedAt = { lte: cutoff };
    } else if (query.stale === false) {
      // Fresh = last reviewed strictly within the window; 'unknown'
      // (never reviewed) is excluded from the fresh list as well.
      where.lastReviewedAt = { gt: cutoff };
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.safetyGuide.count({ where }),
      this.prisma.safetyGuide.findMany({
        where,
        orderBy: [
          { lastReviewedAt: { sort: 'desc', nulls: 'last' } },
          { createdAt: 'desc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: await Promise.all(
        (rows as unknown as GuideRecord[]).map((row) => this.toView(row, now)),
      ),
      pagination: { page, pageSize, total },
    };
  }

  /**
   * GET /guides/:id (public; APPROVED or PUBLISHED only) and the privileged
   * read used by the admin surface. Returns the current revision body, full
   * metadata and the revision history in ascending order. When
   * `publicOnly` is set and the guide is not in a public state, returns
   * null so the controller answers 404: unpublished or retired content must
   * not be readable outside the review workflow.
   */
  async getDetail(
    id: string,
    now: Date = new Date(),
    publicOnly = false,
  ): Promise<GuideDetail | null> {
    const row = await this.prisma.safetyGuide.findUnique({ where: { id } });
    if (!row) return null;

    if (publicOnly && !GUIDE_PUBLIC_STATES.includes(row.approval)) {
      return null;
    }

    const [view, revisions] = await Promise.all([
      this.toView(row as unknown as GuideRecord, now),
      this.prisma.guideRevision.findMany({
        where: { guideId: id },
        orderBy: { revision: 'asc' },
      }),
    ]);

    return {
      ...view,
      revisions: revisions.map(toRevisionView),
    };
  }

  /**
   * POST /guides (privileged). Creates a DRAFT at version 1 and writes the
   * first revision row in one transaction, so a guide always has at least
   * one revision matching its version. The body must be non-empty; a guide
   * that is not yet written up says so explicitly in the body text — a
   * placeholder must be labelled, never blank (SAFETY-POLICY.md 1).
   * Audited as GUIDE_UPDATED (a privileged content write).
   */
  async create(
    input: CreateGuideInput,
    actor: { id: string },
  ): Promise<GuideDetail> {
    const body = input.body?.trim();
    if (!body) {
      throw new BadRequestException(
        'body is required and must be non-empty; an unwritten guide must say ' +
          'so explicitly in the body (SAFETY-POLICY.md 1).',
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const guide = await tx.safetyGuide.create({
        data: {
          hazardType: input.hazardType.trim(),
          jurisdiction: normalizeText(input.jurisdiction),
          language: input.language?.trim() || 'en',
          author: normalizeText(input.author),
          reviewer: normalizeText(input.reviewer),
          authority: normalizeText(input.authority),
          approval: 'DRAFT',
          version: 1,
          references: dedupeReferences(input.references),
        },
      });
      await tx.guideRevision.create({
        data: { guideId: guide.id, revision: 1, body },
      });
      return guide;
    });

    await this.audit.record(
      actor.id,
      AUDIT_ACTIONS.GUIDE_UPDATED,
      'guide',
      created.id,
      JSON.stringify({
        event: 'created',
        hazardType: created.hazardType,
        language: created.language,
        version: 1,
      }),
    );

    const detail = await this.getDetail(created.id);
    if (!detail) throw new NotFoundException('guide create failed to persist');
    return detail;
  }

  /**
   * PATCH /guides/:id (privileged). Writes a new revision and bumps the
   * version atomically (SAFETY-POLICY.md 10: version history + review
   * dates). Allowed only from DRAFT and IN_REVIEW: a guide that is
   * APPROVED, PUBLISHED or RETIRED is immutable; to change it, retire it,
   * re-open it and run a fresh review cycle. Audited as GUIDE_UPDATED.
   */
  async update(
    id: string,
    input: UpdateGuideInput,
    actor: { id: string },
    now: Date = new Date(),
  ): Promise<GuideDetail> {
    const row = await this.mustFind(id);
    assertTransition(row.approval, GUIDE_UPDATE_FROM, 'a new revision');

    const body = input.body?.trim();
    if (!body) {
      throw new BadRequestException(
        'body is required and must be non-empty; a placeholder must say so ' +
          'explicitly in the body text.',
      );
    }

    const nextVersion = row.version + 1;
    await this.prisma.$transaction(async (tx) => {
      await tx.safetyGuide.update({
        where: { id },
        data: {
          version: nextVersion,
          jurisdiction:
            input.jurisdiction === undefined
              ? row.jurisdiction
              : normalizeText(input.jurisdiction),
          language:
            input.language === undefined ? row.language : input.language.trim(),
          author:
            input.author === undefined
              ? row.author
              : normalizeText(input.author),
          reviewer:
            input.reviewer === undefined
              ? row.reviewer
              : normalizeText(input.reviewer),
          authority:
            input.authority === undefined
              ? row.authority
              : normalizeText(input.authority),
          references:
            input.references === undefined
              ? row.references
              : dedupeReferences(input.references),
        },
      });
      await tx.guideRevision.create({
        data: { guideId: id, revision: nextVersion, body },
      });
    });

    await this.audit.record(
      actor.id,
      AUDIT_ACTIONS.GUIDE_UPDATED,
      'guide',
      id,
      JSON.stringify({
        event: 'revised',
        previousVersion: row.version,
        version: nextVersion,
      }),
    );

    const detail = await this.getDetail(id, now);
    if (!detail) throw new NotFoundException('guide not found after update');
    return detail;
  }

  /**
   * POST /guides/:id/review (privileged). DRAFT -> IN_REVIEW, stamps the
   * review date and records the named reviewer/authority that will stand
   * behind the guide (SAFETY-POLICY.md 10: a named responsible role and a
   * review date). Audited as GUIDE_REVIEWED.
   */
  async review(
    id: string,
    input: ReviewGuideInput,
    actor: { id: string },
    now: Date = new Date(),
  ): Promise<GuideDetail> {
    const row = await this.mustFind(id);
    assertTransition(row.approval, GUIDE_REVIEW_FROM, 'review');

    const lastReviewedAt = parseOptionalDate(input.reviewedAt, now);
    const reviewer = input.reviewer?.trim() || row.reviewer;
    const authority = input.authority?.trim() || row.authority;
    const updated = await this.prisma.safetyGuide.update({
      where: { id },
      data: { approval: 'IN_REVIEW', reviewer, authority, lastReviewedAt },
    });

    await this.audit.record(
      actor.id,
      AUDIT_ACTIONS.GUIDE_REVIEWED,
      'guide',
      id,
      guideAuditDetail(
        row.approval,
        'IN_REVIEW',
        reviewer,
        authority,
        lastReviewedAt,
        updated.version,
      ),
    );

    return this.getDetailOrThrow(id, now);
  }

  /**
   * POST /guides/:id/approve (privileged). IN_REVIEW -> APPROVED.
   *
   * Completeness gate (PRODUCT-SPEC.md 5, SAFETY-POLICY.md 6 and 10): a
   * guide cannot be approved without a hazard type, a named reviewer, the
   * reviewing authority and at least one authoritative reference. Any
   * missing element is rejected 400 before the state change — an uncited
   * or unattributed summary is never approvable. Audited as GUIDE_APPROVED.
   */
  async approve(
    id: string,
    input: ApproveGuideInput,
    actor: { id: string },
    now: Date = new Date(),
  ): Promise<GuideDetail> {
    const row = await this.mustFind(id);
    assertTransition(row.approval, GUIDE_APPROVE_FROM, 'approval');
    assertComplete(row);

    const lastReviewedAt = parseOptionalDate(input.reviewedAt, now);
    const updated = await this.prisma.safetyGuide.update({
      where: { id },
      data: { approval: 'APPROVED', lastReviewedAt },
    });

    await this.audit.record(
      actor.id,
      AUDIT_ACTIONS.GUIDE_APPROVED,
      'guide',
      id,
      guideAuditDetail(
        row.approval,
        'APPROVED',
        row.reviewer,
        row.authority,
        lastReviewedAt,
        updated.version,
        { rationale: input.rationale ?? null },
      ),
    );

    return this.getDetailOrThrow(id, now);
  }

  /**
   * POST /guides/:id/publish (privileged). APPROVED -> PUBLISHED. Re-checks
   * completeness defensively (data may have drifted since approval) and
   * stamps lastReviewedAt when one is not supplied. From here on the guide
   * is visible on the public surface; the version is frozen until the
   * next retirement. Audited as GUIDE_PUBLISHED.
   */
  async publish(
    id: string,
    input: PublishGuideInput,
    actor: { id: string },
    now: Date = new Date(),
  ): Promise<GuideDetail> {
    const row = await this.mustFind(id);
    assertTransition(row.approval, GUIDE_PUBLISH_FROM, 'publication');
    assertComplete(row);

    const lastReviewedAt = parseOptionalDate(input.reviewedAt, now);
    const updated = await this.prisma.safetyGuide.update({
      where: { id },
      data: { approval: 'PUBLISHED', lastReviewedAt },
    });

    await this.audit.record(
      actor.id,
      AUDIT_ACTIONS.GUIDE_PUBLISHED,
      'guide',
      id,
      guideAuditDetail(
        row.approval,
        'PUBLISHED',
        row.reviewer,
        row.authority,
        lastReviewedAt,
        updated.version,
        { rationale: input.rationale ?? null },
      ),
    );

    return this.getDetailOrThrow(id, now);
  }

  /**
   * POST /guides/:id/retire (privileged). PUBLISHED -> RETIRED and stamps
   * lastReviewedAt. The guide drops out of the public listing and its
   * detail endpoint 404s for public callers; it stays readable through the
   * admin surface with the RETIRED label. Audited as GUIDE_RETIRED.
   */
  async retire(
    id: string,
    input: RetireGuideInput,
    actor: { id: string },
    now: Date = new Date(),
  ): Promise<GuideDetail> {
    const row = await this.mustFind(id);
    assertTransition(row.approval, GUIDE_RETIRE_FROM, 'retirement');

    const lastReviewedAt = parseOptionalDate(input.retiredAt, now);
    const updated = await this.prisma.safetyGuide.update({
      where: { id },
      data: { approval: 'RETIRED', lastReviewedAt },
    });

    await this.audit.record(
      actor.id,
      AUDIT_ACTIONS.GUIDE_RETIRED,
      'guide',
      id,
      guideAuditDetail(
        row.approval,
        'RETIRED',
        row.reviewer,
        row.authority,
        lastReviewedAt,
        updated.version,
        { rationale: input.rationale ?? null },
      ),
    );

    return this.getDetailOrThrow(id, now);
  }

  /**
   * POST /guides/:id/reopen (privileged). RETIRED -> DRAFT so a fresh
   * review cycle can re-publish content whose review window has elapsed.
   * The revision history is preserved; the next revision write bumps the
   * version. Audited as GUIDE_UPDATED.
   */
  async reopen(
    id: string,
    actor: { id: string },
    now: Date = new Date(),
  ): Promise<GuideDetail> {
    const row = await this.mustFind(id);
    assertTransition(row.approval, GUIDE_REOPEN_FROM, 'reopen');

    await this.prisma.safetyGuide.update({
      where: { id },
      data: { approval: 'DRAFT' },
    });

    await this.audit.record(
      actor.id,
      AUDIT_ACTIONS.GUIDE_UPDATED,
      'guide',
      id,
      guideAuditDetail(
        row.approval,
        'DRAFT',
        row.reviewer,
        row.authority,
        row.lastReviewedAt ?? now,
        row.version,
        { event: 'reopened' },
      ),
    );

    return this.getDetailOrThrow(id, now);
  }

  /* ------------------------------------------------------------------ */

  private async mustFind(id: string): Promise<GuideRecord> {
    const row = await this.prisma.safetyGuide.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException(`guide not found: ${id}`);
    }
    return row as unknown as GuideRecord;
  }

  private async getDetailOrThrow(id: string, now: Date): Promise<GuideDetail> {
    const detail = await this.getDetail(id, now);
    if (!detail)
      throw new NotFoundException('guide not found after state change');
    return detail;
  }

  /**
   * Projects a row into the view shape: metadata, the current revision's
   * body and the computed freshness label (SAFETY-POLICY.md 8).
   */
  private async toView(row: GuideRecord, now: Date): Promise<GuideView> {
    const currentRevision = await this.prisma.guideRevision.findFirst({
      where: { guideId: row.id, revision: row.version },
      orderBy: { revision: 'desc' },
    });
    return {
      id: row.id,
      hazardType: row.hazardType,
      jurisdiction: row.jurisdiction,
      language: row.language,
      author: row.author,
      reviewer: row.reviewer,
      authority: row.authority,
      approval: row.approval,
      version: row.version,
      lastReviewedAt: row.lastReviewedAt?.toISOString() ?? null,
      references: row.references,
      body: currentRevision?.body ?? null,
      freshness: evaluateGuideFreshness({
        lastReviewedAt: row.lastReviewedAt,
        now,
      }),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/**
 * Completeness gate for approving/publishing (PRODUCT-SPEC.md 5: every
 * guide requires hazard type, jurisdiction applicability, language,
 * author, reviewer, authoritative references, version, approval state and
 * last-reviewed date; SAFETY-POLICY.md 6: summaries retain source links).
 * 400 with a clear, actionable message when any required element is missing.
 */
function assertComplete(row: GuideRecord): void {
  const missing: string[] = [];
  if (!row.hazardType?.trim()) missing.push('hazardType');
  if (!row.reviewer?.trim()) missing.push('reviewer');
  if (!row.authority?.trim()) missing.push('authority');
  if (row.references.length === 0) missing.push('references');
  if (missing.length > 0) {
    throw new BadRequestException(
      `A published guide requires: ${missing.join(', ')}. SENTRAVYN will not ` +
        'publish an uncited or unattributed summary (SAFETY-POLICY.md 6, 10).',
    );
  }
}

function parseOptionalDate(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(
      'the supplied timestamp must be valid ISO 8601.',
    );
  }
  return parsed;
}

function toRevisionView(r: {
  revision: number;
  body: string;
  createdAt: Date;
}): GuideRevisionView {
  return {
    revision: r.revision,
    body: r.body,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Empty strings become null; non-empty strings are trimmed. */
function normalizeText(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Trims each entry, drops blanks and removes exact duplicates. */
function dedupeReferences(references: string[] | undefined): string[] {
  if (!references) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const ref of references) {
    const trimmed = ref.trim();
    if (trimmed === '' || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
