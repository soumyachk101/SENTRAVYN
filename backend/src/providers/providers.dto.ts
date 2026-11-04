import {
  IsArray,
  IsBoolean,
  IsUrl,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Strict provider upsert payload (POST /providers).
 *
 * Validated by the global ValidationPipe (whitelist + forbidNonWhitelisted,
 * see backend/src/main.ts): any field not declared here is rejected, and
 * every declared field must pass its constraint.
 */
export class ProviderUpsertDto {
  /**
   * Stable provider identifier, e.g. "usgs". Upsert key: a provider with the
   * same key is updated in place instead of duplicated.
   */
  @Matches(/^[a-z0-9][a-z0-9-]{1,62}$/, {
    message: 'key must be lowercase kebab-case (2-63 chars)',
  })
  key: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name: string;

  /** Official documentation URL. IsUrl rejects non-URL strings. */
  @IsUrl()
  docUrl: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  license?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  attribution?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  /**
   * Maximum age (whole hours) before a provider's latest data is labelled
   * stale (SAFETY-POLICY.md 8). 1-240 hours.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(240)
  freshnessPolicyHours?: number;
}

/**
 * Body for POST /providers/seed.
 *
 * Omitting `providers` (or sending an empty body) seeds the three Phase 2
 * fixture providers documented in docs/DATA-SOURCES.md. Supplying explicit
 * rows upserts those instead; the per-element DTOs are validated by the
 * pipe and keys follow the same rules as ProviderUpsertDto.
 */
export class ProvidersSeedDto {
  @IsOptional()
  @IsArray({ message: 'providers must be an array of provider rows' })
  @ValidateNested({ each: true })
  @Type(() => ProviderUpsertDto)
  providers?: ProviderUpsertDto[];
}

/** Body for PATCH /providers/:key/enable and /disable. */
export class ProviderSetEnabledDto {
  @IsBoolean()
  enabled: boolean;
}
