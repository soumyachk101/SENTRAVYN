import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/rbac/current-user.decorator';
import { PlacesService } from './places.service';
import { PlacesListQueryDto, PlaceEvidenceDto } from './places.dto';

/**
 * Places discovery API (Phase 4; ROADMAP Phase 4, ADR-017/ADR-018).
 *
 * Public reads:
 * - GET /places: radius mode when lat + lng are supplied (PostGIS nearest
 *   first, distance as a disclosed calculation, ADR-004), otherwise a
 *   simple paginated listing. Every row carries the read-path
 *   verificationLabel computed by the shelter policy, never a stored
 *   VERIFIED that has lapsed (SAFETY-POLICY.md 8, Gate E).
 * - GET /places/:id: the place with its shelter profiles, its evidence and
 *   the computed label + reasons. 404 for unknown ids.
 *
 * Shelter evidence workflow (SAFETY-POLICY.md section 9):
 * - POST /places/:id/evidence: authenticated, any role (including PUBLIC
 *   with a token). Stores a user-submitted PlaceEvidence row and records a
 *   PLACE_EVIDENCE_ADDED audit event; it NEVER mutates place/shelter
 *   verification state.
 */
@ApiTags('places')
@Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get()
  @ApiOperation({
    summary: 'List places (paginated, or radius search with lat + lng)',
    description:
      'Default mode returns a paginated place listing (page/pageSize, ' +
      'optional kind filter), each row carrying the read-path ' +
      'verificationLabel and its reasons. Radius mode is selected by ' +
      'supplying BOTH lat and lng: places with a known location within ' +
      'radiusMeters (clamped 100-500000; default 1000), nearest first, ' +
      'capped by limit (1-200, default 200), each row carrying ' +
      'distanceMeters and the literal distanceIsCalculation: true. An ' +
      'empty radius returns the fixed coverageNote. Distance is a ' +
      'calculation, never a safe-reachability claim (SAFETY-POLICY.md 2). ' +
      'A half-supplied coordinate pair (lat without lng or vice versa) is ' +
      'a 400.',
  })
  list(@Query() query: PlacesListQueryDto) {
    return this.places.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Fetch a place with its shelter profiles, evidence and label',
    description:
      'Returns the place record, its ShelterProfiles, its user-submitted ' +
      'PlaceEvidence rows (untrusted, preserved verbatim), and the ' +
      'computed read-path verificationLabel with reasons. 404 for an ' +
      'unknown id. The label never fabricates VERIFIED: a stored ' +
      'verified place whose shelter evidence has lapsed is downgraded ' +
      '(SAFETY-POLICY.md 8).',
  })
  async one(@Param('id') id: string) {
    const detail = await this.places.detail(id);
    if (!detail) {
      throw new NotFoundException('Place not found');
    }
    return detail;
  }

  @Post(':id/evidence')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Submit user evidence for a place (authenticated, any role)',
    description:
      'Creates a PlaceEvidence row (user submission; claim is stored ' +
      'verbatim, sourceUrl optional) and records the PLACE_EVIDENCE_ADDED ' +
      'audit event. A submission is treated as unverified: it never ' +
      'mutates the place or shelter verification state ' +
      '(SAFETY-POLICY.md section 9). 401 without a valid access token; ' +
      '404 when the place id is unknown. The unknown-fields whitelist ' +
      'rejects undeclared body fields.',
  })
  addEvidence(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: PlaceEvidenceDto,
  ) {
    return this.places.addEvidence(user.id, id, {
      claim: dto.claim,
      sourceUrl: dto.sourceUrl ?? null,
    });
  }
}
