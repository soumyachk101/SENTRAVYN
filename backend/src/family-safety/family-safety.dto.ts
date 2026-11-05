import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Family-safety DTOs (Phase 7, SECURITY.md 5 / PRODUCT-SPEC.md 8).
 *
 * These are validated at the API boundary by the global strict
 * ValidationPipe (whitelist + forbidNonWhitelisted, see main.ts).
 * Everything here is the user's OWN data: the service enforces
 * object-level authorisation (only the owning user), and there is no
 * cross-user route at all — a user can never read another user's
 * contacts or shares.
 */

/** POST /family/contacts */
export class CreateEmergencyContactDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  relation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  /**
   * Whether this person consents to be contacted / referenced by SENTRAVYN
   * for emergency purposes. Defaults false (the model default); the UI
   * should ask explicitly.
   */
  @IsOptional()
  @IsBoolean()
  consent?: boolean;
}

/** PATCH /family/contacts/:id (all fields optional; at least one required) */
export class UpdateEmergencyContactDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  relation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsBoolean()
  consent?: boolean;
}

/**
 * One kit checklist entry: a preparedness item and whether it is done.
 */
export class KitChecklistItemDto {
  @IsString()
  @MaxLength(200)
  label: string;

  @IsBoolean()
  done: boolean;
}

/** POST /family/location-shares */
export class CreateLocationShareDto {
  /** Who may receive the location. */
  @IsString()
  @MaxLength(120)
  recipient: string;

  /** Why (explicit consent scope, SECURITY.md 5). */
  @IsString()
  @MaxLength(400)
  purpose: string;

  /** Bounded expiry (ISO 8601). A share is never open-ended. */
  @IsDateString()
  expiresAt: string;

  /**
   * Whether precise coordinates are permitted for this share. Precise only
   * with this explicit flag; otherwise only a coarse position is allowed.
   */
  @IsOptional()
  @IsBoolean()
  preciseConsent?: boolean;

  /**
   * Optional coarse last-known position to record at creation. Must be a
   * coarse value (the mobile client rounds to ~km). Precision is not
   * validated here — the client contract is coarse; a precise value would be
   * misuse, but the column simply stores what it is given.
   */
  @IsOptional()
  @IsString()
  lastKnownLat?: string;

  @IsOptional()
  @IsString()
  lastKnownLng?: string;
}

/** PUT /family/household-plan */
export class UpdateHouseholdPlanDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  meetingPoint?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  meetingPointNote?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KitChecklistItemDto)
  kitChecklist?: KitChecklistItemDto[];

  @IsOptional()
  @IsString()
  @MaxLength(600)
  petConsiderations?: string;
}
