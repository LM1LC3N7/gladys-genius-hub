// -----------------------------------------------------------------------------
// The app end to end against the fake Gladys of the SDK, a scripted hub (a
// state that the PATCHes change) and a virtual clock: reads and their pace,
// failures, identity, values, commands.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COMMAND, DEVICE_STALE_AFTER } from '../src/constants.js';
import { createMemoryStore } from '../src/store.js';
import { NOW, NOW_SECONDS, json, node, zone } from './fixtures/genius.js';
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
  setup,
} from './helpers/app.js';

const ALLOWED = { ...CONFIG, allow_setpoint: true, allow_modes: true };
const reads = (hub, path) =>
  hub.net.calls.filter((c) => c.path === path && c.init.method === 'GET');
const offs = (hub, id) =>
  hub.patches.filter((p) => p.path === `/v3/zone/${id}` && p.body.iMode === 1).length;
const zoneOf = (hub, id) => hub.state.zones.find((z) => z.iID === id);

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
  assert.deepEqual(
    discovered[3].features.map((f) => f.external_id.split(':').pop()),
    ['temperature', 'setpoint', 'water-mode', 'heating', 'override-left', 'fault', 'faults'],
  );
  assert.deepEqual(
    discovered[5].features.map((f) => f.external_id.split(':').pop()),
    ['temperature', 'setpoint', 'battery'],
  );
  for (const device of discovered) {
    for (const f of device.features) {
      for (const o of f.supported_options ?? []) assert.equal(typeof o.label, 'string');
    }
  }
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /Connected to the Genius Hub 5\.3\.6 .*5 zone\(s\) and 5 device\(s\)/,
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
  assert.equal(gladys.fake.lastState(D('2', 'battery')), 85);
  assert.equal(gladys.fake.lastState(D('2', 'temperature')), 20.5);
  assert.equal(gladys.fake.lastState(D('2', 'setpoint')), 21);
  assert.equal(gladys.fake.lastState(D('5', 'luminance')), 120);
  assert.equal(gladys.fake.lastState(D('5', 'motion')), 1);
});

test('r1-8: a zone on the outside temperature (zone:using_weather_temp) publishes no room temperature', async () => {
  const { gladys } = await setup({ devices: [createdZone(ZONE.KITCHEN)] });
  assert.equal(gladys.fake.lastState(Z(2, 'temperature')), undefined);
  assert.match(
    String(gladys.fake.lastState(Z(2, 'faults'))),
    /zone:using_weather_temp \(the hub uses the outside temperature: the room temperature is not sent\)/,
  );
  assert.equal(gladys.fake.lastState(Z(2, 'setpoint')), 4, 'the other values are sent');
});

test('r1-8: a channel takes the last communication of its node: a silent node, no value of its channel', async () => {
  const hub = createHub();
  hub.state.devices['4'].childValues.lastComms.val = NOW_SECONDS - (3 * HOUR) / 1000;
  const created = createdHubDevice('2');
  const channel = {
    ...created,
    external_id: D('4-1'),
    features: [
      {
        ...created.features[0],
        external_id: D('4-1', 'output'),
        category: 'switch',
        type: 'binary',
      },
    ],
  };
  const { gladys } = await setup({ hub, devices: [channel] });
  assert.equal(gladys.fake.lastState(D('4-1', 'output')), undefined);
  assert.match(gladys.fake.connectionStatus.message.en, /1 device\(s\) have not talked to the hub/);
});

test('r1-8: a device without any time of last communication is sent on change only, never as a heartbeat', async () => {
  const hub = createHub();
  delete hub.state.devices['2'].childValues.lastComms;
  const { gladys, app, advance } = await setup({
    hub,
    devices: [createdHubDevice('2'), createdZone()],
    connect: false,
  });
  // The SDK keeps the heartbeat on the real clock: the options it is given tell.
  const calls = [];
  const real = gladys.publishChangedStates.bind(gladys);
  gladys.publishChangedStates = (states, options) => {
    calls.push({ ids: states.map((st) => st.device_feature_external_id), options });
    return real(states, options);
  };
  await gladys.connect();
  await advance(0);
  await app.idle();
  const device = calls.filter((c) => c.ids.includes(D('2', 'battery')));
  assert.equal(device.length, 1);
  assert.equal(device[0].options?.heartbeat, undefined, 'no heartbeat for a value without date');
  assert.ok(!device[0].ids.includes(Z(1, 'temperature')));
  const zoneCall = calls.find((c) => c.ids.includes(Z(1, 'temperature')));
  assert.equal(zoneCall.options.heartbeat, 30 * MINUTE, 'the zones keep their heartbeat');
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
  assert.equal(second.gladys.fake.discoveredDevices.length, 10, 'offered from /data');
  await second.wait(40 * SECOND);
  assert.equal(reads(second.hub, '/v3/zones').length, 1);
});

