import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Request } from 'express';
import { AuthService, PublicUser } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

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
  // default of 201 (register keeps 201 for user creation).
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange credentials for access + refresh tokens' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
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
}
