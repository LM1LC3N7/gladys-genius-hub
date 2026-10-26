// -----------------------------------------------------------------------------
// The app on a REAL moving clock (performance.now, Date.now, setTimeout) and a
// real local HTTP server playing the hub: the reads really start, at 0, the
// interval and twice the interval, with a bounded number of timers. The time
// is sped up 100 times (60 s of the interval are 600 ms) but it is the real
// clock: it moves between any two reads of it. A command on the real clock
// too: its fresh read, its write and its read back fit the budget.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { GeniusHubApp } from '../src/app.js';
import { registerHandlers } from '../src/handlers.js';
import { POLL_INTERVAL } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import { CONFIG, dataManagerPage, patchOk, releasePage, zones } from './fixtures/genius.js';
import { applyPatch, createdZone } from './helpers/app.js';

const SPEED = 100;
const INTERVAL = POLL_INTERVAL.default * 1000;

test('real clock: reads at 0, the interval and twice the interval; a command fits its budget', async () => {
  const list = zones();
  const pages = {
    '/v3/auth/release': releasePage(),
    '/v3/zones': { data: list },
    '/v3/data_manager': dataManagerPage(),
  };
  const reads = [];
  const zoneReads = [];
  const patches = [];
  const server = createServer((req, res) => {
    if (req.method === 'PATCH') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        patches.push({ url: req.url, body: JSON.parse(body) });
        applyPatch(list, Number(req.url.split('/').pop()), JSON.parse(body));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(patchOk()));
      });
      return;
    }
    // The periodic reads only (a command reads the release and the zones too).
    if (req.url === '/v3/data_manager') reads.push(performance.now() * SPEED);
    if (req.url === '/v3/zones') zoneReads.push(performance.now() * SPEED);
    const body = pages[req.url];
    res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body ?? {}));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  let timersSet = 0;
  const timers = {
    setTimeout(fn, ms) {
      timersSet += 1;
      return setTimeout(fn, Math.max(0, ms) / SPEED);
    },
    clearTimeout: (id) => clearTimeout(id),
  };
  const config = { ...CONFIG, address: `127.0.0.1:${port}`, allow_setpoint: true };
  const gladys = createFakeGladys({ selector: 'genius-hub', config, devices: [createdZone()] });
  const quiet = () => {};
  const logger = { info: quiet, warn: quiet, error: quiet, debug: quiet };
  const app = new GeniusHubApp({
    gladys,
    logger,
    now: () => Date.now() * SPEED,
    monotonic: () => performance.now() * SPEED,
    timers,
    store: createMemoryStore(),
  });
  registerHandlers(gladys, app, logger);
  const started = performance.now() * SPEED;
  try {
    await gladys.connect();
    // Counted from the first read (a cold start of fetch takes a few ms).
    const deadline = started + INTERVAL;
    while (reads.length === 0 && performance.now() * SPEED < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    // A setpoint on the real clock: the budget (3.5 s, sped up) holds the
    // fresh read, the write and the read back.
    const device = gladys.fake.devices[0];
    const feature = device.features.find((f) => f.external_id.endsWith(':setpoint'));
    const ack = await gladys.fake.setValue(device, feature, 20);
    assert.equal(ack.success, true, ack.error);
    assert.deepEqual(patches[0]?.body, { iMode: 16, fBoostSP: 20, iBoostTimeRemaining: 3600 });
    // The follow-ups: exactly two reads of the zones (5 s and 20 s) in the
    // 25 s after the answer, never one timer firing twice.
    const acked = performance.now() * SPEED;
    while (performance.now() * SPEED < acked + 25_000) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const follow = zoneReads.filter((t) => t > acked && t <= acked + 25_000);
    assert.equal(
      follow.length,
      2,
      `follow-up reads at ${follow.map((t) => Math.round(t - acked))}`,
    );
    const until = (reads[0] ?? started) + 2.5 * INTERVAL;
    while (performance.now() * SPEED < until) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await app.stop();
  } finally {
    // Stopped even when an assertion failed, so the process can end.
    await app.stop();
    await new Promise((resolve) => server.close(resolve));
  }
  const at = reads.map((t) => Math.round(t - started));
  assert.equal(reads.length, 3, `reads at ${at}`);
  assert.ok(reads[0] - started < INTERVAL / 2, `the first read at once: ${at}`);
  for (let i = 1; i < reads.length; i += 1) {
    const gap = reads[i] - reads[i - 1];
    assert.ok(gap >= 0.9 * INTERVAL, `never sooner than the interval: ${at}`);
    assert.ok(gap < 1.5 * INTERVAL, `on time: ${at}`);
  }
  assert.ok(timersSet <= 30, `${timersSet} timers`);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});
