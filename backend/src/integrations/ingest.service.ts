import { Injectable, Logger, Optional } from '@nestjs/common';
import type { DataProvider } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService, AUDIT_ACTIONS } from '../audit/audit.service';
import { upsertRawRecord } from '../common/provenance/provenance';
import type {
  IngestOutcome,
  IngestOptions,
  NormalizedAlert,
  ProviderKey,
} from './types';
import { ProviderAdapterRegistry } from './adapters/registry';
import { PublishService } from '../notifications/publish.service';

/**
 * DB-backed ingest pipeline (ADR-005 persisted-before-published; ADR-007
 * quarantine-by-default). One call ingests one raw payload for one provider:
 *
 *   adapter.parse → exactly one immutable RawSourceRecord (ADR-007) →
 *   per-event lifecycle (create / update / cancel / quarantine) →
 *   one ProviderFetch row describing the fetch outcome.
 *
 * This service is synchronous-to-DB only: it performs no fetch()/network
 * itself. Fetching raw payloads is Phase 6 scheduling (docs/ROADMAP.md);
 * every caller supplies an already-fetched payload + fetch time.
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly registry: ProviderAdapterRegistry,
    // Phase 6: publication trigger. Optional so pre-Phase-6 constructions
    // (unit tests) keep working; when present, UPDATED transitions enqueue
    // the durable notification fan-out.
    @Optional() private readonly publish?: PublishService,
  ) {}

  async ingest(
    providerKey: string,
    rawPayload: string,
    options?: IngestOptions & { fetchedAt?: Date },
  ): Promise<IngestOutcome> {
    const now = new Date();
    const adapter = this.registry.get(providerKey);

    // Unknown provider: never throw. Register/find the DataProvider row,
    // record a FAILED ProviderFetch, and return a zeroed outcome.
    if (!adapter) {
      const { provider } = await this.upsertByKey(providerKey, providerKey);
      await this.prisma.providerFetch.create({
        data: {
          providerId: provider.id,
          status: 'FAILED',
          itemCount: 0,
          completedAt: now,
          error: `unknown provider: ${providerKey}`,
        },
      });
      return this.zeroed(providerKey as ProviderKey);
    }

    // On-demand ingest registers the provider row if missing; production
    // enablement stays the ADMIN seed/enable path from Phase 2.
    const { provider, created: newlyRegistered } = await this.upsertByKey(
      providerKey,
      adapter.name,
    );

    // Controlled production enablement (DATA-SOURCES.md 5.7): a provider row
    // that already exists and is explicitly DISABLED must not be ingested.
    // A freshly-registered (on-demand/dev) provider is allowed; an existing
    // disabled provider is a refusal, not silent ingest. The refusal is
    // recorded as a FAILED ProviderFetch (fetch/processing status), so the
    // registry row stays the source of truth for "is this provider live".
    if (!newlyRegistered && provider.enabled === false) {
      await this.prisma.providerFetch.create({
        data: {
          providerId: provider.id,
          status: 'FAILED',
          itemCount: 0,
          completedAt: now,
          error: `provider "${providerKey}" is disabled; enable it via the admin registry before ingestion`,
        },
      });
      return this.zeroed(providerKey as ProviderKey);
    }

    const fetchedAt = options?.fetchedAt ?? now;
    const result = adapter.parse(rawPayload, fetchedAt);
    // Fetch-scoped source id: a replay of the same fetch is idempotent
    // (ADR-007) because the raw-record upsert dedups on
    // (providerId, sourceId, payloadHash).
    const fetchRef =
      options?.fetchRef ?? `${providerKey}-${fetchedAt.toISOString()}`;

    // Exactly ONE immutable raw record per ingest() call: every event,
    // quarantined item and rejected item of this parse result shares the
    // same raw payload, so the record is upserted once, up front. A replay
    // (same fetchRef + same payload) returns created:false and the stored
    // row is never mutated (ADR-007).
    const raw = await upsertRawRecord(this.prisma, {
      providerId: provider.id,
      sourceId: fetchRef,
      rawPayload,
      fetchedAt,
    });
    const rawRecordId = raw.record.id;

    let created = 0;
    let updated = 0;
    let cancelled = 0;
    let quarantined = 0;
    let deduped = 0;
    const alertIds: string[] = [];
    const quarantinedIds: string[] = [];

    // Events AND parser-quarantined items both flow through the lifecycle
    // (quarantined items carry event.quarantine; rejected items are already
    // excluded — they never normalised).
    const items = [...result.events, ...result.quarantined];
    for (const event of items) {
      const existing = await this.prisma.alert.findFirst({
        where: { externalRef: event.externalRef },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { revisions: true } } },
      });

      // Idempotency rule (ADR-007): when this exact (fetchRef, payload) has
      // already been ingested (raw.created === false) and the canonical
      // alert for this externalRef already exists, the event is a replay:
      // no new revision, no status change — the fetch counts as deduped.
      if (existing && raw.created === false) {
        deduped += 1;
        continue;
      }

      // Test message: persist a quarantined alert (never live) for the
      // review trail; counted as quarantined, not created.
      if (event.msgType === 'test') {
        const alert = await this.prisma.alert.create({
          data: this.alertData(event, rawRecordId, 'QUARANTINED'),
        });
        await this.prisma.alertRevision.create({
          data: {
            alertId: alert.id,
            revision: 1,
            status: 'QUARANTINED',
            body: event.body,
          },
        });
        quarantined += 1;
        quarantinedIds.push(rawRecordId);
        await this.audit.record(
          null,
          AUDIT_ACTIONS.ALERT_UPDATED,
          'alert',
          alert.id,
          JSON.stringify({ action: 'quarantined', code: 'TEST_MESSAGE' }),
        );
        continue;
      }

      // Parser-flagged quarantine: same shape, with the parser's code and
      // reason preserved in the audit detail.
      if (event.quarantine) {
        const alert = await this.prisma.alert.create({
          data: this.alertData(event, rawRecordId, 'QUARANTINED'),
        });
        await this.prisma.alertRevision.create({
          data: {
            alertId: alert.id,
            revision: 1,
            status: 'QUARANTINED',
            body: event.body,
          },
        });
        quarantined += 1;
        quarantinedIds.push(rawRecordId);
        await this.audit.record(
          null,
          AUDIT_ACTIONS.ALERT_UPDATED,
          'alert',
          alert.id,
          JSON.stringify({
            action: 'quarantined',
            code: event.quarantine.code,
            reason: event.quarantine.reason,
          }),
        );
        continue;
      }

      if (event.msgType === 'cancel') {
        if (existing) {
          await this.prisma.alert.update({
            where: { id: existing.id },
            data: { status: 'CANCELLED', updatedAt: now },
          });
          await this.prisma.alertRevision.create({
            data: {
              alertId: existing.id,
              revision: existing._count.revisions + 1,
              status: 'CANCELLED',
              body: event.body,
            },
          });
          cancelled += 1;
          alertIds.push(existing.id);
          await this.audit.record(
            null,
            AUDIT_ACTIONS.ALERT_CANCELLED,
            'alert',
            existing.id,
            JSON.stringify({
              action: 'cancelled',
              externalRef: event.externalRef,
            }),
          );
        } else {
          // A cancel with no target alert can never legitimately publish:
          // it is quarantined (code CANCEL_NO_TARGET) so a reviewer can
          // decide, never silently dropped.
          const alert = await this.prisma.alert.create({
            data: this.alertData(event, rawRecordId, 'QUARANTINED'),
          });
          await this.prisma.alertRevision.create({
            data: {
              alertId: alert.id,
              revision: 1,
              status: 'QUARANTINED',
              body: event.body,
            },
          });
          quarantined += 1;
          quarantinedIds.push(rawRecordId);
          await this.audit.record(
            null,
            AUDIT_ACTIONS.ALERT_UPDATED,
            'alert',
            alert.id,
            JSON.stringify({
              action: 'quarantined',
              code: 'CANCEL_NO_TARGET',
              externalRef: event.externalRef,
            }),
          );
        }
        continue;
      }

      // 'alert' / 'update'
      if (!existing) {
        const alert = await this.prisma.alert.create({
          data: this.alertData(event, rawRecordId, 'VALIDATED'),
        });
        await this.prisma.alertRevision.create({
          data: {
            alertId: alert.id,
            revision: 1,
            status: 'VALIDATED',
            body: event.body,
          },
        });
        created += 1;
        alertIds.push(alert.id);
        await this.audit.record(
          null,
          AUDIT_ACTIONS.ALERT_UPDATED,
          'alert',
          alert.id,
          JSON.stringify({ action: 'create', externalRef: event.externalRef }),
        );
        continue;
      }

      const status = event.msgType === 'update' ? 'UPDATED' : 'VALIDATED';
      await this.prisma.alert.update({
        where: { id: existing.id },
        data: { status, updatedAt: now },
      });
      await this.prisma.alertRevision.create({
        data: {
          alertId: existing.id,
          revision: existing._count.revisions + 1,
          status,
          body: event.body,
        },
      });
      updated += 1;
      alertIds.push(existing.id);
      await this.audit.record(
        null,
        AUDIT_ACTIONS.ALERT_UPDATED,
        'alert',
        existing.id,
        JSON.stringify({ action: 'update', externalRef: event.externalRef }),
      );

      // Phase 6: an UPDATED alert is live content — trigger the durable
      // notification fan-out AFTER the canonical alert + revision are
      // persisted (ARCHITECTURE.md 6: persist first, enqueue second).
      // A plain 'alert' re-ingest landing on VALIDATED is not a live
      // update, so it is not published. Failures are logged here and never
      // fail the ingest: the durable rows are written inside publish() and
      // the cursor sync recovers anything the live fan-out missed.
      if (status === 'UPDATED' && this.publish) {
        try {
          await this.publish.publish(existing.id, 'UPDATED');
        } catch (err) {
          this.logger.error(
            `notification publish for updated alert ${existing.id} failed: ${String(err)}`,
          );
        }
      }
    }

    await this.prisma.providerFetch.create({
      data: {
        providerId: provider.id,
        status: result.rejected.length ? 'PARTIAL' : 'SUCCESS',
        itemCount: result.events.length + result.quarantined.length,
        completedAt: now,
        error: result.rejected.length ? result.rejected[0].reason : null,
      },
    });

    return {
      providerKey: result.providerKey,
      created,
      updated,
      cancelled,
      quarantined,
      alertIds,
      quarantinedIds,
      deduped,
    };
  }

  private zeroed(providerKey: ProviderKey): IngestOutcome {
    return {
      providerKey,
      created: 0,
      updated: 0,
      cancelled: 0,
      quarantined: 0,
      alertIds: [],
      quarantinedIds: [],
      deduped: 0,
    };
  }

  /**
   * Canonical Alert row for a normalised event. Status is decided by the
   * caller (VALIDATED vs QUARANTINED); verification is always UNVERIFIED —
   * only an authorised reviewer may promote an alert (ADR-006/ADR-007).
   */
  private alertData(
    event: NormalizedAlert,
    rawRecordId: string,
    status: 'VALIDATED' | 'QUARANTINED',
  ): Prisma.AlertUncheckedCreateInput {
    return {
      status,
      verification: 'UNVERIFIED',
      informationClass: 'OFFICIAL_SOURCE',
      headline: event.headline,
      issuer: event.issuer,
      severity: event.severity,
      urgency: event.urgency,
      certainty: event.certainty,
      issuedAt: this.toDate(event.issuedAt),
      effectiveAt: this.toDate(event.effectiveAt),
      expiresAt: this.toDate(event.expiresAt),
      externalRef: event.externalRef,
      sourceRecordId: rawRecordId,
    };
  }

  private toDate(value: string | null): Date | null {
    if (value === null) {
      return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  /**
   * Find-or-create the DataProvider row for an on-demand ingest. Reports
   * whether the row was just created so the caller can distinguish a fresh
   * on-demand/dev provider (allowed) from an existing explicitly-disabled
   * provider (refused — controlled production enablement, DATA-SOURCES.md 5.7).
   */
  private async upsertByKey(
    key: string,
    name: string,
  ): Promise<{ provider: DataProvider; created: boolean }> {
    const existing = await this.prisma.dataProvider.findUnique({
      where: { key },
    });
    if (existing) {
      return { provider: existing, created: false };
    }
    const created = await this.prisma.dataProvider.create({
      data: { key, name, enabled: false },
    });
    return { provider: created, created: true };
  }
}
