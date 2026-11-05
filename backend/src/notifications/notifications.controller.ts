import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/rbac/roles.guard';
import { Roles } from '../common/rbac/roles.decorator';
import { SyncService } from './sync.service';
import { WebPushAdapter } from './push/push-adapters';

/**
 * Durable sync + Web Push configuration REST surface (Phase 6;
 * ARCHITECTURE.md 6 step 6).
 *
 * - POST /notifications/sync: the PWA reconnect / catch-up path. The client
 *   sends the opaque cursor it last saw (or nothing for the latest tail)
 *   and receives every PUBLISHED / UPDATED revision created since, read
 *   from the database — never from a memory ring. A malformed or unknown
 *   cursor reports cursorKnown=false and falls back to the latest tail.
 * - GET /notifications/push/vapid-public-key: the public VAPID key the
 *   service worker uses for pushManager.subscribe(). Only the public key is
 *   ever returned; a generated ephemeral pair is used until operators
 *   configure WEB_PUSH_VAPID_* (subscriptions then need stable keys to
 *   survive deployments).
 *
 * Both routes require a bearer token (JwtAuthGuard, same credential policy
 * as the REST surface) so the sync cursor and VAPID configuration are not
 * publicly probeable. Roles are full-hierarchy: even a PUBLIC user token
 * may read the public feed sync — the feed content itself is public REST
 * data; the endpoint just carries a cursor.
 */
/** Durable sync-since-cursor request. */
class SyncRequest {
  /** Opaque cursor from a previous nextCursor; optional / empty = tail. */
  @IsOptional()
  @IsString()
  @Max(4096)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class NotificationsController {
  constructor(
    private readonly sync: SyncService,
    private readonly config: ConfigService,
  ) {}

  @Post('sync')
  @Roles('PUBLIC', 'REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: 'Durable sync-since-cursor for missed alert revisions',
    description:
      'Reads every PUBLISHED / UPDATED revision created after the given ' +
      'cursor directly from the database. The cursor is opaque; a malformed ' +
      'or unknown cursor is reported (cursorKnown=false) and the latest ' +
      'tail is returned instead of an error. This is the reconnect recovery ' +
      'path (ARCHITECTURE.md 6 step 6).',
  })
  async syncSince(@Body() body: SyncRequest) {
    return this.sync.since(body.cursor ?? null, body.limit ?? 100);
  }

  @Get('push/vapid-public-key')
  @Roles('PUBLIC', 'REVIEWER', 'OPERATOR', 'ADMIN')
  @ApiOperation({
    summary: 'VAPID public key for Web Push subscription',
    description:
      'Returns only the public VAPID key (never the private key). The ' +
      'service worker uses it as applicationServerKey. When no keys are ' +
      'configured an ephemeral generated pair is used; configure ' +
      'WEB_PUSH_VAPID_PUBLIC_KEY / WEB_PUSH_VAPID_PRIVATE_KEY for stable ' +
      'subscriptions across deployments.',
  })
  vapidPublicKey() {
    const adapter = new WebPushAdapter(this.config);
    return { publicKey: adapter.publicKeyForClient() };
  }
}
