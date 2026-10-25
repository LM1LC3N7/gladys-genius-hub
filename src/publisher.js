// -----------------------------------------------------------------------------
// What goes to Gladys, within its limit of 300 states a minute: the states
// of a read are merged by feature (the last value wins), sent through
// publishChangedStates (unchanged values skipped, sent again after the
// heartbeat), and what the budget of the minute cannot take waits for the
// next flush, a second later. One flush at a time; the budget is counted on
// the monotonic clock. A value asked to be sent whatever the last one
// (`force`: the value read back after a command) is forgotten first.
// -----------------------------------------------------------------------------

import {
  FLUSH_INTERVAL,
  MINUTE,
  STATES_PER_MINUTE,
  STATES_PER_REQUEST,
  STATE_HEARTBEAT,
} from './constants.js';

export class StatePublisher {
  constructor({
    gladys,
    logger,
    monotonic = () => performance.now(),
    timers = { setTimeout, clearTimeout },
    perMinute = STATES_PER_MINUTE,
    heartbeat = STATE_HEARTBEAT,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.monotonic = monotonic;
    this.timers = timers;
    this.perMinute = perMinute;
    this.heartbeat = heartbeat;
    /** featureId -> { state } | { text } */
    this.pending = new Map();
    /** Monotonic send times of the last minute. */
    this.window = [];
    this.timer = undefined;
    this.flushing = undefined;
  }

  /** Queues states (`{ device_feature_external_id, state | text }`); `force` re-sends even an equal value. */
  push(states, { force = false } = {}) {
    for (const { device_feature_external_id: id, ...value } of states) {
      if (force) {
        this.gladys.forgetPublishedStates?.(id);
      }
      this.pending.set(id, value);
    }
  }

  /** Forgets what is pending (another hub, a stop). */
  clear() {
    this.pending.clear();
    this.stopTimer();
  }

  get idle() {
    return this.pending.size === 0 && !this.flushing;
  }

  stopTimer() {
    if (this.timer !== undefined) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** Sends what the budget allows; what is left waits for a later flush. */
  flush() {
    if (!this.flushing) {
      this.flushing = this.doFlush().finally(() => {
        this.flushing = undefined;
        if (this.pending.size > 0 && this.timer === undefined) {
          this.timer = this.timers.setTimeout(() => {
            this.timer = undefined;
            this.flush();
          }, FLUSH_INTERVAL);
        }
      });
    }
    return this.flushing;
  }

  async doFlush() {
    const now = this.monotonic();
    this.window = this.window.filter((t) => now - t < MINUTE);
    const room = Math.min(this.perMinute - this.window.length, STATES_PER_REQUEST);
    if (room <= 0 || this.pending.size === 0) {
      return;
    }
    const batch = [];
    for (const [id, value] of this.pending) {
      if (batch.length >= room) {
        break;
      }
      this.pending.delete(id);
      batch.push({ device_feature_external_id: id, ...value });
    }
    try {
      const result = await this.gladys.publishChangedStates(batch, { heartbeat: this.heartbeat });
      for (let i = 0; i < (result?.count ?? batch.length); i += 1) {
        this.window.push(now);
      }
    } catch (err) {
      this.logger.warn(`Publishing the Genius Hub values failed (${err?.name ?? 'Error'})`);
      // Kept for the next round, unless a newer value arrived meanwhile.
      for (const { device_feature_external_id: id, ...value } of batch) {
        if (!this.pending.has(id)) {
          this.pending.set(id, value);
        }
      }
    }
  }
}
