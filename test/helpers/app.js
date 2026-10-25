// -----------------------------------------------------------------------------
// The app against the SDK's fake Gladys, a scripted hub and a virtual clock.
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { GeniusHubApp } from '../../src/app.js';
import { HubClient } from '../../src/client.js';
import { buildHubDevice, buildZoneDevice, capabilitiesOf } from '../../src/devices.js';
import { registerHandlers } from '../../src/handlers.js';
import { parseDevices, parseZones } from '../../src/model.js';
import { createMemoryStore } from '../../src/store.js';
import {
  CONFIG,
  NOW,
  UID,
  ZONE,
  dataManagerPage,
  patchOk,
  releasePage,
  zonesPage,
} from '../fixtures/genius.js';
import { createFetch, timeoutError } from './fakeNet.js';
import { createFakeClock } from './fakeTimers.js';

export const SELECTOR = 'genius-hub';
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const Z = (id, role) => `ext:${SELECTOR}:zone:${id}${role ? `:${role}` : ''}`;
export const D = (addr, role) => `ext:${SELECTOR}:device:${addr}${role ? `:${role}` : ''}`;
export { CONFIG, ZONE };

const ids = (prefix) => ({
  externalIds: (type, id) => ({
    device: `${prefix}:${type}:${id}`,
    feature: (key) => `${prefix}:${type}:${id}:${key}`,
  }),
});

/** The device of a zone as the user created it (from the default fixtures). */
export function createdZone(id = ZONE.LOUNGE) {
  const zone = parseZones(zonesPage()).find((z) => z.id === id);
  return buildZoneDevice(ids(`ext:${SELECTOR}`), zone, { uid: UID });
}

/** The device of a hub device as the user created it. */
export function createdHubDevice(addr = '2') {
  const device = parseDevices(dataManagerPage()).find((d) => d.addr === addr);
  return buildHubDevice(ids(`ext:${SELECTOR}`), device, capabilitiesOf(device), { uid: UID });
}

/** The answers of a default hub, by path. */
export const defaults = {
  '/v3/auth/release': () => releasePage(),
  '/v3/zones': () => zonesPage(),
  '/v3/data_manager': () => dataManagerPage(),
};

/**
 * The hub: `world(path, t, init)` -> an answer object | 'timeout' | a Response
 * | undefined (404). A PATCH of a zone answers `patchOk()` by default and is
 * recorded in `hub.patches`.
 */
export function createHub(world) {
  const hub = { clock: { now: NOW }, patches: [] };
  hub.world =
    world ??
    ((path, t, init) => {
      if (init.method === 'PATCH') {
        hub.patches.push({ path, body: JSON.parse(init.body), at: t });
        return patchOk();
      }
      return defaults[path]?.();
    });
  hub.net = createFetch(async ({ path, init }) => {
    const answer = await hub.world(path, hub.clock.now, init);
    if (answer === 'timeout') throw timeoutError();
    if (answer instanceof Response) return answer;
    if (answer === undefined) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify(answer), {
      status: 200,
      headers: { 'content-type': 'application/json', date: new Date(hub.clock.now).toUTCString() },
    });
  });
  return hub;
}

export async function setup({
  devices: known = [],
  store,
  now = NOW,
  hub = createHub(),
  config = CONFIG,
  random,
  wall = { offset: 0 },
  connect = true,
} = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices: known });
  const { clock, timers, advance } = createFakeClock(now);
  let drift = 0;
  hub.clock = clock;
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  const logger = { lines, info: log, warn: log, error: log, debug: log };
  const kept = store ?? createMemoryStore();
  const app = new GeniusHubApp({
    gladys,
    logger,
    now: () => clock.now + wall.offset,
    // A real monotonic clock moves between two reads of it: 1 µs per call
    // here, so that a decision reading the clock twice is caught.
    monotonic: () => clock.now + (drift += 0.001),
    timers,
    store: kept,
    clientFactory: (options) => new HubClient({ ...options, fetchImpl: hub.net.fetch }),
    ...(random ? { random } : {}),
  });
  registerHandlers(gladys, app, logger);
  if (connect) {
    await gladys.connect();
    await advance(0);
    await app.idle();
  }
  const start = async (cfg = config) => {
    await app.start(cfg);
    await advance(0);
    await app.idle();
  };
  const wait = async (ms) => {
    await advance(ms);
    await app.idle();
  };
  /** A command from Gladys on a created device: the ack `{ success, error? }`. */
  const set = async (externalId, value) => {
    const device = gladys.fake.devices.find((d) =>
      d.features.some((f) => f.external_id === externalId),
    );
    const feature = device?.features.find((f) => f.external_id === externalId);
    const promise = gladys.fake.setValue(device, feature, value);
    await advance(0);
    const ack = await promise;
    await app.idle();
    return ack;
  };
  return { app, gladys, clock, store: kept, hub, start, wait, advance, set, lines };
}
