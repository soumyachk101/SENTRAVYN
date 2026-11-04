import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AuditService, AUDIT_ACTIONS } from './audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/rbac/roles.guard';
import { Roles } from '../common/rbac/roles.decorator';

/**
 * Query params for GET /admin/audit. Matches the strict global ValidationPipe
 * (whitelist + forbidNonWhitelisted), so every accepted param is declared here.
 * `limit` arrives as a string; @Type converts it since implicit conversion is
 * disabled in the pipe config.
 */
export class AuditListQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsString()
  entity?: string;
}

/**
 * Read-only admin endpoint for the audit trail.
 *
 * Authorization: JWT authentication (JwtAuthGuard) plus @Roles('ADMIN')
 * enforced by RolesGuard, attached at the controller level.
 */
@ApiTags('audit')
@Controller('admin/audit')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles('ADMIN')
  @ApiOperation({
    summary: 'List recent audit events (admin)',
    description:
      `Most recent audit events, newest first. Optional filter: entity. ` +
      `Known actions: ${Object.values(AUDIT_ACTIONS).join(', ')}.`,
  })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'entity', required: false })
  list(@Query() query: AuditListQuery) {
    return this.audit.list(query);
  }
}
