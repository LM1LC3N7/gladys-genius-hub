// -----------------------------------------------------------------------------
// The app end to end against the fake Gladys of the SDK, a scripted hub and a
// virtual clock: reads and their pace, failures, identity, values, commands.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND, DEVICE_STALE_AFTER } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import {
  NOW_SECONDS,
  UID,
  dataManagerPage,
  devices,
  json,
  node,
  patchOk,
  releasePage,
  zone,
  zones,
  zonesPage,
} from './fixtures/genius.js';
import {
  CONFIG,
  D,
  HOUR,
  MINUTE,
  SECOND,
  Z,
  ZONE,
  createHub,
  createdHubDevice,
  createdZone,
  defaults,
  setup,
} from './helpers/app.js';

const ALLOWED = { ...CONFIG, allow_setpoint: true, allow_modes: true };
const reads = (hub, path) =>
  hub.net.calls.filter((c) => c.path === path && c.init.method === 'GET');

test('first read: the zones and devices discovered, the status, the values of a created zone', async () => {
  const { gladys, hub } = await setup({ devices: [createdZone(ZONE.LOUNGE)] });
  assert.equal(reads(hub, '/v3/auth/release').length, 1);
  assert.equal(reads(hub, '/v3/zones').length, 1);
  assert.equal(reads(hub, '/v3/data_manager').length, 1);
  const discovered = gladys.fake.discoveredDevices;
  assert.deepEqual(
    discovered.map((d) => d.external_id),
    [Z(1), Z(2), Z(3), Z(4), Z(5), D('2'), D('3'), D('4'), D('4-1'), D('5')],
    'the manager zone is not offered; the hub and the weather are not devices',
  );
  const lounge = discovered[0];
  assert.equal(lounge.name, 'Lounge');
  assert.deepEqual(
    lounge.features.map((f) => f.external_id.split(':').pop()),
    [
      'temperature',
      'setpoint',
      'heating-mode',
      'operating-state',
      'zone-mode',
      'override-left',
      'occupied',
      'fault',
      'faults',
    ],
  );
  assert.ok(
    !discovered[1].features.some((f) => f.external_id.endsWith(':occupied')),
    'no PIR: no occupancy',
  );
  const water = discovered[3];
  assert.deepEqual(
    water.features.map((f) => f.external_id.split(':').pop()),
    ['temperature', 'setpoint', 'water-mode', 'heating', 'override-left', 'fault', 'faults'],
  );
  assert.deepEqual(
    discovered[5].features.map((f) => f.external_id.split(':').pop()),
    ['temperature', 'setpoint', 'battery'],
  );
  for (const device of discovered) {
    for (const f of device.features) {
      if (f.supported_options) {
        for (const o of f.supported_options) assert.equal(typeof o.label, 'string');
      }
    }
  }
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /Connected to the Genius Hub 5\.3\.6 .*5 zone\(s\) and 5 device\(s\)/,
  );
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /Create the device of zone\(s\) Kitchen, Hall floor, Hot water, Towel rail/,
  );
  assert.equal(gladys.fake.lastState(Z(1, 'temperature')), 20.5);
  assert.equal(gladys.fake.lastState(Z(1, 'setpoint')), 21);
  assert.equal(gladys.fake.lastState(Z(1, 'heating-mode')), 1);
  assert.equal(gladys.fake.lastState(Z(1, 'operating-state')), 1);
  assert.equal(gladys.fake.lastState(Z(1, 'zone-mode')), 'timer');
  assert.equal(gladys.fake.lastState(Z(1, 'occupied')), 1);
  assert.equal(gladys.fake.lastState(Z(1, 'fault')), 0);
  assert.equal(gladys.fake.lastState(Z(1, 'override-left')), 'none');
  assert.equal(gladys.fake.lastState(Z(2, 'temperature')), undefined, 'not created: nothing sent');
});

