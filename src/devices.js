// -----------------------------------------------------------------------------
// The Gladys devices of a Genius Hub and their states. Pure.
//
// External ids (forever): `zone:<iID>` for a zone of the hub, `device:<addr>`
// for a device (a radiator valve, a thermostat, a plug, a sensor), the ids
// the hub gives. Feature roles (forever): see ROLES below.
//
// Zones take the commands: a room setpoint (an override for the configured
// duration), the thermostat mode (off / heating = the timer), the Genius mode
// (off, timer, footprint, override), the hot water setpoint and mode, the
// state of an on/off zone. The devices are read-only: a valve, a thermostat
// or a plug is read, never commanded (the hub drives them from its zones).
//
// Units: only the ones the core lists for the category
// (DEVICE_FEATURE_UNITS_BY_CATEGORY): °C for the temperature sensors and the
// thermostat, % for the battery, lux for the light sensor, none elsewhere.
//
// The features of a hub device follow what it showed: the set only grows and
// always holds the features of the created device, so a device published
// again never loses one (an "Update" in Discovery would drop its history).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import {
  GLADYS,
  HOT_WATER_SETPOINT,
  MODE_NAMES,
  OFFERED_KINDS,
  ROOM_SETPOINT,
  ZONE_KIND,
} from './constants.js';
import { DEVICE_ADDR, WEATHER_ISSUE, ZONE_ID } from './model.js';

const { THERMOSTAT_MODE, OPERATING_STATE, WATER_HEATER_MODE } = GLADYS;

/** Feature roles (forever). */
export const ROLES = {
  TEMPERATURE: 'temperature',
  SETPOINT: 'setpoint',
  HEATING_MODE: 'heating-mode',
  OPERATING_STATE: 'operating-state',
  ZONE_MODE: 'zone-mode',
  OVERRIDE_LEFT: 'override-left',
  OCCUPIED: 'occupied',
  WATER_MODE: 'water-mode',
  HEATING: 'heating',
  STATE: 'state',
  FAULT: 'fault',
  FAULTS: 'faults',
  // Hub devices.
  BATTERY: 'battery',
  LUMINANCE: 'luminance',
  MOTION: 'motion',
  OUTPUT: 'output',
};

/** The roles that take a command, per zone kind. */
export const COMMAND_ROLES = {
  [ZONE_KIND.RADIATOR]: [ROLES.SETPOINT, ROLES.HEATING_MODE, ROLES.ZONE_MODE],
  [ZONE_KIND.UNDERFLOOR]: [ROLES.SETPOINT, ROLES.HEATING_MODE, ROLES.ZONE_MODE],
  [ZONE_KIND.HOT_WATER]: [ROLES.SETPOINT, ROLES.WATER_MODE],
  [ZONE_KIND.ON_OFF]: [ROLES.STATE, ROLES.ZONE_MODE],
};

/** The Genius modes a zone may be set to from Gladys (the values of the select, forever). */
export const SELECT_MODES = {
  [ZONE_KIND.RADIATOR]: ['off', 'timer', 'footprint', 'override'],
  [ZONE_KIND.UNDERFLOOR]: ['off', 'timer', 'footprint', 'override'],
  [ZONE_KIND.ON_OFF]: ['off', 'timer', 'override'],
};

export const zoneIds = (gladys, id) => gladys.externalIds('zone', String(id));
export const deviceIds = (gladys, addr) => gladys.externalIds('device', String(addr));

/** The kind, the id and the role of a zone or device external id (its form only). */
export function parseExternalId(externalId) {
  const match = /:(zone|device):([^:]+)(?::([^:]+))?$/.exec(String(externalId ?? ''));
  if (!match) return undefined;
  const [, kind, id, role] = match;
  if (kind === 'zone' && !ZONE_ID.test(id)) return undefined;
  if (kind === 'device' && !DEVICE_ADDR.test(id)) return undefined;
  return { kind, id: kind === 'zone' ? Number(id) : id, role };
}

const feature = (external, role, name, category, type, extra = {}) => ({
  name,
  external_id: external.feature(role),
  category,
  type,
  min: 0,
  max: 1,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...extra,
});
const writable = { read_only: false, has_feedback: true };
const option = (value, label, i) => ({ value, label, sort_order: i });

const MODE_LABELS = {
  off: 'Off',
  timer: 'Timer (schedule)',
  footprint: 'Footprint (occupancy)',
  override: 'Override (boost)',
  away: 'Away',
  early: 'Early',
  test: 'Test',
  linked: 'Linked',
  other: 'Other',
  unknown: 'Unknown',
};

