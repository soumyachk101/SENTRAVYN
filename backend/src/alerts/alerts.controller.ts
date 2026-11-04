import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AlertsService, AlertListQuery } from './alerts.service';

@ApiTags('alerts')
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  @ApiOperation({
    summary: 'List alerts (paginated, with freshness labels)',
  })
  list(@Query() query: AlertListQuery) {
    return this.alerts.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch a single alert by id' })
  async one(@Param('id') id: string) {
    const alert = await this.alerts.getOne(id);
    if (!alert) {
      throw new NotFoundException('Alert not found');
    }
    return alert;
  }
}
