// -----------------------------------------------------------------------------
// The integration itself: a Genius Hub read through its local API v3, one
// Gladys device per zone (room, underfloor, hot water, on/off) and per device
// behind the hub (radiator valve, thermostat, plug, sensor), the commands on
// the zones, the pauses and the refused login kept in /data, the test
// button. index.js only wires the SDK handlers to it (src/handlers.js).
//
// One read = the release page (the principal page: a login refused there is
// final, and it gives the unique id of the hub), the zones, then the
// devices (a failure there only leaves the devices unread this time). The
// values of a read go to the devices of the hub whose id was discovered: a
// different hub at the address publishes nothing until a Scan adopts it.
//
// The pace is global and kept across restarts: never two reads less than an
// interval apart, whatever asks (a reconnection, a save of the form, the
// test button, the Discover tab, a device created, a restart of the
// container: the time of the last read is kept in /data). The follow-up
// reads after a command (the zones only, 5 s and 20 s after it, grouped) are
// outside the pace. Structure taken from gladys-iskra (approved).
//
// A read belongs to its session (the client of one address and login): when
// they change, a late answer of the old one publishes nothing and sets no
// status (checked after every await).
//
// Two clocks: `now` (wall clock) dates /data and the deadlines of the
// commands; `monotonic` paces the reads, the pauses, the guards and the
// freshness, so that a wall clock set back or forward never stops nor
// hurries them. Every decision reads its clock once (`dueAt(mono)`).
//
// The commands (rules learnt on the previous modules):
//   - non-protective ones (a setpoint, a mode, "on"): refused unless their
//     option allows it; decided on a fresh read of the hub (its unique id and
//     the zones, outside the queue of the periodic reads, shared by the
//     commands arriving before it leaves); refused when the zone is missing
//     or of another kind, when another hub answers, during a pause, after a
//     refused login or while an "off" guard holds the zone; every setpoint
//     written is within the bounds of the integration (the one asked, and
//     the one an override or a boost takes from the hub); options and
//     ceilings checked on arrival, after the fresh read and right before the
//     request leaves (beforeSend); sent within 3.5 s of the click or refused
//     unsent; one at a time per zone, two seconds apart; never retried; a
//     success only when the zone read back shows the mode and setpoint
//     written (a value beyond the bounds turns the zone off at once);
//   - "Off" (the thermostat mode, the Genius mode, the hot water mode, the
//     on/off zone): no option; it waits for no read, only for the
//     configuration when it is not read yet and for the departure of a write
//     of the zone already leaving (never its answer), within its budget; it
//     cancels a command of the zone not sent yet; it goes through a pause
//     and past a refused login (one try); a success only when the zone read
//     back is off. Every "off" that may have reached the hub sets a guard of
//     two minutes, kept in /data: the reads (follow-ups every 20 s while it
//     lasts, after a restart too) write "Off" again while the zone shows on
//     (3 times at most) and the status says so; a plain guard is lifted by a
//     read showing the zone off, a sticky one (a setting of the zone left
//     within two minutes before) by the time only;
//   - a write that may have reached the hub (silence, a dropped connection,
//     a 5xx) is never answered "nothing sent": "sent, without confirmation";
//     the ack never waits for a publication.
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { isComplete, normalizeConfig, numberOf } from './config.js';
import {
  ATTEMPT_SAVE_EVERY,
  COMMAND,
  CONFIG_RETRY,
  DEVICE_STALE_AFTER,
  GLADYS,
  HOT_WATER_SETPOINT,
  MAX_ZONES,
  MODE_NAMES,
  MODE_VALUES,
  OFFERED_KINDS,
  ON_OFF_SETPOINT,
  PAGE_RETRY_MAX,
  PAUSE_MAX,
  PAUSE_MIN,
  RETRY_MAX,
  RETRY_MIN,
  ROOM_SETPOINT,
  SECOND,
  STOP_WAIT,
  TEST_ANSWER_WITHIN,
  ZONE_KIND,
  ZONE_MODE,
} from './constants.js';
import {
  COMMAND_ROLES,
  ROLES,
  SELECT_MODES,
  buildHubDevice,
  buildZoneDevice,
  capabilitiesOf,
  capabilitiesOfDevice,
  deviceIds,
  hubDeviceStates,
  parseExternalId,
  union,
  validRoles,
  zoneIds,
  zoneStates,
} from './devices.js';
import { HubClient, HubError } from './client.js';
import { DEVICE_ADDR, nameOf } from './model.js';
import { Refusal, T } from './i18n.js';
import { StatePublisher } from './publisher.js';
import { createFileStore } from './store.js';

const defaultTimers = { setTimeout, clearTimeout };
const { THERMOSTAT_MODE, WATER_HEATER_MODE } = GLADYS;

/** At most this many devices kept in /data. */
const MAX_KEPT_DEVICES = 256;
const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/**
 * The tag of a refused password: 8 bits of a salted hash, never more (a
 * short password must not be found back from /data by brute force).
 */
export const tagOf = (salt, password) =>
  createHash('sha256').update(`${salt}\u0000${password}`, 'utf8').digest()[0];

/** A pause read back from /data: `{ until, count, code, status }`; in memory it ends at a monotonic `due`. */
function validPause(pause, now, mono) {
  if (
    !pause ||
    !finite(pause.until) ||
    !Number.isInteger(pause.count) ||
    pause.count < 1 ||
    (pause.code !== 'rate_limited' && pause.code !== 'server')
  ) {
    return undefined;
  }
  const left = Math.min(Math.max(0, pause.until - now), PAUSE_MAX);
  return {
    until: now + left,
    due: mono + left,
    count: Math.min(pause.count, 32),
    code: pause.code,
    status: Number.isInteger(pause.status) ? pause.status : null,
  };
}

/** The refused login read back from /data: `{ address, username, salt, tag }`. */
function validRefused(refused) {
  return refused &&
    typeof refused.address === 'string' &&
    typeof refused.username === 'string' &&
    typeof refused.salt === 'string' &&
    /^[0-9a-f]{32}$/.test(refused.salt) &&
    Number.isInteger(refused.tag) &&
    refused.tag >= 0 &&
    refused.tag < 256
    ? { address: refused.address, username: refused.username, salt: refused.salt, tag: refused.tag }
    : undefined;
}

/** The hub read back from /data: `{ uid, release }`. */
function validHub(hub) {
  return hub && typeof hub.uid === 'string' && /^[A-Za-z0-9:_-]{1,64}$/.test(hub.uid)
    ? {
        uid: hub.uid,
        release: typeof hub.release === 'string' ? hub.release.slice(0, 32) : undefined,
      }
    : undefined;
}

/** The zones kept in /data (offered before the first read): `[{ id, name, kind, hasPir }]`. */
function validZones(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(
      (z) =>
        z &&
        Number.isInteger(z.id) &&
        z.id >= 0 &&
        OFFERED_KINDS.has(z.kind) &&
        typeof z.name === 'string',
    )
    .slice(0, MAX_ZONES)
    .map((z) => ({
      id: z.id,
      name: nameOf(z.name) || `Zone ${z.id}`,
      kind: z.kind,
      hasPir: z.hasPir === true,
    }));
}

/** Plain objects under string keys only (no prototype key). */
function plainEntries(object) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) {
    return [];
  }
  return Object.entries(object).filter(
    ([key, value]) =>
      key !== '__proto__' && value && typeof value === 'object' && !Array.isArray(value),
  );
}

/** The devices kept in /data: addr -> `{ model, sku, zoneName, roles, lastComms }`. */
function validDevices(devices) {
  const kept = new Map();
  for (const [addr, value] of plainEntries(devices)) {
    if (!DEVICE_ADDR.test(addr)) continue;
    kept.set(addr, {
      addr,
      model: typeof value.model === 'string' ? value.model.slice(0, 40) : undefined,
      sku: typeof value.sku === 'string' ? value.sku.slice(0, 16) : undefined,
      zoneName: nameOf(value.zoneName),
      roles: validRoles(value.roles),
      /** The last communication published (Unix seconds): nothing older is sent again. */
      lastComms:
        Number.isInteger(value.lastComms) && value.lastComms > 0 ? value.lastComms : undefined,
    });
  }
  return new Map([...kept].slice(-MAX_KEPT_DEVICES));
}