test('the values of the hot water, the on/off zone and the hub devices', async () => {
  const { gladys } = await setup({
    devices: [
      createdZone(ZONE.WATER),
      createdZone(ZONE.TOWEL),
      createdZone(ZONE.KITCHEN),
      createdHubDevice('2'),
      createdHubDevice('5'),
    ],
  });
  assert.equal(gladys.fake.lastState(Z(4, 'temperature')), 48);
  assert.equal(gladys.fake.lastState(Z(4, 'setpoint')), 55);
  assert.equal(gladys.fake.lastState(Z(4, 'water-mode')), 3, 'override = boost');
  assert.equal(gladys.fake.lastState(Z(4, 'heating')), 1);
  assert.equal(gladys.fake.lastState(Z(4, 'override-left')), '30 min');
  assert.equal(gladys.fake.lastState(Z(5, 'state')), 1);
  assert.equal(gladys.fake.lastState(Z(2, 'heating-mode')), 0, 'off');
  assert.equal(gladys.fake.lastState(Z(2, 'fault')), 1);
  assert.equal(gladys.fake.lastState(Z(2, 'faults')), 'zone:using_weather_temp');
  assert.equal(gladys.fake.lastState(D('2', 'battery')), 85);
  assert.equal(gladys.fake.lastState(D('2', 'temperature')), 20.5);
  assert.equal(gladys.fake.lastState(D('2', 'setpoint')), 21);
  assert.equal(gladys.fake.lastState(D('5', 'luminance')), 120);
  assert.equal(gladys.fake.lastState(D('5', 'motion')), 1);
});

test('pace: reads at the interval, never sooner whatever asks; the test button tells the last read', async () => {
  const { gladys, hub, wait, start, app } = await setup({ devices: [createdZone()] });
  assert.equal(reads(hub, '/v3/zones').length, 1);
  await wait(30 * SECOND);
  await start(CONFIG);
  await gladys.fake.scanRequest();
  await gladys.fake.deviceCreated(createdZone(ZONE.KITCHEN));
  assert.equal(
    reads(hub, '/v3/zones').length,
    1,
    'a save, a Scan, a device created: no read sooner',
  );
  const ack = await gladys.fake.action('test_connection');
  assert.equal(ack.success, true);
  assert.match(
    ack.data.message.en,
    /Last read 30 s ago: Genius Hub 5\.3\.6 at 192\.168\.1\.50, 5 zone\(s\).*Lounge: timer, 20\.5 °C \/ 21 °C.*Next read in 30 s/,
  );
  assert.equal(reads(hub, '/v3/zones').length, 1);
  await wait(30 * SECOND);
  assert.equal(reads(hub, '/v3/zones').length, 2);
  await wait(MINUTE);
  assert.equal(reads(hub, '/v3/zones').length, 3);
  await app.stop();
  await wait(HOUR);
  assert.equal(reads(hub, '/v3/zones').length, 3, 'stopped');
});

test('pace: the time of the last read is kept in /data, a restart never reads sooner', async () => {
  const store = createMemoryStore();
  const first = await setup({ store });
  await first.wait(20 * SECOND);
  await first.app.stop();
  assert.equal(typeof store.data.lastAttemptAt, 'number');
  const second = await setup({ store, now: first.clock.now });
  assert.equal(reads(second.hub, '/v3/zones').length, 0, 'not yet due');
  assert.equal(
    second.gladys.fake.discoveredDevices.length,
    10,
    'offered from /data before the first read',
  );
  await second.wait(40 * SECOND);
  assert.equal(reads(second.hub, '/v3/zones').length, 1);
});

test('refused login (401 on the release page): a final stop, the test button tries once, a success lifts it', async () => {
  let status = 401;
  const hub = createHub((path, t, init) =>
    status
      ? new Response('', { status })
      : (defaults[path]?.() ?? (init.method === 'PATCH' ? patchOk() : undefined)),
  );
  const { gladys, wait, store } = await setup({ hub, devices: [createdZone()] });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refuses this login: reads stopped/);
  await wait(HOUR);
  assert.equal(reads(hub, '/v3/auth/release').length, 1, 'never tried again by itself');
  assert.equal(store.data.refused.username, 'hubuser');
  assert.ok(!JSON.stringify(store.data).includes('hubpass'), 'never the password in /data');
  assert.equal(typeof store.data.refused.tag, 'number');
  status = 0;
  const ack = await gladys.fake.action('test_connection');
  assert.match(ack.data.message.en, /Read now/);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(store.data.refused, null);
  await wait(MINUTE);
  assert.equal(reads(hub, '/v3/auth/release').length, 3, 'reads again');
});