test('refused login (401 on the release page): a final stop, the test button tries once, a success lifts it', async () => {
  let status = 401;
  const hub = createHub((path) =>
    status && path === '/v3/auth/release' ? new Response('', { status }) : undefined,
  );
  const { gladys, wait, store } = await setup({ hub, devices: [createdZone()] });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /refuses this login: reads stopped/);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /If you already did, click "Test the connection": a read leaves once the read interval is over/,
    'r1-10',
  );
  await wait(HOUR);
  assert.equal(reads(hub, '/v3/auth/release').length, 1, 'never tried again by itself');
  assert.ok(!JSON.stringify(store.data).includes('hubpass'), 'never the password in /data');
  assert.equal(typeof store.data.refused.tag, 'number');
  status = 0;
  const ack = await gladys.fake.action('test_connection');
  assert.match(ack.data.message.en, /Read now/);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(store.data.refused, null);
});

test('r1-4: a 401 on the devices page is not a refused login: the zones are read, the page spaced up to 1 h', async () => {
  const hub = createHub((path) =>
    path === '/v3/data_manager' ? new Response('', { status: 401 }) : undefined,
  );
  const { gladys, wait, store } = await setup({ hub, devices: [createdZone()] });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(store.data.refused, null);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /devices of the hub .* could not be read this time \(access to this page refused to this login\)/,
  );
  assert.equal(gladys.fake.lastState(Z(1, 'temperature')), 20.5);
  await wait(MINUTE);
  assert.equal(reads(hub, '/v3/zones').length, 2, 'the zones at every read');
  assert.equal(reads(hub, '/v3/data_manager').length, 1, 'the devices page waits (2 intervals)');
  await wait(MINUTE);
  assert.equal(reads(hub, '/v3/data_manager').length, 2);
});

test('r1-4: a 401 on the zones page is not a refused login: tried again, spaced', async () => {
  const hub = createHub((path) =>
    path === '/v3/zones' ? new Response('', { status: 403 }) : undefined,
  );
  const { gladys, wait, store } = await setup({ hub });
  assert.equal(store.data.refused, null);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /could not be read \(access to this page refused to this login\)/,
  );
  await wait(10 * MINUTE);
  assert.ok(reads(hub, '/v3/auth/release').length > 1, 'tried again');
});

test('5xx and 429: a pause kept in /data, doubled; a 503 says it may be the login; cleared by a success', async () => {
  let status = 503;
  const hub = createHub(() => (status ? new Response('', { status }) : undefined));
  const { gladys, wait, store, clock } = await setup({ hub });
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /asks to wait \(error of the hub 503, also given for a wrong login: check the user name and password\): reads paused, new try in 1 min/,
  );
  assert.equal(store.data.pause.code, 'server');
  await wait(MINUTE);
  assert.equal(reads(hub, '/v3/auth/release').length, 2);
  assert.match(gladys.fake.connectionStatus.message.en, /new try in 2 min/);
  const restarted = await setup({ hub, store, now: clock.now });
  assert.equal(reads(hub, '/v3/auth/release').length, 2, 'the pause survives a restart');
  await restarted.wait(2 * MINUTE + SECOND);
  assert.equal(reads(hub, '/v3/auth/release').length, 3);
  status = 0;
  await restarted.wait(4 * MINUTE);
  assert.equal(restarted.gladys.fake.connectionStatus.connected, true);
  assert.equal(restarted.store.data.pause, null);
});

