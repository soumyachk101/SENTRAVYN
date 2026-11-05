import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * The closed set of guide approval states. Must stay in sync with the Prisma
 * GuideApprovalState enum; the @IsIn below enforces it at the boundary so
 * a typo or a removed state is rejected 400, not stored (CLAUDE.md 12).
 */
export const GUIDE_APPROVAL_STATES = [
  'DRAFT',
  'IN_REVIEW',
  'APPROVED',
  'PUBLISHED',
  'RETIRED',
] as const;
export type GuideApprovalState = (typeof GUIDE_APPROVAL_STATES)[number];

/** The known hazard categories (PRODUCT-SPEC.md 4). */
export const HAZARD_TYPES = [
  'NUCLEAR',
  'RADIOLOGICAL',
  'CONFLICT',
  'MISSILE',
  'EARTHQUAKE',
  'TSUNAMI',
  'FLOOD',
  'CYCLONE',
  'SEVERE_WEATHER',
  'WILDFIRE',
  'INDUSTRIAL',
  'CHEMICAL',
  'PUBLIC_HEALTH',
  'INFRASTRUCTURE',
  'UTILITY',
] as const;
export type HazardType = (typeof HAZARD_TYPES)[number];

/**
 * Boolean query param coercion. The global ValidationPipe disables implicit
 * conversion (main.ts), so `stale=true` arrives as the string 'true'; this
 * transform maps the accepted string forms onto real booleans so the
 * service sees `stale` as `true | false | undefined`, never as a string.
 */
function TransformBoolean() {
  return Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  });
}

/** Query DTO for GET /guides. */
export class GuideListQuery {
  @IsOptional()
  @TransformBoolean()
  @IsBoolean()
  stale?: boolean;

  @IsOptional()
  @Type(() => String)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  hazardType?: string;

  @IsOptional()
  @IsIn([...GUIDE_APPROVAL_STATES])
  approval?: GuideApprovalState;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(8)
  language?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/** Body for POST /guides. */
export class CreateGuideInput {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  hazardType: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  body: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  jurisdiction?: string;

  /** BCP-47 style code, 2-8 chars ('en', 'de', 'pt-BR'). Defaults to 'en'. */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(8)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  author?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reviewer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  authority?: string;

  /**
   * Authoritative source references (URLs or citation strings). Up to 32
   * entries; each trimmed and deduped by the caller. Empty at create time is
   * allowed for a DRAFT; publication requires at least one.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  references?: string[];
}

/** Body for PATCH /guides/:id. Every field optional; the body is required. */
export class UpdateGuideInput {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  body?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  jurisdiction?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(8)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  author?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reviewer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  authority?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @MaxLength(500, { each: true })
  references?: string[];
}

/** Body for POST /guides/:id/review. */
export class ReviewGuideInput {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reviewer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  authority?: string;

  @IsOptional()
  @IsDateString()
  reviewedAt?: string;
}

/** Body for POST /guides/:id/approve (IN_REVIEW -> APPROVED). */
export class ApproveGuideInput {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string;

  @IsOptional()
  @IsDateString()
  reviewedAt?: string;
}

/** Body for POST /guides/:id/publish (APPROVED -> PUBLISHED). */
export class PublishGuideInput {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string;

  @IsOptional()
  @IsDateString()
  reviewedAt?: string;
}

/** Body for POST /guides/:id/retire. */
export class RetireGuideInput {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string;

  @IsOptional()
  @IsDateString()
  retiredAt?: string;
}

/* ------------------------------------------------------------------ */
/* Response shapes (mirror the service views; used by the api-client). */
/* ------------------------------------------------------------------ */

export interface GuideRevisionView {
  revision: number;
  body: string;
  /** ISO 8601. */
  createdAt: string;
}

/** One guide as the public surfaces see it. */
export interface GuideView {
  id: string;
  hazardType: string;
  jurisdiction: string | null;
  language: string;
  author: string | null;
  reviewer: string | null;
  authority: string | null;
  approval: GuideApprovalState;
  version: number;
  /** ISO 8601; null when the guide has never been reviewed. */
  lastReviewedAt: string | null;
  /** Authoritative source references. */
  references: string[];
  /** Body of the current (version) revision; null if none was written. */
  body: string | null;
  /** Freshness label computed server-side (SAFETY-POLICY.md 8). */
  freshness: 'fresh' | 'stale' | 'unknown';
  createdAt: string;
  updatedAt: string;
}

export interface GuideDetail extends GuideView {
  revisions: GuideRevisionView[];
}

export interface PaginatedGuideView {
  items: GuideView[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}