test('a 401 on the devices page only is not a refused login: the zones are read, the devices not', async () => {
  const hub = createHub((path) =>
    path === '/v3/data_manager' ? new Response('', { status: 401 }) : defaults[path]?.(),
  );
  const { gladys } = await setup({ hub, devices: [createdZone()] });
  assert.equal(
    gladys.fake.connectionStatus.connected,
    false,
    'a refused page is a refused login (the library sends one login)',
  );
});

test('5xx and 429: a pause kept in /data, Retry-After honoured, doubled, never beyond 6 h; cleared by a success', async () => {
  let status = 503;
  const hub = createHub((path) => (status ? new Response('', { status }) : defaults[path]?.()));
  const { gladys, wait, store, clock } = await setup({ hub });
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /asks to wait \(error of the hub 503\): reads paused, new try in 1 min/,
  );
  assert.equal(store.data.pause.code, 'server');
  await wait(MINUTE);
  assert.equal(reads(hub, '/v3/auth/release').length, 2);
  assert.match(gladys.fake.connectionStatus.message.en, /new try in 2 min/);
  const restarted = await setup({ hub, store, now: clock.now });
  assert.equal(reads(hub, '/v3/auth/release').length, 2, 'the pause survives a restart');
  await restarted.wait(2 * MINUTE);
  assert.equal(reads(hub, '/v3/auth/release').length, 3);
  status = 0;
  await restarted.wait(4 * MINUTE);
  assert.equal(restarted.gladys.fake.connectionStatus.connected, true);
  assert.equal(restarted.store.data.pause, null);
});

test('unreachable: retries 30 s, 1 min, 2 min... up to 10 min, never sooner than the interval', async () => {
  const hub = createHub(() => 'timeout');
  const { gladys, wait } = await setup({ hub });
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /could not be read \(no answer\): new try in 1 min/,
    'the retry of 30 s never comes sooner than the interval',
  );
  await wait(MINUTE);
  assert.equal(reads(hub, '/v3/auth/release').length, 2);
  await wait(MINUTE);
  assert.equal(reads(hub, '/v3/auth/release').length, 3, 'doubled: 1 min');
  await wait(MINUTE);
  assert.equal(reads(hub, '/v3/auth/release').length, 3, 'doubled: 2 min');
  await wait(MINUTE);
  assert.equal(reads(hub, '/v3/auth/release').length, 4);
});

test('devices: values sent only when the device talked to the hub since; stale ones not sent', async () => {
  const nodes = devices();
  const hub = createHub((path) =>
    path === '/v3/data_manager' ? dataManagerPage(nodes) : defaults[path]?.(),
  );
  const { gladys, wait, lines } = await setup({
    hub,
    devices: [createdHubDevice('2'), createdHubDevice('3')],
  });
  assert.equal(gladys.fake.lastState(D('2', 'battery')), 85);
  const sent = () =>
    gladys.fake.states.filter((s) => s.device_feature_external_id === D('2', 'battery')).length;
  assert.equal(sent(), 1);
  nodes['2'].childValues.Battery.val = 70;
  await wait(MINUTE);
  assert.equal(sent(), 1, 'the same lastComms: an old copy, not sent again');
  nodes['2'].childValues.lastComms.val = NOW_SECONDS + 30;
  await wait(MINUTE);
  assert.equal(sent(), 2);
  assert.equal(gladys.fake.lastState(D('2', 'battery')), 70);
  // The thermostat stops talking: after 2 h its values are no longer sent.
  nodes['3'].childValues.lastComms.val = NOW_SECONDS - (3 * HOUR) / 1000;
  nodes['3'].childValues.Battery.val = 10;
  await wait(MINUTE);
  assert.equal(gladys.fake.lastState(D('3', 'battery')), 60);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /1 device\(s\) have not talked to the hub for 2 h or more/,
  );
  assert.ok(DEVICE_STALE_AFTER === 2 * HOUR);
  assert.ok(!lines.some((l) => l.includes('hubpass')));
});

