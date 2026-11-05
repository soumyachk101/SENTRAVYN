import { PublishService } from '../../src/notifications/publish.service';
import type { NotificationQueueService } from '../../src/notifications/queue.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Unit spec: one alert publication transition enqueues exactly ONE deduped
 * BullMQ job, and durable channel rows are written to match the queue state.
 *
 * The queue is faked to emulate BullMQ jobId deduplication: a second add()
 * with the same dedupKey returns the existing job (deduped: true) instead of
 * a new one, which is the "exactly one deduped job" property under test.
 */

class FakeQueue {
  added: { dedupKey: string; call: number }[] = [];
  /** Simulate a queue outage (REDIS_URL unset / Redis down). */
  down = false;

  async add(payload: { dedupKey: string }): Promise<{
    enqueued: boolean;
    deduped: boolean;
    dedupKey: string;
    error?: string;
  }> {
    if (this.down) {
      return {
        enqueued: false,
        deduped: false,
        dedupKey: payload.dedupKey,
        error: 'REDIS_URL is not configured; notification queue unavailable',
      };
    }
    this.added.push({ dedupKey: payload.dedupKey, call: this.added.length + 1 });
    // jobId dedup: the first call adds, repeats dedupe.
    const deduped = this.added.filter((a) => a.dedupKey === payload.dedupKey).length > 1;
    return { enqueued: true, deduped, dedupKey: payload.dedupKey };
  }
}

class FakeRepo {
  rows: { id: string; channel: string; status: string }[] = [];
  attempts: { id: string; outcome: string; error: string | null }[] = [];

  constructor(private readonly channels: string[] = ['PUSH_WEB', 'PUSH_FCM', 'PUSH_APNS']) {
    this.rows = channels.map((channel, i) => ({
      id: `n-${i}`,
      channel,
      status: 'PENDING',
    }));
  }

  async ensureChannelRows() {
    return { created: true, notificationIds: this.rows.map((r) => r.id) };
  }

  async recordAttempt(id: string, outcome: string, result: { error?: string | null }) {
    this.attempts.push({ id, outcome, error: result.error ?? null });
    const row = this.rows.find((r) => r.id === id);
    if (row) row.status = outcome;
  }

  async getById(id: string) {
    return this.rows.find((r) => r.id === id) ?? null;
  }
}

function makeAlert() {
  return {
    alert: {
      findUnique: jest.fn(async () => ({
        id: 'al-1',
        headline: 'Flood warning',
        severity: 'Severe',
        urgency: 'Immediate',
        issuer: 'Test Authority',
        issuedAt: new Date('2026-01-01T00:00:00.000Z'),
        status: 'QUARANTINED',
      })),
    },
  };
}

describe('PublishService — exactly one deduped job per transition', () => {
  function build() {
    const queue = new FakeQueue();
    const repo = new FakeRepo();
    const prisma = makeAlert() as unknown as PrismaService;
    const service = new PublishService(
      prisma,
      repo as never,
      queue as unknown as NotificationQueueService,
    );
    return { service, queue, repo };
  }

  it('publishes once: one queue job, PENDING channel rows, PENDING attempts', async () => {
    const { service, queue, repo } = build();
    const outcome = await service.publish('al-1', 'PUBLISHED');

    expect(outcome.dedupKey).toBe('alert:al-1:PUBLISHED');
    expect(outcome.enqueued).toBe(true);
    expect(outcome.deduped).toBe(false);
    expect(queue.added).toHaveLength(1);
    expect(repo.attempts.map((a) => a.outcome)).toEqual([
      'PENDING',
      'PENDING',
      'PENDING',
    ]);
  });

  it('re-publishing the same transition enqueues no second job (deduped)', async () => {
    const { service, queue } = build();
    await service.publish('al-1', 'PUBLISHED');
    const second = await service.publish('al-1', 'PUBLISHED');

    // Exactly one distinct job in the queue; the second publish deduped.
    expect(new Set(queue.added.map((a) => a.dedupKey)).size).toBe(1);
    expect(second.deduped).toBe(true);
  });

  it('a queue outage drops the push rows instead of claiming delivery', async () => {
    const { service, queue, repo } = build();
    queue.down = true;
    const outcome = await service.publish('al-1', 'PUBLISHED');

    expect(outcome.enqueued).toBe(false);
    expect(outcome.error).toMatch(/REDIS_URL/);
    // No job was added, and no channel row reads as SENT/DELIVERED.
    expect(queue.added).toHaveLength(0);
    expect(repo.attempts.map((a) => a.outcome)).toEqual([
      'DROPPED',
      'DROPPED',
      'DROPPED',
    ]);
    expect(repo.rows.map((r) => r.status)).not.toContain('SENT');
    expect(repo.rows.map((r) => r.status)).not.toContain('DELIVERED');
  });

  it('rejects publishing a transition for an alert that does not exist', async () => {
    const queue = new FakeQueue();
    const repo = new FakeRepo();
    const prisma = {
      alert: { findUnique: jest.fn(async () => null) },
    } as unknown as PrismaService;
    const service = new PublishService(
      prisma,
      repo as never,
      queue as unknown as NotificationQueueService,
    );
    await expect(service.publish('missing', 'PUBLISHED')).rejects.toThrow(/does not exist/);
  });
});
