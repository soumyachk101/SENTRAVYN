import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('meta')
@Controller('meta')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'API metadata (version, name, disclaimer)' })
  @ApiOkResponse({ description: 'API metadata envelope' })
  meta() {
    return this.appService.meta();
  }
}
