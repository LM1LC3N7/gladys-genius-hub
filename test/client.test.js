// -----------------------------------------------------------------------------
// The HTTP client: the login header of the library, the bounds, the errors in
// our words, the deadlines of a write, `sent`.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { HubClient, HubError, authHeader, baseUrlOf } from '../src/client.js';
import { createFetch, refusedError, streamOf, timeoutError } from './helpers/fakeNet.js';
import { LOGIN, json, patchOk, releasePage, zonesPage } from './fixtures/genius.js';

const client = (handler, extra = {}) => {
  const net = createFetch(handler);
  return {
    net,
    client: new HubClient({
      address: '192.168.1.50',
      login: LOGIN,
      fetchImpl: net.fetch,
      ...extra,
    }),
  };
};

test('the login header: Basic of user name and SHA-256 hex of user name + password (session.py)', () => {
  const digest = createHash('sha256').update('hubuserhubpass').digest('hex');
  assert.equal(authHeader(LOGIN), `Basic ${Buffer.from(`hubuser:${digest}`).toString('base64')}`);
  assert.equal(baseUrlOf('192.168.1.50'), 'http://192.168.1.50:1223');
  assert.equal(baseUrlOf('hub.local:8080'), 'http://hub.local:8080');
  assert.equal(baseUrlOf('[fe80::1]'), 'http://[fe80::1]:1223');
});

test('a read: the headers, the port, the parsed answer, the Date of the hub', async () => {
  const { net, client: c } = client(() => json(releasePage()));
  const { value, at } = await c.release();
  assert.deepEqual(value, { uid: 'ab:cd:ef:01:02:03', release: '5.3.6' });
  assert.equal(typeof at, 'number');
  const [call] = net.calls;
  assert.equal(call.host, '192.168.1.50:1223');
  assert.equal(call.path, '/v3/auth/release');
  assert.equal(call.init.headers.Accept, 'application/json');
  assert.equal(call.init.headers.Connection, 'close');
  assert.match(call.init.headers.Authorization, /^Basic /);
  assert.equal(call.init.redirect, 'manual');
  assert.ok(!JSON.stringify(c).includes('Basic'), 'the login is not enumerable');
});

test('errors in our words: statuses, timeout, unreachable, too large, not JSON, not a hub', async () => {
  const cases = [
    [() => new Response('', { status: 401 }), 'refused', 401],
    [() => new Response('', { status: 403 }), 'refused', 403],
    [() => new Response('', { status: 404 }), 'not_found', 404],
    [() => new Response('', { status: 302, headers: { location: '/x' } }), 'redirect', 302],
    [() => new Response('', { status: 418 }), 'http', 418],
    [() => new Response('', { status: 500 }), 'server', 500],
    [
      () => new Response('', { status: 429, headers: { 'retry-after': '120' } }),
      'rate_limited',
      429,
    ],
    [() => Promise.reject(timeoutError()), 'timeout'],
    [() => Promise.reject(refusedError()), 'unreachable'],
    [() => new Response('{not json', { status: 200 }), 'not_json'],
    [() => json({ hello: 'world' }), 'unknown_answer'],
    [() => new Response(streamOf(2, 64 * 1024), { status: 200 }), 'too_large'],
  ];
  for (const [handler, code, status] of cases) {
    const { client: c } = client(handler);
    const err = await c.release().then(
      () => undefined,
      (e) => e,
    );
    assert.ok(err instanceof HubError, code);
    assert.equal(err.code, code);
    if (status) assert.equal(err.status, status);
    if (code === 'rate_limited') assert.equal(err.retryAfter, 120_000);
  }
});

test('a write: PATCH with the body, error 0 accepted, another error rejected, sent flags', async () => {
  const { net, client: c } = client(() => json(patchOk()));
  await c.setZone(3, { iMode: 1 });
  const [call] = net.calls;
  assert.equal(call.init.method, 'PATCH');
  assert.equal(call.path, '/v3/zone/3');
  assert.equal(call.init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(call.init.body), { iMode: 1 });

  const rejected = await client(() => json({ error: 4 }))
    .client.setZone(3, { iMode: 1 })
    .then(
      () => undefined,
      (e) => e,
    );
  assert.equal(rejected.code, 'rejected');
  assert.equal(rejected.error, 4);
  assert.equal(rejected.sent, true);

  const silent = await client(() => Promise.reject(timeoutError()))
    .client.setZone(3, { iMode: 1 })
    .then(
      () => undefined,
      (e) => e,
    );
  assert.equal(silent.code, 'timeout');
  assert.equal(silent.sent, true, 'a silence may have reached the hub');

  const down = await client(() => Promise.reject(refusedError()))
    .client.setZone(3, { iMode: 1 })
    .then(
      () => undefined,
      (e) => e,
    );
  assert.equal(down.sent, false, 'a refused connection never left');
});

test('a write: the deadlines (startBy, answerBy) and beforeSend', async () => {
  let now = 1000;
  const { net, client: c } = client(() => json(patchOk()), { now: () => now });
  const late = await c.setZone(3, { iMode: 1 }, { startBy: 500 }).then(
    () => undefined,
    (e) => e,
  );
  assert.equal(late.code, 'late');
  assert.equal(late.sent, false);
  assert.equal(net.calls.length, 0, 'nothing sent after startBy');
  const noTime = await c.setZone(3, { iMode: 1 }, { answerBy: 1000 }).then(
    () => undefined,
    (e) => e,
  );
  assert.equal(noTime.code, 'late');
  const refusal = new Error('stop');
  const cancelled = await c
    .setZone(
      3,
      { iMode: 1 },
      {
        beforeSend: () => {
          throw refusal;
        },
      },
    )
    .then(
      () => undefined,
      (e) => e,
    );
  assert.equal(cancelled, refusal, 'a throw of beforeSend cancels the request as is');
  assert.equal(net.calls.length, 0);
  let seen = false;
  await c.setZone(
    3,
    { iMode: 1 },
    {
      startBy: 2000,
      answerBy: 3000,
      beforeSend: () => {
        seen = true;
      },
    },
  );
  assert.ok(seen);
  assert.equal(net.calls.length, 1);
});

test('the reads queue one after the other; a write does not wait for them', async () => {
  const { net, client: c } = client((req) =>
    req.init.method === 'PATCH' ? json(patchOk()) : json(zonesPage()),
  );
  net.hold = true;
  const read = c.zones();
  const read2 = c.zones();
  let patched = false;
  const write = c.setZone(1, { iMode: 1 }).then(() => {
    patched = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(net.calls.length, 2, 'the first read and the write left; the second read waits');
  net.hold = false;
  net.release();
  await write;
  assert.ok(patched);
  await read;
  await read2;
  assert.equal(net.calls.length, 3);
});
