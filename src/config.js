// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized: the
// address of the hub, its login, the pace, the duration of an override, the
// options that allow the commands and the ceilings of the setpoints. The
// address parser comes from gladys-iskra / gladys-p1-monitor (approved).
// -----------------------------------------------------------------------------

import { HOT_WATER_SETPOINT, OVERRIDE_MINUTES, POLL_INTERVAL, ROOM_SETPOINT } from './constants.js';

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * An address typed by the user: an IP address or a host name, with an
 * optional port (1223, the port of the API, when none). A pasted URL
 * ("http://192.168.1.30:1223/") is reduced to its host and port.
 * @returns {{ address: string } | { error: 'invalid' }} `address` is '' when empty.
 */
export function parseAddress(raw) {
  let text = String(raw ?? '').trim();
  if (text === '') {
    return { address: '' };
  }
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '');
  // user:password@ never belongs in the address: refused rather than sent around.
  if (text.includes('@')) {
    return { error: 'invalid' };
  }
  const bracketed = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/i.exec(text);
  if (bracketed) {
    return withPort(`[${bracketed[1].toLowerCase()}]`, bracketed[2]);
  }
  if (/^[0-9a-f:.]+$/i.test(text) && (text.match(/:/g) ?? []).length >= 2) {
    return { address: `[${text.toLowerCase()}]` };
  }
  const match = /^(.*?)(?::(\d{1,5}))?$/.exec(text);
  const host = match[1];
  if (host.length > 253 || !host.split('.').every((label) => LABEL.test(label))) {
    return { error: 'invalid' };
  }
  return withPort(host.toLowerCase(), match[2]);
}

function withPort(host, port) {
  if (port === undefined) {
    return { address: host };
  }
  const number = Number(port);
  if (number < 1 || number > 65535) {
    return { error: 'invalid' };
  }
  return { address: `${host}:${number}` };
}

/** A login part: printable, no control byte (it goes into a header), bounded. */
const LOGIN = /^[\x20-\x7e\u00a0-\uffff]{1,128}$/;

/**
 * The login of the hub: both fields. The user name never holds ":" (Basic
 * encoding).
 * @returns {{ username: string, password: string } | null | 'invalid'}
 */
function loginOf(raw) {
  const username = typeof raw?.username === 'string' ? raw.username.trim() : '';
  const password = typeof raw?.password === 'string' ? raw.password : '';
  if (username === '' && password === '') {
    return null;
  }
  if (
    username === '' ||
    password === '' ||
    username.includes(':') ||
    !LOGIN.test(username) ||
    !LOGIN.test(password)
  ) {
    return 'invalid';
  }
  return { username, password };
}

/** A number typed by the user (a number, or digits with an optional decimal part). */
export function numberOf(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : undefined;
  }
  if (typeof raw === 'string' && /^-?\d{1,6}(?:\.\d{1,3})?$/.test(raw.trim())) {
    return Number(raw.trim());
  }
  return undefined;
}

/** A number within bounds, else the default. */
const bounded = (raw, { min, max }, fallback) => {
  const value = numberOf(raw);
  return value !== undefined && value >= min && value <= max ? value : fallback;
};

/** A whole number within bounds, else the default. */
const wholeBounded = (raw, bounds, fallback) => {
  const value = bounded(raw, bounds, fallback);
  return Number.isInteger(value) ? value : fallback;
};

const flag = (raw) => raw === true || raw === 'true' || raw === 1 || raw === '1';

export function normalizeConfig(raw = {}) {
  // An address longer than any host name is refused before any parsing.
  const value = typeof raw?.address === 'string' && raw.address.length <= 300 ? raw.address : '';
  const parsed = parseAddress(value);
  const login = loginOf(raw);
  return {
    address: parsed.error ? '' : parsed.address,
    invalidAddress:
      Boolean(parsed.error) ||
      (typeof raw?.address === 'string' && value === '' && raw.address !== ''),
    login: login === 'invalid' ? null : login,
    invalidLogin: login === 'invalid',
    /** Seconds between two reads. */
    pollInterval: wholeBounded(raw?.poll_interval, POLL_INTERVAL, POLL_INTERVAL.default),
    /** Minutes of an override set from Gladys. */
    overrideMinutes: wholeBounded(
      raw?.override_duration,
      OVERRIDE_MINUTES,
      OVERRIDE_MINUTES.default,
    ),
    allowSetpoint: flag(raw?.allow_setpoint),
    allowModes: flag(raw?.allow_modes),
    /** The highest room setpoint Gladys may send (Celsius). */
    maxSetpoint: bounded(raw?.max_setpoint, ROOM_SETPOINT, ROOM_SETPOINT.defaultMax),
    /** The highest hot water setpoint Gladys may send (whole Celsius). */
    maxHotWater: wholeBounded(
      raw?.max_hot_water,
      HOT_WATER_SETPOINT,
      HOT_WATER_SETPOINT.defaultMax,
    ),
  };
}

/** Whether the form is complete enough to read the hub. */
export const isComplete = (config) =>
  Boolean(config.address) && Boolean(config.login) && !config.invalidLogin;
