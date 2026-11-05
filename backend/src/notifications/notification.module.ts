import { Global, Module, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationRepository } from './notification.repository';
import {
  NotificationQueueService,
  NOTIFICATION_QUEUE,
  NOTIFICATION_QUEUE_NAME,
} from './queue.service';
import { GatewayService, GATEWAY_OPTIONS } from './gateway/gateway.service';
import { InjectableNotificationProcessor } from './notification.processor';
import { PushAdapterRegistry, PushChannelDelivery } from './push/push-adapters';
import { PublishService } from './publish.service';
import { SyncService } from './sync.service';
import { NotificationsController } from './notifications.controller';
import { GatewaySocketAuth } from './gateway/gateway.auth';

/**
 * Phase 6 notification module (docs/ROADMAP.md Phase 6; ARCHITECTURE.md 6).
 *
 * Wires the durable notification pipeline over the existing schema
 * (Notification + NotificationAttempt, no new tables):
 *
 *   PublishService (enqueue one idempotent BullMQ job per revision +
 *     record the durable channel rows)
 *   NotificationQueueService (BullMQ producer, REDIS_URL-gated, fail-soft)
 *   NotificationProcessor (shared retry / dead-letter logic, used in-process
 *     and by the standalone worker)
 *   PushChannelDelivery (credential-gated Web Push / FCM / APNs adapters)
 *   GatewayService (Socket.IO /alerts namespace, JWT handshake, live
 *     fan-out + DB-backed cursor sync)
 *   SyncService (durable sync-since-cursor, read from the DB)
 *   NotificationsController (POST /notifications/sync, VAPID public key)
 *
 * Global: downstream modules (admin-review, integrations) call
 * PublishService without importing this module — every alert publication
 * must fan out, and a missing import would silently drop notifications.
 *
 * The standalone BullMQ worker (worker/worker.main.ts) does NOT import this
 * module: it builds NotificationRepository, the push registry and the
 * processor directly so the worker process stays light (ARCHITECTURE.md 9:
 * separate BullMQ worker containers).
 */

/**
 * Starts the realtime gateway on REALTIME_PORT (default 4100) when a port
 * is configured, and binds the live fan-out to the publication pipeline:
 * every PublishService.publish call also broadcasts to connected sockets.
 * Kept as a separate lifecycle provider so the module graph stays identical
 * when the gateway is intentionally disabled — the durable pipeline
 * (queue + cursor sync) works with or without a live socket.
 */
class GatewayBootstrap implements OnApplicationBootstrap {
  constructor(
    private readonly gateway: GatewayService,
    private readonly publish: PublishService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const port = process.env.REALTIME_PORT;
    if (!port) {
      return; // gateway disabled: durable paths still run
    }
    await this.gateway.start();
    this.publish.onPublished = (job) => this.gateway.broadcastUpdate(job);
  }
}

@Global()
@Module({
  imports: [PrismaModule, AuditModule, AuthModule],
  controllers: [NotificationsController],
  providers: [
    {
      provide: NOTIFICATION_QUEUE_NAME,
      useValue: NOTIFICATION_QUEUE,
    },
    {
      provide: GATEWAY_OPTIONS,
      useValue: {},
    },
    // The injectable processor depends on the base registry type; the module
    // builds it as the PushChannelDelivery facade (same class shape, adapter
    // list built from ConfigService), so alias the token to that provider.
    {
      provide: PushAdapterRegistry,
      useExisting: PushChannelDelivery,
    },
    NotificationRepository,
    NotificationQueueService,
    InjectableNotificationProcessor,
    PushChannelDelivery,
    GatewaySocketAuth,
    SyncService,
    PublishService,
    GatewayService,
    GatewayBootstrap,
  ],
  exports: [
    NotificationRepository,
    NotificationQueueService,
    PushChannelDelivery,
    PublishService,
    SyncService,
    GatewayService,
  ],
})
export class NotificationModule {}