test('r1-5: a new password lifts the pause of a 503: the next read at the interval, not the pause', async () => {
  let status = 503;
  const hub = createHub(() => (status ? new Response('', { status }) : undefined));
  const { gladys, wait, start, store } = await setup({ hub });
  for (let i = 0; i < 3; i += 1) await wait(2 ** i * MINUTE);
  assert.equal(reads(hub, '/v3/auth/release').length, 4);
  assert.match(gladys.fake.connectionStatus.message.en, /new try in 8 min/);
  status = 0;
  await start({ ...CONFIG, password: 'newpass' });
  assert.equal(store.data.pause, null);
  await wait(MINUTE);
  assert.equal(reads(hub, '/v3/auth/release').length, 5, 'read at the interval');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('unreachable: retries 30 s, 1 min, 2 min... never sooner than the interval', async () => {
  const hub = createHub(() => 'timeout');
  const { gladys, wait } = await setup({ hub });
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /could not be read \(no answer\): new try in 1 min/,
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

test('r1-6: a failed read of the configuration is tried again with a status; "Off" waits for it', async () => {
  const hub = createHub();
  const { gladys, app, advance, wait } = await setup({
    hub,
    devices: [createdZone()],
    config: ALLOWED,
    connect: false,
  });
  const real = gladys.getConfig.bind(gladys);
  // The first call is the resynchronization of the SDK; the second, the app's, fails.
  let calls = 0;
  let failures = 1;
  gladys.getConfig = async () => {
    calls += 1;
    if (calls > 1 && failures > 0) {
      failures -= 1;
      throw new Error('unreachable');
    }
    return real();
  };
  await gladys.connect();
  await advance(0);
  await app.idle();
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /configuration of the integration could not be read from Gladys: new try in 5 s/,
  );
  assert.equal(reads(hub, '/v3/zones').length, 0);
  // "Off" arrives before the configuration: it waits for it, within its budget.
  const device = gladys.fake.devices[0];
  const feature = device.features.find((f) => f.external_id === Z(1, 'heating-mode'));
  failures = 0;
  await advance(3 * SECOND);
  // The retry of the configuration comes at 5 s, within the budget of this "Off".
  const ack = gladys.fake.setValue(device, feature, 0);
  await wait(0);
  await advance(3 * SECOND);
  const off = await ack;
  assert.equal(reads(hub, '/v3/zones').length >= 1, true, 'started');
  assert.equal(off.success, true, off.error);
  assert.equal(offs(hub, ZONE.LOUNGE), 1);
});

test('r1-6: "Off" while the configuration cannot be read: refused with the true cause', async () => {
  const { gladys, advance, wait } = await setup({
    devices: [createdZone()],
    connect: false,
  });
  const real = gladys.getConfig.bind(gladys);
  let calls = 0;
  gladys.getConfig = async () => {
    calls += 1;
    if (calls > 1) throw new Error('unreachable');
    return real();
  };
  await gladys.connect();
  await advance(0);
  const device = gladys.fake.devices[0];
  const feature = device.features.find((f) => f.external_id === Z(1, 'heating-mode'));
  const ack = gladys.fake.setValue(device, feature, 0);
  await wait(0);
  await advance(4 * SECOND);
  const off = await ack;
  assert.equal(off.success, false);
  assert.match(off.error, /configuration of the integration is not read from Gladys yet/);
});

test('devices: values sent only when the device talked to the hub since; stale ones not sent', async () => {
  const hub = createHub();
  const nodes = hub.state.devices;
  const { gladys, wait } = await setup({
    hub,
    devices: [createdHubDevice('2'), createdHubDevice('3')],
  });
  const sent = () =>
    gladys.fake.states.filter((s) => s.device_feature_external_id === D('2', 'battery')).length;
  assert.equal(sent(), 1);
  nodes['2'].childValues.Battery.val = 70;
  await wait(MINUTE);
  assert.equal(sent(), 1, 'the same lastComms: an old copy, not sent again');
  nodes['2'].childValues.lastComms.val = NOW_SECONDS + 30;
  await wait(MINUTE);
  assert.equal(sent(), 2);
  nodes['3'].childValues.lastComms.val = NOW_SECONDS - (3 * HOUR) / 1000;
  nodes['3'].childValues.Battery.val = 10;
  await wait(MINUTE);
  assert.equal(gladys.fake.lastState(D('3', 'battery')), 60);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /1 device\(s\) have not talked to the hub for 2 h or more/,
  );
  assert.ok(DEVICE_STALE_AFTER === 2 * HOUR);
});

test('devices: a page of devices failing leaves the zones read; the status says so', async () => {
  const hub = createHub((path) => (path === '/v3/data_manager' ? 'timeout' : undefined));
  const { gladys } = await setup({ hub, devices: [createdZone()] });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /devices of the hub .* could not be read this time \(no answer\)/,
  );
  assert.equal(gladys.fake.lastState(Z(1, 'temperature')), 20.5);
});

test('identity: another hub at the address publishes nothing until a Scan adopts it', async () => {
  const hub = createHub();
  const { gladys, wait, store, set } = await setup({
    hub,
    devices: [createdZone()],
    config: ALLOWED,
  });
  assert.equal(store.data.hub.uid, hub.state.uid);
  hub.state.uid = 'other-hub';
  const before = gladys.fake.states.length;
  await wait(MINUTE);
  assert.equal(gladys.fake.states.length, before, 'nothing sent');
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /Another Genius Hub answers .*\(id other-hub\)/,
  );
  const ack = await set(Z(1, 'setpoint'), 20);
  assert.match(ack.error, /Another hub answers/);
  assert.equal(hub.patches.length, 0);
  const off = await set(Z(1, 'heating-mode'), 0);
  assert.equal(off.success, true, '"Off" does not depend on the identity');
  await gladys.fake.scanRequest();
  assert.equal(store.data.hub.uid, 'other-hub');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('r1-7: the identity is read again by the command: another hub answering now, nothing sent', async () => {
  const hub = createHub();
  const { set } = await setup({ hub, devices: [createdZone()], config: ALLOWED });
  hub.state.uid = 'swapped';
  const ack = await set(Z(1, 'setpoint'), 20);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Another hub answers at this address: nothing sent/);
  assert.equal(hub.patches.length, 0);
});

test('r1-7: a command during a slow periodic read is not delayed behind it', async () => {
  let slow = false;
  const hub = createHub(async (path) => {
    if (slow && path === '/v3/data_manager') {
      await new Promise((resolve) => setTimeout(resolve, 50));
      hub.clock.now += 3 * SECOND;
    }
    return undefined;
  });
  const { gladys, advance, app } = await setup({
    hub,
    devices: [createdZone()],
    config: ALLOWED,
  });
  slow = true;
  await advance(MINUTE);
  // The periodic read is now on the devices page (3 s); the command arrives.
  const device = gladys.fake.devices[0];
  const feature = device.features.find((f) => f.external_id === Z(1, 'setpoint'));
  const ack = await gladys.fake.setValue(device, feature, 20);
  await app.idle();
  assert.equal(ack.success, true, ack.error);
  assert.equal(hub.patches.length, 1);
});

test('r1-7: three zones commanded together: three successes, one fresh read shared', async () => {
  const hub = createHub();
  const { gladys, app } = await setup({
    hub,
    devices: [createdZone(ZONE.LOUNGE), createdZone(ZONE.KITCHEN), createdZone(ZONE.FLOOR)],
    config: ALLOWED,
  });
  const before = reads(hub, '/v3/auth/release').length;
  const acks = [ZONE.LOUNGE, ZONE.KITCHEN, ZONE.FLOOR].map((id) => {
    const device = gladys.fake.devices.find((d) => d.external_id === Z(id));
    const feature = device.features.find((f) => f.external_id === Z(id, 'setpoint'));
    return gladys.fake.setValue(device, feature, 22);
  });
  const results = await Promise.all(acks);
  await app.idle();
  assert.deepEqual(
    results.map((r) => r.success),
    [true, true, true],
    JSON.stringify(results),
  );
  assert.equal(reads(hub, '/v3/auth/release').length - before, 1, 'one fresh read');
  assert.equal(hub.patches.length, 3);
});

test('commands: refused unless the option allows them; "Off" needs none and is confirmed', async () => {
  const { hub, set } = await setup({
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
  for (const [id, value] of [
    [Z(1, 'heating-mode'), 0],
    [Z(4, 'water-mode'), 0],
    [Z(5, 'state'), 0],
  ]) {
    const ack = await set(id, value);
    assert.equal(ack.success, true, `${id} ${ack.error}`);
  }
  assert.deepEqual(
    hub.patches.map((p) => [p.path, p.body]),
    [
      ['/v3/zone/1', { iMode: 1 }],
      ['/v3/zone/4', { iMode: 1 }],
      ['/v3/zone/5', { iMode: 1 }],
    ],
  );
});

test('a setpoint: decided on a fresh read, an override for the configured duration, read back, followed up', async () => {
  const hub = createHub();
  const { gladys, set, wait } = await setup({
    hub,
    devices: [createdZone()],
    config: { ...ALLOWED, override_duration: 30 },
  });
  const ack = await set(Z(1, 'setpoint'), 22.5);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(hub.patches[0].body, {
    iMode: 16,
    fBoostSP: 22.5,
    iBoostTimeRemaining: 1800,
  });
  assert.equal(reads(hub, '/v3/zones').length, 3, 'the fresh read before, the read back after');
  assert.equal(gladys.fake.lastState(Z(1, 'setpoint')), 22.5, 'read back');
  assert.equal(gladys.fake.lastState(Z(1, 'zone-mode')), 'override');
  await wait(5 * SECOND);
  assert.equal(reads(hub, '/v3/zones').length, 4, 'follow-up 5 s after');
  await wait(15 * SECOND);
  assert.equal(reads(hub, '/v3/zones').length, 5, 'follow-up 20 s after');
  const again = await set(Z(1, 'setpoint'), 22.5);
  assert.equal(again.success, true, 'already so: a success, nothing sent');
  assert.equal(hub.patches.length, 1);
  assert.equal((await set(Z(1, 'zone-mode'), 'timer')).success, true);
  assert.deepEqual(hub.patches[1].body, { iMode: 2 });
  await wait(3 * SECOND);
  assert.equal((await set(Z(1, 'heating-mode'), 1)).success, true, 'already timer');
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
  const ok = await set(Z(4, 'setpoint'), 60);
  assert.equal(ok.success, true, ok.error);
  assert.deepEqual(hub.patches[0].body, { iMode: 16, fBoostSP: 60, iBoostTimeRemaining: 3600 });
});

test('r1-1: an override or a boost never writes a current setpoint outside the bounds', async () => {
  const hub = createHub();
  const water = zoneOf(hub, ZONE.WATER);
  Object.assign(water, { iMode: 2, fSP: 65, fBoostSP: 0, iBoostTimeRemaining: 0 });
  const lounge = zoneOf(hub, ZONE.LOUNGE);
  Object.assign(lounge, { fSP: 28 });
  const { set, start, wait } = await setup({
    hub,
    devices: [createdZone(), createdZone(ZONE.WATER)],
    config: ALLOWED,
  });
  const boost = await set(Z(4, 'water-mode'), 3);
  assert.equal(boost.success, false);
  assert.match(boost.error, /current setpoint of the zone \(65 °C\) is outside .*30 to 55 °C/);
  const room = await set(Z(1, 'zone-mode'), 'override');
  assert.match(room.error, /current setpoint of the zone \(28 °C\) is outside .*4 to 25 °C/);
  await start({ ...ALLOWED, max_hot_water: 60 });
  water.fSP = 61;
  await wait(3 * SECOND);
  assert.match((await set(Z(4, 'water-mode'), 3)).error, /\(61 °C\) is outside .*30 to 60 °C/);
  water.fSP = 0;
  await wait(3 * SECOND);
  assert.match((await set(Z(4, 'water-mode'), 3)).error, /\(0 °C\) is outside/);
  delete water.fSP;
  await wait(3 * SECOND);
  assert.match((await set(Z(4, 'water-mode'), 3)).error, /\(\? °C\) is outside/);
  assert.equal(hub.patches.length, 0);
  water.fSP = 50;
  await wait(3 * SECOND);
  const ok = await set(Z(4, 'water-mode'), 3);
  assert.equal(ok.success, true, ok.error);
  assert.deepEqual(hub.patches[0].body, { iMode: 16, fBoostSP: 50, iBoostTimeRemaining: 3600 });
});

test('r1-1: a ceiling lowered during the fresh read refuses the setpoint taken from the hub', async () => {
  let lower;
  const hub = createHub(async (path, t, init) => {
    if (lower && path === '/v3/zones' && init.method === 'GET') {
      const run = lower;
      lower = undefined;
      await run();
    }
    return undefined;
  });
  const water = zoneOf(hub, ZONE.WATER);
  Object.assign(water, { iMode: 2, fSP: 55 });
  const { set, app } = await setup({ hub, devices: [createdZone(ZONE.WATER)], config: ALLOWED });
  lower = () => app.start({ ...ALLOWED, max_hot_water: 50 });
  const ack = await set(Z(4, 'water-mode'), 3);
  assert.equal(ack.success, false);
  assert.match(ack.error, /\(55 °C\) is outside .*30 to 50 °C/);
  assert.equal(hub.patches.length, 0);
});

test('r1-2: a setpoint applied at another value is a failure; beyond the bounds the zone is turned off', async () => {
  let applied;
  const hub = createHub((path, t, init) => {
    if (init.method === 'PATCH' && applied !== undefined) {
      const body = JSON.parse(init.body);
      hub.patches.push({ path, body });
      if (body.iMode === 1) {
        zoneOf(hub, ZONE.LOUNGE).iMode = 1;
      } else {
        Object.assign(zoneOf(hub, ZONE.LOUNGE), { iMode: 16, ...applied });
      }
      return { error: 0 };
    }
    return undefined;
  });
  const { set, wait, gladys } = await setup({ hub, devices: [createdZone()], config: ALLOWED });
  applied = { fBoostSP: 23, fSP: 23, iBoostTimeRemaining: 3600 };
  const other = await set(Z(1, 'setpoint'), 24);
  assert.equal(other.success, false);
  assert.match(other.error, /The hub applied 23 °C instead of 24 °C/);
  await wait(3 * SECOND);
  applied = { fBoostSP: 28, fSP: 28, iBoostTimeRemaining: 7200 };
  const beyond = await set(Z(1, 'setpoint'), 24);
  assert.equal(beyond.success, false);
  assert.match(
    beyond.error,
    /outside the bounds of the integration \(28 °C, 120 min\): "Off" sent/,
  );
  await wait(SECOND);
  assert.equal(offs(hub, ZONE.LOUNGE), 1, '"Off" written at once');
  assert.equal(gladys.fake.lastState(Z(1, 'zone-mode')) !== undefined, true);
  const start = await set(Z(1, 'zone-mode'), 'timer');
  assert.match(start.error, /"Off" was sent to this zone just before/);
});

test('r1-2/r2-1: a command the hub does not apply: not confirmed at once, said by the 20 s follow-up', async () => {
  const hub = createHub();
  const { set, wait, gladys } = await setup({ hub, devices: [createdZone()], config: ALLOWED });
  hub.apply = false;
  const ack = await set(Z(1, 'zone-mode'), 'footprint');
  assert.equal(ack.success, false);
  assert.match(
    ack.error,
    /not shown yet by the zone read back: the reads of 5 s and 20 s check it/,
  );
  await wait(5 * SECOND);
  assert.doesNotMatch(gladys.fake.connectionStatus.message.en, /not applied/);
  await wait(15 * SECOND);
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /last command of zone Lounge was accepted by the hub but not applied within 20 s/,
  );
  assert.equal(offs(hub, ZONE.LOUNGE), 0, 'nothing turned off');
});

test('r1-2: a mode applied otherwise is a failure at once', async () => {
  const hub = createHub((path, t, init) => {
    if (init.method === 'PATCH') {
      hub.patches.push({ path, body: JSON.parse(init.body) });
      zoneOf(hub, ZONE.LOUNGE).iMode = 8;
      return { error: 0 };
    }
    return undefined;
  });
  const { set } = await setup({ hub, devices: [createdZone()], config: ALLOWED });
  const ack = await set(Z(1, 'zone-mode'), 'footprint');
  assert.match(ack.error, /shows the zone in mode "away" instead of "footprint"/);
});

test('r1-2: no read-back in time is not a confirmation', async () => {
  const hub = createHub();
  const { set } = await setup({ hub, devices: [createdZone()], config: ALLOWED });
  const original = hub.world;
  let patched = false;
  hub.world = async (path, t, init) => {
    if (init.method === 'PATCH') patched = true;
    if (patched && path === '/v3/zones') return 'timeout';
    return original(path, t, init);
  };
  const ack = await set(Z(1, 'setpoint'), 20);
  assert.equal(ack.success, false);
  assert.match(ack.error, /not shown yet by the zone read back/);
  const off = await set(Z(1, 'heating-mode'), 0);
  assert.equal(off.success, false);
  assert.match(
    off.error,
    /"Off" sent and accepted by the hub, but the zone could not be read back/,
  );
});

test('r1-2: "Off" accepted but not applied: the follow-ups say so and write it again 3 times', async () => {
  const hub = createHub();
  const { set, wait, gladys, lines } = await setup({
    hub,
    devices: [createdZone()],
    config: ALLOWED,
  });
  hub.apply = false;
  const off = await set(Z(1, 'heating-mode'), 0);
  assert.equal(off.success, false);
  assert.match(
    off.error,
    /read back right after still shows mode "timer": the reads of 5 s and 20 s check it/,
  );
  assert.doesNotMatch(gladys.fake.connectionStatus.message.en, /did not take effect/, 'not yet');
  assert.equal(offs(hub, ZONE.LOUNGE), 1);
  const start = await set(Z(1, 'zone-mode'), 'timer');
  assert.match(start.error, /"Off" was sent to this zone just before/);
  await wait(5 * SECOND);
  assert.equal(offs(hub, ZONE.LOUNGE), 2, 'written again at the follow-up');
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /"Off" did not take effect on zone\(s\) Lounge/,
  );
  assert.ok(lines.some((l) => l.includes('still on, "off" written again')));
  await wait(2 * MINUTE);
  assert.equal(offs(hub, ZONE.LOUNGE), 4, '3 times at most');
  hub.apply = true;
  await wait(MINUTE);
  assert.doesNotMatch(gladys.fake.connectionStatus.message.en, /did not take effect/);
});

test('r2-1: a hub applying 300 ms after its answer: a setpoint over an app boost at 28 °C is confirmed at 5 s, never turned off', async () => {
  const hub = createHub();
  Object.assign(zoneOf(hub, ZONE.LOUNGE), {
    iMode: 16,
    fBoostSP: 28,
    fSP: 28,
    iBoostTimeRemaining: 7200,
  });
  const { set, wait, gladys } = await setup({ hub, devices: [createdZone()], config: ALLOWED });
  hub.applyAfter = 300;
  const ack = await set(Z(1, 'setpoint'), 22);
  assert.equal(ack.success, false);
  assert.match(ack.error, /not shown yet by the zone read back/);
  assert.equal(offs(hub, ZONE.LOUNGE), 0, 'no "Off" on the state of before');
  await wait(5 * SECOND);
  assert.equal(gladys.fake.lastState(Z(1, 'setpoint')), 22);
  assert.equal(offs(hub, ZONE.LOUNGE), 0);
  await wait(15 * SECOND);
  assert.doesNotMatch(gladys.fake.connectionStatus.message.en, /not applied|outside the bounds/);
  await wait(SECOND);
  assert.equal((await set(Z(1, 'zone-mode'), 'timer')).success, false, 'still pending at once');
  await wait(5 * SECOND);
  assert.equal(zoneOf(hub, ZONE.LOUNGE).iMode, 2, 'no guard: the next command left');
});

test('r2-1/r2-3: a value beyond the bounds seen only at the 5 s follow-up turns the zone off, with its own note', async () => {
  const hub = createHub((path, t, init) => {
    if (init.method === 'PATCH') {
      const body = JSON.parse(init.body);
      hub.patches.push({ path, body });
      hub.late.push({
        due: t + 300,
        id: 1,
        body: body.iMode === 1 ? body : { ...body, fBoostSP: 28, iBoostTimeRemaining: 7200 },
      });
      return { error: 0 };
    }
    return undefined;
  });
  hub.applyAfter = 300;
  const { set, wait, gladys } = await setup({ hub, devices: [createdZone()], config: ALLOWED });
  const ack = await set(Z(1, 'setpoint'), 22);
  assert.match(ack.error, /not shown yet/);
  assert.equal(offs(hub, ZONE.LOUNGE), 0);
  await wait(5 * SECOND);
  assert.equal(offs(hub, ZONE.LOUNGE), 1, '"Off" at the follow-up');
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /The hub applied 28 °C for 120 min on zone Lounge, outside the bounds of the integration: "Off" sent and kept/,
  );
  assert.doesNotMatch(gladys.fake.connectionStatus.message.en, /may still be applied/);
});

