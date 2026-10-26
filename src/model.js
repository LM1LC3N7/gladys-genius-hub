// -----------------------------------------------------------------------------
// The answers of the local API v3 of the hub -> plain objects (pure). The
// shapes come from geniushub-client (zone.py, device.py, const.py, see
// THIRD_PARTY_NOTICES.md): a zone of `/v3/zones`, a device of
// `/v3/data_manager` with its channels, the release. Everything is read
// against strict patterns and bounds: a value of an odd type is left out, an
// answer of another shape gives `undefined` ("not an answer of a Genius Hub").
// -----------------------------------------------------------------------------

import {
  MAX_DEVICES,
  MAX_NAME,
  MAX_ZONES,
  MODE_NAMES,
  ZONE_KIND,
  ZONE_KIT,
  ZONE_TYPE,
} from './constants.js';

/** The models the vendor's application knows, by hash: `[hash, sku, description]`. */
const MODELS = [
  ['VIRTUAL', 'virtual node', 'Virtual Node'],
  ['0x0000000000000000', 'n/a', 'Unrecognised Device'],
  ['Danfoss/eTRV0100', 'da-wrv-e', 'Wireless Radiator Valve'],
  ['Danfoss/eTRV0103', 'da-wrv-e', 'Wireless Radiator Valve'],
  ['DXJI0RG/eTW6FJWG', 'da-wrv-e', 'Wireless Radiator Valve'],
  ['Genius Concepts/PH-PLG-E', 'ph-plg-e', 'Smart Plug'],
  ['0x0000000200030005', 'da-wrv-a', 'Radiator Valve'],
  ['0x0000000200040005', 'da-wrv-b', 'Radiator Valve'],
  ['0x0000000220008004', 'da-dur-a', 'Dual Underfloor Receiver'],
  ['0x0000000280100003', 'da-wrt-c', 'Room Thermostat'],
  ['0x00000002A0107FFF', 'da-wrv-c', 'Genius Valve'],
  ['0x0000005900010003', 'ho-scr-c', 'Single Channel Receiver'],
  ['0x0000005900010010', 'ho-esw-d', 'Electric Switch'],
  ['0x0000005900020003', 'ho-dcr-c', 'Dual Channel Receiver'],
  ['0x000000590002000D', 'ho-wts-a', 'Temperature Sensor'],
  ['0x0000005900020010', 'ho-esw-d', 'Electric Switch'],
  ['0x0000005900030010', 'ho-esw-e', 'Electric Switch'],
  ['0x0000005900040010', 'ho-esw-e', 'Electric Switch w/temp'],
  ['0x0000005900030001', 'ho-wrt-b', 'Room Thermostat'],
  ['0x0000005900050001', 'ho-wrt-d', 'Room Thermostat'],
  ['0x0000005900050003', 'ho-scr-d', 'Single Channel Receiver'],
  ['0x0000005900060003', 'ho-dcr-d', 'Dual Channel Receiver'],
  ['0x0000006000010003', 'ev-plg-a', 'Smart Plug'],
  ['0x0000006000010006', 'es-ths-a', 'Temperature Humidity Sensor'],
  ['0x0000006000020001', 'es-wms-a', 'Motion Sensor'],
  ['0x00000071035D0002', 'ls-wts-a', 'Temperature Sensor'],
  ['0x00000081000100A0', 'sa-cos-a', 'CO2 Sensor'],
  ['0x0000008600050002', 'al-wrs-c', 'Room Sensor'],
  ['0x0000009600010010', 'nq-umr-a', 'Gas Meter Reader'],
  ['0x0000013C00010001', 'ph-plg-c', 'Smart Plug'],
  ['0x0000013C00290001', 'ph-plg-d', 'Smart Plug'],
  ['0x0000013C00950001', 'ph-plg-e', 'Smart Plug'],
  ['0x0000013C00020002', 'ph-wrs-a', 'Room Sensor'],
  ['0x0000013C000C0002', 'ph-wrs-b', 'Room Sensor'],
  ['0x0000013C000D0002', 'ph-wrs-b', 'Room Sensor'],
  ['0x0000013C00500002', 'ph-wms-b', 'Motion Sensor'],
  ['0x0000013C000F0001', 'ph-esw-b', 'Electric Switch'],
  ['0x0000013C00100001', 'ph-ers-a', 'Electric Relay'],
  ['0x0000013C00110001', 'ph-plg-c', 'Smart Plug'],
  ['0x0000013C001A0006', 'ph-iwm-a', 'In Wall Meter'],
  ['0x0000015400011100', 'po-plg-b', 'Smart Plug'],
  ['0x0000019B02080003', 'hi-esw-e', 'HeatIt Relay'],
  ['0x0000019B02030003', 'hi-prt-a', 'Powered Room Thermostat'],
  ['0x0000019B02040004', 'hi-wrt-d', 'Wireless Room Thermostat'],
  ['0x0000006000010015', 'ev-wrv-a', 'Wireless Radiator Valve (beta)'],
];
export const MODEL_BY_HASH = new Map(
  MODELS.map(([hash, sku, description]) => [hash, { sku, description }]),
);

