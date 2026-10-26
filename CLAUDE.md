# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.16), its only
runtime dependency. It reads a Genius Hub through its local API v3 (HTTP on
port 1223 of the hub, Node's own fetch), turns its zones and devices into
Gladys devices and states, and sends the zone commands (setpoint, modes, hot
water, on/off). Unofficial, not affiliated with Genius Hub.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
gi ci                                     # the whole CI locally (this VM)
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          GeniusHubApp: pace, failures and pauses, identity, devices,
                    values, commands, follow-ups, sticky "off", test button
src/client.js       the only network access: the API v3 (GET bounded, PATCH)
src/model.js        the answers -> plain objects (pure, strict)
src/devices.js      -> Gladys devices and states (pure)
src/publisher.js    states within 300/min
src/store.js        /data/genius-hub-state.json
src/config.js       config_schema normalized
src/constants.js    API paths, zone types and modes, bounds, timings
src/i18n.js         runtime texts (en/fr), the refusals
scripts/cover.mjs   cover.png, plain Node
test/fixtures/      answers shaped after geniushub-client
test/helpers/       the app on the fake Gladys, a scripted hub, a virtual clock
```

## Rules

- **External ids are forever**: `zone:<iID>`, `device:<addr>`, feature =
  `<device>:<role>` (src/devices.js ROLES). Manifest keys and the values of
  the "Genius mode" select (`off`, `timer`, `footprint`, `override`) are
  frozen: users store them in devices and scenes.
- **Clocks**: `now` (wall) for /data and the command deadlines, `monotonic`
  for the pace, pauses, guards and freshness; one clock read per decision
  (`dueAt(mono)`), never a second read that would cap "now".
- **Never read the hub sooner than the interval**, whatever asks; the reads
  outside the pace are the zones (and the release) of a command, its
  follow-ups at 5 s and 20 s, and every 20 s while an "off" guard lasts.
- **"Off"** needs no option and goes through a pause, a refused login, the
  read queue and another hub; its refusal cases are listed in `docs/*.md`
  (configuration not loaded in time, address or login not set, the budget,
  a rejection, no read-back showing the zone off): keep that list exact.
  Every other command is decided on a fresh read (identity + zones), within
  its budget, its option checked on arrival, after the read and in
  `beforeSend`, and is a success only when the read-back shows what was
  written. Every setpoint written is bounded module-side, the one taken from
  the hub by an override or a boost included (hot water never above 60 °C).
- Never log or put in a status, an error or /data the password (only an
  8-bit salted tag of a refused one). Never add a call outside `HubClient`.
- Our own words only in the texts: the error codes of `HubError`, the zone
  names checked by src/model.js; never a free text of the hub.
- Container limits: 256 MB RAM, read-only rootfs, only `/data` writable.
  Gladys rate limit: 300 states/min (src/publisher.js).
- Tests never touch the network (`test/realclock.test.js` uses a loopback
  server). Every test of the app runs on the virtual clock of
  `test/helpers/fakeTimers.js`, whose monotonic clock moves at every read.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