test('r2-1: "Off" applied 300 ms late: no failure note, no rewrite, the guard lifted by the follow-up', async () => {
  const hub = createHub();
  const { set, wait, gladys } = await setup({ hub, devices: [createdZone()], config: ALLOWED });
  hub.applyAfter = 300;
  const off = await set(Z(1, 'heating-mode'), 0);
  assert.match(off.error, /still shows mode "timer"/);
  await wait(5 * SECOND);
  assert.equal(offs(hub, ZONE.LOUNGE), 1, 'not written again');
  assert.doesNotMatch(gladys.fake.connectionStatus.message.en, /did not take effect/);
  hub.applyAfter = 0;
  const heat = await set(Z(1, 'heating-mode'), 1);
  assert.equal(heat.success, true, heat.error);
});

test('r2-2: commands arriving one after the other: one fresh read in flight at a time', async () => {
  let inFlight = 0;
  let most = 0;
  const hub = createHub(async (path, t, init) => {
    if (path === '/v3/auth/release' && init.method === 'GET') {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
    }
    return undefined;
  });
  const ids = [ZONE.LOUNGE, ZONE.KITCHEN, ZONE.FLOOR];
  const { gladys, app } = await setup({
    hub,
    devices: ids.map((id) => createdZone(id)),
    config: ALLOWED,
  });
  most = 0;
  const acks = [];
  for (const id of ids) {
    const device = gladys.fake.devices.find((d) => d.external_id === Z(id));
    const feature = device.features.find((f) => f.external_id === Z(id, 'setpoint'));
    acks.push(gladys.fake.setValue(device, feature, 22));
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const results = await Promise.all(acks);
  await app.idle();
  assert.deepEqual(
    results.map((r) => r.success),
    [true, true, true],
    JSON.stringify(results),
  );
  assert.equal(most, 1, 'never two fresh reads at once');
});

test('"Off" goes through a pause and past a refused login (one try); other commands are refused then', async () => {
  let status = 429;
  const hub = createHub((path) =>
    status && path === '/v3/auth/release' ? new Response('', { status }) : undefined,
  );
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
  assert.deepEqual(
    hub.patches.map((p) => p.body),
    [{ iMode: 1 }],
  );
  status = 401;
  await wait(HOUR);
  assert.ok(app.refusedApplies());
  const refused = await set(Z(1, 'setpoint'), 20);
  assert.match(refused.error, /refuses the login: nothing sent/);
  zoneOf(hub, ZONE.LOUNGE).iMode = 2;
  const off2 = await set(Z(1, 'heating-mode'), 0);
  assert.equal(off2.success, true, off2.error);
  assert.equal(hub.patches.length, 2);
});

test('"Off" after a setting that just left: sticky, written again when the hub applies the setting late', async () => {
  const hub = createHub();
  const { set, wait, store, gladys } = await setup({
    hub,
    devices: [createdZone()],
    config: ALLOWED,
  });
  assert.equal((await set(Z(1, 'setpoint'), 23)).success, true);
  await wait(SECOND);
  const off = await set(Z(1, 'heating-mode'), 0);
  assert.equal(off.success, true, off.error);
  assert.equal(store.data.guards['1'].sticky, true, 'kept in /data');
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /"Off" is being enforced on zone\(s\) Lounge/,
  );
  const start = await set(Z(1, 'zone-mode'), 'timer');
  assert.match(start.error, /"Off" was sent to this zone just before/);
  // The hub applies the setting that left before the "Off", late.
  Object.assign(zoneOf(hub, ZONE.LOUNGE), { iMode: 16, fBoostSP: 23 });
  await wait(5 * SECOND);
  assert.equal(offs(hub, ZONE.LOUNGE), 2, 'written again at the follow-up');
  await wait(2 * MINUTE);
  assert.equal(store.data.guards['1'], undefined, 'over after two minutes');
  await wait(3 * SECOND);
  assert.equal((await set(Z(1, 'zone-mode'), 'timer')).success, true);
});

