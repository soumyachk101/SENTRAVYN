import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/rbac/roles.guard';
import { Roles } from '../common/rbac/roles.decorator';
import { CurrentUser, AuthUser } from '../common/rbac/current-user.decorator';
import { AdminReviewService, DecideResult } from './admin-review.service';
import { AdminReviewDecisionDto, QueryKindDto } from './admin-review.dto';

/**
 * Admin review API (SAFETY-POLICY.md 3, Gate E; SECURITY.md 6).
 *
 * - GET /admin/review/queue?kind=alerts|places: the unverified review
 *   surface, for REVIEWER, OPERATOR and ADMIN.
 * - POST /admin/review/decide: records a review decision and applies the
 *   minimum state change it implies; REVIEWER, OPERATOR and ADMIN.
 *
 * Every request passes JwtAuthGuard (authentication, request.user), then
 * RolesGuard enforcing @Roles (fail-closed). The service stays role-
 * agnostic and writes an AdminReviewDecision row for every decision.
 */
@ApiTags('admin-review')
@Controller('admin/review')
@UseGuards(JwtAuthGuard, RolesGuard)
@SkipThrottle({ auth: true })
export class AdminReviewController {
  constructor(private readonly review: AdminReviewService) {}

  @Get('queue')
  @Roles('REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: 'List the admin review queue by kind',
    description:
      'kind=alerts returns quarantined/received alerts with source-record ' +
      'provenance and the source provider key; kind=places returns shelter ' +
      'profiles that are not VERIFIED, joined to their place. The queue ' +
      'organises human review and never asserts safety.',
  })
  queue(@Query() dto: QueryKindDto) {
    return this.review.queue(dto.kind);
  }

  @Post('decide')
  @Roles('REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: 'Record a review decision on an alert, place or shelter',
    description:
      'Records the actor, decision, rationale and (where supplied) ' +
      'authority/verification date as an immutable decision row, then ' +
      'applies only the minimum state the decision implies: ' +
      'SHELTER_VERIFIED requires both a verifying authority and an ISO ' +
      'verification date and stamps them on the shelter profile and its ' +
      'place; all other decisions change no place state. SHELTER_VERIFIED ' +
      'without either field is rejected (shelter-policy.ts, Gate E).',
  })
  decide(
    @CurrentUser() user: AuthUser,
    @Body() dto: AdminReviewDecisionDto,
  ): Promise<DecideResult> {
    return this.review.decide(user, dto);
  }
}