const temperatureFeature = (e, name, type = T.SENSOR.DECIMAL) =>
  feature(e, ROLES.TEMPERATURE, name, C.TEMPERATURE_SENSOR, type, {
    unit: U.CELSIUS,
    min: -50,
    max: 150,
  });

const faultFeatures = (e) => [
  feature(e, ROLES.FAULT, 'Issue reported', C.INPUT, T.INPUT.BINARY, { keep_history: false }),
  feature(e, ROLES.FAULTS, 'Issues', C.TEXT, T.TEXT.TEXT, { keep_history: false }),
];

const overrideLeft = (e) =>
  feature(e, ROLES.OVERRIDE_LEFT, 'Override left', C.TEXT, T.TEXT.TEXT, { keep_history: false });

const zoneModeFeature = (e, kind, hasPir) => {
  const modes = SELECT_MODES[kind].filter((m) => m !== 'footprint' || hasPir);
  return feature(e, ROLES.ZONE_MODE, 'Genius mode', C.TEXT, T.TEXT.SELECT, {
    ...writable,
    keep_history: false,
    supported_options: modes.map((m, i) => option(m, MODE_LABELS[m], i)),
  });
};

/** The features of a zone, by kind. */
function zoneFeatures(e, zone) {
  switch (zone.kind) {
    case ZONE_KIND.RADIATOR:
    case ZONE_KIND.UNDERFLOOR:
      return [
        temperatureFeature(e, 'Temperature'),
        feature(e, ROLES.SETPOINT, 'Setpoint', C.THERMOSTAT, T.THERMOSTAT.TARGET_TEMPERATURE, {
          unit: U.CELSIUS,
          min: ROOM_SETPOINT.min,
          max: ROOM_SETPOINT.max,
          ...writable,
        }),
        feature(e, ROLES.HEATING_MODE, 'Thermostat mode', C.THERMOSTAT, T.THERMOSTAT.MODE, {
          min: THERMOSTAT_MODE.OFF,
          max: THERMOSTAT_MODE.HEATING,
          keep_history: false,
          ...writable,
          supported_options: [
            option(THERMOSTAT_MODE.OFF, 'Off', 0),
            option(THERMOSTAT_MODE.HEATING, 'Heating', 1),
          ],
        }),
        feature(
          e,
          ROLES.OPERATING_STATE,
          'Heat demand',
          C.THERMOSTAT,
          T.THERMOSTAT.OPERATING_STATE,
          { min: OPERATING_STATE.IDLE, max: OPERATING_STATE.HEATING, keep_history: false },
        ),
        zoneModeFeature(e, zone.kind, zone.hasPir),
        overrideLeft(e),
        ...(zone.hasPir
          ? [
              feature(e, ROLES.OCCUPIED, 'Occupied', C.PRESENCE_SENSOR, T.SENSOR.BINARY, {
                keep_history: false,
              }),
            ]
          : []),
        ...faultFeatures(e),
      ];
    case ZONE_KIND.HOT_WATER:
      return [
        temperatureFeature(e, 'Hot water temperature', T.TEMPERATURE_SENSOR.PROBE),
        feature(
          e,
          ROLES.SETPOINT,
          'Hot water setpoint',
          C.WATER_HEATER,
          T.WATER_HEATER.TARGET_TEMPERATURE,
          {
            unit: U.CELSIUS,
            min: HOT_WATER_SETPOINT.min,
            max: HOT_WATER_SETPOINT.max,
            ...writable,
          },
        ),
        feature(e, ROLES.WATER_MODE, 'Hot water mode', C.WATER_HEATER, T.WATER_HEATER.MODE, {
          min: WATER_HEATER_MODE.OFF,
          max: WATER_HEATER_MODE.PROGRAM,
          keep_history: false,
          ...writable,
          supported_options: [
            option(WATER_HEATER_MODE.OFF, 'Off', 0),
            option(WATER_HEATER_MODE.PROGRAM, 'Timer (schedule)', 1),
            option(WATER_HEATER_MODE.BOOST, 'Override (boost)', 2),
          ],
        }),
        feature(e, ROLES.HEATING, 'Heating water', C.WATER_HEATER, T.WATER_HEATER.HEATING, {
          keep_history: false,
        }),
        overrideLeft(e),
        ...faultFeatures(e),
      ];
    case ZONE_KIND.ON_OFF:
      return [
        feature(e, ROLES.STATE, 'On', C.SWITCH, T.SWITCH.BINARY, { ...writable }),
        zoneModeFeature(e, zone.kind, false),
        overrideLeft(e),
        ...faultFeatures(e),
      ];
    default:
      return [];
  }
}