/** The channels of a device the integration reads: channel id -> our key. */
const CHANNELS = {
  'Switch Binary': 'output',
  SwitchBinary: 'output',
  Battery: 'battery',
  HEATING_1: 'setpoint',
  TEMPERATURE: 'temperature',
  LUMINANCE: 'luminance',
  Motion: 'motion',
};

/** The issue the hub raises when a zone uses the outside temperature (issue.py). */
export const WEATHER_ISSUE = 'zone:using_weather_temp';

/** A device address of the hub: a node number, with a channel ("12-1") at most. */
export const DEVICE_ADDR = /^\d{1,5}(?:-\d{1,3})?$/;
/** A zone id: a small whole number. */
export const ZONE_ID = /^\d{1,6}$/;

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const plainEntries = (object) =>
  isObject(object) ? Object.entries(object).filter(([key]) => key !== '__proto__') : [];

/** A number, or the number of a boolean (the hub mixes 0/1 and true/false), else undefined. */
function numberOf(value) {
  if (finite(value)) return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return undefined;
}

/** A temperature read: -50 to 150, else undefined. */
const temperatureOf = (value) =>
  finite(value) && value >= -50 && value <= 150 ? Math.round(value * 100) / 100 : undefined;

/** A whole number within bounds, else undefined. */
const wholeOf = (value, min, max) =>
  Number.isInteger(value) && value >= min && value <= max ? value : undefined;

// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1f\x7f]/g;

/** A name shown in Gladys: printable, trimmed, bounded (never a control byte). */
export function nameOf(value) {
  if (typeof value !== 'string') return '';
  return value.replace(CONTROL, ' ').trim().slice(0, MAX_NAME);
}

/** The kind of a zone from its `iType` and `zoneSubType` (zone.py: a TPI of sub type 0 is a wet underfloor). */
export function kindOf(iType, subType) {
  switch (iType) {
    case ZONE_TYPE.MANAGER:
      return ZONE_KIND.MANAGER;
    case ZONE_TYPE.ON_OFF_TIMER:
      return ZONE_KIND.ON_OFF;
    case ZONE_TYPE.CONTROL_SP:
      return ZONE_KIND.RADIATOR;
    case ZONE_TYPE.CONTROL_ON_OFF_PID:
      return ZONE_KIND.UNDERFLOOR;
    case ZONE_TYPE.TPI:
      return subType === 0 ? ZONE_KIND.UNDERFLOOR : ZONE_KIND.HOT_WATER;
    case ZONE_TYPE.SURROGATE:
      return ZONE_KIND.GROUP;
    case ZONE_TYPE.OPENTHERM:
      return ZONE_KIND.OPENTHERM;
    default:
      return undefined;
  }
}

