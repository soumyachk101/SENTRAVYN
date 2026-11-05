import {
  NotificationProcessor,
  JobOutcome,
} from '../../src/notifications/notification.processor';
import { PushAdapterRegistry } from '../../src/notifications/push/push-adapters';
import type {
  DeliveryResult,
  NotificationChannel,
  NotificationJobPayload,
  PushAdapter,
} from '../../src/notifications/types';

/**
 * Unit spec for the notification job processor: idempotency of the dedup
 * key, bounded retry behaviour and the dead-letter (terminal DROPPED) path.
 *
 * No database or Redis required: a fake repository records every
 * ensureChannelRows / recordAttempt call, and fake adapters return
 * programmed DeliveryResults. The processor is the pure state-machine
 * (ARCHITECTURE.md 6 step 7); this spec asserts its contract directly.
 */

type ChannelRow = {
  id: string;
  channel: string;
  status: string;
  receipt: string | null;
};

/** In-memory fake of NotificationRepository (the processor is fed via `as never`). */
class FakeRepo {
  rows: ChannelRow[] = [];
  ensureChannelRowsCalls: number[] = [];
  attempts: {
    notificationId: string;
    outcome: string;
    error: string | null;
  }[] = [];

  constructor(channels: string[]) {
    this.rows = channels.map((channel, i) => ({
      id: `n-${i}`,
      channel,
      status: 'PENDING',
      receipt: null,
    }));
  }

  async ensureChannelRows(job: NotificationJobPayload) {
    this.ensureChannelRowsCalls.push(this.rows.length);
    // Idempotent: after the first call the rows already exist.
    const known = this.rows.filter((r) =>
      job.channels.includes(r.channel as never),
    );
    if (known.length === job.channels.length) {
      return { created: false, notificationIds: known.map((r) => r.id) };
    }
    const created = job.channels.map((channel) => {
      this.rows.push({
        id: `n-${this.rows.length}`,
        channel,
        status: 'PENDING',
        receipt: null,
      });
      return this.rows[this.rows.length - 1].id;
    });
    return {
      created: true,
      notificationIds: [...known.map((r) => r.id), ...created],
    };
  }

  async recordAttempt(
    notificationId: string,
    outcome: string,
    result: DeliveryResult,
  ) {
    this.attempts.push({
      notificationId,
      outcome,
      error: result.error ?? null,
    });
    const row = this.rows.find((r) => r.id === notificationId);
    if (row) row.status = outcome;
  }

  async rowsForDedupKey(_dedupKey: string, _alertId: string) {
    return this.rows.map((r) => ({ ...r }));
  }

  async getById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
}

/** Fake adapter factory: per-channel programmed results, call counted. */
class FakeAdapter implements PushAdapter {
  constructor(
    readonly channel: NotificationChannel,
    private readonly program: () => DeliveryResult,
    readonly calls: number[] = [],
  ) {}
  isConfigured(): boolean {
    return true;
  }
  async send(_job: NotificationJobPayload): Promise<DeliveryResult> {
    this.calls.push(this.calls.length);
    return this.program();
  }
}

