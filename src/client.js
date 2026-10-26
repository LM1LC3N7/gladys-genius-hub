// -----------------------------------------------------------------------------
// The only network access: the local API v3 of a Genius Hub, plain HTTP on
// port 1223 of the home network, no cloud (as geniushub-client, session.py,
// see THIRD_PARTY_NOTICES.md). The login goes as the library sends it: HTTP
// Basic with the user name and the SHA-256 (hex) of user name + password,
// `Connection: close`, to this address only. It is never logged, never in an
// error, never in a URL.
//
// Bounded: the reads one after the other (a small hub), each within a
// deadline (the body included), the answers read into one buffer allocated
// once, never a redirect followed. The writes (PATCH of a zone) do not queue
// behind the reads: an "off" never waits for a read of the devices. Node's
// own fetch: no User-Agent of ours, no imitation of the application.
//
// Errors carry our own codes, never a text of the hub nor a URL; a write
// error says whether the request may have reached the hub (`sent`).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  HTTP_TIMEOUT,
  HUB_PORT,
  MAX_DATA_BYTES,
  MAX_SMALL_BYTES,
  MAX_ZONES_BYTES,
  PATHS,
} from './constants.js';
import { parseDevices, parsePatch, parseRelease, parseZones } from './model.js';

export class HubError extends Error {
  /**
   * @param {'timeout'|'unreachable'|'http'|'redirect'|'not_found'|'server'|'rate_limited'|
   *   'refused'|'page_refused'|'too_large'|'not_json'|'unknown_answer'|'late'|'rejected'} code
   */
  constructor(code, { status, retryAfter, sent = false, error } = {}) {
    super(code);
    this.name = 'HubError';
    this.code = code;
    this.status = status;
    /** ms, from a Retry-After header (429, 503), when given. */
    this.retryAfter = retryAfter;
    /** Whether the request may have reached the hub (writes). */
    this.sent = sent;
    /** The `error` number of a PATCH the hub rejected. */
    this.error = error;
  }
}

/** A network failure (while connecting or while reading the body), in our words. */
function networkError(err) {
  if (err instanceof HubError) {
    return err;
  }
  const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
  return new HubError(timeout ? 'timeout' : 'unreachable');
}

/** A failure Node reports before any byte left (the host refused or does not exist). */
const neverLeft = (err) =>
  ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH'].includes(
    err?.cause?.code,
  );

/**
 * The body, up to `limit` bytes, copied into a single buffer allocated once
 * (no list of chunks, no concatenation): a longer one is not a hub answer.
 */
export async function readBounded(response, limit) {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const buffer = new Uint8Array(limit);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (size + value.byteLength > limit) {
        throw new HubError('too_large');
      }
      buffer.set(value, size);
      size += value.byteLength;
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  }
  return new TextDecoder('utf-8').decode(buffer.subarray(0, size));
}

/** The body of an answer we do not read: let go. */
const drop = async (response) => {
  try {
    await response.body?.cancel?.();
  } catch {
    // Nothing to do: the answer is refused anyway.
  }
};

/** Retry-After in seconds (or an HTTP date) -> ms, undefined when absent or odd. */
function retryAfterOf(response, now) {
  const raw = response.headers?.get?.('retry-after');
  if (typeof raw !== 'string' || raw.length > 64) {
    return undefined;
  }
  if (/^\d{1,9}$/.test(raw.trim())) {
    return Number(raw.trim()) * 1000;
  }
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now()) : undefined;
}

/** The `Date` header of an answer (ms), when readable: the clock of the hub. */
function dateOf(response) {
  const raw = response.headers?.get?.('date');
  if (typeof raw !== 'string' || raw.length > 64) {
    return undefined;
  }
  const at = Date.parse(raw);
  return Number.isFinite(at) ? at : undefined;
}

/** The HTTP status -> a HubError, or undefined for a 2xx. */
function statusError(status, response, now) {
  if (status === 429 || status >= 500) {
    return new HubError(status === 429 ? 'rate_limited' : 'server', {
      status,
      retryAfter: retryAfterOf(response, now),
    });
  }
  // const.py API_STATUS_ERROR: 401 = "the authorization information is missing or invalid".
  if (status === 401 || status === 403) {
    return new HubError('refused', { status });
  }
  if (status === 404) {
    return new HubError('not_found', { status });
  }
  if (status >= 300 && status < 400) {
    return new HubError('redirect', { status });
  }
  if (status < 200 || status >= 300) {
    return new HubError('http', { status });
  }
  return undefined;
}

/** The Basic header the library sends (session.py): user name and SHA-256 hex of user name + password. */
export function authHeader(login) {
  const digest = createHash('sha256')
    .update(`${login.username}${login.password}`, 'utf8')
    .digest('hex');
  return `Basic ${Buffer.from(`${login.username}:${digest}`, 'utf8').toString('base64')}`;
}

