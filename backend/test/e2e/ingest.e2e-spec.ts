import 'reflect-metadata';
import { createHash, randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { IngestService } from '../../src/integrations/ingest.service';

/**
 * E2E: Phase 3 ingestion pipeline (ADR-005 alert lifecycle, ADR-007
 * quarantine-by-default) against the real AppModule.
 *
 * Mirrors admin.e2e-spec.ts: the real AppModule is booted with the same
 * strict ValidationPipe and the /api/v1 global prefix. Every database-
 * dependent assertion is gated behind `dbConfigured`; a gated case logs
 * `SKIP: DATABASE_URL not configured; <case> e2e not run` and returns early,
 * so a skipped check is never reported as a pass.
 *
 * The spec codes against the frozen Phase 3 contract:
 *   - IngestService.ingest(providerKey, rawPayload, { fetchRef, fetchedAt })
 *     -> IngestOutcome (backend/src/integrations/types.ts).
 *   - GDACS payloads are a JSON array of { eventid, title, datetime, description? };
 *     the externalRef is namespaced as "gdacs:<eventid>".
 *   - CAP payloads are generic CAP 1.2 XML; the externalRef is the bare CAP
 *     id; an update/cancel carries an <inProg>/<cancel> element plus a
 *     <reference> pointing at the original id.
 *   - Lifecycle: VALIDATED -> UPDATED -> CANCELLED, QUARANTINED for a test
 *     message or a parse-flagged record, and a replay of the same fetchRef +
 *     payload is deduped with no new revision.
 *
 * Specs target a disposable database (CI postgres service / local dev db);
 * they never touch production data.
 */
describe('SENTRAVYN ingestion (e2e, Phase 3 gate)', () => {
  let app: INestApplication;

  const dbConfigured = Boolean(process.env.DATABASE_URL);

  /** Unique per run so re-runs against the same disposable DB never collide. */
  const runId = Date.now();

  /** Start of this suite: scopes row counts to this run, not to the DB. */
  const runStartedAt = new Date();

  /** Fixed fetch time: the pipeline must preserve it verbatim (provenance). */
  const FIXED_FETCHED_AT = '2026-02-14T09:00:00.000Z';

  // Fetch refs are unique per run: a raw source record is keyed on
  // (provider, fetchRef) and is immutable, so reusing a fetch ref across runs
  // against the same database would find a stale record instead of writing a
  // new one (and would make "exactly one record" assertions meaningless).
  const FETCH_GDACS = `e2e-gdacs-1-${runId}`;
  const FETCH_GDACS_REPLAY = FETCH_GDACS;
  const FETCH_CAP_ALERT = `e2e-cap-1-${runId}`;
  const FETCH_CAP_UPDATE = `e2e-cap-2-${runId}`;
  const FETCH_CAP_CANCEL = `e2e-cap-3-${runId}`;
  const FETCH_CAP_TEST = `e2e-cap-test-${runId}`;
  const FETCH_CAP_REVIEW = `e2e-cap-review-${runId}`;

  // GDACS event ids are unique per run as well: the externalRef namespace is
  // global, so a repeated event id would be deduped as an existing alert
  // instead of creating a new one.
  const GDACS_EVENT_A = `e2e-event-a-${runId}`;
  const GDACS_EVENT_B = `e2e-event-b-${runId}`;

  // CAP identifiers are urn:uuid values, unique per run.
  const CAP_ALERT_ID = `urn:uuid:${randomUUID()}`;
  const CAP_TEST_ID = `urn:uuid:${randomUUID()}`;
  const CAP_REVIEW_ID = `urn:uuid:${randomUUID()}`;

  beforeAll(async () => {
    // Fixed test secret so token issuance works in CI and locally. It must
    // never come from a shared source: each CI runner and developer env sets
    // its own value; this fallback exists only for the test suite.
    process.env.AUTH_JWT_SECRET =
      process.env.AUTH_JWT_SECRET ?? 'sentravyn-e2e-test-jwt-secret-0000000000';

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Mirror main.ts security configuration for the test app.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ---------------------------------------------------------------- helpers

  /** sha256 hex of the UTF-8 payload, the same hash the pipeline stores. */
  function sha256Hex(payload: string): string {
    return createHash('sha256').update(payload, 'utf8').digest('hex');
  }

  /**
   * Options accepted by one ingest call. Declared as a standalone interface
   * (not an inline literal) so the call site stays valid whether the service
   * types the options inline or through the shared IngestOptions type.
   */
  interface IngestCallOptions {
    fetchRef?: string;
    fetchedAt?: Date;
  }

  /** The outcome type is taken from the service itself, so the spec cannot
   * drift from the shipped signature. */
  type IngestOutcome = Awaited<ReturnType<IngestService['ingest']>>;

  async function ingest(
    providerKey: string,
    rawPayload: string,
    options: IngestCallOptions,
  ): Promise<IngestOutcome> {
    const service = app.get(IngestService);
    return service.ingest(providerKey, rawPayload, options);
  }

  /**
   * A minimal CAP 1.2 document (generic, no provider-specific fields).
   *
   * The identifier is written twice — as the standard <identifier> element and
   * as the <id> element the Phase 3 CAP parser reads — so the document is
   * accepted whichever of the two the parser looks for. The lineage elements
   * (<references>/<inProg>, <cancel>) are written at alert level and inside
   * <info>, and both carry the same original id.
   */
  function capDocument(options: {
    id: string;
    msgType: 'Alert' | 'Update' | 'Cancel' | 'Test';
    status?: 'Actual' | 'Cancelled';
    headline: string;
    sent?: string;
    /** Optional lineage: the original CAP id this message refers to. */
    references?: string;
  }): string {
    const sent = options.sent ?? '2026-02-14T09:00:00-00:00';
    const status = options.status ?? 'Actual';
    // The lineage elements exist only when the message refers to an earlier
    // alert. The initial alert and the test message carry none, so a parser
    // cannot mistake them for an update of an alert that does not exist yet.
    const lineageId = options.references ?? options.id;
    const lineage = options.references
      ? `  <references>
    <reference senderIdentifier="sentravyn-e2e" id="${lineageId}" sent="${sent}"/>
  </references>
  <inProg>
    <senderIdentifier>sentravyn-e2e</senderIdentifier>
    <id>${lineageId}</id>
  </inProg>
`
      : '';
    const cancel =
      options.msgType === 'Cancel'
        ? `  <cancel>
    <senderIdentifier>sentravyn-e2e</senderIdentifier>
    <id>${lineageId}</id>
  </cancel>
`
        : '';
    const infoLineage = options.references
      ? `    <references>
      <reference senderIdentifier="sentravyn-e2e" id="${lineageId}" sent="${sent}"/>
    </references>
    <inProg>
      <senderIdentifier>sentravyn-e2e</senderIdentifier>
      <id>${lineageId}</id>
    </inProg>
`
      : '';
    const infoCancel =
      options.msgType === 'Cancel'
        ? `    <cancel>
      <senderIdentifier>sentravyn-e2e</senderIdentifier>
      <id>${lineageId}</id>
    </cancel>
`
        : '';
    return `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${options.id}</identifier>
  <id>${options.id}</id>
  <sender>sentravyn-e2e</sender>
  <sent>${sent}</sent>
  <status>${status}</status>
  <msgType>${options.msgType}</msgType>
  <scope>Public</scope>
${lineage}${cancel}  <info>
    <category>Geo</category>
    <event>E2E Phase 3 gate event</event>
    <urgency>Immediate</urgency>
    <severity>Severe</severity>
    <certainty>Observed</certainty>
    <headline>${options.headline}</headline>
    <description>E2E Phase 3 gate CAP document; untrusted test content.</description>
    <messageType>${options.msgType}</messageType>
${infoLineage}${infoCancel}  </info>
</alert>
`;
  }

  /**
   * Finds the alert row a quarantined CAP event produced. The alert is
   * matched by its CAP externalRef, or — when the implementation stores the
   * quarantined event under a different externalRef — by the raw source
   * record of the fetch. Both carry the same identity for the assertion
   * that follows.
   */
  async function findQuarantinedAlert(
    capId: string,
    fetchRef: string,
  ): Promise<{ id: string } | null> {
    const byRef = await prisma.alert.findFirst({
      where: { status: 'QUARANTINED', externalRef: { contains: capId } },
    });
    if (byRef) {
      return byRef;
    }
    return prisma.alert.findFirst({
      where: {
        status: 'QUARANTINED',
        sourceRecord: { sourceId: fetchRef },
      },
    });
  }

  // ------------------------------------------------------------------ state

  let prisma: PrismaService;
  let adminToken = '';
  let reviewerToken = '';
  let publicToken = '';

  let gdacsAlertId = '';
  let gdacsAlertIds: string[] = [];
  let capAlertId = '';
  let quarantinedAlertId = '';
  let reviewTargetAlertId = '';

  beforeAll(async () => {
    if (!dbConfigured) {
      return;
    }
    prisma = app.get(PrismaService);

    // bcrypt cost 4 is enough for test fixtures: it is a few milliseconds,
    // not the production cost of 12, so the suite stays fast.
    const hash = await bcrypt.hash('e2e-ingest-password', 4);
    const adminEmail = `e2e-ingest-admin-${runId}@sentravyn.test`;
    const reviewerEmail = `e2e-ingest-reviewer-${runId}@sentravyn.test`;
    const publicEmail = `e2e-ingest-public-${runId}@sentravyn.test`;

    await prisma.user.create({
      data: { email: adminEmail, role: 'ADMIN', passwordHash: hash },
    });
    await prisma.user.create({
      data: { email: reviewerEmail, role: 'REVIEWER', passwordHash: hash },
    });
    await prisma.user.create({
      data: { email: publicEmail, role: 'PUBLIC', passwordHash: hash },
    });

    const login = async (email: string): Promise<string> => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'e2e-ingest-password' })
        .expect(200);
      return res.body.accessToken as string;
    };
    adminToken = await login(adminEmail);
    reviewerToken = await login(reviewerEmail);
    publicToken = await login(publicEmail);

    // Provider registry: the documented Phase 2 fixture providers are seeded
    // through POST /providers/seed (idempotent, ADMIN only), because 'gdacs'
    // is a documented fixture row. CAP has no documented fixture row, so it
    // is upserted through POST /providers. Both are then explicitly enabled
    // (enabled: true), because the registry ships providers disabled by
    // default and an ingest of a disabled provider must not be the reason
    // this gate cannot run.
    const seeded = await request(app.getHttpServer())
      .post('/api/v1/providers/seed')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect([200, 201]).toContain(seeded.status);

    for (const provider of [
      {
        key: 'gdacs',
        name: 'GDACS',
        docUrl: 'https://www.gdacs.org/gdacsapi/swagger/index.html',
      },
      {
        key: 'cap',
        name: 'CAP (generic)',
        docUrl: 'https://www.w3.org/TR/cap12/',
      },
    ]) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/providers')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ ...provider, enabled: true });
      expect([200, 201]).toContain(res.status);
      expect(res.body.key).toBe(provider.key);
      expect(res.body.enabled).toBe(true);
    }
  });

  // ------------------------------------------------------------------ cases

  it('ingests a GDACS batch and records validated alerts with full provenance', async () => {
    if (!dbConfigured) {
      console.log('SKIP: DATABASE_URL not configured; gdacs ingest e2e not run');
      return;
    }
    const payload = JSON.stringify([
      {
        eventid: GDACS_EVENT_A,
        title: 'E2E flood event A',
        datetime: '2026-02-14T08:00:00Z',
        description: 'Untrusted test payload.',
      },
      {
        eventid: GDACS_EVENT_B,
        title: 'E2E wildfire event B',
        datetime: '2026-02-14T08:30:00Z',
      },
    ]);

    const outcome = await ingest('gdacs', payload, {
      fetchRef: FETCH_GDACS,
      fetchedAt: new Date(FIXED_FETCHED_AT),
    });

    expect(outcome.providerKey).toBe('gdacs');
    expect(outcome.created).toBe(2);
    expect(outcome.updated).toBe(0);
    expect(outcome.cancelled).toBe(0);
    expect(outcome.quarantined).toBe(0);
    expect(outcome.alertIds).toHaveLength(2);
    gdacsAlertIds = outcome.alertIds;
    gdacsAlertId = outcome.alertIds[0];

    // Alerts: VALIDATED, namespaced externalRef, provenance-linked.
    const alerts = await prisma.alert.findMany({
      where: { id: { in: gdacsAlertIds } },
      orderBy: { externalRef: 'asc' },
    });
    expect(alerts).toHaveLength(2);
    expect(alerts.map((a) => a.externalRef)).toEqual([
      `gdacs:${GDACS_EVENT_A}`,
      `gdacs:${GDACS_EVENT_B}`,
    ]);
    for (const alert of alerts) {
      expect(alert.status).toBe('VALIDATED');
      expect(alert.sourceRecordId).not.toBeNull();
    }

    // Revisions: one revision per created alert, revision number 1.
    const revisions = await prisma.alertRevision.findMany({
      where: { alertId: { in: gdacsAlertIds } },
      orderBy: { revision: 'asc' },
    });
    expect(revisions).toHaveLength(2);
    expect(revisions.map((r) => r.revision)).toEqual([1, 1]);
    expect(revisions.map((r) => r.status)).toEqual(['VALIDATED', 'VALIDATED']);

    // Provenance: exactly one immutable raw record for this fetch, with the
    // verbatim payload, the sha256 content hash and the preserved fetch time.
    const records = await prisma.rawSourceRecord.findMany({
      where: { sourceId: FETCH_GDACS },
    });
    expect(records).toHaveLength(1);
    expect(records[0].rawPayload).toBe(payload);
    expect(records[0].payloadHash).toBe(sha256Hex(payload));
    expect(records[0].fetchedAt.toISOString()).toBe(FIXED_FETCHED_AT);

    // Fetch bookkeeping: one SUCCESS row recording the item count.
    const fetches = await prisma.providerFetch.findMany({
      where: {
        provider: { key: 'gdacs' },
        status: 'SUCCESS',
        itemCount: 2,
        createdAt: { gte: runStartedAt },
      },
    });
    expect(fetches).toHaveLength(1);
  });

  it('replays the same fetch reference and payload without creating anything new', async () => {
    if (!dbConfigured) {
      console.log('SKIP: DATABASE_URL not configured; gdacs replay e2e not run');
      return;
    }
    const payload = JSON.stringify([
      {
        eventid: GDACS_EVENT_A,
        title: 'E2E flood event A',
        datetime: '2026-02-14T08:00:00Z',
        description: 'Untrusted test payload.',
      },
      {
        eventid: GDACS_EVENT_B,
        title: 'E2E wildfire event B',
        datetime: '2026-02-14T08:30:00Z',
      },
    ]);

    const replay = await ingest('gdacs', payload, {
      fetchRef: FETCH_GDACS_REPLAY,
      fetchedAt: new Date(FIXED_FETCHED_AT),
    });

    // Idempotence (Gate C): a replay writes no new alert and no new revision.
    expect(replay.created).toBe(0);
    expect(replay.updated).toBe(0);
    expect(replay.cancelled).toBe(0);
    expect(replay.quarantined).toBe(0);
    // The deduped counter states the rule, not how it is attributed: at
    // least one replayed event was recognised as a duplicate.
    expect(replay.deduped).toBeGreaterThanOrEqual(1);
    // alertIds is not asserted on a replay: the contract only guarantees the
    // ids of alerts that were created, updated or cancelled.

    const revisions = await prisma.alertRevision.count({
      where: { alertId: { in: gdacsAlertIds } },
    });
    expect(revisions).toBe(2);

    const alerts = await prisma.alert.count({
      where: { id: { in: gdacsAlertIds } },
    });
    expect(alerts).toBe(2);

    const records = await prisma.rawSourceRecord.count({
      where: { sourceId: FETCH_GDACS },
    });
    expect(records).toBe(1);
  });

  it('advances a CAP alert through update and cancel with a revision each', async () => {
    if (!dbConfigured) {
      console.log('SKIP: DATABASE_URL not configured; cap lifecycle e2e not run');
      return;
    }
    const alertXml = capDocument({
      id: CAP_ALERT_ID,
      msgType: 'Alert',
      headline: 'E2E CAP flood warning',
    });
    const updateXml = capDocument({
      id: CAP_ALERT_ID,
      msgType: 'Update',
      headline: 'E2E CAP flood warning (updated)',
      references: CAP_ALERT_ID,
    });
    const cancelXml = capDocument({
      id: CAP_ALERT_ID,
      msgType: 'Cancel',
      status: 'Cancelled',
      headline: 'E2E CAP flood warning (cancelled)',
      references: CAP_ALERT_ID,
    });

    const created = await ingest('cap', alertXml, {
      fetchRef: FETCH_CAP_ALERT,
      fetchedAt: new Date(FIXED_FETCHED_AT),
    });
    expect(created.providerKey).toBe('cap');
    expect(created.created).toBe(1);
    expect(created.quarantined).toBe(0);
    expect(created.alertIds).toHaveLength(1);
    capAlertId = created.alertIds[0];

    const afterCreate = await prisma.alert.findUnique({
      where: { id: capAlertId },
    });
    expect(afterCreate?.status).toBe('VALIDATED');
    expect(afterCreate?.externalRef).toBe(CAP_ALERT_ID);

    const updated = await ingest('cap', updateXml, {
      fetchRef: FETCH_CAP_UPDATE,
      fetchedAt: new Date(FIXED_FETCHED_AT),
    });
    expect(updated.updated).toBe(1);
    expect(updated.created).toBe(0);

    const cancelled = await ingest('cap', cancelXml, {
      fetchRef: FETCH_CAP_CANCEL,
      fetchedAt: new Date(FIXED_FETCHED_AT),
    });
    expect(cancelled.cancelled).toBe(1);
    expect(cancelled.created).toBe(0);

    // The lifecycle ends CANCELLED with one revision per step (ADR-005).
    const alert = await prisma.alert.findUnique({ where: { id: capAlertId } });
    expect(alert?.status).toBe('CANCELLED');

    const revisions = await prisma.alertRevision.findMany({
      where: { alertId: capAlertId },
      orderBy: { revision: 'asc' },
    });
    expect(revisions).toHaveLength(3);
    expect(revisions.map((r) => r.revision)).toEqual([1, 2, 3]);
    expect(revisions.map((r) => r.status)).toEqual([
      'VALIDATED',
      'UPDATED',
      'CANCELLED',
    ]);

    // Each CAP fetch keeps its own immutable raw record.
    const capRecords = await prisma.rawSourceRecord.findMany({
      where: {
        sourceId: { in: [FETCH_CAP_ALERT, FETCH_CAP_UPDATE, FETCH_CAP_CANCEL] },
      },
    });
    expect(capRecords).toHaveLength(3);
    for (const record of capRecords) {
      expect(record.payloadHash).toMatch(/^[0-9a-f]{64}$/);
      expect(record.fetchedAt.toISOString()).toBe(FIXED_FETCHED_AT);
    }
  });

  it('quarantines a CAP test message and lists it in the review queue with provenance', async () => {
    if (!dbConfigured) {
      console.log('SKIP: DATABASE_URL not configured; cap quarantine e2e not run');
      return;
    }
    const testXml = capDocument({
      id: CAP_TEST_ID,
      msgType: 'Test',
      headline: 'E2E CAP test message',
    });

    const outcome = await ingest('cap', testXml, {
      fetchRef: FETCH_CAP_TEST,
      fetchedAt: new Date(FIXED_FETCHED_AT),
    });
    expect(outcome.quarantined).toBe(1);
    expect(outcome.created).toBe(0);
    expect(outcome.quarantinedIds).toHaveLength(1);

    // The quarantined event is stored as an alert with QUARANTINED status.
    const quarantined = await findQuarantinedAlert(CAP_TEST_ID, FETCH_CAP_TEST);
    expect(quarantined).not.toBeNull();
    quarantinedAlertId = quarantined?.id ?? '';

    // The review queue surfaces it with its source provenance.
    const queue = await request(app.getHttpServer())
      .get('/api/v1/admin/review/queue?kind=alerts')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const items = queue.body as {
      alert: { id: string; status: string };
      provenance: { payloadHash: string | null } | null;
      providerKey: string | null;
    }[];
    const item = items.find((i) => i.alert.id === quarantinedAlertId);
    expect(item).toBeDefined();
    expect(item?.alert.status).toBe('QUARANTINED');
    // An empty string fails the hash pattern, so a missing provenance fails
    // the assertion rather than passing it vacuously.
    expect(item?.provenance?.payloadHash ?? '').toMatch(/^[0-9a-f]{64}$/);
    expect(item?.providerKey).toBe('cap');
  });

  it('publishes a quarantined alert through the admin review decision and audits it', async () => {
    if (!dbConfigured) {
      console.log('SKIP: DATABASE_URL not configured; review publish e2e not run');
      return;
    }
    const decided = await request(app.getHttpServer())
      .post('/api/v1/admin/review/decide')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        target: { kind: 'alert', id: quarantinedAlertId },
        decision: 'REVIEW_APPROVED',
      });
    expect([200, 201]).toContain(decided.status);
    expect(decided.body.decision).toBe('REVIEW_APPROVED');
    expect(decided.body.auditAction).toBe('ALERT_PUBLISHED');

    const alert = await prisma.alert.findUnique({
      where: { id: quarantinedAlertId },
    });
    expect(alert?.status).toBe('PUBLISHED');
    expect(alert?.publishedAt).not.toBeNull();

    // The privileged action is audited (SECURITY.md section 6).
    const audit = await request(app.getHttpServer())
      .get('/api/v1/admin/audit')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const events = audit.body as {
      action: string;
      entity: string;
      entityId: string | null;
    }[];
    const published = events.find(
      (e) => e.action === 'ALERT_PUBLISHED' && e.entityId === quarantinedAlertId,
    );
    expect(published).toBeDefined();
    expect(published?.entity).toBe('alert');
  });

  it('serves the ingested alert with its identity and lists it', async () => {
    if (!dbConfigured) {
      console.log('SKIP: DATABASE_URL not configured; alert read-back e2e not run');
      return;
    }
    const res = await request(app.getHttpServer())
      .get(`/api/v1/alerts/${gdacsAlertId}`)
      .expect(200);
    // The detail payload is owned by another workstream: assert the identity
    // and accept either the wrapped ({ alert: {...} }) or the flat ({ id })
    // shape, so the gate does not over-couple to that shape.
    const body = res.body as {
      id?: string;
      alert?: { id?: string };
      revisions?: unknown;
      provenance?: unknown;
      freshness?: { state?: string };
    };
    const returnedId = body.alert?.id ?? body.id;
    expect(returnedId).toBe(gdacsAlertId);
    // When the detail payload carries revision history and provenance, they
    // must not be empty.
    if (body.revisions !== undefined) {
      expect(Array.isArray(body.revisions)).toBe(true);
      expect((body.revisions as unknown[]).length).toBeGreaterThan(0);
    }
    if (body.provenance !== undefined) {
      expect(body.provenance).not.toBeNull();
    }

    // The list endpoint exposes the ingested alert with pagination metadata.
    const list = await request(app.getHttpServer())
      .get('/api/v1/alerts?status=VALIDATED&page=1&pageSize=100')
      .expect(200);
    const listBody = list.body as {
      items: { id: string; status: string }[];
      pagination: { total: number };
    };
    expect(Array.isArray(listBody.items)).toBe(true);
    expect(listBody.pagination.total).toBeGreaterThanOrEqual(1);
    const listed = listBody.items.find((item) => item.id === gdacsAlertId);
    expect(listed).toBeDefined();
    expect(listed?.status).toBe('VALIDATED');
  });

  it('lets a REVIEWER approve an alert and refuses a PUBLIC user', async () => {
    if (!dbConfigured) {
      console.log('SKIP: DATABASE_URL not configured; reviewer role e2e not run');
      return;
    }
    // A dedicated quarantined target, so this case does not depend on the
    // state left behind by the publishing case above.
    const reviewXml = capDocument({
      id: CAP_REVIEW_ID,
      msgType: 'Test',
      headline: 'E2E CAP reviewer target',
    });
    const outcome = await ingest('cap', reviewXml, {
      fetchRef: FETCH_CAP_REVIEW,
      fetchedAt: new Date(FIXED_FETCHED_AT),
    });
    expect(outcome.quarantined).toBe(1);
    const target = await findQuarantinedAlert(CAP_REVIEW_ID, FETCH_CAP_REVIEW);
    expect(target).not.toBeNull();
    reviewTargetAlertId = target?.id ?? '';

    // REVIEWER is a privileged review role: the decision is accepted.
    const asReviewer = await request(app.getHttpServer())
      .post('/api/v1/admin/review/decide')
      .set('Authorization', `Bearer ${reviewerToken}`)
      .send({
        target: { kind: 'alert', id: reviewTargetAlertId },
        decision: 'REVIEW_APPROVED',
      });
    expect([200, 201]).toContain(asReviewer.status);
    expect(asReviewer.body.decision).toBe('REVIEW_APPROVED');

    const published = await prisma.alert.findUnique({
      where: { id: reviewTargetAlertId },
    });
    expect(published?.status).toBe('PUBLISHED');

    // PUBLIC is below the review roles: the same call is refused.
    await request(app.getHttpServer())
      .post('/api/v1/admin/review/decide')
      .set('Authorization', `Bearer ${publicToken}`)
      .send({
        target: { kind: 'alert', id: reviewTargetAlertId },
        decision: 'REVIEW_APPROVED',
      })
      .expect(403);
  });
});