/** One zone of `/v3/zones`, or undefined when it is not one. */
export function parseZone(raw) {
  if (!isObject(raw) || !Number.isInteger(raw.iID) || raw.iID < 0 || raw.iID > 999999) {
    return undefined;
  }
  const kind = kindOf(raw.iType, raw.zoneSubType);
  if (kind === undefined) {
    return undefined;
  }
  const mode = Number.isInteger(raw.iMode) ? (MODE_NAMES[raw.iMode] ?? 'unknown') : 'unknown';
  const kit = wholeOf(raw.iFlagExpectedKit, 0, 0x7fffffff) ?? 0;
  const issues = Array.isArray(raw.lstIssues)
    ? raw.lstIssues.filter(isObject).map((issue) => ({
        id: typeof issue.id === 'string' ? issue.id.slice(0, 40) : 'unknown',
        level: wholeOf(issue.level, 0, 9) ?? 0,
      }))
    : [];
  const heating = numberOf(raw.bOutRequestHeat);
  // The sensors of the zone are silent: the hub takes the outside
  // temperature instead (issue.py), which is never the room's.
  const usingWeather = issues.some((issue) => issue.id === WEATHER_ISSUE);
  return {
    id: raw.iID,
    name: nameOf(raw.strName) || `Zone ${raw.iID}`,
    kind,
    mode,
    /** The temperature measured by the zone (room, or hot water probe); none when it is the weather's. */
    temperature: usingWeather ? undefined : temperatureOf(raw.fPV),
    usingWeather,
    /** The setpoint in force (the schedule's, or the override's). */
    setpoint: kind === ZONE_KIND.ON_OFF ? undefined : temperatureOf(raw.fSP),
    /** On/off zones: whether the schedule or the override asks for "on". */
    on: kind === ZONE_KIND.ON_OFF ? numberOf(raw.fSP) : undefined,
    overrideSetpoint: temperatureOf(raw.fBoostSP),
    /** Seconds left in the override, 0 when none. */
    overrideLeft: wholeOf(raw.iBoostTimeRemaining, 0, 100 * 86400) ?? 0,
    hasPir: (kit & ZONE_KIT.PIR) !== 0,
    /** Whether the zone asks the boiler (or its relay) for heat now. */
    heating: heating === undefined ? undefined : heating > 0 ? 1 : 0,
    /** Whether anyone has been seen lately (zones with a PIR). */
    occupied:
      (kit & ZONE_KIT.PIR) !== 0 && isObject(raw.zoneReactive)
        ? (numberOf(raw.zoneReactive.fActivityLevel) ?? 0) > 0
          ? 1
          : 0
        : undefined,
    issues: issues.slice(0, 20),
    /** The build date of the hub software, from any zone (a hack of the library). */
    buildDate: typeof raw.strBuildDate === 'string' ? raw.strBuildDate.slice(0, 20) : undefined,
  };
}

/** The zones of `/v3/zones`, or undefined when the answer is not that page. */
export function parseZones(json) {
  if (!isObject(json) || !Array.isArray(json.data)) {
    return undefined;
  }
  const zones = [];
  const seen = new Set();
  for (const raw of json.data.slice(0, MAX_ZONES)) {
    const zone = parseZone(raw);
    if (zone && !seen.has(zone.id)) {
      seen.add(zone.id);
      zones.push(zone);
    }
  }
  return zones;
}

/** The values of a node's channels: `{ key: value }`, numbers only. */
function channelsOf(childValues) {
  const values = {};
  for (const [id, key] of Object.entries(CHANNELS)) {
    const node = childValues[id];
    if (isObject(node) && numberOf(node.val) !== undefined) {
      values[key] = numberOf(node.val);
    }
  }
  return values;
}