/** The Gladys device of a zone (undefined for a kind not offered). */
export function buildZoneDevice(gladys, zone, hub) {
  if (!OFFERED_KINDS.has(zone.kind)) {
    return undefined;
  }
  const e = zoneIds(gladys, zone.id);
  return {
    name: zone.name,
    external_id: e.device,
    features: zoneFeatures(e, zone),
    params: [
      { name: 'zone_id', value: String(zone.id) },
      { name: 'zone_kind', value: zone.kind },
      { name: 'hub_uid', value: String(hub?.uid ?? '') },
    ],
  };
}

/** The feature roles a hub device reading shows. */
export function capabilitiesOf(device) {
  const keys = new Set();
  if (device.battery !== undefined) keys.add(ROLES.BATTERY);
  if (device.temperature !== undefined) keys.add(ROLES.TEMPERATURE);
  if (device.setpoint !== undefined) keys.add(ROLES.SETPOINT);
  if (device.luminance !== undefined) keys.add(ROLES.LUMINANCE);
  if (device.motion !== undefined) keys.add(ROLES.MOTION);
  if (device.output !== undefined) keys.add(ROLES.OUTPUT);
  return keys;
}

/** The order of the features of a hub device. */
export const DEVICE_ORDER = [
  ROLES.TEMPERATURE,
  ROLES.SETPOINT,
  ROLES.BATTERY,
  ROLES.LUMINANCE,
  ROLES.MOTION,
  ROLES.OUTPUT,
];
const DEVICE_KNOWN = new Set(DEVICE_ORDER);

const DEVICE_DEFINITIONS = {
  [ROLES.TEMPERATURE]: (e) => temperatureFeature(e, 'Temperature'),
  [ROLES.SETPOINT]: (e) =>
    feature(e, ROLES.SETPOINT, 'Valve setpoint', C.THERMOSTAT, T.THERMOSTAT.TARGET_TEMPERATURE, {
      unit: U.CELSIUS,
      min: -50,
      max: 150,
    }),
  [ROLES.BATTERY]: (e) =>
    feature(e, ROLES.BATTERY, 'Battery', C.BATTERY, T.BATTERY.INTEGER, {
      unit: U.PERCENT,
      max: 100,
    }),
  [ROLES.LUMINANCE]: (e) =>
    feature(e, ROLES.LUMINANCE, 'Luminance', C.LIGHT_SENSOR, T.SENSOR.INTEGER, {
      unit: U.LUX,
      max: 1_000_000,
    }),
  [ROLES.MOTION]: (e) =>
    feature(e, ROLES.MOTION, 'Motion', C.MOTION_SENSOR, T.SENSOR.BINARY, {
      keep_history: false,
    }),
  [ROLES.OUTPUT]: (e) =>
    feature(e, ROLES.OUTPUT, 'Output on', C.SWITCH, T.SWITCH.BINARY, { keep_history: false }),
};

/** The roles of the features of a created Gladys device (its external ids), known ones only. */
export function capabilitiesOfDevice(created) {
  const keys = new Set();
  for (const f of created?.features ?? []) {
    const role = parseExternalId(f.external_id)?.role;
    if (DEVICE_KNOWN.has(role)) keys.add(role);
  }
  return keys;
}

export const union = (...sets) => new Set(sets.flatMap((s) => [...s]));

/** The roles kept in /data, known ones only. */
export const validRoles = (list) =>
  new Set((Array.isArray(list) ? list : []).filter((k) => DEVICE_KNOWN.has(k)));

export const hubDeviceName = (device) =>
  `${device.model ?? 'Device'} ${device.addr}${device.zoneName ? ` (${device.zoneName})` : ''}`;

/** The Gladys device of a hub device, with the features of `keys` (undefined when none). */
export function buildHubDevice(gladys, device, keys, hub) {
  const roles = DEVICE_ORDER.filter((k) => keys.has(k));
  if (roles.length === 0) {
    return undefined;
  }
  const e = deviceIds(gladys, device.addr);
  return {
    name: hubDeviceName(device),
    external_id: e.device,
    features: roles.map((role) => DEVICE_DEFINITIONS[role](e)),
    params: [
      { name: 'address', value: device.addr },
      { name: 'model', value: device.sku ?? device.hash ?? '' },
      { name: 'zone', value: device.zoneName ?? '' },
      { name: 'hub_uid', value: String(hub?.uid ?? '') },
    ].filter((p) => p.value !== ''),
  };
}

