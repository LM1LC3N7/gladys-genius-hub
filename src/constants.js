// -----------------------------------------------------------------------------
// Constants shared by the integration. Every key stored by Gladys (actions,
// manifest keys, external ids and feature roles in src/devices.js, the option
// values of the selects) is forever: never rename one.
// -----------------------------------------------------------------------------

export const ACTIONS = { TEST: 'test_connection' };

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
export { SECOND, MINUTE, HOUR };

// --- The local API v3 of the hub (as geniushub-client reads it, see THIRD_PARTY_NOTICES.md) ---
/** The hub listens on this port, plain HTTP on the home network. */
export const HUB_PORT = 1223;
export const PATHS = {
  /** Every zone with its mode, temperatures and issues: `{ data: [zone...] }`. */
  ZONES: '/v3/zones',
  /** Every device (valves, thermostats, plugs, sensors) by site and node. */
  DATA_MANAGER: '/v3/data_manager',
  /** The software release and the unique id of the hub: `{ data: { release, UID } }`. */
  RELEASE: '/v3/auth/release',
  /** PATCH one zone: `{ iMode }` or `{ iMode, fBoostSP, iBoostTimeRemaining }`. */
  zone: (id) => `/v3/zone/${id}`,
};

/** `iType` of a zone (the vendor's web application, through geniushub-client). */
export const ZONE_TYPE = {
  MANAGER: 1,
  ON_OFF_TIMER: 2,
  CONTROL_SP: 3,
  CONTROL_ON_OFF_PID: 4,
  TPI: 5,
  SURROGATE: 6,
  OPENTHERM: 7,
};

/** `iMode` of a zone. Boost and Override share the value 16. */
export const ZONE_MODE = {
  UNKNOWN: 0,
  OFF: 1,
  TIMER: 2,
  FOOTPRINT: 4,
  AWAY: 8,
  OVERRIDE: 16,
  EARLY: 32,
  TEST: 64,
  LINKED: 128,
  OTHER: 256,
};

/** Our names of the modes (the values of the "Genius mode" select, forever). */
export const MODE_NAMES = {
  [ZONE_MODE.UNKNOWN]: 'unknown',
  [ZONE_MODE.OFF]: 'off',
  [ZONE_MODE.TIMER]: 'timer',
  [ZONE_MODE.FOOTPRINT]: 'footprint',
  [ZONE_MODE.AWAY]: 'away',
  [ZONE_MODE.OVERRIDE]: 'override',
  [ZONE_MODE.EARLY]: 'early',
  [ZONE_MODE.TEST]: 'test',
  [ZONE_MODE.LINKED]: 'linked',
  [ZONE_MODE.OTHER]: 'other',
};
export const MODE_VALUES = Object.fromEntries(
  Object.entries(MODE_NAMES).map(([value, name]) => [name, Number(value)]),
);

/** `iFlagExpectedKit` bits: the equipment of a zone. */
export const ZONE_KIT = { TEMP: 1, VALVE: 2, PIR: 4, POWER: 8, SWITCH: 16 };

/** Our kinds of zones (the `type` of src/model.js). */
export const ZONE_KIND = {
  MANAGER: 'manager',
  ON_OFF: 'on_off',
  RADIATOR: 'radiator',
  UNDERFLOOR: 'underfloor',
  HOT_WATER: 'hot_water',
  GROUP: 'group',
  OPENTHERM: 'opentherm',
};

/** The zone kinds offered to Gladys (manager, groups and the OpenTherm add-on are not). */
export const OFFERED_KINDS = new Set([
  ZONE_KIND.ON_OFF,
  ZONE_KIND.RADIATOR,
  ZONE_KIND.UNDERFLOOR,
  ZONE_KIND.HOT_WATER,
]);

/** Gladys values (server/utils/constants.js of the core, not exported by the SDK). */
export const GLADYS = {
  ON: 1,
  OFF: 0,
  THERMOSTAT_MODE: { OFF: 0, HEATING: 1 },
  OPERATING_STATE: { IDLE: 0, HEATING: 1 },
  WATER_HEATER_MODE: { OFF: 0, BOOST: 3, PROGRAM: 6 },
};