test('r1-3: a sticky guard restored from /data is enforced before its end, whatever the interval', async () => {
  const hub = createHub();
  Object.assign(zoneOf(hub, ZONE.LOUNGE), { iMode: 16, fBoostSP: 23 });
  const store = createMemoryStore({
    guards: { 1: { until: NOW + 100 * SECOND, resends: 0, sticky: true, failed: false } },
    lastAttemptAt: NOW - 10 * SECOND,
    hub: { uid: hub.state.uid },
    zones: [{ id: 1, name: 'Lounge', kind: 'radiator', hasPir: true }],
  });
  const { wait } = await setup({
    hub,
    store,
    devices: [createdZone()],
    config: { ...CONFIG, poll_interval: 600 },
  });
  assert.equal(reads(hub, '/v3/zones').length, 0, 'the periodic read is not due');
  await wait(5 * SECOND);
  assert.equal(reads(hub, '/v3/zones').length, 1, 'a guard read');
  assert.equal(offs(hub, ZONE.LOUNGE), 1, '"Off" written again');
});

test('r1-3: a save of the configuration keeps the follow-ups of a guard', async () => {
  const hub = createHub();
  const { set, wait, start } = await setup({ hub, devices: [createdZone()], config: ALLOWED });
  assert.equal((await set(Z(1, 'setpoint'), 23)).success, true);
  await wait(SECOND);
  assert.equal((await set(Z(1, 'heating-mode'), 0)).success, true);
  await wait(SECOND);
  await start({ ...ALLOWED, override_duration: 90 });
  Object.assign(zoneOf(hub, ZONE.LOUNGE), { iMode: 16, fBoostSP: 23 });
  await wait(30 * SECOND);
  assert.equal(offs(hub, ZONE.LOUNGE), 2, 'the follow-up read wrote "Off" again');
});

