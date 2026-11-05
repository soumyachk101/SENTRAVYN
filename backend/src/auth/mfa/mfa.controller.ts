import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { MfaService, MfaStatus } from './mfa.service';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../../common/rbac/current-user.decorator';

export class MfaCodeDto {
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  code: string;
}

/**
 * MFA endpoints (docs/SECURITY.md section 2). Enrolment (setup/verify),
 * status and disable are self-service and require a valid session
 * (JwtAuthGuard). The privileged login step-2 (`/auth/mfa/complete`) lives
 * on AuthController (it issues the full token pair via AuthService); this
 * controller handles the account-layer flows.
 *
 * None of these ever return the stored seed or plaintext recovery codes
 * after the one-time /setup response (SECURITY.md 4).
 */
@ApiTags('auth')
@Controller('auth/mfa')
export class MfaController {
  constructor(private readonly mfa: MfaService) {}

  @Post('setup')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Begin TOTP enrolment: returns a one-time seed, URI and 8 recovery codes',
  })
  setup(@CurrentUser() user: AuthUser) {
    return this.mfa.setup(user.id);
  }

  @Post('verify')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm a valid TOTP/recovery code, which enables MFA on the account',
  })
  verify(@CurrentUser() user: AuthUser, @Body() dto: MfaCodeDto) {
    return this.mfa.verifyMfa(user.id, dto.code);
  }

  @Post('disable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable MFA after proving a valid second factor' })
  disable(@CurrentUser() user: AuthUser, @Body() dto: MfaCodeDto) {
    return this.mfa.disableMfa(user.id, dto.code);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Report MFA state (enabled + remaining recovery codes, never the seed)',
  })
  status(@CurrentUser() user: AuthUser): Promise<MfaStatus> {
    return this.mfa.status(user.id);
  }
}