test('devices: a page of devices failing leaves the zones read; the status says so', async () => {
  const hub = createHub((path) => (path === '/v3/data_manager' ? 'timeout' : defaults[path]?.()));
  const { gladys } = await setup({ hub, devices: [createdZone()] });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /devices of the hub .* could not be read this time \(no answer\)/,
  );
  assert.equal(gladys.fake.lastState(Z(1, 'temperature')), 20.5);
});

test('identity: another hub at the address publishes nothing until a Scan adopts it', async () => {
  let uid = UID;
  const hub = createHub((path, t, init) => {
    if (init.method === 'PATCH') {
      hub.patches.push({ path, body: JSON.parse(init.body) });
      return patchOk();
    }
    return path === '/v3/auth/release' ? releasePage(uid) : defaults[path]?.();
  });
  const { gladys, wait, store, set } = await setup({
    hub,
    devices: [createdZone()],
    config: ALLOWED,
  });
  assert.equal(store.data.hub.uid, UID);
  uid = 'other-hub';
  const before = gladys.fake.states.length;
  await wait(MINUTE);
  assert.equal(gladys.fake.states.length, before, 'nothing sent');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /Another Genius Hub answers .*\(id other-hub\)/,
  );
  const ack = await set(Z(1, 'setpoint'), 20);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Another hub answers/);
  assert.equal(hub.patches.length, 0);
  const off = await set(Z(1, 'heating-mode'), 0);
  assert.equal(off.success, true, '"Off" is never blocked by the identity');
  assert.equal(hub.patches.length, 1);
  await gladys.fake.scanRequest();
  assert.equal(store.data.hub.uid, 'other-hub');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  await wait(MINUTE);
  assert.ok(gladys.fake.states.length > before, 'values flow again');
});

test('commands: refused unless the option allows them; "Off" needs none; nothing sent', async () => {
  const { gladys, hub, set } = await setup({
    devices: [createdZone(), createdZone(ZONE.WATER), createdZone(ZONE.TOWEL)],
  });
  for (const [id, value, text] of [
    [Z(1, 'setpoint'), 20, /Setpoint commands are off/],
    [Z(1, 'heating-mode'), 1, /Mode commands are off/],
    [Z(1, 'zone-mode'), 'footprint', /Mode commands are off/],
    [Z(4, 'setpoint'), 50, /Setpoint commands are off/],
    [Z(4, 'water-mode'), 3, /Mode commands are off/],
    [Z(5, 'state'), 1, /Mode commands are off/],
    [Z(1, 'temperature'), 20, /cannot be set/],
  ]) {
    const ack = await set(id, value);
    assert.equal(ack.success, false, id);
    assert.match(ack.error, text);
  }
  assert.equal(hub.patches.length, 0);
  assert.equal(reads(hub, '/v3/zones').length, 1, 'no fresh read for a refused command');
  for (const [id, value] of [
    [Z(1, 'heating-mode'), 0],
    [Z(1, 'zone-mode'), 'off'],
    [Z(4, 'water-mode'), 0],
    [Z(5, 'state'), 0],
  ]) {
    const ack = await set(id, value);
    assert.equal(ack.success, true, id);
  }
  assert.deepEqual(
    hub.patches.map((p) => [p.path, p.body]),
    [
      ['/v3/zone/1', { iMode: 1 }],
      ['/v3/zone/1', { iMode: 1 }],
      ['/v3/zone/4', { iMode: 1 }],
      ['/v3/zone/5', { iMode: 1 }],
    ],
  );
  assert.ok(!gladys.fake.connectionStatus.message.en.includes('hubpass'));
});

