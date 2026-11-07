import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/rbac/roles.guard';
import { Roles } from '../common/rbac/roles.decorator';
import { CurrentUser, AuthUser } from '../common/rbac/current-user.decorator';
import { GuidesService } from './guides.service';
import {
  ApproveGuideInput,
  CreateGuideInput,
  GuideDetail,
  GuideListQuery,
  PaginatedGuideView,
  PublishGuideInput,
  ReviewGuideInput,
  RetireGuideInput,
  UpdateGuideInput,
} from './guides.dto';

/**
 * Privileged guide-workflow surface (Phase 5; SAFETY-POLICY.md 10;
 * SECURITY.md 6). Mirrors admin-review.controller.ts: every request passes
 * JwtAuthGuard (authentication) then RolesGuard enforcing @Roles
 * (fail-closed); the service writes an AuditEvent row for every state
 * change (SECURITY.md 6: every privileged mutation is audited).
 *
 * - GET /admin/guides: all states, same query surface as /guides.
 * - POST /admin/guides: create a DRAFT at version 1 with its first
 *   revision row (one transaction).
 * - PATCH /admin/guides/:id: new revision + version bump (one transaction);
 *   only from DRAFT or IN_REVIEW.
 * - POST /admin/guides/:id/review: DRAFT -> IN_REVIEW, stamps the review
 *   date (GUIDE_REVIEWED).
 * - POST /admin/guides/:id/approve: IN_REVIEW -> APPROVED; completeness
 *   gate — reviewer, authority and a non-empty references array are
 *   required or the request 400s (GUIDE_APPROVED).
 * - POST /admin/guides/:id/publish: APPROVED -> PUBLISHED (GUIDE_PUBLISHED).
 * - POST /admin/guides/:id/retire: PUBLISHED -> RETIRED, stamps the review
 *   date (GUIDE_RETIRED).
 * - POST /admin/guides/:id/reopen: RETIRED -> DRAFT, a new review cycle
 *   (GUIDE_UPDATED).
 */
@ApiTags('guides-admin')
@Controller('admin/guides')
@SkipThrottle({ auth: true })
@UseGuards(JwtAuthGuard, RolesGuard)
export class GuidesAdminController {
  constructor(private readonly guides: GuidesService) {}

  @Get()
  @Roles('REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: 'List guides in any approval state (admin)',
    description:
      'Same query surface as GET /guides but without the public-state ' +
      'restriction: DRAFT, IN_REVIEW, APPROVED, PUBLISHED and RETIRED are ' +
      'all addressable. REVIEWER, OPERATOR and ADMIN.',
  })
  list(@Query() query: GuideListQuery): Promise<PaginatedGuideView> {
    return this.guides.list(query, new Date(), false);
  }

  @Get(':id')
  @Roles('REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({ summary: 'Fetch one guide in any state (admin)' })
  async one(@Param('id') id: string): Promise<GuideDetail> {
    const detail = await this.guides.getDetail(id);
    if (!detail) {
      throw new NotFoundException('Guide not found');
    }
    return detail;
  }

  @Post()
  @Roles('REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: 'Create a new safety guide (DRAFT, version 1)',
    description:
      'Writes the guide row and its first GuideRevision row in one ' +
      'transaction. The body must be non-empty; an unwritten guide must ' +
      'say so explicitly in the body text. REVIEWER, OPERATOR and ADMIN.',
  })
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateGuideInput,
  ): Promise<GuideDetail> {
    return this.guides.create(dto, user);
  }

  @Patch(':id')
  @Roles('REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: 'Write a new revision and bump the guide version',
    description:
      'Revision write + version bump in one transaction; only from DRAFT ' +
      'or IN_REVIEW. APPROVED, PUBLISHED and RETIRED guides are immutable; ' +
      'retire and reopen them to start a new review cycle.',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateGuideInput,
  ): Promise<GuideDetail> {
    return this.guides.update(id, dto, user);
  }

  @Post(':id/review')
  @Roles('REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: 'Send a DRAFT guide into review (DRAFT -> IN_REVIEW)',
    description:
      'Stamps lastReviewedAt and records the acting reviewer and authority. ' +
      'Audited as GUIDE_REVIEWED.',
  })
  review(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ReviewGuideInput,
  ): Promise<GuideDetail> {
    return this.guides.review(id, dto, user);
  }

  @Post(':id/approve')
  @Roles('REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: 'Approve an in-review guide (IN_REVIEW -> APPROVED)',
    description:
      'Completeness gate: the guide must have a hazard type, a named ' +
      'reviewer, the reviewing authority and at least one reference, or ' +
      'the request rejects 400. Audited as GUIDE_APPROVED.',
  })
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ApproveGuideInput,
  ): Promise<GuideDetail> {
    return this.guides.approve(id, dto, user);
  }

  @Post(':id/publish')
  @Roles('REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: 'Publish an approved guide (APPROVED -> PUBLISHED)',
    description:
      'Makes the guide visible on the public surface. Completeness is ' +
      're-checked at publish time. Audited as GUIDE_PUBLISHED.',
  })
  publish(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: PublishGuideInput,
  ): Promise<GuideDetail> {
    return this.guides.publish(id, dto, user);
  }

  @Post(':id/retire')
  @Roles('REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: 'Retire a published guide (PUBLISHED -> RETIRED)',
    description:
      'Removes the guide from the public surface; it remains readable ' +
      'here in any state. Stamps lastReviewedAt. Audited as GUIDE_RETIRED.',
  })
  retire(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RetireGuideInput,
  ): Promise<GuideDetail> {
    return this.guides.retire(id, dto, user);
  }

  @Post(':id/reopen')
  @Roles('REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: 'Reopen a retired guide for a new review cycle (RETIRED -> DRAFT)',
    description:
      'Starts a new review cycle; the revision history is preserved. ' +
      'Audited as GUIDE_UPDATED (event=reopened).',
  })
  reopen(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<GuideDetail> {
    return this.guides.reopen(id, user);
  }
}