test('"Off" during a write of the zone still leaving: waits for its departure only, then leaves', async () => {
  const hub = createHub();
  const { gladys, wait, app } = await setup({ hub, devices: [createdZone()], config: ALLOWED });
  hub.net.hold = true;
  const device = gladys.fake.devices[0];
  const feature = (role) => device.features.find((f) => f.external_id === Z(1, role));
  const setpoint = gladys.fake.setValue(device, feature('setpoint'), 20);
  await wait(0);
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

test('a setpoint: the hub too slow before the command, nothing sent; a zone gone, nothing sent', async () => {
  let slow = false;
  const hub = createHub((path) => {
    if (slow && path === '/v3/zones') {
      hub.clock.now += 3 * SECOND;
      return 'timeout';
    }
    return undefined;
  });
  const { set, wait } = await setup({ hub, devices: [createdZone()], config: ALLOWED });
  slow = true;
  const late = await set(Z(1, 'setpoint'), 20);
  assert.match(late.error, /too slow to answer before the command: nothing sent/);
  slow = false;
  await wait(3 * SECOND);
  const all = hub.state.zones;
  hub.state.zones = all.filter((z) => z.iID !== ZONE.LOUNGE);
  assert.match((await set(Z(1, 'setpoint'), 20)).error, /does not list this zone/);
  hub.state.zones = all.map((z) => (z.iID === ZONE.LOUNGE ? { ...z, iType: 2 } : z));
  assert.match((await set(Z(1, 'setpoint'), 20)).error, /\(or not with this kind\)/);
  assert.equal(hub.patches.length, 0);
});

test('a write the hub rejects is "not applied"; a silence is "sent, without confirmation"', async () => {
  let answer;
  const hub = createHub((path, t, init) => (init.method === 'PATCH' ? answer() : undefined));
  const { set, wait } = await setup({ hub, devices: [createdZone()], config: ALLOWED });
  answer = () => json({ error: 7 });
  const rejected = await set(Z(1, 'setpoint'), 20);
  assert.match(rejected.error, /rejected the command \(rejected by the hub \(7\)\): not applied/);
  await wait(3 * SECOND);
  answer = () => new Response('', { status: 500 });
  const unsure = await set(Z(1, 'setpoint'), 20);
  assert.match(unsure.error, /Command sent, without confirmation \(error of the hub 500\)/);
  await wait(3 * SECOND);
  answer = () => 'timeout';
  const silent = await set(Z(1, 'heating-mode'), 0);
  assert.match(silent.error, /sent, without confirmation \(no answer\)/);
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
  const on = await set(Z(5, 'state'), 1);
  assert.equal(on.success, true, on.error);
  assert.deepEqual(hub.patches[0].body, { iMode: 16, fBoostSP: 1, iBoostTimeRemaining: 3600 });
});

test('a reconnection to Gladys clears neither the pause nor the refused login, and sends the status again', async () => {
  const hub = createHub(() => new Response('', { status: 503 }));
  const { gladys, hub: h } = await setup({ hub });
  const count = gladys.fake.connectionStatuses.length;
  await gladys.disconnect();
  await gladys.connect();
  assert.equal(reads(h, '/v3/auth/release').length, 1);
  assert.equal(gladys.fake.connectionStatuses.length, count + 1, 'the status is sent again');
  assert.match(gladys.fake.connectionStatus.message.en, /reads paused/);
});

test('a stop writes /data and the budget of states is honoured on a big first read', async () => {
  const hub = createHub();
  const many = {};
  for (let i = 10; i < 90; i += 1) {
    many[String(i)] = node(String(i), '0x0000000200040005', 'Lounge', {
      Battery: 50,
      TEMPERATURE: 20,
      HEATING_1: 21,
    });
  }
  hub.state.devices = many;
  const created = Object.keys(many).map((addr) => ({
    ...createdHubDevice('2'),
    external_id: D(addr),
    features: createdHubDevice('2').features.map((f) => ({
      ...f,
      external_id: f.external_id.replace(':2:', `:${addr}:`),
    })),
  }));
  const { gladys, wait, app, store } = await setup({ hub, devices: created });
  assert.ok(gladys.fake.states.length <= 100, `${gladys.fake.states.length} states at first`);
  await wait(MINUTE);
  assert.equal(gladys.fake.states.length, 240, 'all sent within the budget of 300 a minute');
  await app.stop();
  assert.equal(Object.keys(store.data.devices).length, 80);
});

test('a config saved with the same login keeps the session; another address or login drops the pause', async () => {
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
  const hub = createHub();
  hub.state.zones = [
    zone({
      strName: 'x'.repeat(500),
      fPV: { a: 1 },
      lstIssues: [{ id: 5 }],
      iFlagExpectedKit: 'pir',
    }),
  ];
  const { gladys } = await setup({ hub, devices: [createdZone()] });
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.discoveredDevices[0].name.length, 60);
  assert.equal(gladys.fake.lastState(Z(1, 'temperature')), undefined);
  assert.equal(gladys.fake.lastState(Z(1, 'faults')), 'unknown');
});