// --- States ---------------------------------------------------------------------------

export const thermostatModeOf = (mode) =>
  mode === 'off' || mode === 'away' ? THERMOSTAT_MODE.OFF : THERMOSTAT_MODE.HEATING;

export function waterModeOf(mode) {
  if (mode === 'override') return WATER_HEATER_MODE.BOOST;
  if (mode === 'off' || mode === 'away') return WATER_HEATER_MODE.OFF;
  return WATER_HEATER_MODE.PROGRAM;
}

const state = (e, role, value) => ({ device_feature_external_id: e.feature(role), state: value });
const text = (e, role, value) => ({ device_feature_external_id: e.feature(role), text: value });

const left = (seconds) => {
  if (!seconds) return 'none';
  const minutes = Math.round(seconds / 60);
  return minutes >= 120 ? `${Math.round(minutes / 60)} h` : `${Math.max(1, minutes)} min`;
};

const issuesText = (issues) =>
  issues.length === 0
    ? 'none'
    : issues
        .map((i) =>
          i.id === WEATHER_ISSUE
            ? `${i.id} (the hub uses the outside temperature: the room temperature is not sent)`
            : i.id,
        )
        .join(', ')
        .slice(0, 300);

/** The states of a zone reading. */
export function zoneStates(gladys, zone) {
  const e = zoneIds(gladys, zone.id);
  const states = [];
  const common = () => {
    states.push(text(e, ROLES.ZONE_MODE, zone.mode));
    states.push(
      text(e, ROLES.OVERRIDE_LEFT, zone.mode === 'override' ? left(zone.overrideLeft) : 'none'),
    );
    states.push(state(e, ROLES.FAULT, zone.issues.length > 0 ? 1 : 0));
    states.push(text(e, ROLES.FAULTS, issuesText(zone.issues)));
  };
  switch (zone.kind) {
    case ZONE_KIND.RADIATOR:
    case ZONE_KIND.UNDERFLOOR:
      if (zone.temperature !== undefined)
        states.push(state(e, ROLES.TEMPERATURE, zone.temperature));
      if (zone.setpoint !== undefined) states.push(state(e, ROLES.SETPOINT, zone.setpoint));
      states.push(state(e, ROLES.HEATING_MODE, thermostatModeOf(zone.mode)));
      if (zone.heating !== undefined) {
        states.push(
          state(
            e,
            ROLES.OPERATING_STATE,
            zone.heating ? OPERATING_STATE.HEATING : OPERATING_STATE.IDLE,
          ),
        );
      }
      if (zone.occupied !== undefined) states.push(state(e, ROLES.OCCUPIED, zone.occupied));
      common();
      break;
    case ZONE_KIND.HOT_WATER:
      if (zone.temperature !== undefined)
        states.push(state(e, ROLES.TEMPERATURE, zone.temperature));
      if (zone.setpoint !== undefined) states.push(state(e, ROLES.SETPOINT, zone.setpoint));
      states.push(state(e, ROLES.WATER_MODE, waterModeOf(zone.mode)));
      if (zone.heating !== undefined) states.push(state(e, ROLES.HEATING, zone.heating));
      common();
      break;
    case ZONE_KIND.ON_OFF:
      if (zone.heating !== undefined) {
        states.push(state(e, ROLES.STATE, zone.heating));
      } else if (zone.on !== undefined) {
        states.push(state(e, ROLES.STATE, zone.on > 0 ? 1 : 0));
      }
      common();
      break;
    default:
      break;
  }
  return states;
}

/** The states of a hub device reading. */
export function hubDeviceStates(gladys, device) {
  const e = deviceIds(gladys, device.addr);
  const states = [];
  if (device.temperature !== undefined)
    states.push(state(e, ROLES.TEMPERATURE, device.temperature));
  if (device.setpoint !== undefined) states.push(state(e, ROLES.SETPOINT, device.setpoint));
  if (device.battery !== undefined) states.push(state(e, ROLES.BATTERY, device.battery));
  if (device.luminance !== undefined) {
    states.push(state(e, ROLES.LUMINANCE, Math.round(device.luminance)));
  }
  if (device.motion !== undefined) states.push(state(e, ROLES.MOTION, device.motion));
  if (device.output !== undefined) states.push(state(e, ROLES.OUTPUT, device.output));
  return states;
}

/** The name of a Genius mode, for the texts. */
export const modeLabel = (mode) => MODE_LABELS[mode] ?? MODE_LABELS.unknown;
export { MODE_NAMES };