/**
 * The "off" guards kept in /data: zone id -> `{ until (wall), resends,
 * sticky, failed }`. A guard follows every "off" for 2 minutes at most: the
 * reads write "off" again while they show the zone on (3 times at most); a
 * plain guard is lifted by a read showing the zone off, a sticky one (an
 * "off" after a setting that had just left) by the time only.
 */
function validGuards(guards, now, mono) {
  const kept = new Map();
  for (const [key, value] of plainEntries(guards)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id < 0 || !finite(value.until) || value.until <= now) continue;
    const left = Math.min(value.until - now, COMMAND.guard);
    kept.set(id, {
      until: now + left,
      due: mono + left,
      resends:
        Number.isInteger(value.resends) && value.resends >= 0
          ? Math.min(value.resends, COMMAND.resends)
          : 0,
      sticky: value.sticky === true,
      failed: value.failed === true,
      outOfBounds:
        value.outOfBounds && typeof value.outOfBounds === 'object' && finite(value.outOfBounds.left)
          ? {
              setpoint: finite(value.outOfBounds.setpoint) ? value.outOfBounds.setpoint : undefined,
              left: value.outOfBounds.left,
            }
          : undefined,
    });
  }
  return kept;
}

/** The thermostat mode, the Genius mode, the hot water mode or the on/off state asked: is it "off"? */
function isOff(role, value) {
  if (role === ROLES.HEATING_MODE) return value === THERMOSTAT_MODE.OFF;
  if (role === ROLES.WATER_MODE) return value === WATER_HEATER_MODE.OFF;
  if (role === ROLES.ZONE_MODE) return value === 'off';
  if (role === ROLES.STATE) return value === 0;
  return false;
}

