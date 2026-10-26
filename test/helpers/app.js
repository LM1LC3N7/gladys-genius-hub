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
  devices,
  patchOk,
  releasePage,
  zones,
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

/** Applies a PATCH of a zone to the state of the fake hub, as a hub would. */
export function applyPatch(list, id, body) {
  const target = list.find((z) => z.iID === id);
  if (!target) return;
  target.iMode = body.iMode;
  if (body.fBoostSP !== undefined) {
    target.fBoostSP = body.fBoostSP;
    target.fSP = body.fBoostSP;
    target.iBoostTimeRemaining = body.iBoostTimeRemaining;
  }
  if (body.iMode === 1) {
    target.bOutRequestHeat = 0;
    target.iBoostTimeRemaining = 0;
  }
}

/**
 * The hub: a state (`hub.state.zones`, `.devices`, `.uid`) served by path; a
 * PATCH is recorded in `hub.patches` and applied to the zones unless
 * `hub.apply` is false. `intercept(path, t, init)` may answer first: an
 * answer object | 'timeout' | a Response | undefined (the state answers).
 */
export function createHub(intercept) {
  const hub = {
    clock: { now: NOW },
    patches: [],
    apply: true,
    /** A hub applying its PATCHes this long (virtual ms) after its answer. */
    applyAfter: 0,
    late: [],
    state: { zones: zones(), devices: devices(), uid: UID },
  };
  hub.world = async (path, t, init) => {
    const own = intercept ? await intercept(path, t, init) : undefined;
    if (own !== undefined) return own;
    if (init.method === 'PATCH') {
      const body = JSON.parse(init.body);
      const id = Number(path.split('/').pop());
      hub.patches.push({ path, body, at: t });
      if (hub.apply && hub.applyAfter > 0) {
        hub.late.push({ due: t + hub.applyAfter, id, body });
      } else if (hub.apply) {
        applyPatch(hub.state.zones, id, body);
      }
      return patchOk();
    }
    // The PATCHes applied late, from their time on.
    for (const late of hub.late.filter((l) => l.due <= t)) {
      applyPatch(hub.state.zones, late.id, late.body);
    }
    hub.late = hub.late.filter((l) => l.due > t);
    if (path === '/v3/auth/release') return releasePage(hub.state.uid);
    if (path === '/v3/zones') return zonesPage(hub.state.zones);
    if (path === '/v3/data_manager') return dataManagerPage(hub.state.devices);
    return new Response('not found', { status: 404 });
  };
  hub.net = createFetch(async ({ path, init }) => {
    const answer = await hub.world(path, hub.clock.now, init);
    if (answer === 'timeout') throw timeoutError();
    if (answer instanceof Response) return answer;
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
  let wallDrift = 0;
  hub.clock = clock;
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  const logger = { lines, info: log, warn: log, error: log, debug: log };
  const kept = store ?? createMemoryStore();
  const app = new GeniusHubApp({
    gladys,
    logger,
    // The wall clock moves too between two reads of it (1 µs per call).
    now: () => clock.now + wall.offset + (wallDrift += 0.001),
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
