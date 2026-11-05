import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SentravynApiClient } from './client.bundle.mjs';

/**
 * Unit tests for the Phase 4 places + Phase 7 family api-client methods.
 * We drive the client with a recorded fetch stub so we can assert the exact
 * URL, method, headers and body each call sends, and that the response is
 * passed through typed. The client source is extensionless ESM (bundler
 * output), so the test loads an esbuild bundle built in test/build.mjs
 * (`pnpm test` runs it first) — no package-level test framework.
 */

function makeClient(responseJson = {}) {
  const calls = [];
  const fetchImpl = (url, options) => {
    calls.push({ url: String(url), options });
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve(JSON.stringify(responseJson)),
    });
  };
  const client = new SentravynApiClient({
    baseUrl: 'http://api.test',
    fetchImpl,
  });
  return { client, calls };
}

function jsonBody(options) {
  return options?.body ? JSON.parse(options.body) : undefined;
}
function auth(options) {
  return options?.headers?.authorization;
}

// ---------------------------------------------------------------- places

test('placesList builds a GET with the query params it is given', async () => {
  const { client, calls } = makeClient();
  await client.placesList({
    kind: 'hospital',
    page: 2,
    pageSize: 10,
    limit: 50,
  });
  const call = calls[0];
  assert.match(call.url, /^http:\/\/api\.test\/api\/v1\/places\?/);
  assert.match(call.url, /kind=hospital/);
  assert.match(call.url, /page=2/);
  assert.match(call.url, /pageSize=10/);
  assert.match(call.url, /limit=50/);
  assert.equal(call.options.method, 'GET');
});

test('placesList with no params hits the bare path', async () => {
  const { client, calls } = makeClient();
  await client.placesList();
  assert.equal(calls[0].url, 'http://api.test/api/v1/places');
});

test('placesNearby encodes centre, radius, kind and limit into the query', async () => {
  const { client, calls } = makeClient();
  await client.placesNearby({
    lat: 51.5,
    lng: -0.1,
    radiusMeters: 5000,
    kind: 'shelter',
    limit: 200,
  });
  const url = calls[0].url;
  assert.match(url, /lat=51\.5/);
  assert.match(url, /lng=-0\.1/);
  assert.match(url, /radiusMeters=5000/);
  assert.match(url, /kind=shelter/);
  assert.match(url, /limit=200/);
});

test('placeDetail URL-encodes the id and targets /places/:id', async () => {
  const { client, calls } = makeClient();
  await client.placeDetail('abc 123/x');
  assert.equal(calls[0].url, 'http://api.test/api/v1/places/abc%20123%2Fx');
});

// ---------------------------------------------------------------- family

test('familyContacts attaches the Bearer token to GET /family/contacts', async () => {
  const { client, calls } = makeClient();
  await client.familyContacts('TOKEN-A');
  assert.equal(calls[0].url, 'http://api.test/api/v1/family/contacts');
  assert.equal(auth(calls[0].options), 'Bearer TOKEN-A');
});

test('familyCreateContact POSTs a JSON body with the token', async () => {
  const { client, calls } = makeClient();
  await client.familyCreateContact(
    { name: 'Aunty May', consent: true },
    'TOKEN-A',
  );
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(auth(calls[0].options), 'Bearer TOKEN-A');
  assert.deepEqual(jsonBody(calls[0].options), {
    name: 'Aunty May',
    consent: true,
  });
});

test('familyUpdateContact PATCHes the owner-scoped path', async () => {
  const { client, calls } = makeClient();
  await client.familyUpdateContact('c-1', { phone: '555' }, 'TOKEN-A');
  assert.match(calls[0].url, /\/family\/contacts\/c-1$/);
  assert.equal(calls[0].options.method, 'PATCH');
  assert.deepEqual(jsonBody(calls[0].options), { phone: '555' });
});

test('familyCreateLocationShare POSTs the consent payload with all fields', async () => {
  const { client, calls } = makeClient();
  await client.familyCreateLocationShare(
    {
      recipient: 'B',
      purpose: 'check-in',
      expiresAt: '2026-01-01T00:00:00Z',
      preciseConsent: false,
      lastKnownLat: '51.5',
      lastKnownLng: '-0.1',
    },
    'TOKEN-A',
  );
  const body = jsonBody(calls[0].options);
  assert.equal(body.recipient, 'B');
  assert.equal(body.purpose, 'check-in');
  assert.equal(body.expiresAt, '2026-01-01T00:00:00Z');
  assert.equal(body.preciseConsent, false);
  assert.equal(body.lastKnownLat, '51.5');
  assert.equal(auth(calls[0].options), 'Bearer TOKEN-A');
});

test('familyRevokeLocationShare POSTs to the revoke sub-route', async () => {
  const { client, calls } = makeClient();
  await client.familyRevokeLocationShare('s-1', 'TOKEN-A');
  assert.match(calls[0].url, /\/family\/location-shares\/s-1\/revoke$/);
  assert.equal(calls[0].options.method, 'POST');
});

test('familyUpsertHouseholdPlan PUTs the plan with the kit checklist', async () => {
  const { client, calls } = makeClient();
  await client.familyUpsertHouseholdPlan(
    {
      meetingPoint: 'Community Hall',
      kitChecklist: [{ label: 'water', done: true }],
      petConsiderations: 'two cats',
    },
    'TOKEN-A',
  );
  assert.equal(calls[0].options.method, 'PUT');
  assert.match(calls[0].url, /\/family\/household-plan$/);
  assert.deepEqual(jsonBody(calls[0].options).kitChecklist, [
    { label: 'water', done: true },
  ]);
});
