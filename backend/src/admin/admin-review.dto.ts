import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { DecisionOutcome } from './admin-review.service';

/** Kinds of review queues. */
export type QueueKind = 'alerts' | 'places';

/** Query DTO for GET /admin/review/queue?kind=alerts|places. */
export class QueryKindDto {
  @IsIn(['alerts', 'places'])
  kind: QueueKind;
}

/** Explicit target of a review decision. */
export class AdminReviewTargetDto {
  @IsIn(['alert', 'place', 'shelter'])
  kind: string;

  @IsString()
  @MaxLength(64)
  id: string;
}

/**
 * Body for POST /admin/review/decide.
 *
 * Validated by the global ValidationPipe (whitelist + forbidNonWhitelisted,
 * see backend/src/main.ts). `decision` is typed as the service's
 * DecisionOutcome union so AdminReviewService.decide can hand the value to
 * its strict result and audit-mapping functions; the @IsIn guard enforces
 * the same closed set at the boundary. authority and verificationDate are
 * optional at the DTO level: their requiredness for SHELTER_VERIFIED is a
 * policy check the service performs (SAFETY-POLICY.md 3, Gate E), so a
 * missing value is rejected with a policy-specific 400, not a 422 schema
 * error.
 */
export class AdminReviewDecisionDto {
  @ValidateNested()
  @Type(() => AdminReviewTargetDto)
  target: AdminReviewTargetDto;

  @IsIn(['REVIEW_APPROVED', 'REVIEW_REJECTED', 'SHELTER_VERIFIED', 'SHELTER_STALE'])
  decision: DecisionOutcome;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string;

  /** Verifying authority, required for SHELTER_VERIFIED (Gate E). */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  authority?: string;

  /** ISO 8601 date, required for SHELTER_VERIFIED (Gate E). */
  @IsOptional()
  @IsDateString()
  verificationDate?: string;
}
