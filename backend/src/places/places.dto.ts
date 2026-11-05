import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query params for GET /places (the public place-discovery read).
 *
 * Validated by the global strict ValidationPipe (whitelist +
 * forbidNonWhitelisted, see backend/src/main.ts): every accepted param is
 * declared here and unknown params are rejected. Numeric params arrive as
 * strings on the wire; @Type converts them because implicit conversion is
 * disabled in the pipe config (mirrors AuditListQuery).
 *
 * Two modes:
 * - Radius mode: both `lat` and `lng` are present. `radiusMeters` and
 *   `limit` refine it; the service clamps them the way GeoService does
 *   (radius to [100, 500_000], limit to [1, 200]).
 * - Default mode: no coordinates. `page`/`pageSize` paginate; `kind`
 *   narrows the listing. `radiusMeters`/`limit` are not used.
 */
export class PlacesListQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  kind?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500_000)
  radiusMeters?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/**
 * Strict payload for POST /places/:id/evidence (Phase 4 shelter evidence
 * workflow; SAFETY-POLICY.md section 9).
 *
 * A submission only records an additional PlaceEvidence row. It is untrusted
 * user data: it is stored and audited, and it NEVER mutates place or shelter
 * verification state (SAFETY-POLICY.md 9, Gate E). `claim` is preserved
 * verbatim (no trimming) so the record stays forensically faithful.
 */
export class PlaceEvidenceDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  claim: string;

  /** Optional link to the source the submission refers to. IsUrl rejects non-URL strings. */
  @IsOptional()
  @IsUrl()
  sourceUrl?: string;
}

/** The plain (undecorated) list-query shape the service consumes. */
export interface PlacesListQuery {
  kind?: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  limit?: number;
  page?: number;
  pageSize?: number;
}

/** The plain evidence-input shape the service consumes. */
export interface PlaceEvidenceInput {
  claim: string;
  sourceUrl?: string | null;
}
