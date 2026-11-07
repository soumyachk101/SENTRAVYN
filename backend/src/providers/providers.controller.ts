import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
import { CurrentUser, AuthUser } from '../common/rbac/current-user.decorator';
import { Roles } from '../common/rbac/roles.decorator';
import {
  ProvidersService,
  ProviderHealthView,
  ProviderView,
  SeedResult,
} from './providers.service';
import { ProviderUpsertDto, ProvidersSeedDto } from './providers.dto';

/**
 * Data-provider registry API (docs/DATA-SOURCES.md 2).
 *
 * Routes under /providers. Every request passes JwtAuthGuard
 * (authentication, request.user) then RolesGuard enforcing @Roles,
 * attached at the controller level; fail-closed behaviour is documented in
 * the RBAC layer.
 *
 * - GET /providers: any authenticated role.
 * - Mutating routes: ADMIN only (@Roles('ADMIN')).
 */
@ApiTags('providers')
@Controller('providers')
@UseGuards(JwtAuthGuard, RolesGuard)
@SkipThrottle({ auth: true })
export class ProvidersController {
  constructor(private readonly providers: ProvidersService) {}

  @Get()
  @Roles('PUBLIC', 'REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: 'List data providers (any authenticated role)',
    description:
      'Authenticated read for any role: the guard requires request.user, so ' +
      'the route is not public, and every authenticated role may list. ' +
      'Returns provider key, name, docUrl, category, license, attribution, ' +
      'enabled, freshnessPolicyHours and lastSeededAt. No credential ' +
      'material is ever returned.',
  })
  list(): Promise<ProviderView[]> {
    return this.providers.list();
  }

  @Get('health')
  @Roles('REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary:
      'Provider fetch-health aggregation (Phase 10 section 3 data-quality monitoring)',
    description:
      'Per-provider ProviderFetch outcomes over an optional window ' +
      '(?sinceHours=N; unbounded when omitted): success/partial/failed/' +
      'outage counts, the most recent finished fetch and whether it was an ' +
      'OUTAGE. FAILED counts include RATE_LIMITED; PENDING fetches are ' +
      'excluded. The outage flag is an admin/stale-provider signal only — ' +
      'the public UI never surfaces provider health (Phase 10 section 3: ' +
      'a stale provider state is admin-visible, never public).',
  })
  health(
    @Query('sinceHours') sinceHoursRaw?: string,
  ): Promise<ProviderHealthView[]> {
    const sinceHours =
      sinceHoursRaw === undefined || sinceHoursRaw === ''
        ? null
        : Number(sinceHoursRaw);
    if (
      sinceHours !== null &&
      (!Number.isFinite(sinceHours) || sinceHours <= 0)
    ) {
      throw new BadRequestException(
        'sinceHours must be a positive number of hours',
      );
    }
    return this.providers.health(sinceHours);
  }

  @Post()
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Create or update a provider by key (ADMIN)',
    description:
      'Upserts a DataProvider row by its stable key. docUrl is validated ' +
      'as an ISO URL; unknown fields are rejected by the global ' +
      'ValidationPipe (whitelist + forbidNonWhitelisted).',
  })
  upsert(
    @CurrentUser() user: AuthUser,
    @Body() dto: ProviderUpsertDto,
  ): Promise<ProviderView> {
    return this.providers.upsert(user.id, dto);
  }

  @Post('seed')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Seed the Phase 2 fixture providers (ADMIN, idempotent)',
    description:
      'Upserts the GDACS, USGS and CopernicusEMDAT fixture providers ' +
      'documented in docs/DATA-SOURCES.md (or the explicit `providers` ' +
      'array, when supplied). Seeded disabled by default; re-seeding ' +
      'refreshes metadata and lastSeededAt without duplicating keys and ' +
      'without flipping `enabled`.',
  })
  seed(
    @CurrentUser() user: AuthUser,
    @Body() dto: ProvidersSeedDto,
  ): Promise<SeedResult> {
    return this.providers.seed(user.id, dto.providers);
  }

  @Patch(':key/enable')
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'Enable a provider (ADMIN)',
    description:
      'Split-route design: enable/disable are separate PATCH routes rather ' +
      'than a boolean body, so the intent is unambiguous in the URL and in ' +
      'the audit record.',
  })
  setEnabled(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
  ): Promise<ProviderView> {
    return this.providers.setEnabled(user.id, key, true);
  }

  @Patch(':key/disable')
  @Roles('ADMIN')
  @ApiOperation({ summary: 'Disable a provider (ADMIN)' })
  setDisabled(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
  ): Promise<ProviderView> {
    return this.providers.setEnabled(user.id, key, false);
  }
}