test('a setpoint: decided on a fresh read, an override for the configured duration, read back, followed up', async () => {
  const list = zones();
  const hub = createHub((path, t, init) => {
    if (init.method === 'PATCH') {
      hub.patches.push({ path, body: JSON.parse(init.body), at: t });
      const body = JSON.parse(init.body);
      const target = list.find((z) => z.iID === Number(path.split('/').pop()));
      target.iMode = body.iMode;
      if (body.fBoostSP !== undefined) {
        target.fBoostSP = body.fBoostSP;
        target.fSP = body.fBoostSP;
        target.iBoostTimeRemaining = body.iBoostTimeRemaining;
      }
      return patchOk();
    }
    return path === '/v3/zones' ? zonesPage(list) : defaults[path]?.();
  });
  const { gladys, set, wait } = await setup({
    hub,
    devices: [createdZone()],
    config: { ...ALLOWED, override_duration: 30 },
  });
  assert.equal(reads(hub, '/v3/zones').length, 1);
  const ack = await set(Z(1, 'setpoint'), 22.5);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(hub.patches, [
    {
      path: '/v3/zone/1',
      body: { iMode: 16, fBoostSP: 22.5, iBoostTimeRemaining: 1800 },
      at: hub.patches[0].at,
    },
  ]);
  assert.equal(reads(hub, '/v3/zones').length, 3, 'the fresh read before, the read back after');
  assert.equal(gladys.fake.lastState(Z(1, 'setpoint')), 22.5, 'read back');
  assert.equal(gladys.fake.lastState(Z(1, 'zone-mode')), 'override');
  assert.equal(gladys.fake.lastState(Z(1, 'override-left')), '30 min');
  await wait(5 * SECOND);
  assert.equal(reads(hub, '/v3/zones').length, 4, 'follow-up 5 s after');
  await wait(15 * SECOND);
  assert.equal(reads(hub, '/v3/zones').length, 5, 'follow-up 20 s after');
  await wait(40 * SECOND);
  assert.equal(reads(hub, '/v3/zones').length, 6, 'the periodic read keeps its pace');
  // Already so: nothing sent.
  const again = await set(Z(1, 'setpoint'), 22.5);
  assert.equal(again.success, true);
  assert.equal(hub.patches.length, 1);
  // A mode: timer, footprint (PIR), override keeps the current setpoint.
  await wait(3 * SECOND);
  assert.equal((await set(Z(1, 'zone-mode'), 'timer')).success, true);
  assert.deepEqual(hub.patches[1].body, { iMode: 2 });
  await wait(3 * SECOND);
  assert.equal((await set(Z(1, 'heating-mode'), 1)).success, true, 'already timer: nothing sent');
  assert.equal(hub.patches.length, 2);
  assert.equal((await set(Z(1, 'zone-mode'), 'footprint')).success, true);
  assert.deepEqual(hub.patches[2].body, { iMode: 4 });
  await wait(3 * SECOND);
  assert.equal((await set(Z(1, 'zone-mode'), 'override')).success, true);
  assert.deepEqual(hub.patches[3].body, { iMode: 16, fBoostSP: 22.5, iBoostTimeRemaining: 1800 });
});

test('a setpoint: bounds (the ceiling of the configuration), steps, hot water whole degrees never above 60', async () => {
  const { hub, set } = await setup({
    devices: [createdZone(), createdZone(ZONE.WATER)],
    config: { ...ALLOWED, max_setpoint: 24, max_hot_water: 60 },
  });
  for (const [id, value, text] of [
    [Z(1, 'setpoint'), 24.5, /out of range: 4 to 24 °C/],
    [Z(1, 'setpoint'), 3, /out of range/],
    [Z(1, 'setpoint'), 20.3, /not valid/],
    [Z(1, 'setpoint'), '', /not valid/],
    [Z(1, 'setpoint'), null, /not valid/],
    [Z(4, 'setpoint'), 61, /out of range: 30 to 60 °C/],
    [Z(4, 'setpoint'), 50.5, /not valid/],
    [Z(1, 'zone-mode'), 'away', /not valid/],
    [Z(1, 'heating-mode'), 2, /not valid/],
  ]) {
    const ack = await set(id, value);
    assert.equal(ack.success, false, `${id} ${value}`);
    assert.match(ack.error, text);
  }
  assert.equal(hub.patches.length, 0);
  assert.equal((await set(Z(4, 'setpoint'), 60)).success, true);
  assert.deepEqual(hub.patches[0].body, { iMode: 16, fBoostSP: 60, iBoostTimeRemaining: 3600 });
});