export class GeniusHubApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'genius-hub' }),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    clientFactory = (options) => new HubClient(options),
    store = createFileStore(),
    random = () => randomBytes(16).toString('hex'),
    defer = (fn) => setImmediate(fn),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.clientFactory = clientFactory;
    this.random = random;
    /** Runs `fn` once the commands that arrived meanwhile are in (the shared fresh read). */
    this.defer = defer;
    this.store = store;
    this.savedKey = undefined;
    this.config = normalizeConfig();
    /** `{ client, discovered }` of the current address and login; replaced when they change. */
    this.session = undefined;
    this.running = false;
    this.timer = undefined;
    this.busy = undefined;
    this.loopRun = Promise.resolve();
    this.lifecycle = Promise.resolve();
    this.lastStatus = undefined;
    this.publisher = new StatePublisher({ gladys, logger, monotonic, timers });
    /** zone id -> the non-protective command in flight (one at a time per zone). */
    this.inFlight = new Map();
    /** zone id -> no new non-protective command before this monotonic time. */
    this.quietUntil = new Map();
    /** zone id -> monotonic time the last write of the zone left (any kind). */
    this.lastWriteAt = new Map();
    /** zone id -> the departure of the write leaving now (resolved by beforeSend or the end). */
    this.departures = new Map();
    /** zone id -> bumped by every "off": a non-protective command of an older epoch is cancelled. */
    this.stopEpoch = new Map();
    /** The follow-up reads: `{ timer, due: [monotonic...] }`. */
    this.follow = { timer: undefined, due: [] };
    /** The fresh read of the commands: `{ session, departed, settled, readBy, promise }`. */
    this.fresh = undefined;
    /** zone id -> a command not confirmed yet: `{ command, body, before, due (monotonic) }`. */
    this.checks = new Map();
    /** zone id -> a note of the status about a command: `{ text(name), due (monotonic) }`. */
    this.notes = new Map();
    /** The configuration read from Gladys at least once: until then, "Off" waits for it. */
    this.loaded = false;
    this.ready = new Promise((resolve) => {
      this.markReady = resolve;
    });
    /** Reading the configuration from Gladys failed: `{ timer, failures }`. */
    this.configRetry = { timer: undefined, failures: 0 };

    const kept = store.load();
    const at = now();
    const mono = monotonic();
    this.pause = validPause(kept.pause, at, mono);
    /** The login the hub refused: no read until it changes or the test button succeeds. */
    this.refused = validRefused(kept.refused);
    /** The hub whose devices Gladys holds (its unique id). */
    this.hub = validHub(kept.hub);
    /** The zones and devices seen, kept so that they are offered at a restart. */
    this.zones = validZones(kept.zones);
    this.devices = validDevices(kept.devices);
    this.guards = validGuards(kept.guards, at, mono);
    this.lastAttemptAt = finite(kept.lastAttemptAt) ? Math.min(kept.lastAttemptAt, at) : undefined;
    this.savedAttemptAt = this.lastAttemptAt;
    /** Monotonic time of the last read started. */
    this.lastReadAt =
      this.lastAttemptAt === undefined ? undefined : mono - (at - this.lastAttemptAt);
    this.resetReads();
  }

  /** What belongs to one address and login: forgotten when they change. */
  resetReads() {
    /** The last read: `{ at (monotonic), kind: 'reading' | 'error', ... }`. */
    this.outcome = undefined;
    this.failures = 0;
    this.nextTryAt = undefined;
    this.lastError = undefined;
    /** The zones and devices of the last read (this session). */
    this.current = undefined;
    /** The unique id of another hub answering at the address, when it is not the one kept. */
    this.otherHub = undefined;
    /** The devices page refused to the login: `{ failures, until (monotonic), err }`. */
    this.devicesSkip = { failures: 0, until: undefined, err: undefined };
  }

  // --- Lifecycle -------------------------------------------------------------

  start(raw = {}) {
    return this.serialize(() => this.doStart(raw));
  }

  /**
   * A connection to Gladys: the configuration read, then a start. A read of
   * the configuration that fails is tried again (5 s, doubled up to 5 min),
   * never left dead; the status says so.
   */
  async connected(loadConfig) {
    this.clearConfigRetry();
    let config;
    try {
      config = await loadConfig();
    } catch (err) {
      this.configRetry.failures += 1;
      const wait = Math.min(
        CONFIG_RETRY.min * 2 ** (this.configRetry.failures - 1),
        CONFIG_RETRY.max,
      );
      this.logger.warn(`genius-hub: reading the configuration failed (${err?.name ?? 'Error'})`);
      await this.setStatus(false, T.configRetry(wait));
      this.configRetry.timer = this.timers.setTimeout(() => {
        this.configRetry.timer = undefined;
        return this.connected(loadConfig);
      }, wait);
      return;
    }
    this.configRetry.failures = 0;
    await this.start(config);
  }

  clearConfigRetry() {
    if (this.configRetry.timer !== undefined) {
      this.timers.clearTimeout(this.configRetry.timer);
      this.configRetry.timer = undefined;
    }
  }

  stop() {
    this.clearConfigRetry();
    return this.serialize(async () => {
      this.doStop();
      await this.saveState();
      if (this.busy) {
        let timer;
        await Promise.race([
          this.busy.catch(() => {}),
          new Promise((resolve) => {
            timer = this.timers.setTimeout(resolve, STOP_WAIT);
          }),
        ]);
        this.timers.clearTimeout(timer);
      }
      await this.saveState();
    });
  }

  /** Resolves once every queued start/stop, the read running and the publisher are done (tests). */
  async idle() {
    await this.lifecycle;
    await this.loopRun;
    await this.busy;
    await this.publisher.flushing;
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  static sessionKey(config) {
    return JSON.stringify([
      config.address,
      config.invalidAddress,
      config.login?.username ?? null,
      config.login?.password ?? null,
      config.invalidLogin,
    ]);
  }

  async doStart(raw) {
    this.doStop();
    const config = normalizeConfig(raw);
    const first = this.session === undefined;
    const changed =
      first || GeniusHubApp.sessionKey(config) !== GeniusHubApp.sessionKey(this.config);
    this.config = config;
    if (changed) {
      this.session = {
        client: isComplete(config)
          ? this.clientFactory({ address: config.address, login: config.login, now: this.now })
          : undefined,
        discovered: false,
      };
      if (!first) {
        this.resetReads();
      }
      if (!first && this.pause) {
        // Another address or login: a pause asked for the old one ends (a 503
        // of the hub may mean a wrong login); the pace does not.
        this.pause = undefined;
        await this.saveState();
      }
    }
    if (this.refused && !this.refusedApplies()) {
      this.refused = undefined;
      await this.saveState();
    }
    this.running = true;
    this.loaded = true;
    this.markReady();
    // The core keeps the connection status, the Discovery list and the last
    // values in memory: a restarted Gladys has lost them, so they are always
    // sent again (the values at the next read).
    this.lastStatus = undefined;
    this.gladys.forgetPublishedStates?.();
    if (!this.session.client) {
      await this.updateStatus();
      return;
    }
    await this.discover();
    await this.updateStatus();
    this.schedule();
    // The follow-ups left by a stop (a save of the form) and the guards kept
    // in /data go on (their reads are outside the pace).
    this.guardFollowUps(COMMAND.followUps[0]);
    this.scheduleFollowUp(this.session);
  }

  doStop() {
    this.running = false;
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.follow.timer !== undefined) {
      this.timers.clearTimeout(this.follow.timer);
      this.follow.timer = undefined;
    }
    this.publisher.stopTimer();
  }

  refusedApplies() {
    const r = this.refused;
    const config = this.config;
    return Boolean(
      r &&
      r.address === config.address &&
      r.username === (config.login?.username ?? '') &&
      r.tag === tagOf(r.salt, config.login?.password ?? ''),
    );
  }

  // --- Pace ------------------------------------------------------------------

  interval() {
    return this.config.pollInterval * SECOND;
  }

  pauseLeft(mono) {
    if (!this.pause) {
      return 0;
    }
    return Math.min(Math.max(0, this.pause.due - mono), PAUSE_MAX);
  }

  /** The monotonic time from which the next read may start, from the caller's instant `mono`. */
  dueAt(mono) {
    let due = this.lastReadAt === undefined ? mono : this.lastReadAt + this.interval();
    if (this.nextTryAt !== undefined) {
      due = Math.max(due, this.nextTryAt);
    }
    return Math.max(due, mono + this.pauseLeft(mono));
  }

  /** One timer: the next read when it is due; none while the login is refused. */
  schedule() {
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (!this.running || !this.session?.client || this.refusedApplies()) {
      return;
    }
    const mono = this.monotonic();
    const wait = Math.max(0, this.dueAt(mono) - mono);
    this.timer = this.timers.setTimeout(() => {
      this.timer = undefined;
      this.loopRun = this.loop();
      return this.loopRun;
    }, wait);
  }

  async loop() {
    const session = this.session;
    try {
      await this.tick();
    } catch (err) {
      this.logger.error(`genius-hub: unexpected error (${err?.name ?? 'Error'})`);
    }
    if (session === this.session && this.running) {
      this.schedule();
    }
  }

  /** One read when it is due; a read running is never doubled. */
  tick({ evenRefused = false } = {}) {
    if (this.busy) {
      return this.busy;
    }
    this.busy = this.read({ evenRefused }).finally(() => {
      this.busy = undefined;
    });
    return this.busy;
  }

  async read({ evenRefused }) {
    const session = this.session;
    const client = session?.client;
    if (!client || !this.running) {
      return;
    }
    if (!evenRefused && this.refusedApplies()) {
      return;
    }
    const mono = this.monotonic();
    if (mono < this.dueAt(mono)) {
      return;
    }
    const gone = () => session !== this.session || !this.running;
    this.lastReadAt = mono;
    // Kept BEFORE the request: a restart during it never reads again sooner.
    await this.saveAttempt(this.now());
    if (gone()) return;
    let result;
    try {
      result = await this.readAll(client, gone, mono);
    } catch (err) {
      if (gone()) return;
      await this.failed(err, mono, gone);
      return;
    }
    if (gone() || !result) return;
    await this.succeeded(result, mono, gone);
  }

  /** The release (principal page), the zones, then the devices (optional). */
  async readAll(client, gone, mono) {
    const release = await client.release();
    if (gone()) return undefined;
    const zones = await client.zones();
    if (gone()) return undefined;
    let devices;
    let devicesError;
    const skip = this.devicesSkip;
    if (skip.until !== undefined && mono < skip.until) {
      // The devices page was refused to this login: tried again later.
      devicesError = skip.err;
    } else {
      try {
        devices = await client.devices();
        this.devicesSkip = { failures: 0, until: undefined, err: undefined };
      } catch (err) {
        if (gone()) return undefined;
        if (!(err instanceof HubError) || err.code === 'rate_limited') {
          throw err;
        }
        devicesError = err;
        if (err.code === 'page_refused') {
          const failures = skip.failures + 1;
          const wait = Math.min(this.interval() * 2 ** failures, PAGE_RETRY_MAX);
          this.devicesSkip = { failures, until: this.monotonic() + wait, err };
        }
      }
    }
    return {
      hub: release.value,
      zones: zones.value,
      at: zones.at ?? devices?.at,
      devices: devices?.value,
      devicesError,
    };
  }

  async saveAttempt(now) {
    this.lastAttemptAt = now;
    if (
      this.savedAttemptAt === undefined ||
      now < this.savedAttemptAt ||
      now - this.savedAttemptAt >= ATTEMPT_SAVE_EVERY
    ) {
      this.savedAttemptAt = now;
      await this.saveState();
    }
  }

  // --- Outcomes ----------------------------------------------------------------

  async succeeded(result, mono, gone) {
    this.pause = undefined;
    this.failures = 0;
    this.nextTryAt = undefined;
    this.lastError = undefined;
    if (this.refused) {
      this.refused = undefined;
      this.logger.info('genius-hub: the hub accepts the login again');
    }
    if (!this.hub) {
      // The first hub seen: its devices are the ones Gladys will hold.
      this.hub = { uid: result.hub.uid, release: result.hub.release };
    } else if (this.hub.uid !== result.hub.uid) {
      if (this.otherHub !== result.hub.uid) {
        this.logger.warn('genius-hub: another hub answers at this address');
      }
      this.otherHub = result.hub.uid;
    } else {
      this.otherHub = undefined;
      this.hub.release = result.hub.release ?? this.hub.release;
    }
    const offered = result.zones.filter((z) => OFFERED_KINDS.has(z.kind));
    this.outcome = {
      at: mono,
      kind: 'reading',
      hub: result.hub,
      zones: result.zones,
      offered,
      devices: result.devices,
      devicesError: result.devicesError,
      stale: 0,
    };
    if (this.otherHub) {
      // Nothing of another hub goes to the devices of the kept one.
      await this.updateStatus();
      return;
    }
    const current = { zones: offered, devices: result.devices };
    let grew = !this.session.discovered || !this.current;
    if (!grew) {
      grew =
        this.current.zones.length !== offered.length ||
        this.current.zones.some(
          (z, i) =>
            z.id !== offered[i].id || z.kind !== offered[i].kind || z.name !== offered[i].name,
        );
    }
    this.zones = offered.map((z) => ({ id: z.id, name: z.name, kind: z.kind, hasPir: z.hasPir }));
    if (result.devices) {
      for (const device of result.devices) {
        const known = this.devices.get(device.addr);
        const roles = union(
          known?.roles ?? new Set(),
          capabilitiesOfDevice(this.createdDevice(deviceIds(this.gladys, device.addr).device)),
          capabilitiesOf(device),
        );
        if (!known || roles.size !== known.roles.size || known.zoneName !== device.zoneName) {
          grew = true;
        }
        this.devices.delete(device.addr);
        this.devices.set(device.addr, {
          addr: device.addr,
          model: device.model,
          sku: device.sku,
          zoneName: device.zoneName,
          roles,
          lastComms: known?.lastComms,
        });
      }
      while (this.devices.size > MAX_KEPT_DEVICES) {
        this.devices.delete(this.devices.keys().next().value);
      }
    }
    this.current = current;
    if (grew) {
      this.session.discovered = true;
      await this.discover();
      if (gone()) return;
    }
    this.publishZones(result.zones, { force: false });
    if (result.devices) {
      this.publishDevices(result.devices, result.at ?? this.now());
    }
    await this.evaluateChecks(result.zones, this.monotonic(), this.session);
    if (gone()) return;
    await this.enforceGuards(result.zones, mono, gone);
    if (gone()) return;
    await this.saveState();
    if (gone()) return;
    await this.updateStatus();
    void this.publisher.flush();
  }

  async failed(err, mono, gone) {
    const code = err?.code ?? 'error';
    const now = this.now();
    const at = this.monotonic();
    this.logger.warn(
      `genius-hub read failed: ${code}${Number.isInteger(err?.status) ? ` ${err.status}` : ''}`,
    );
    this.outcome = { at: mono, kind: 'error', err };
    if (code === 'refused') {
      if (!this.refusedApplies()) {
        const salt = this.random();
        this.refused = {
          address: this.config.address,
          username: this.config.login?.username ?? '',
          salt,
          tag: tagOf(salt, this.config.login?.password ?? ''),
        };
      }
      this.failures = 0;
      this.nextTryAt = undefined;
      this.lastError = undefined;
      await this.saveState();
      if (gone()) return;
      await this.updateStatus();
      return;
    }
    if (code === 'rate_limited' || code === 'server') {
      const count = (this.pause?.count ?? 0) + 1;
      const asked = finite(err.retryAfter) ? err.retryAfter : PAUSE_MIN * 2 ** (count - 1);
      const wait = Math.min(Math.max(asked, PAUSE_MIN), PAUSE_MAX);
      this.pause = {
        until: now + wait,
        due: at + wait,
        count: Math.min(count, 32),
        code,
        status: Number.isInteger(err.status) ? err.status : null,
      };
      await this.saveState();
      if (gone()) return;
      await this.updateStatus();
      return;
    }
    // A page refused to the login (the release accepted it): spaced up to 1 h.
    const max = code === 'page_refused' ? PAGE_RETRY_MAX : RETRY_MAX;
    const wait = Math.min(RETRY_MIN * 2 ** this.failures, max);
    this.failures += 1;
    this.lastError = err;
    this.nextTryAt = at + wait;
    await this.saveState();
    if (gone()) return;
    await this.updateStatus();
  }

  // --- Status ------------------------------------------------------------------

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed (${err?.name ?? 'Error'})`));
  }

  async updateStatus() {
    const [connected, message] = this.currentStatus();
    await this.setStatus(connected, message);
  }

  /** The notes of the "off" guards: the ones enforced, the ones the hub did not apply. */
  guardNotes() {
    const mono = this.monotonic();
    const name = (id) => this.zones.find((z) => z.id === id)?.name ?? `Zone ${id}`;
    const sticky = [];
    const failed = [];
    const notes = [];
    for (const [id, guard] of this.guards) {
      if (mono >= guard.due) continue;
      if (guard.failed) failed.push(name(id));
      else if (guard.outOfBounds) notes.push(T.notes.outOfBounds(name(id), guard.outOfBounds));
      else if (guard.sticky) sticky.push(name(id));
    }
    if (failed.length > 0) notes.push(T.notes.offFailed(failed, COMMAND.resends));
    if (sticky.length > 0) notes.push(T.notes.sticky(sticky));
    for (const [id, note] of [...this.notes]) {
      if (mono >= note.due) {
        this.notes.delete(id);
        continue;
      }
      notes.push(note.text(name(id)));
    }
    return notes;
  }

  /** The status from what is known now: never a read. */
  currentStatus() {
    const address = this.config.address;
    if (!this.session?.client) {
      if (this.config.invalidAddress) return [false, T.badAddress];
      if (this.config.invalidLogin) return [false, T.badLogin];
      return [false, T.incomplete];
    }
    const notes = this.guardNotes();
    if (this.refusedApplies()) {
      return [false, T.refused(address, notes)];
    }
    const left = this.pauseLeft(this.monotonic());
    if (left > 0) {
      return [false, T.paused(address, this.pause, left, notes)];
    }
    if (this.lastError && this.failures > 0) {
      const mono = this.monotonic();
      const wait = Math.max(0, this.dueAt(mono) - mono);
      return [false, T.unreachable(address, this.lastError, wait, notes)];
    }
    if (this.outcome?.kind === 'reading') {
      const o = this.outcome;
      if (this.otherHub) {
        return [false, T.otherHub(address, this.otherHub, notes)];
      }
      const extra = [];
      if (o.devicesError) extra.push(T.notes.devicesUnread(o.devicesError));
      if (o.stale > 0) extra.push(T.notes.stale(o.stale, DEVICE_STALE_AFTER));
      const missing = o.offered
        .filter((z) => !this.createdDevice(zoneIds(this.gladys, z.id).device))
        .map((z) => z.name);
      if (missing.length > 0) extra.unshift(T.notes.noDevice(missing));
      return [
        true,
        T.ok(address, this.hub, o.offered.length, o.devices?.length ?? 0, [...extra, ...notes]),
      ];
    }
    return [false, T.waiting(address, notes)];
  }

  // --- /data -------------------------------------------------------------------------

  async saveState() {
    const devices = {};
    for (const [addr, d] of this.devices) {
      devices[addr] = {
        model: d.model ?? null,
        sku: d.sku ?? null,
        zoneName: d.zoneName ?? '',
        roles: [...d.roles],
        lastComms: d.lastComms ?? null,
      };
    }
    const guards = {};
    for (const [id, g] of this.guards) {
      guards[id] = {
        until: g.until,
        resends: g.resends,
        sticky: g.sticky,
        failed: g.failed,
        outOfBounds: g.outOfBounds ?? null,
      };
    }
    const p = this.pause;
    const state = {
      hub: this.hub ?? null,
      zones: this.zones,
      devices,
      guards,
      pause: p ? { until: p.until, count: p.count, code: p.code, status: p.status } : null,
      refused: this.refused ?? null,
      lastAttemptAt: this.lastAttemptAt ?? null,
    };
    const key = JSON.stringify(state);
    if (key === this.savedKey) {
      return;
    }
    try {
      await this.store.save(state);
      this.savedKey = key;
    } catch (err) {
      this.logger.warn(`Saving the genius-hub state in /data failed (${err?.code ?? 'error'})`);
    }
  }

  // --- Devices -----------------------------------------------------------------------

  /** The created Gladys device with this external id, undefined until the user creates it. */
  createdDevice(externalId) {
    return (this.gladys.devices ?? []).find((d) => d.external_id === externalId);
  }

  async discover() {
    if (!this.session?.client) {
      return;
    }
    const devices = [];
    for (const zone of this.zones) {
      const device = buildZoneDevice(this.gladys, zone, this.hub);
      if (device) devices.push(device);
    }
    for (const device of this.devices.values()) {
      const roles = union(
        device.roles,
        capabilitiesOfDevice(this.createdDevice(deviceIds(this.gladys, device.addr).device)),
      );
      const built = buildHubDevice(this.gladys, device, roles, this.hub);
      if (built) devices.push(built);
    }
    await this.gladys
      .publishDiscoveredDevices(devices)
      .catch((err) => this.logger.warn(`Publishing the Genius Hub devices failed (${err?.name})`));
  }

  /**
   * The Discover tab asks: the known zones and devices, never a read. When
   * another hub answered at the address, this Scan adopts it: its zones and
   * devices take the place of the former ones.
   */
  async scan() {
    if (this.otherHub && this.outcome?.kind === 'reading') {
      const o = this.outcome;
      this.hub = { uid: this.otherHub, release: o.hub.release };
      this.otherHub = undefined;
      this.zones = o.offered.map((z) => ({
        id: z.id,
        name: z.name,
        kind: z.kind,
        hasPir: z.hasPir,
      }));
      this.devices = new Map();
      for (const device of o.devices ?? []) {
        this.devices.set(device.addr, {
          addr: device.addr,
          model: device.model,
          sku: device.sku,
          zoneName: device.zoneName,
          roles: capabilitiesOf(device),
          lastComms: undefined,
        });
      }
      this.guards.clear();
      this.current = { zones: o.offered, devices: o.devices };
      this.gladys.forgetPublishedStates?.();
      this.logger.info('genius-hub: the hub at this address is adopted');
      await this.saveState();
      await this.updateStatus();
    }
    await this.discover();
  }

  async onDeviceCreated(device) {
    const parsed = parseExternalId(device?.external_id);
    if (!parsed || parsed.role !== undefined) {
      return;
    }
    if (parsed.kind === 'device') {
      // Its values at the next read, whatever was published before.
      const kept = this.devices.get(parsed.id);
      if (kept) kept.lastComms = undefined;
    }
    await this.updateStatus();
  }

  async onDeviceUpdated(device) {
    await this.onDeviceCreated(device);
  }

  // --- Values ------------------------------------------------------------------------

  /** The states of the zones read, to the created devices only. */
  publishZones(zones, { force }) {
    if (this.otherHub) return;
    const states = [];
    for (const zone of zones) {
      if (!OFFERED_KINDS.has(zone.kind)) continue;
      const created = this.createdDevice(zoneIds(this.gladys, zone.id).device);
      if (!created) continue;
      const own = zoneStates(this.gladys, zone);
      const features = created.features
        ? new Set(created.features.map((f) => f.external_id))
        : null;
      states.push(
        ...(features ? own.filter((s) => features.has(s.device_feature_external_id)) : own),
      );
    }
    if (states.length > 0) {
      this.publisher.push(states, { force });
    }
  }

  /**
   * The states of the devices read: only when the device talked to the hub
   * since the values last published (`lastComms`, kept in /data; a channel
   * takes its node's), and not when that was more than DEVICE_STALE_AFTER
   * before the hub's clock. A device without any time of last communication
   * is sent on change only, never again as a heartbeat.
   */
  publishDevices(devices, hubTime) {
    const states = [];
    /** Values of a device that gives no time of last communication: on change only, no heartbeat. */
    const undated = [];
    let stale = 0;
    for (const device of devices) {
      const created = this.createdDevice(deviceIds(this.gladys, device.addr).device);
      if (!created) continue;
      const kept = this.devices.get(device.addr);
      if (device.lastComms !== undefined) {
        if (hubTime - device.lastComms * 1000 > DEVICE_STALE_AFTER) {
          stale += 1;
          continue;
        }
        if (kept?.lastComms !== undefined && device.lastComms <= kept.lastComms) {
          continue;
        }
      }
      const own = hubDeviceStates(this.gladys, device);
      const features = created.features
        ? new Set(created.features.map((f) => f.external_id))
        : null;
      const sent = features ? own.filter((s) => features.has(s.device_feature_external_id)) : own;
      if (sent.length > 0) {
        (device.lastComms === undefined ? undated : states).push(...sent);
        if (kept && device.lastComms !== undefined) kept.lastComms = device.lastComms;
      }
    }
    if (this.outcome) this.outcome.stale = stale;
    if (states.length > 0) {
      this.publisher.push(states);
    }
    if (undated.length > 0) {
      this.publisher.push(undated, { heartbeat: false });
    }
  }

  // --- Commands ------------------------------------------------------------------------

  refusal(text) {
    return new Refusal(text);
  }

  /** The kept zone of an id (its kind and PIR), or undefined. */
  keptZone(id) {
    return this.zones.find((z) => z.id === id);
  }

  /** The command asked: `{ zoneId, role, kind, value, off }`, or a refusal. */
  parseCommand(device, feature, value) {
    const target = parseExternalId(feature?.external_id);
    if (!target || target.kind !== 'zone' || target.role === undefined) {
      throw this.refusal(T.command.readOnly);
    }
    // The kind of the zone: as last read, else as the device was created
    // (its `zone_kind` param): "Off" is never refused for want of a read.
    const param = (device?.params ?? []).find((p) => p?.name === 'zone_kind')?.value;
    const zone =
      this.keptZone(target.id) ?? (OFFERED_KINDS.has(param) ? { kind: param } : undefined);
    if (!zone) {
      throw this.refusal(T.command.unknownZone);
    }
    if (!(COMMAND_ROLES[zone.kind] ?? []).includes(target.role)) {
      throw this.refusal(T.command.readOnly);
    }
    let wanted;
    if (target.role === ROLES.ZONE_MODE) {
      if (typeof value !== 'string' || !SELECT_MODES[zone.kind].includes(value)) {
        throw this.refusal(T.command.badValue);
      }
      wanted = value;
    } else {
      const number = numberOf(value);
      if (number === undefined) {
        throw this.refusal(T.command.badValue);
      }
      wanted = number;
      if (
        target.role === ROLES.HEATING_MODE &&
        ![THERMOSTAT_MODE.OFF, THERMOSTAT_MODE.HEATING].includes(number)
      ) {
        throw this.refusal(T.command.badValue);
      }
      if (
        target.role === ROLES.WATER_MODE &&
        ![WATER_HEATER_MODE.OFF, WATER_HEATER_MODE.PROGRAM, WATER_HEATER_MODE.BOOST].includes(
          number,
        )
      ) {
        throw this.refusal(T.command.badValue);
      }
      if (target.role === ROLES.STATE && number !== 0 && number !== 1) {
        throw this.refusal(T.command.badValue);
      }
      if (target.role === ROLES.SETPOINT) {
        wanted = this.checkSetpoint(zone.kind, number);
      }
    }
    return {
      zoneId: target.id,
      role: target.role,
      kind: zone.kind,
      value: wanted,
      off: isOff(target.role, wanted),
    };
  }

  /** The bounds of a setpoint: the maker's, capped by the configuration. */
  bounds(kind) {
    return kind === ZONE_KIND.HOT_WATER
      ? {
          low: HOT_WATER_SETPOINT.min,
          high: Math.min(HOT_WATER_SETPOINT.max, this.config.maxHotWater),
        }
      : { low: ROOM_SETPOINT.min, high: Math.min(ROOM_SETPOINT.max, this.config.maxSetpoint) };
  }

  checkSetpoint(kind, number) {
    const rounded = kind === ZONE_KIND.HOT_WATER ? Math.round(number) : Math.round(number * 2) / 2;
    if (Math.abs(rounded - number) > 1e-6) {
      throw this.refusal(T.command.badValue);
    }
    const { low, high } = this.bounds(kind);
    if (rounded < low || rounded > high) {
      throw this.refusal(T.command.outOfRange(low, high));
    }
    return rounded;
  }

  async setValue(device, feature, value) {
    // The deadlines count from the arrival of the command, before any wait.
    const received = this.now();
    const command = this.parseCommand(device, feature, value);
    if (command.off) {
      return this.protect(command, received);
    }
    this.checkOption(command);
    const { zoneId } = command;
    const mono = this.monotonic();
    if (this.guardActive(zoneId, mono)) {
      throw this.refusal(T.command.stopped);
    }
    if (this.inFlight.has(zoneId) || mono < (this.quietUntil.get(zoneId) ?? -Infinity)) {
      throw this.refusal(T.command.stillRunning);
    }
    const promise = this.command(command, received);
    this.inFlight.set(zoneId, promise);
    try {
      return await promise;
    } finally {
      if (this.inFlight.get(zoneId) === promise) {
        this.inFlight.delete(zoneId);
      }
    }
  }

  checkOption({ role }) {
    if (role === ROLES.SETPOINT) {
      if (!this.config.allowSetpoint) throw this.refusal(T.command.setpointDisabled);
    } else if (!this.config.allowModes) {
      throw this.refusal(T.command.modesDisabled);
    }
  }

  /** Whether a setpoint is within the bounds of the integration for this kind of zone. */
  inBounds(kind, value) {
    if (kind === ZONE_KIND.ON_OFF) {
      return true;
    }
    const { low, high } = this.bounds(kind);
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      value >= low &&
      value <= high &&
      (kind !== ZONE_KIND.HOT_WATER || Number.isInteger(value))
    );
  }

  /** The checks of a non-protective command before sending, on the latest configuration and state. */
  checkBeforeSend({ session, zoneId, epoch, command, body }) {
    this.checkOption(command);
    if ((this.stopEpoch.get(zoneId) ?? 0) !== epoch || this.guardActive(zoneId, this.monotonic())) {
      throw this.refusal(T.command.stopped);
    }
    if (session !== this.session) {
      throw this.refusal(T.command.configChanged);
    }
    if (!session?.client) {
      throw this.refusal(T.command.noSession);
    }
    if (this.refusedApplies()) {
      throw this.refusal(T.command.refusedLogin);
    }
    if (this.pauseLeft(this.monotonic()) > 0) {
      throw this.refusal(T.command.paused);
    }
    if (this.otherHub) {
      throw this.refusal(T.command.otherHub);
    }
    // The ceilings may have been lowered since the command arrived: every
    // setpoint written is checked, the one asked and the one taken from the hub.
    const { low, high } = this.bounds(command.kind);
    if (command.role === ROLES.SETPOINT && !this.inBounds(command.kind, command.value)) {
      throw this.refusal(T.command.outOfRange(low, high));
    }
    if (body?.fBoostSP !== undefined && !this.inBounds(command.kind, body.fBoostSP)) {
      throw this.refusal(T.command.currentOutOfRange(body.fBoostSP, low, high));
    }
  }

  /** The body of the PATCH for a non-protective command, from the fresh zone; undefined when already so. */
  bodyOf(command, zone) {
    const { role, value, kind } = command;
    const duration = this.config.overrideMinutes * 60;
    const override = (setpoint) => ({
      iMode: ZONE_MODE.OVERRIDE,
      fBoostSP: setpoint,
      iBoostTimeRemaining: duration,
    });
    if (role === ROLES.SETPOINT) {
      if (zone.mode === 'override' && zone.overrideSetpoint === value) return undefined;
      return override(value);
    }
    if (role === ROLES.STATE) {
      if (zone.mode === 'override' && zone.on) return undefined;
      return override(ON_OFF_SETPOINT);
    }
    let mode;
    if (role === ROLES.HEATING_MODE) mode = 'timer';
    else if (role === ROLES.WATER_MODE)
      mode = value === WATER_HEATER_MODE.BOOST ? 'override' : 'timer';
    else mode = value;
    if (mode === 'footprint' && !zone.hasPir) {
      throw this.refusal(T.command.noFootprint);
    }
    if (zone.mode === mode) return undefined;
    if (mode === 'override') {
      if (kind === ZONE_KIND.ON_OFF) {
        return override(ON_OFF_SETPOINT);
      }
      // An override keeps the setpoint the hub shows now: only when it is
      // within the bounds of the integration (never a hot water above its
      // ceiling, never a boost at 0 °C); otherwise a setpoint must be sent.
      const current = zone.setpoint;
      if (!this.inBounds(kind, current)) {
        const { low, high } = this.bounds(kind);
        throw this.refusal(T.command.currentOutOfRange(current, low, high));
      }
      return override(current);
    }
    return { iMode: MODE_VALUES[mode] };
  }

  /**
   * The fresh read of a command: the release (the identity of the hub) and
   * the zones, outside the queue of the periodic reads (never behind a slow
   * page of devices), shared by the commands that arrive before it leaves
   * (a scene setting several zones at once makes one read).
   */
  freshState(session, readBy) {
    const shared = this.fresh;
    if (shared && shared.session === session && !shared.departed) {
      shared.readBy = Math.min(shared.readBy, readBy);
      return shared.promise;
    }
    // One fresh read in flight at a time: the commands arriving meanwhile
    // share the next one, which leaves when the current one ends.
    const previous =
      shared && shared.session === session && !shared.settled ? shared.promise : undefined;
    const f = { session, departed: false, settled: false, readBy };
    const start = previous
      ? previous.then(
          () => undefined,
          () => undefined,
        )
      : new Promise((resolve) => this.defer(resolve));
    f.promise = start.then(async () => {
      f.departed = true;
      const release = await session.client.release({ queued: false, answerBy: f.readBy });
      const zones = await session.client.zones({ queued: false, answerBy: f.readBy });
      return { uid: release.value.uid, zones: zones.value };
    });
    f.promise
      .finally(() => {
        f.settled = true;
      })
      .catch(() => {});
    this.fresh = f;
    return f.promise;
  }

  async command(command, received) {
    const session = this.session;
    const { zoneId } = command;
    const epoch = this.stopEpoch.get(zoneId) ?? 0;
    const sendBy = received + COMMAND.sendBy;
    const answerBy = received + COMMAND.answerBy;
    const context = { session, zoneId, epoch, command };
    this.checkBeforeSend(context);
    const start = this.now();
    const readBy = Math.min(start + COMMAND.readMax, sendBy - COMMAND.minSend);
    if (readBy - start < COMMAND.minSend) {
      throw this.refusal(T.command.tooSlow);
    }
    // The fresh read: the hub and the zones now, never the values in memory.
    let fresh;
    try {
      fresh = await this.freshState(session, readBy);
    } catch (err) {
      if (!(err instanceof HubError)) throw err;
      if (err.code === 'late' || err.code === 'timeout') throw this.refusal(T.command.tooSlow);
      if (err.code === 'refused') throw this.refusal(T.command.refusedLogin);
      throw this.refusal(T.command.unknownState(err));
    }
    // The identity of the hub, read in this command.
    if (!this.hub || fresh.uid !== this.hub.uid) {
      throw this.refusal(this.hub ? T.command.otherHub : T.command.notReadYet);
    }
    const zone = fresh.zones.find((z) => z.id === zoneId);
    if (!zone || zone.kind !== command.kind) {
      throw this.refusal(T.command.unknownZone);
    }
    const body = this.bodyOf(command, zone);
    context.body = body;
    // The options may have been turned off during the read: checked again.
    this.checkBeforeSend(context);
    if (body === undefined) {
      // Already so: nothing sent, a success.
      return;
    }
    if (this.now() > sendBy) {
      throw this.refusal(T.command.tooSlow);
    }
    this.logger.info(`genius-hub zone ${zoneId} ${command.role}: ${command.value}`);
    const options = {
      startBy: sendBy,
      answerBy,
      // The very last check, right before the request leaves.
      beforeSend: () => this.checkBeforeSend(context),
    };
    try {
      await this.write(session, zoneId, body, options);
    } catch (err) {
      if (err instanceof Refusal) throw err;
      throw this.writeFailure(err, zoneId, 'command');
    }
    this.followUp(session, zoneId);
    const back = await this.readBack(session, zoneId, answerBy);
    this.verify(command, body, back, zone, session, zoneId);
  }

  /**
   * What a read of the zone says of a write: 'pending' (it still shows the
   * state of before the command: not applied yet), 'ok', or a failure
   * `{ outOfBounds, setpoint, left }` / `{ text }`. A value beyond the bounds
   * counts only when it is new (not the state of before the command).
   */
  classify(command, body, back, before) {
    const unchanged =
      back.mode === before.mode &&
      back.overrideSetpoint === before.overrideSetpoint &&
      back.setpoint === before.setpoint &&
      back.overrideLeft <= before.overrideLeft;
    const wanted = body.iMode === ZONE_MODE.OVERRIDE ? 'override' : MODE_NAMES[body.iMode];
    if (back.mode !== wanted) {
      return unchanged ? 'pending' : { text: T.command.modeNotApplied(back.mode, wanted) };
    }
    if (body.fBoostSP === undefined) {
      return 'ok';
    }
    if (unchanged) {
      return 'pending';
    }
    const setpoint = back.overrideSetpoint;
    const tooLong = back.overrideLeft > this.config.overrideMinutes * 60 + COMMAND.overrideSlack;
    if (tooLong || !this.inBounds(command.kind, setpoint)) {
      return { outOfBounds: true, setpoint, left: back.overrideLeft };
    }
    const same =
      command.kind === ZONE_KIND.ON_OFF
        ? setpoint !== undefined && setpoint > 0
        : Math.abs(setpoint - body.fBoostSP) <= COMMAND.tolerance;
    return same ? 'ok' : { text: T.command.appliedOther(setpoint, body.fBoostSP) };
  }

  /**
   * A command is a success only when the zone read back shows what was
   * written: the mode, and for an override its setpoint (±0.05 °C) and a
   * duration within the configured one. A read-back that still shows the
   * state of before (a hub applying a little after its answer), or none in
   * time, is checked again by the follow-up reads of 5 s and 20 s. A new
   * value beyond the bounds of the integration turns the zone off at once.
   */
  verify(command, body, back, before, session, zoneId) {
    this.checks.delete(zoneId);
    const outcome = back === undefined ? 'pending' : this.classify(command, body, back, before);
    if (outcome === 'ok') {
      return;
    }
    if (outcome === 'pending') {
      this.checks.set(zoneId, {
        command,
        body,
        before,
        due: this.monotonic() + COMMAND.checkWithin,
      });
      throw this.refusal(T.command.sentUnchecked);
    }
    if (outcome.outOfBounds) {
      this.outOfBounds(session, zoneId, outcome);
      throw this.refusal(T.command.appliedOutOfBounds(outcome.setpoint, outcome.left));
    }
    throw this.refusal(outcome.text);
  }

  /** A value beyond the bounds applied by the hub: the zone off at once. */
  outOfBounds(session, zoneId, { setpoint, left }) {
    this.logger.warn(`genius-hub zone ${zoneId}: the hub applied values out of bounds, off sent`);
    this.emergencyOff(session, zoneId, { setpoint, left });
  }

  /**
   * The commands left unconfirmed, against a follow-up read: confirmed,
   * a value beyond the bounds (the zone off), another value or nothing
   * applied by the end of the check (said in the logs and the status).
   */
  async evaluateChecks(zones, mono, session) {
    let changed = false;
    for (const [zoneId, check] of [...this.checks]) {
      const back = zones.find((z) => z.id === zoneId);
      const outcome = back
        ? this.classify(check.command, check.body, back, check.before)
        : 'pending';
      if (outcome === 'pending') {
        if (mono >= check.due) {
          this.checks.delete(zoneId);
          this.logger.warn(`genius-hub zone ${zoneId}: the command was not applied by the hub`);
          this.setNote(zoneId, T.notes.notApplied, mono);
          changed = true;
        }
        continue;
      }
      this.checks.delete(zoneId);
      changed = true;
      if (outcome === 'ok') {
        this.notes.delete(zoneId);
      } else if (outcome.outOfBounds) {
        this.outOfBounds(session, zoneId, outcome);
      } else {
        this.logger.warn(`genius-hub zone ${zoneId}: the hub applied another value`);
        this.setNote(zoneId, () => outcome.text, mono);
      }
    }
    if (changed) {
      await this.updateStatus();
    }
  }

  /** A note of a zone in the status for 10 minutes: `text(name)` -> { en, fr }. */
  setNote(zoneId, text, mono) {
    this.notes.set(zoneId, { text, due: mono + COMMAND.noteFor });
  }

  /** The refusal after a failed write: "nothing sent", "rejected" or "sent, without confirmation". */
  writeFailure(err, zoneId, what) {
    const hubError = err instanceof HubError ? err : new HubError('unreachable');
    this.logger.warn(`genius-hub zone ${zoneId} ${what}: write failed (${hubError.code})`);
    if (!hubError.sent) {
      return this.refusal(
        hubError.code === 'late' ? T.command.tooSlow : T.command.notSent(hubError),
      );
    }
    if (
      hubError.code === 'rejected' ||
      hubError.code === 'refused' ||
      hubError.code === 'not_found'
    ) {
      return this.refusal(T.command.rejected(hubError));
    }
    return this.refusal(T.command.sentUnconfirmed(hubError));
  }

  /**
   * One write of a zone. Its departure (beforeSend) and its end are kept:
   * "Off" waits for the departure of a previous write only, never its answer.
   */
  write(session, zoneId, body, options) {
    let departed;
    const departure = new Promise((resolve) => {
      departed = resolve;
    });
    const inner = options.beforeSend;
    const promise = session.client.setZone(zoneId, body, {
      ...options,
      beforeSend: () => {
        inner?.();
        this.lastWriteAt.set(zoneId, this.monotonic());
        departed();
      },
    });
    const tracked = promise.finally(() => {
      departed();
      if (this.departures.get(zoneId) === departure) {
        this.departures.delete(zoneId);
      }
    });
    this.departures.set(zoneId, departure);
    return tracked;
  }

  /**
   * The zone read back right after a write (outside the read queue), when
   * the budget leaves time; its values published. Undefined when it could
   * not be read in time.
   */
  async readBack(session, zoneId, answerBy) {
    if (answerBy - this.now() < COMMAND.minReadBack) {
      return undefined;
    }
    try {
      const fresh = await session.client.zones({ queued: false, answerBy });
      if (session !== this.session) return undefined;
      this.publishZones(fresh.value, { force: true });
      void this.publisher.flush();
      return fresh.value.find((z) => z.id === zoneId);
    } catch {
      // The follow-ups tell.
      return undefined;
    }
  }

  /** Waits for `promise` until `by` (wall clock); 'late' after it. */
  async within(promise, by) {
    let handle;
    const late = new Promise((resolve) => {
      handle = this.timers.setTimeout(() => resolve('late'), Math.max(0, by - this.now()));
    });
    try {
      return await Promise.race([promise, late]);
    } finally {
      this.timers.clearTimeout(handle);
    }
  }

  /** Whether an "off" guard holds the zone now (no command that would start it). */
  guardActive(zoneId, mono) {
    const guard = this.guards.get(zoneId);
    if (!guard) return false;
    if (mono >= guard.due) {
      this.guards.delete(zoneId);
      return false;
    }
    return true;
  }

  /** Sets the "off" guard of a zone for 2 minutes (sticky stays sticky). */
  setGuard(zoneId, { sticky, outOfBounds }) {
    const at = this.monotonic();
    const before = this.guards.get(zoneId);
    const alive = before && at < before.due;
    this.guards.set(zoneId, {
      until: this.now() + COMMAND.guard,
      due: at + COMMAND.guard,
      resends: 0,
      sticky: sticky || Boolean(alive && before.sticky),
      failed: false,
      /** Monotonic time it was set: a read started before says nothing of it. */
      since: at,
      outOfBounds: outOfBounds ?? (alive ? before.outOfBounds : undefined),
    });
    return this.guards.get(zoneId);
  }

  /**
   * "Off": the protective choice. No option, no fresh read, through a pause
   * and past a refused login (one try). Its refusal cases are listed in the
   * docs (the same list). A success only when the zone read back is off.
   */
  async protect(command, received) {
    const { zoneId } = command;
    // Cancels any non-protective command of this zone not sent yet.
    this.stopEpoch.set(zoneId, (this.stopEpoch.get(zoneId) ?? 0) + 1);
    const sendBy = received + COMMAND.sendBy;
    const answerBy = received + COMMAND.answerBy;
    const lastBy = sendBy - COMMAND.minSend;
    if (!this.loaded && (await this.within(this.ready, lastBy)) === 'late') {
      // The configuration is not read from Gladys yet (it is tried again).
      throw this.refusal(T.command.notLoaded);
    }
    const session = this.session;
    if (!session?.client) {
      throw this.refusal(T.command.noSession);
    }
    // Only the departure of a write already leaving is awaited (never its answer).
    const leaving = this.departures.get(zoneId);
    const earlier = this.inFlight.has(zoneId) || leaving !== undefined;
    if (leaving && (await this.within(leaving, lastBy)) === 'late') {
      throw this.refusal(T.command.tooSlow);
    }
    const mono = this.monotonic();
    const sticky = earlier || mono - (this.lastWriteAt.get(zoneId) ?? -Infinity) < COMMAND.guard;
    this.logger.info(`genius-hub zone ${zoneId}: off`);
    const options = {
      startBy: sendBy,
      answerBy,
      beforeSend: () => {
        if (this.session !== session) {
          throw this.refusal(T.command.configChanged);
        }
      },
    };
    let failure;
    try {
      await this.write(session, zoneId, { iMode: ZONE_MODE.OFF }, options);
    } catch (err) {
      if (err instanceof Refusal) throw err;
      failure = this.writeFailure(err, zoneId, 'off');
      const hubError = err instanceof HubError ? err : undefined;
      if (!hubError?.sent || ['rejected', 'refused', 'not_found'].includes(hubError.code)) {
        throw failure;
      }
    }
    // The write may have reached the hub: the reads check it from now on.
    const guard = this.setGuard(zoneId, { sticky });
    await this.saveState();
    this.followUp(session, zoneId);
    if (failure) {
      void this.updateStatus();
      throw failure;
    }
    const back = await this.readBack(session, zoneId, answerBy);
    if (back === undefined) {
      void this.updateStatus();
      throw this.refusal(T.command.offUnchecked);
    }
    if (back.mode !== 'off') {
      // Not shown yet (the hub may apply a little after its answer): the
      // follow-up reads check it, and write it again only if it still shows on.
      void this.updateStatus();
      throw this.refusal(T.command.offPending(back.mode));
    }
    this.checks.delete(zoneId);
    if (!guard.sticky) {
      // Confirmed: the guard is lifted.
      this.guards.delete(zoneId);
      await this.saveState();
    }
    void this.updateStatus();
  }

  /** Turns a zone off at once (a value read back beyond the bounds): sticky guard, not awaited. */
  emergencyOff(session, zoneId, applied) {
    this.stopEpoch.set(zoneId, (this.stopEpoch.get(zoneId) ?? 0) + 1);
    this.checks.delete(zoneId);
    this.setGuard(zoneId, { sticky: true, outOfBounds: applied });
    const received = this.now();
    void this.write(
      session,
      zoneId,
      { iMode: ZONE_MODE.OFF },
      { startBy: received + COMMAND.sendBy, answerBy: received + COMMAND.answerBy },
    )
      .catch((err) =>
        this.logger.warn(`genius-hub zone ${zoneId}: "off" failed (${err?.code ?? 'error'})`),
      )
      .then(async () => {
        await this.saveState();
        await this.updateStatus();
        this.followUp(session, zoneId);
      });
  }

  /** After a command: follow-up reads of the zones, 5 s then 20 s after it, grouped (one timer). */
  followUp(session, zoneId) {
    const mono = this.monotonic();
    this.quietUntil.set(zoneId, mono + COMMAND.spacing);
    for (const delay of COMMAND.followUps) {
      this.follow.due.push(mono + delay);
    }
    this.scheduleFollowUp(session);
  }

  /**
   * While an "off" guard lasts, a read of the zones within `delay` (outside
   * the pace): after a restart, after a save of the form, between the
   * follow-ups of a command.
   */
  guardFollowUps(delay) {
    const mono = this.monotonic();
    if ([...this.guards.values()].every((g) => mono >= g.due)) {
      return;
    }
    const at = mono + delay;
    if (!this.follow.due.some((d) => d > mono && d <= at)) {
      this.follow.due.push(at);
    }
    this.scheduleFollowUp(this.session);
  }

  scheduleFollowUp(session) {
    if (this.follow.timer !== undefined || this.follow.due.length === 0 || !this.running) {
      return;
    }
    const mono = this.monotonic();
    const next = Math.min(...this.follow.due);
    this.follow.timer = this.timers.setTimeout(
      () => {
        this.follow.timer = undefined;
        return this.runFollowUp(session);
      },
      Math.max(0, next - mono),
    );
  }

  async runFollowUp(session) {
    const mono = this.monotonic();
    this.follow.due = this.follow.due.filter((at) => at > mono);
    if (session !== this.session || !this.running) {
      // Another session: its own follow-ups (a start schedules them).
      this.scheduleFollowUp(this.session);
      return;
    }
    try {
      const fresh = await session.client.zones();
      if (session !== this.session || !this.running) return;
      this.publishZones(fresh.value, { force: false });
      await this.evaluateChecks(fresh.value, this.monotonic(), session);
      await this.enforceGuards(fresh.value, this.monotonic(), () => session !== this.session, mono);
      void this.publisher.flush();
    } catch (err) {
      this.logger.warn(`genius-hub follow-up read failed (${err?.code ?? err?.name ?? 'error'})`);
    }
    this.guardFollowUps(COMMAND.guardEvery);
    this.scheduleFollowUp(session);
  }

  /**
   * The "off" guards against a read of the zones: a guarded zone read on is
   * written "Off" again (3 times at most) and said in the status; a plain
   * guard is lifted by a read showing the zone off; a guard whose time is
   * over is dropped.
   */
  async enforceGuards(zones, mono, gone, readAt = mono) {
    if (this.guards.size === 0) return;
    const session = this.session;
    let changed = false;
    for (const [zoneId, guard] of [...this.guards]) {
      if (mono >= guard.due) {
        this.guards.delete(zoneId);
        changed = true;
        continue;
      }
      const zone = zones.find((z) => z.id === zoneId);
      if (!zone || (guard.since !== undefined && guard.since > readAt)) {
        continue;
      }
      if (zone.mode === 'off') {
        if (guard.failed) {
          guard.failed = false;
          changed = true;
        }
        if (!guard.sticky) {
          this.guards.delete(zoneId);
          changed = true;
        }
        continue;
      }
      if (!guard.failed) {
        guard.failed = true;
        changed = true;
      }
      if (guard.resends >= COMMAND.resends) {
        continue;
      }
      guard.resends += 1;
      changed = true;
      this.logger.warn(`genius-hub zone ${zoneId}: still on, "off" written again`);
      const received = this.now();
      try {
        await this.write(
          session,
          zoneId,
          { iMode: ZONE_MODE.OFF },
          {
            startBy: received + COMMAND.sendBy,
            answerBy: received + COMMAND.answerBy,
          },
        );
      } catch (err) {
        this.logger.warn(`genius-hub zone ${zoneId}: "off" again failed (${err?.code ?? 'error'})`);
      }
      if (gone()) return;
      this.followUp(session, zoneId);
    }
    if (changed) {
      await this.saveState();
      await this.updateStatus();
    }
  }

  // --- Configuration screen button -------------------------------------------------

  async testConnection() {
    if (!this.session?.client) {
      return this.currentStatus()[1];
    }
    const mono = this.monotonic();
    if (this.pauseLeft(mono) > 0) {
      return this.currentStatus()[1];
    }
    if (this.busy || this.dueAt(mono) > mono) {
      return this.describeOutcome();
    }
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve(T.test.slow), TEST_ANSWER_WITHIN);
    });
    const since = this.monotonic();
    try {
      return await Promise.race([
        this.tick({ evenRefused: true }).then(() => this.describeOutcome(since)),
        late,
      ]);
    } finally {
      this.timers.clearTimeout(timer);
      if (this.running) this.schedule();
    }
  }

  describeOutcome(since) {
    const mono = this.monotonic();
    const refused = this.refusedApplies();
    const next = refused ? undefined : Math.max(0, this.dueAt(mono) - mono);
    const outcome = this.outcome;
    if (!outcome) {
      return refused ? this.currentStatus()[1] : T.test.notYet(next, this.interval());
    }
    const ago =
      since !== undefined && outcome.at >= since ? undefined : Math.max(0, mono - outcome.at);
    if (outcome.kind === 'reading') {
      if (this.otherHub) {
        return this.currentStatus()[1];
      }
      return T.test.reading(
        outcome.hub,
        this.config.address,
        outcome.offered,
        outcome.devices?.length ?? 0,
        ago,
        next,
      );
    }
    return T.test.failed(this.config.address, outcome.err, ago, next);
  }
}
