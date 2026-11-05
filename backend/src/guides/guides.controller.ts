import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GuidesService } from './guides.service';
import { GuideDetail, GuideListQuery, PaginatedGuideView } from './guides.dto';

/**
 * Public safety-guide surface (Phase 5; SAFETY-POLICY.md 5, 8, 10;
 * PRODUCT-SPEC.md 5).
 *
 * - GET /guides: the public listing. Only APPROVED and PUBLISHED guides are
 *   visible; the default filter is PUBLISHED. A hazard with no reviewed
 *   guide returns an empty list, which the UI renders as "no reviewed
 *   guide for this hazard yet" — never fabricated content.
 * - GET /guides/:id: the PUBLISHED current version's body + metadata + the
 *   full revision history. Unpublished or retired guides 404 here.
 *
 * Both routes are public (no guards). The privileged workflow lives in
 * GuidesAdminController (admin/guides): DRAFT creation, revision writes,
 * review, approval, publication, retirement and reopen — each audited
 * (SECURITY.md 6).
 */
@ApiTags('guides')
@Controller('guides')
export class GuidesController {
  constructor(private readonly guides: GuidesService) {}

  @Get()
  @ApiOperation({
    summary: 'List public safety guides (paginated, filterable)',
    description:
      'Filters: hazardType, approval (APPROVED or PUBLISHED), language, ' +
      'stale (true|false, lastReviewedAt-based review window per ' +
      'SAFETY-POLICY.md 8). The default view shows PUBLISHED guides with a ' +
      'computed freshness label; stale guides are labelled, never hidden. ' +
      'An empty list means no reviewed guide exists for that hazard yet.',
  })
  list(@Query() query: GuideListQuery): Promise<PaginatedGuideView> {
    return this.guides.list(query, new Date(), true);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Fetch one public safety guide: current version, metadata, revisions',
    description:
      'Returns the current (version) revision body plus all revisions in ' +
      'ascending order. Only APPROVED or PUBLISHED guides are readable ' +
      'here; DRAFT, IN_REVIEW and RETIRED guides 404 on this route.',
  })
  async one(@Param('id') id: string): Promise<GuideDetail> {
    const detail = await this.guides.getDetail(id, new Date(), true);
    if (!detail) {
      throw new NotFoundException('Guide not found');
    }
    return detail;
  }
}
