import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/rbac/roles.guard';
import { CurrentUser, AuthUser } from '../common/rbac/current-user.decorator';
import { Roles } from '../common/rbac/roles.decorator';
import {
  CreateEmergencyContactDto,
  CreateLocationShareDto,
  UpdateEmergencyContactDto,
  UpdateHouseholdPlanDto,
} from './family-safety.dto';
import {
  FamilySafetyService,
  EmergencyContactView,
  HouseholdPlanView,
  LocationShareView,
} from './family-safety.service';

/**
 * Family-safety API (Phase 7, SECURITY.md 5, PRODUCT-SPEC.md 8).
 *
 * Routes under /family. Every route is authenticated (JwtAuthGuard ->
 * request.user) and any-role (RolesGuard runs after it; there is no
 * @Roles restriction beyond authentication). OBJECT-LEVEL authorisation is
 * enforced in the service: every query is scoped to request.user.id, and a
 * resource id that belongs to another user is answered 404 (existence of
 * other users' records is never confirmed).
 *
 * Privacy (SECURITY.md 5): location is requested at the moment of need,
 * consented explicitly, bounded by expiry, revocable, and never exact in
 * persistence or logs.
 */
@ApiTags('family')
@Controller('family')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FamilySafetyController {
  constructor(private readonly family: FamilySafetyService) {}

  // ---------------------------------------------------------- contacts

  @Get('contacts')
  @Roles('PUBLIC', 'REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: "List the user's emergency contacts",
    description:
      'Returns the authenticated user\'s own EmergencyContact rows. Object-' +
      'level authorisation: no user can ever list another user\'s contacts.',
  })
  listContacts(
    @CurrentUser() user: AuthUser,
  ): Promise<EmergencyContactView[]> {
    return this.family.listContacts(user.id);
  }

  @Post('contacts')
  @Roles('PUBLIC', 'REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: "Add one of the user's emergency contacts",
    description:
      'Creates a contact owned by the authenticated user. `consent` must be ' +
      'an explicit value when the recipient has not consented. Audited.',
  })
  createContact(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateEmergencyContactDto,
  ): Promise<EmergencyContactView> {
    return this.family.createContact(user.id, dto);
  }

  @Patch('contacts/:id')
  @Roles('PUBLIC', 'REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: "Update one of the user's own emergency contacts",
    description:
      'Scoped to the owner: a contact id that belongs to another user (or ' +
      'does not exist) is a 404, by design. Audited.',
  })
  updateContact(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateEmergencyContactDto,
  ): Promise<EmergencyContactView> {
    return this.family.updateContact(user.id, id, dto);
  }

  @Delete('contacts/:id')
  @Roles('PUBLIC', 'REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: "Delete one of the user's own emergency contacts",
    description: 'Owner-scoped; a foreign id is a 404, not a 403. Audited.',
  })
  deleteContact(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.family.deleteContact(user.id, id);
  }

  // ---------------------------------------------------------- location shares

  @Get('location-shares')
  @Roles('PUBLIC', 'REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: "List the user's location shares (with computed active flag)",
    description:
      'Each share carries a read-time computed `active` = consented and not ' +
      'revoked and not expired; the flag is never stored. Owner-scoped; no ' +
      'route exposes another user\'s shares. Coarse last-known position only.',
  })
  listShares(
    @CurrentUser() user: AuthUser,
  ): Promise<LocationShareView[]> {
    return this.family.listShares(user.id);
  }

  @Post('location-shares')
  @Roles('PUBLIC', 'REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary:
      'Create a consent-based location share (purpose, recipient, bounded expiry)',
    description:
      'Creates a LocationShare only with explicit consent: recipient + ' +
      'purpose + a bounded expiresAt are required. A coarse last-known ' +
      'position may be recorded (rounded to ~110 m server-side; precise ' +
      'coordinates are never persisted). preciseConsent marks whether ' +
      'precise sharing is allowed for this grant. Audited without any ' +
      'location value.',
  })
  createShare(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateLocationShareDto,
  ): Promise<LocationShareView> {
    return this.family.createShare(user.id, dto);
  }

  @Post('location-shares/:id/revoke')
  @HttpCode(HttpStatus.OK)
  @Roles('PUBLIC', 'REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: "Immediately revoke one of the user's own location shares",
    description:
      'Revocation is immediate and irreversible (consented=false, revoked=' +
      'true, revokedAt=now), owner-scoped (a foreign id is 404), and is a ' +
      'security-relevant mutation: audited. No location value is logged.',
  })
  revokeShare(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<LocationShareView> {
    return this.family.revokeShare(user.id, id);
  }

  // ---------------------------------------------------------- household plan

  @Get('household-plan')
  @Roles('PUBLIC', 'REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: "Get the user's household plan (meeting point, kit, pets)",
    description:
      'Returns the user\'s own HouseholdPlan, or null when none is stored ' +
      'yet. This is the user\'s preparedness data, not a live operational ' +
      'claim.',
  })
  getHouseholdPlan(
    @CurrentUser() user: AuthUser,
  ): Promise<HouseholdPlanView | null> {
    return this.family.getHouseholdPlan(user.id);
  }

  @Put('household-plan')
  @Roles('PUBLIC', 'REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: "Create or update the user's household plan (upsert)",
    description:
      'All fields optional; omitted fields keep their current value on an ' +
      'existing plan. The kit checklist is a validated array of { label, ' +
      'done }. Owned by the user; a separate user\'s plan is unreachable.',
  })
  upsertHouseholdPlan(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateHouseholdPlanDto,
  ): Promise<HouseholdPlanView> {
    return this.family.upsertHouseholdPlan(user.id, dto);
  }
}