/** One device node (or one channel of it, `inherited` = the lastComms of its node) -> our device, or undefined. */
function parseNode(raw, addr, inherited) {
  if (!isObject(raw) || !DEVICE_ADDR.test(addr)) {
    return undefined;
  }
  const values = isObject(raw.childValues) ? raw.childValues : {};
  const hash = isObject(values.hash) && typeof values.hash.val === 'string' ? values.hash.val : '';
  const model = MODEL_BY_HASH.get(hash);
  const channels = channelsOf(values);
  const cfg = isObject(raw.childNodes) && isObject(raw.childNodes._cfg) ? raw.childNodes._cfg : {};
  const cfgValues = isObject(cfg.childValues) ? cfg.childValues : {};
  const own =
    isObject(values.lastComms) && Number.isInteger(values.lastComms.val) && values.lastComms.val > 0
      ? values.lastComms.val
      : undefined;
  // A channel carries no lastComms of its own: it is the node's radio that talks.
  const lastComms = own ?? inherited;
  const device = {
    addr,
    hash: hash.slice(0, 40),
    sku: model ? model.sku.toUpperCase() : undefined,
    model: model?.description,
    zoneName: isObject(values.location) ? nameOf(values.location.val) : '',
    /** Unix seconds of the last communication with the hub, when the node gives it. */
    lastComms,
    battery: wholeOf(channels.battery, 0, 100),
    temperature: temperatureOf(channels.temperature),
    setpoint: temperatureOf(channels.setpoint),
    luminance:
      finite(channels.luminance) && channels.luminance >= 0 ? channels.luminance : undefined,
    motion: channels.motion === undefined ? undefined : channels.motion > 0 ? 1 : 0,
    output: channels.output === undefined ? undefined : channels.output > 0 ? 1 : 0,
    minSetpoint:
      isObject(cfgValues.min_sp) && finite(cfgValues.min_sp.val) ? cfgValues.min_sp.val : undefined,
    maxSetpoint:
      isObject(cfgValues.max_sp) && finite(cfgValues.max_sp.val) ? cfgValues.max_sp.val : undefined,
  };
  return device;
}

/**
 * The devices of `/v3/data_manager` (__init__.py `_devices_via_v3_data_mgr`):
 * every node of every site but "WeatherData", but the hub itself (address 1),
 * and every channel of a node but `_cfg`, addressed `<node>-<channel>`.
 * Undefined when the answer is not that page.
 */
export function parseDevices(json) {
  if (!isObject(json) || !isObject(json.data) || !isObject(json.data.childNodes)) {
    return undefined;
  }
  const devices = [];
  const seen = new Set();
  const add = (raw, addr, inherited) => {
    if (devices.length >= MAX_DEVICES || seen.has(addr)) return undefined;
    const device = parseNode(raw, addr, inherited);
    if (device) {
      seen.add(addr);
      devices.push(device);
    }
    return device;
  };
  for (const [, site] of plainEntries(json.data.childNodes)) {
    if (!isObject(site) || site.addr === 'WeatherData' || !isObject(site.childNodes)) continue;
    for (const [, node] of plainEntries(site.childNodes)) {
      if (!isObject(node) || typeof node.addr !== 'string' || node.addr === '1') continue;
      const parent = add(node, node.addr) ?? parseNode(node, node.addr);
      for (const [, channel] of plainEntries(isObject(node.childNodes) ? node.childNodes : {})) {
        if (!isObject(channel) || typeof channel.addr !== 'string' || channel.addr === '_cfg') {
          continue;
        }
        add(channel, `${node.addr}-${channel.addr}`, parent?.lastComms);
      }
    }
  }
  return devices;
}

/** `/v3/auth/release`: the software release and the unique id of the hub. */
export function parseRelease(json) {
  if (!isObject(json) || !isObject(json.data)) {
    return undefined;
  }
  const uid = typeof json.data.UID === 'string' ? json.data.UID.trim() : '';
  if (!/^[A-Za-z0-9:_-]{1,64}$/.test(uid)) {
    return undefined;
  }
  const release = typeof json.data.release === 'string' ? json.data.release.trim() : '';
  return { uid, release: /^[A-Za-z0-9. _-]{1,32}$/.test(release) ? release : undefined };
}

/** The answer of a PATCH: `{ error: 0, data }` is accepted; another `error` is a refusal. */
export function parsePatch(json) {
  if (!isObject(json) || !Number.isInteger(json.error)) {
    return undefined;
  }
  return { ok: json.error === 0, error: json.error };
}
