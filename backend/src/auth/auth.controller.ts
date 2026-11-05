import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Request } from 'express';
import { AuthService, AuthTokens, MfaPendingLogin, PublicUser } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/rbac/current-user.decorator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(320)
  email: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  displayName?: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password: string;
}

export class LoginDto {
  @IsEmail()
  @MaxLength(320)
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;
}

export class RefreshDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  refreshToken: string;
}

export class LogoutDto {
  @IsString()
  @MinLength(1)
  @MaxLength(512)
  refreshToken: string;
}

/** Body for POST /auth/mfa/complete (privileged login step 2). */
export class MfaCompleteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  mfaTempToken: string;

  @IsString()
  @MinLength(4)
  @MaxLength(64)
  code: string;
}

/** Body for POST /auth/sessions/:id/revoke (id is validated in the handler). */
export class RevokeSessionDto {
  @IsString()
  @MaxLength(64)
  @MinLength(1)
  sessionId: string;
}

interface AuthRequest extends Request {
  user?: { id: string; role: string; email: string };
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a public account' })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto.email, dto.displayName ?? null, dto.password);
  }

  @Post('login')
  // Credential exchange is a read-style operation: 200, not the Nest POST
  // default of 201 (register keeps 201 for user creation). For a privileged
  // account that has enrolled MFA this returns a pending token instead of a
  // token pair (MfaPendingLogin) — the client must complete step 2.
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Exchange credentials for access + refresh tokens, or a pending MFA ' +
      'token when the account is a privileged role with MFA enabled',
  })
  login(@Body() dto: LoginDto): Promise<AuthTokens | MfaPendingLogin> {
    return this.auth.login(dto.email, dto.password);
  }

  @Post('mfa/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Privileged login step 2: exchange the pending MFA token + a valid TOTP ' +
      'or recovery code for a full token pair',
  })
  completeMfa(@Body() dto: MfaCompleteDto): Promise<AuthTokens> {
    return this.auth.completeMfaLogin(dto.mfaTempToken, dto.code);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate a refresh token, returning a new token pair' })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke the session backing a refresh token' })
  logout(@Body() dto: LogoutDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Current authenticated user (requires access token)' })
  me(@Req() request: AuthRequest): Promise<PublicUser> {
    if (!request.user?.id) {
      // Unreachable when JwtAuthGuard is applied; guards are composable.
      throw new UnauthorizedException('Invalid or missing access token');
    }
    return this.auth.me(request.user.id);
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'List the caller\'s active sessions (metadata only; never token material)',
  })
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user.id);
  }

  @Post('sessions/revoke-all')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Credential-compromise path: revoke every active session for the ' +
      'caller. Re-authenticate afterwards.',
  })
  async revokeAllSessions(@CurrentUser() user: AuthUser) {
    const revoked = await this.auth.revokeAllSessions(user.id, 'user-initiated revoke-all');
    return { revoked };
  }

  @Post('sessions/:id/revoke')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Revoke one of the caller\'s sessions by id. Idempotent; a foreign or ' +
      'already-revoked id is a no-op.',
  })
  revokeSession(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    // The :id path param is the canonical source; the body DTO is accepted
    // but the param wins. Validate length at the boundary.
    if (typeof id !== 'string' || id.length < 1 || id.length > 64) {
      throw new UnauthorizedException('Invalid session id');
    }
    return this.auth.revokeSession(user.id, id);
  }
}