test('a setpoint: the hub too slow before the command, nothing sent; a zone gone, nothing sent', async () => {
  let slow = false;
  let list = zones();
  const hub = createHub((path, t, init) => {
    if (init.method === 'PATCH') {
      hub.patches.push({ path, body: JSON.parse(init.body) });
      return patchOk();
    }
    if (path === '/v3/zones') {
      if (slow) {
        hub.clock.now += 3 * SECOND;
        return 'timeout';
      }
      return zonesPage(list);
    }
    return defaults[path]?.();
  });
  const { set, hub: h } = await setup({ hub, devices: [createdZone()], config: ALLOWED });
  slow = true;
  const late = await set(Z(1, 'setpoint'), 20);
  assert.equal(late.success, false);
  assert.match(late.error, /too slow to answer before the command: nothing sent/);
  assert.equal(h.patches.length, 0);
  slow = false;
  list = zones().filter((z) => z.iID !== ZONE.LOUNGE);
  const gone = await set(Z(1, 'setpoint'), 20);
  assert.equal(gone.success, false);
  assert.match(gone.error, /does not list this zone/);
  list = zones().map((z) => (z.iID === ZONE.LOUNGE ? { ...z, iType: 2 } : z));
  const other = await set(Z(1, 'setpoint'), 20);
  assert.match(other.error, /does not list this zone \(or not with this kind\)/);
  assert.equal(h.patches.length, 0);
});

test('a write the hub rejects or refuses is "not applied"; a silence is "sent, without confirmation"', async () => {
  let answer = () => json({ error: 7 });
  const hub = createHub((path, t, init) =>
    init.method === 'PATCH' ? answer() : defaults[path]?.(),
  );
  const { set, wait } = await setup({ hub, devices: [createdZone()], config: ALLOWED });
  const rejected = await set(Z(1, 'setpoint'), 20);
  assert.equal(rejected.success, false);
  assert.match(rejected.error, /rejected the command \(rejected by the hub \(7\)\): not applied/);
  await wait(3 * SECOND);
  answer = () => new Response('', { status: 500 });
  const unsure = await set(Z(1, 'setpoint'), 20);
  assert.equal(unsure.success, false);
  assert.match(unsure.error, /Command sent, without confirmation \(error of the hub 500\)/);
  await wait(3 * SECOND);
  answer = () => 'timeout';
  const silent = await set(Z(1, 'heating-mode'), 0);
  assert.equal(silent.success, false);
  assert.match(silent.error, /sent, without confirmation \(no answer\)/);
});

test('"Off" goes through a pause and past a refused login (one try); other commands are refused then', async () => {
  let status = 429;
  const hub = createHub((path, t, init) => {
    if (init.method === 'PATCH') {
      hub.patches.push({ path, body: JSON.parse(init.body) });
      return patchOk();
    }
    return status ? new Response('', { status }) : defaults[path]?.();
  });
  const { set, gladys, wait, app } = await setup({
    hub,
    devices: [createdZone()],
    config: ALLOWED,
  });
  assert.match(gladys.fake.connectionStatus.message.en, /reads paused/);
  const setpoint = await set(Z(1, 'setpoint'), 20);
  assert.match(setpoint.error, /asked to wait after an error: nothing sent/);
  const off = await set(Z(1, 'zone-mode'), 'off');
  assert.equal(off.success, true, off.error);
  assert.deepEqual(hub.patches, [{ path: '/v3/zone/1', body: { iMode: 1 } }]);
  status = 401;
  await wait(HOUR);
  assert.ok(app.refusedApplies());
  const refused = await set(Z(1, 'setpoint'), 20);
  assert.match(refused.error, /refuses the login: nothing sent/);
  const off2 = await set(Z(1, 'heating-mode'), 0);
  assert.equal(off2.success, true);
  assert.equal(hub.patches.length, 2);
});

