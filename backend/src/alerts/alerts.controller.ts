import { Controller, Get, Param, Query, NotFoundException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AlertsService, AlertListQuery, AlertDetail } from './alerts.service';

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
  @ApiOperation({
    summary: 'Fetch a single alert with revisions + provenance',
  })
  async one(@Param('id') id: string): Promise<AlertDetail> {
    // Returns the AlertDetail envelope (alert + revisions + provenance), not
    // the bare AlertResponse. The Phase 1 e2e only asserts the 404 status on
    // this route, so the body change is safe (backend/test/e2e/api.e2e-spec.ts).
    const detail = await this.alerts.getDetail(id);
    if (!detail) {
      throw new NotFoundException('Alert not found');
    }
    return detail;
  }
}
