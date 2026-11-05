import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AppService } from './app.service';

/**
 * Non-auth surface: the general `default` rate limit governs this; the tight
 * `auth` credential-exchange limit does not (throttling.module.ts, SECURITY.md 3).
 */
@ApiTags('meta')
@Controller('meta')
@SkipThrottle({ auth: true })
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'API metadata (version, name, disclaimer)' })
  @ApiOkResponse({ description: 'API metadata envelope' })
  meta() {
    return this.appService.meta();
  }
}