test('"Off" after a setting that just left: sticky, written again by the follow-ups, starts refused meanwhile', async () => {
  const list = zones().map((z) =>
    z.iID === ZONE.LOUNGE ? { ...z, iMode: 16, fBoostSP: 22, iBoostTimeRemaining: 3600 } : z,
  );
  const hub = createHub((path, t, init) => {
    if (init.method === 'PATCH') {
      hub.patches.push({ path, body: JSON.parse(init.body), at: t });
      return patchOk();
    }
    return path === '/v3/zones' ? zonesPage(list) : defaults[path]?.();
  });
  const { set, wait, store, gladys } = await setup({
    hub,
    devices: [createdZone()],
    config: ALLOWED,
  });
  assert.equal((await set(Z(1, 'setpoint'), 23)).success, true);
  await wait(SECOND);
  const off = await set(Z(1, 'heating-mode'), 0);
  assert.equal(off.success, true);
  assert.deepEqual(hub.patches[1].body, { iMode: 1 });
  assert.equal(typeof store.data.sticky['1'].until, 'number', 'kept in /data');
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /"Off" is being enforced on zone\(s\) Lounge/,
  );
  const start = await set(Z(1, 'zone-mode'), 'timer');
  assert.equal(start.success, false);
  assert.match(start.error, /"Off" was sent to this zone just before/);
  // The hub still shows the zone on at the follow-ups: "Off" again, 3 times at most.
  const offs = () => hub.patches.filter((p) => p.body.iMode === 1).length;
  await wait(5 * SECOND);
  assert.ok(offs() >= 2, `${offs()} offs`);
  await wait(15 * SECOND);
  assert.ok(offs() >= 3, `${offs()} offs`);
  await wait(MINUTE);
  await wait(MINUTE);
  assert.equal(offs(), 4, '3 resends at most');
  await wait(MINUTE);
  assert.equal(store.data.sticky['1'], undefined, 'over after two minutes');
  await wait(3 * SECOND);
  assert.equal((await set(Z(1, 'zone-mode'), 'timer')).success, true);
});

test('"Off" during a write of the zone still leaving: waits for its departure only, then leaves', async () => {
  const hub = createHub();
  const { gladys, wait, app } = await setup({
    hub,
    devices: [createdZone()],
    config: ALLOWED,
  });
  hub.net.hold = true;
  const device = gladys.fake.devices[0];
  const feature = (role) => device.features.find((f) => f.external_id === Z(1, role));
  const setpoint = gladys.fake.setValue(device, feature('setpoint'), 20);
  await wait(0);
  // The fresh read is held: the setpoint has not left. "Off" cancels it.
  const off = gladys.fake.setValue(device, feature('heating-mode'), 0);
  await wait(0);
  hub.net.hold = false;
  hub.net.release();
  await wait(SECOND);
  const offAck = await off;
  assert.equal(offAck.success, true, offAck.error);
  const setpointAck = await setpoint;
  assert.equal(setpointAck.success, false);
  assert.match(setpointAck.error, /"Off" was sent to this zone just before/);
  assert.deepEqual(
    hub.patches.map((p) => p.body),
    [{ iMode: 1 }],
    'only "Off" left',
  );
  await app.idle();
});

test('two commands of a zone back to back: the second waits a little', async () => {
  const { set, wait } = await setup({ devices: [createdZone()], config: ALLOWED });
  assert.equal((await set(Z(1, 'setpoint'), 20)).success, true);
  const soon = await set(Z(1, 'setpoint'), 21);
  assert.match(soon.error, /still running or just left/);
  await wait(COMMAND.spacing);
  assert.equal((await set(Z(1, 'setpoint'), 21)).success, true);
});