// --- Bounds (module side, whatever the hub says) -------------------------------------
/** A room setpoint, in Celsius: the range of the Genius Hub application (4 to 28). */
export const ROOM_SETPOINT = { min: 4, max: 28, defaultMax: 25 };
/** The hot water setpoint, in whole Celsius: 55 by default, never above 60 (scalding). */
export const HOT_WATER_SETPOINT = { min: 30, max: 60, defaultMax: 55 };
/** An override lasts this many minutes (the application boosts for an hour). */
export const OVERRIDE_MINUTES = { min: 10, max: 1440, default: 60 };
/** The on/off zones: the value the hub takes as "on" in an override. */
export const ON_OFF_SETPOINT = 1;

// --- Limits --------------------------------------------------------------------------
/** The library waits 20 s for an answer of the hub; so do we, the body included. */
export const HTTP_TIMEOUT = 20 * SECOND;
/** The zones of a house are a few hundred KiB at most; the devices a bit more. */
export const MAX_ZONES_BYTES = 2 * 1024 * 1024;
export const MAX_DATA_BYTES = 4 * 1024 * 1024;
export const MAX_SMALL_BYTES = 64 * 1024;
/** At most this many zones and devices read (and offered). */
export const MAX_ZONES = 64;
export const MAX_DEVICES = 256;
/** A name of the hub shown in Gladys: bounded. */
export const MAX_NAME = 60;

// --- Schedule ------------------------------------------------------------------------
/** One read of the hub every minute by default (Home Assistant's pace on the local API). */
export const POLL_INTERVAL = { min: 60, max: 3600, default: 60 };
/** An unreachable hub or a wrong answer: tries after 30 s, doubled up to 10 minutes. */
export const RETRY_MIN = 30 * SECOND;
export const RETRY_MAX = 10 * MINUTE;
/** HTTP 429 or 5xx of the hub: a pause from 1 min to 6 h, kept in /data. */
export const PAUSE_MIN = MINUTE;
export const PAUSE_MAX = 6 * HOUR;
/** The time of the last read is written in /data at most once per this delay. */
export const ATTEMPT_SAVE_EVERY = MINUTE;
/** Unchanged values are sent again after this delay (publishChangedStates heartbeat). */
export const STATE_HEARTBEAT = 30 * MINUTE;
/** The test button answers within this delay (the manifest gives it 60 s). */
export const TEST_ANSWER_WITHIN = 45 * SECOND;
/** A stop saves /data, then waits for the read running at most this long and saves again. */
export const STOP_WAIT = 5 * SECOND;
/** A device whose last communication is older than this: its values are not published. */
export const DEVICE_STALE_AFTER = 2 * HOUR;
/** Gladys takes 300 states a minute; the publisher never sends more. */
export const STATES_PER_MINUTE = 300;
export const STATES_PER_REQUEST = 100;
export const FLUSH_INTERVAL = SECOND;

// --- Commands ------------------------------------------------------------------------
export const COMMAND = {
  /** The request leaves within this delay of the click, or the command is refused unsent. */
  sendBy: 3500,
  /** The answer (and the read-back) within this delay (Gladys waits 5 s). */
  answerBy: 4500,
  /** The fresh read before a non-protective command gets at most this long. */
  readMax: 2000,
  /** Less than this left to send after the read: refused as too slow. */
  minSend: 400,
  /** A read-back after a write needs at least this long; otherwise the follow-ups tell. */
  minReadBack: 600,
  /** Follow-up reads of the zones after a command (grouped, outside the pace). */
  followUps: [5 * SECOND, 20 * SECOND],
  /** No two non-protective writes of a zone within this delay. */
  spacing: 2 * SECOND,
  /** A non-protective write that left within this delay before an "off" makes it sticky. */
  guard: 2 * MINUTE,
  /** A sticky "off" is written again at most this many times by the follow-ups. */
  resends: 3,
};
