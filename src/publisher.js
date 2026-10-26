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
    /** featureId -> { value: { state } | { text }, heartbeat } */
    this.pending = new Map();
    /** Monotonic send times of the last minute. */
    this.window = [];
    this.timer = undefined;
    this.flushing = undefined;
  }

  /**
   * Queues states (`{ device_feature_external_id, state | text }`); `force`
   * re-sends even an equal value; `heartbeat: false` sends a value only when
   * it changed, never again as a heartbeat (a value without a date of its own).
   */
  push(states, { force = false, heartbeat = true } = {}) {
    for (const { device_feature_external_id: id, ...value } of states) {
      if (force) {
        this.gladys.forgetPublishedStates?.(id);
      }
      this.pending.set(id, { value, heartbeat });
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
    const groups = { beat: [], plain: [] };
    let taken = 0;
    for (const [id, entry] of this.pending) {
      if (taken >= room) {
        break;
      }
      taken += 1;
      this.pending.delete(id);
      groups[entry.heartbeat ? 'beat' : 'plain'].push({ id, entry });
    }
    for (const [name, list] of Object.entries(groups)) {
      if (list.length === 0) continue;
      const batch = list.map(({ id, entry }) => ({
        device_feature_external_id: id,
        ...entry.value,
      }));
      try {
        const result = await this.gladys.publishChangedStates(
          batch,
          name === 'beat' ? { heartbeat: this.heartbeat } : {},
        );
        for (let i = 0; i < (result?.count ?? batch.length); i += 1) {
          this.window.push(now);
        }
      } catch (err) {
        this.logger.warn(`Publishing the Genius Hub values failed (${err?.name ?? 'Error'})`);
        // Kept for the next round, unless a newer value arrived meanwhile.
        for (const { id, entry } of list) {
          if (!this.pending.has(id)) {
            this.pending.set(id, entry);
          }
        }
      }
    }
  }
}