/** The base URL of the hub: its address with the port of the API when none was given. */
export function baseUrlOf(address) {
  const withPort = /:\d{1,5}$/.test(address) ? address : `${address}:${HUB_PORT}`;
  return `http://${withPort}`;
}

export class HubClient {
  /** The login header: a private field, never enumerable, never logged. */
  #auth;

  constructor({
    address,
    login,
    fetchImpl = (...args) => globalThis.fetch(...args),
    timeout = HTTP_TIMEOUT,
    now = Date.now,
  }) {
    this.base = baseUrlOf(address);
    this.fetch = fetchImpl;
    this.timeout = timeout;
    this.now = now;
    this.#auth = authHeader(login);
    /** The reads one after the other, never two at once (a small hub). */
    this.queue = Promise.resolve();
  }

  headers(extra = {}) {
    return {
      Accept: 'application/json',
      Authorization: this.#auth,
      Connection: 'close',
      ...extra,
    };
  }

  /**
   * One request: `{ json, at }` (the clock of the hub when it says it). The
   * whole answer within `answerBy` (wall clock) or the timeout; `startBy`
   * refuses to send after that instant; `beforeSend` runs right before the
   * request leaves (its throw cancels the request, nothing sent).
   */
  async request(method, path, { body, limit, startBy, answerBy, beforeSend } = {}) {
    const now = this.now();
    if (startBy !== undefined && now > startBy) {
      throw new HubError('late');
    }
    // Whole milliseconds (AbortSignal.timeout refuses a fraction).
    const budget = Math.floor(
      answerBy === undefined ? this.timeout : Math.min(this.timeout, answerBy - now),
    );
    if (budget <= 0) {
      throw new HubError('late');
    }
    const init = {
      method,
      headers: this.headers(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      // A redirect is never followed: the login stays on this address.
      redirect: 'manual',
      // The whole answer, the body included, within the budget.
      signal: AbortSignal.timeout(budget),
    };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }
    beforeSend?.();
    let sent = false;
    let text;
    let at;
    try {
      let response;
      try {
        response = await this.fetch(`${this.base}${path}`, init);
      } catch (err) {
        // The request left unless Node says the host refused it outright.
        sent = !neverLeft(err);
        throw err;
      }
      sent = true;
      at = dateOf(response);
      const failure = statusError(response.status, response, this.now);
      if (failure) {
        await drop(response);
        throw failure;
      }
      text = await readBounded(response, limit);
    } catch (err) {
      const failure = networkError(err);
      failure.sent = sent;
      throw failure;
    }
    try {
      return { json: JSON.parse(text), at };
    } catch {
      throw new HubError('not_json', { sent: true });
    }
  }

  /**
   * A read; `unknown_answer` when the page is not what it should be. Queued
   * behind the other reads unless `queued: false` (the reads of a command:
   * they never wait behind a periodic read). `principal`: the page whose
   * 401/403 means "login refused"; on any other page it is `page_refused`
   * (the login was accepted by the principal page, this page is not open
   * to it).
   */
  read(path, parse, limit, { queued = true, principal = false, ...options } = {}) {
    const run = async () => {
      let answer;
      try {
        answer = await this.request('GET', path, { ...options, limit });
      } catch (err) {
        if (!principal && err instanceof HubError && err.code === 'refused') {
          throw new HubError('page_refused', { status: err.status, sent: true });
        }
        throw err;
      }
      const value = parse(answer.json);
      if (value === undefined) {
        throw new HubError('unknown_answer');
      }
      return { value, at: answer.at };
    };
    if (!queued) {
      return run();
    }
    const job = this.queue.then(run, run);
    this.queue = job.catch(() => {});
    return job;
  }

  /** The zones (src/model.js parseZones): `{ value: zones[], at }`. */
  zones(options) {
    return this.read(PATHS.ZONES, parseZones, MAX_ZONES_BYTES, options);
  }

  /** The devices (src/model.js parseDevices). */
  devices(options) {
    return this.read(PATHS.DATA_MANAGER, parseDevices, MAX_DATA_BYTES, options);
  }

  /** The release and the unique id of the hub: the principal page (its 401/403 = login refused). */
  release(options) {
    return this.read(PATHS.RELEASE, parseRelease, MAX_SMALL_BYTES, { ...options, principal: true });
  }

  /**
   * PATCH one zone (zone.py set_mode / set_override), outside the read
   * queue. Resolves when the hub answers `error: 0`; a `rejected` error
   * carries the hub's error number; `sent` tells whether the request may
   * have reached the hub.
   */
  async setZone(id, body, options = {}) {
    const { json } = await this.request('PATCH', PATHS.zone(id), {
      ...options,
      body,
      limit: MAX_ZONES_BYTES,
    });
    const answer = parsePatch(json);
    if (!answer) {
      throw new HubError('unknown_answer', { sent: true });
    }
    if (!answer.ok) {
      throw new HubError('rejected', { sent: true, error: answer.error });
    }
  }
}