function makeJob(
  overrides: Partial<NotificationJobPayload> = {},
): NotificationJobPayload {
  return {
    alertId: 'al-1',
    nextStatus: 'PUBLISHED',
    dedupKey: 'alert:al-1:PUBLISHED',
    headline: 'Flood warning',
    severity: 'Severe',
    urgency: 'Immediate',
    issuer: 'Test Authority',
    channels: ['PUSH_WEB', 'PUSH_FCM', 'PUSH_APNS'],
    issuedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function delivered(): DeliveryResult {
  return { delivered: true, unavailable: false, receipt: 'msg-1' };
}
function transient(): DeliveryResult {
  return { delivered: false, unavailable: false, error: 'provider timeout' };
}
function unavailable(reason: string): DeliveryResult {
  return { delivered: false, unavailable: true, error: reason };
}

describe('NotificationProcessor (Phase 6 job state machine)', () => {
  function build(
    repo: FakeRepo,
    results: Partial<Record<NotificationChannel, () => DeliveryResult>>,
  ) {
    const adapters = new PushAdapterRegistry(
      (Object.keys(results) as NotificationChannel[]).map(
        (channel) => new FakeAdapter(channel, results[channel]!),
      ),
    );
    return {
      processor: new NotificationProcessor(repo as never, adapters),
      adapters,
    };
  }

  it('marks every channel DELIVERED when all adapters deliver', async () => {
    const repo = new FakeRepo(['PUSH_WEB', 'PUSH_FCM', 'PUSH_APNS']);
    const { processor } = build(repo, {
      PUSH_WEB: () => delivered(),
      PUSH_FCM: () => delivered(),
      PUSH_APNS: () => delivered(),
    });
    const outcome: JobOutcome = await processor.process(makeJob());
    expect(outcome.delivered).toBe(true);
    expect(outcome.terminal).toBe(true);
    expect(outcome.anyUnavailable).toBe(false);
    expect(repo.rows.map((r) => r.status)).toEqual([
      'DELIVERED',
      'DELIVERED',
      'DELIVERED',
    ]);
  });

  it('is idempotent: a second call for the same dedup key does not duplicate channel rows', async () => {
    const repo = new FakeRepo(['PUSH_WEB', 'PUSH_FCM', 'PUSH_APNS']);
    const { processor } = build(repo, {
      PUSH_WEB: () => delivered(),
      PUSH_FCM: () => delivered(),
      PUSH_APNS: () => delivered(),
    });
    await processor.process(makeJob());
    const rowCountAfterFirst = repo.rows.length;
    await processor.process(makeJob());
    // Same dedupKey -> ensureChannelRows is a no-op, row count is stable.
    expect(repo.rows.length).toBe(rowCountAfterFirst);
    // The already-DELIVERED channels were skipped: exactly 3 attempts total
    // (one per channel, from the first call only).
    expect(repo.attempts.length).toBe(3);
  });

  it('retries a transient failure only while retry budget remains, then dead-letters', async () => {
    const repo = new FakeRepo(['PUSH_WEB', 'PUSH_FCM', 'PUSH_APNS']);
    const { processor } = build(repo, {
      PUSH_WEB: () => delivered(),
      // FCM keeps timing out on every attempt (a real outage, not a flake).
      PUSH_FCM: () => transient(),
      PUSH_APNS: () => delivered(),
    });

    // Attempt 1: budget left = 1. The transient FCM failure is recorded as
    // FAILED (retryable) and the job is not terminal -> the queue will retry.
    const first = await processor.process(makeJob(), 1);
    expect(first.delivered).toBe(false);
    expect(first.terminal).toBe(false);
    expect(repo.rows.find((r) => r.channel === 'PUSH_FCM')?.status).toBe(
      'FAILED',
    );

    // Attempt 2: budget left = 0 (final attempt). The still-failing FCM
    // channel is now terminal DROPPED (the dead-letter state).
    const second = await processor.process(makeJob(), 0);
    expect(second.terminal).toBe(true);
    const fcmRow = repo.rows.find((r) => r.channel === 'PUSH_FCM');
    expect(fcmRow?.status).toBe('DROPPED');
    // The two successful channels were delivered once and then skipped.
    expect(repo.rows.find((r) => r.channel === 'PUSH_WEB')?.status).toBe(
      'DELIVERED',
    );
    expect(repo.rows.find((r) => r.channel === 'PUSH_APNS')?.status).toBe(
      'DELIVERED',
    );
  });

  it('marks an unavailable channel terminal DROPPED (never SENT/DELIVERED)', async () => {
    const repo = new FakeRepo(['PUSH_WEB', 'PUSH_FCM', 'PUSH_APNS']);
    const { processor } = build(repo, {
      PUSH_WEB: () => delivered(),
      // FCM has no credentials configured -> unavailable.
      PUSH_FCM: () => unavailable('FCM not configured'),
      PUSH_APNS: () => delivered(),
    });
    const outcome = await processor.process(makeJob(), 3);
    expect(outcome.terminal).toBe(true);
    expect(outcome.anyUnavailable).toBe(true);
    const fcmRow = repo.rows.find((r) => r.channel === 'PUSH_FCM');
    expect(fcmRow?.status).toBe('DROPPED');
    // No attempt row ever records FCM as SENT or DELIVERED.
    const fcmAttempts = repo.attempts.filter(
      (a) => a.notificationId === fcmRow?.id,
    );
    expect(fcmAttempts.map((a) => a.outcome)).not.toContain('DELIVERED');
    expect(fcmAttempts.map((a) => a.outcome)).not.toContain('SENT');
  });

  it('skips already-delivered channels on a partial retry (no duplicate pushes)', async () => {
    const repo = new FakeRepo(['PUSH_WEB', 'PUSH_FCM', 'PUSH_APNS']);
    const web = new FakeAdapter('PUSH_WEB', () => delivered());
    const adapters = new PushAdapterRegistry([
      web,
      new FakeAdapter('PUSH_FCM', () => transient()),
      new FakeAdapter('PUSH_APNS', () => transient()),
    ]);
    const processor = new NotificationProcessor(repo as never, adapters);

    // First attempt: web delivers, FCM/APNS fail transiently (retry budget 1).
    const first = await processor.process(makeJob(), 1);
    expect(first.terminal).toBe(false);
    expect(repo.rows.find((r) => r.channel === 'PUSH_WEB')?.status).toBe(
      'DELIVERED',
    );

    // Second attempt (queue retry, final budget): the DELIVERED web channel is
    // skipped — exactly one web adapter call across both attempts — while the
    // still-failing FCM/APNS become terminal DROPPED on the last attempt.
    const second = await processor.process(makeJob(), 0);
    expect(second.terminal).toBe(true);
    expect(web.calls.length).toBe(1);
    expect(repo.rows.find((r) => r.channel === 'PUSH_FCM')?.status).toBe(
      'DROPPED',
    );
    expect(repo.rows.find((r) => r.channel === 'PUSH_APNS')?.status).toBe(
      'DROPPED',
    );
  });
});
