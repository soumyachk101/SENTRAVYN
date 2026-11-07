import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ProvidersService, CoverageView } from './providers.service';

/**
 * Public coverage-disclosure API (docs/PHASE-10-LAUNCH-READINESS.md
 * section 1, docs/DATA-SOURCES.md section 6).
 *
 * Non-auth surface: governed only by the general `default` rate limit
 * (throttling.module.ts, SECURITY.md 3) — the same treatment as the public
 * /alerts and /places read paths. This is deliberately a separate controller
 * from the auth-gated ProvidersController: that one enforces JwtAuthGuard +
 * RolesGuard at the controller level, and this public route must carry no
 * such guard, so it lives on its own route.
 *
 * The endpoint answers one public question: what data kinds does the platform
 * actually cover right now? The answer is derived from the enabled provider
 * registry, never hard-coded, so a disabled/empty registry reads as a real
 * "no coverage" state rather than fabricated coverage (SAFETY-POLICY.md 1, 6).
 * The landing page, footer and /terms read this; it is the machine-readable
 * form of the disclosure those surfaces render.
 */
@ApiTags('coverage')
@Controller('coverage')
@SkipThrottle({ auth: true })
export class CoverageController {
  constructor(private readonly providers: ProvidersService) {}

  @Get()
  @ApiOperation({
    summary: 'Public coverage disclosure (registry-derived, never hard-coded)',
    description:
      'Returns the fixed coverage note (a listing is not proof a place is ' +
      'open, safe or operational), whether any provider is enabled ' +
      '(`hasCoverage`), the enabled/total provider counts, and the covered ' +
      'and uncovered data categories. Derived from the enabled provider ' +
      'registry so the public UI discloses real coverage; an all-disabled ' +
      'registry is the `hasCoverage: false` "no coverage" state, not a ' +
      'fabricated source. Read-only, unauthenticated.',
  })
  coverage(): Promise<CoverageView> {
    return this.providers.coverage();
  }
}