test('a footprint on a zone without PIR is refused; an on/off zone goes on as an override', async () => {
  const { set, hub } = await setup({
    devices: [createdZone(ZONE.KITCHEN), createdZone(ZONE.TOWEL)],
    config: ALLOWED,
  });
  const fp = await set(Z(2, 'zone-mode'), 'footprint');
  assert.match(fp.error, /no occupancy sensor/);
  assert.equal(hub.patches.length, 0);
  assert.equal((await set(Z(5, 'state'), 1)).success, true);
  assert.deepEqual(hub.patches[0].body, { iMode: 16, fBoostSP: 1, iBoostTimeRemaining: 3600 });
});

test('a reconnection to Gladys clears neither the pause nor the refused login, and sends the status again', async () => {
  const hub = createHub(() => new Response('', { status: 503 }));
  const { gladys, hub: h } = await setup({ hub });
  assert.equal(gladys.fake.connectionStatuses.length, 2, 'waiting, then paused');
  await gladys.disconnect();
  await gladys.connect();
  assert.equal(reads(h, '/v3/auth/release').length, 1);
  assert.equal(gladys.fake.connectionStatuses.length, 3, 'the status is sent again');
  assert.match(gladys.fake.connectionStatus.message.en, /reads paused/);
});

test('a stop writes /data and the budget of states is honoured on a big first read', async () => {
  const many = {};
  for (let i = 10; i < 90; i += 1) {
    many[String(i)] = node(String(i), '0x0000000200040005', 'Lounge', {
      Battery: 50,
      TEMPERATURE: 20,
      HEATING_1: 21,
    });
  }
  const hub = createHub((path) =>
    path === '/v3/data_manager' ? dataManagerPage(many) : defaults[path]?.(),
  );
  const created = Object.keys(many).map((addr) => ({
    ...createdHubDevice('2'),
    external_id: D(addr),
    features: createdHubDevice('2').features.map((f) => ({
      ...f,
      external_id: f.external_id.replace(':2:', `:${addr}:`),
    })),
  }));
  const { gladys, wait, app, store } = await setup({ hub, devices: created });
  const sent = () => gladys.fake.states.length;
  assert.ok(sent() <= 100, `${sent()} states in the first second`);
  await wait(SECOND);
  assert.ok(sent() <= 200, `${sent()} states after two flushes`);
  await wait(MINUTE);
  assert.equal(sent(), 240, 'all sent within the budget of 300 a minute');
  await app.stop();
  assert.equal(Object.keys(store.data.devices).length, 80);
});

test('a config saved with the same login keeps the session; another address drops the pause', async () => {
  const hub = createHub(() => new Response('', { status: 503 }));
  const { app, start, store, gladys } = await setup({ hub });
  const session = app.session;
  await start({ ...CONFIG, poll_interval: 120 });
  assert.equal(app.session, session);
  assert.ok(store.data.pause);
  await start({ ...CONFIG, address: '192.168.1.51' });
  assert.notEqual(app.session, session);
  assert.equal(store.data.pause, null);
  assert.match(gladys.fake.connectionStatus.message.en, /Waiting for the first answer/);
});

test('an odd zones page (a zone with hostile fields) never breaks the read', async () => {
  const hub = createHub((path) =>
    path === '/v3/zones'
      ? zonesPage([
          zone({
            strName: 'x'.repeat(500),
            fPV: { a: 1 },
            lstIssues: [{ id: 5 }],
            iFlagExpectedKit: 'pir',
          }),
        ])
      : defaults[path]?.(),
  );
  const { gladys } = await setup({ hub, devices: [createdZone()] });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.discoveredDevices[0].name.length, 60);
  assert.equal(gladys.fake.lastState(Z(1, 'temperature')), undefined);
  assert.equal(gladys.fake.lastState(Z(1, 'faults')), 'unknown');
});
