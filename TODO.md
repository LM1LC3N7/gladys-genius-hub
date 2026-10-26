# TODO — Genius Hub v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/en.md`, `docs/fr.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).
- No forum topic of its own, no forum post from a module session: the main
  session posts one recap on /t/10385 per wave of five published modules.

## Status

- [x] **Milestone 1 — core** (2026-10-25): local API v3 (release, zones,
      data_manager, PATCH zone), zone devices (radiator, underfloor, hot
      water, on/off), read-only hub devices, commands with options, "Off"
      protective with sticky guard, pace, pauses, refused login, identity by
      hub UID, test button, docs en/fr, cover. Tested against fixtures shaped
      after geniushub-client only.
- [ ] **Milestone 2 — real hub**: run against a real Genius Hub and compare
      with the app (see "To check on a real hub"); turn the answers
      (anonymized) into fixtures; fix what differs.
- [ ] **Milestone 3 — more**: the house-wide modes of the manager zone
      (away, holiday); the schedules as text; the OpenTherm add-on (boiler
      flow temperature, read-only); issues as a text per device; the cloud
      API v1 (my.geniushub.co.uk, token) for hubs not reachable locally;
      `keywords` (genius hub, heat genius, heating, radiator, hot water) and
      `countries` (GB) in the manifest once the module requires Gladys 5.3.0.
- [ ] **Milestone 4 — first release**: `gi ci`, Release workflow, topic,
      GHCR package public (the main session does it).

## To check on a real hub

- Whether the zones page gives `fPV`/`fSP` for every zone kind (the
  library reads them for ControlSP and TPI only), and whether `fSP` of an
  on/off zone is 0/1.
- The `error` numbers of a rejected PATCH, and whether `PATCH /v3/zone/<id>`
  (the library's call) or `PUT` is expected by recent hub releases.
- Whether a wrong login gives 401 (final stop here) or 503 (a pause here,
  with a status asking to check the login; the library's table says 503 =
  "the authorization information is invalid", 502 = "the hub is offline").
- Whether the read-back right after a PATCH already shows the new mode and
  setpoint (the ack depends on it). A hub applying a little after its
  answer is handled: a read-back still showing the state of before is "not
  shown yet", and the follow-ups of 5 s and 20 s conclude (success, another
  value, nothing applied, or "Off" for a new value beyond the bounds).
- Whether `/v3/auth/release` asks for the login at all. If it does not, a
  wrong password shows only as `page_refused` on the zones page, tried again
  from 30 s up to 1 h with the hash sent each time: then treat two
  `page_refused` in a row on the zones as a refused login.
- The `Date` header of the hub (used for the staleness of the devices) and
  whether `lastComms` is Unix seconds on every device.
- The time the hub takes for `data_manager` on a large house (the budget of
  the fresh read before a command only reads the zones).
- Whether `zoneReactive.fActivityLevel > 0` is a fair "occupied" (the web
  application's heuristic also looks at the footprint mode and the night).

## Decisions

- **Versions**: 0.1.0 set once by hand when leaving the template (package,
  lock file, manifest, image tag `ghcr.io/lm1lc3n7/gladys-genius-hub:0.1.0`),
  as for the sibling integrations; the Release workflow owns them from now on
  (the first patch release gives 0.1.1).
- **SDK `^0.16.0`** (2026-10-26, migration wave 1): 0.16.0 is on npm since
  2026-10-25 (a stale npm cache said otherwise); it adds the ai, tts and music
  types; no effect here (`should_poll` explicit or `poll_frequency` unused). `keywords`, `countries` and `gladys_version >= 5.3.0` wait until
  Gladys 5.3 is widespread.
- **Reused project**: geniushub-client (MIT, 0.7.4, commit 2b182e5), cloned
  read-only in `~/code/ref/lot16/geniushub-client`, ported to JavaScript
  (`src/client.js`, `src/model.js`, `src/constants.js`); the SDK stays the
  only runtime dependency. Structure and clock model from gladys-iskra
  (commit 7ea6ab1), command shape from gladys-compit (approved).
- **Local API only** (v3, the hub's user name and password): the cloud API
  v1 needs the my.geniushub.co.uk token and is slower (120 s timeout in the
  library); left for a later version.
- **Zone kinds offered**: radiator room (iType 3), wet underfloor (iType 4,
  or TPI with zoneSubType 0), hot water (TPI), on/off timer (iType 2). The
  manager (1), groups (6) and OpenTherm (7) are read but not offered.
- **Features**: thermostat `target-temperature` + `mode` (OFF/HEATING) +
  `operating-state` for the rooms, a `text/select` "Genius mode" with the
  library's names (off, timer, footprint, override) because THERMOSTAT_PRESET
  has no footprint; water-heater `target-temperature` + `mode`
  (OFF/PROGRAM/BOOST) + `heating`; `switch/binary` for the on/off zones (not
  a protective device: "off" is the safe side); `input/binary` + `text` for
  the issues. Devices behind the hub: read-only, `switch/binary` read-only
  for their output.
- **Bounds**: room setpoints 4–28 °C (the app's range), capped by
  `max_setpoint` (25 by default); hot water whole degrees 30–60 °C, capped
  by `max_hot_water` (55 by default, 60 at most). Override duration 10–1440
  min (60 by default, the app's boost).
- **Commands**: setpoint and mode commands behind `allow_setpoint` /
  `allow_modes` (off by default); "Off" without option, outside the read
  queue, through pauses and refused logins, sticky for 2 min after a
  setting that just left (3 resends at most, kept in /data). Decided on a
  fresh read of the zones, sent within 3.5 s, read back within 4.5 s,
  follow-ups at 5 s and 20 s.
- **Identity**: the hub's UID (`/v3/auth/release`) kept in /data; another
  UID at the address publishes nothing and refuses the non-protective
  commands until a Scan adopts it. Zone ids and device addresses are the
  hub's own.
- **Freshness**: devices published only when `lastComms` advanced, never
  when older than 2 h (hub's `Date` header); zones at every read.
- **Refused login**: 401/403 on the release page is final (8-bit salted
  tag of the password in /data, never the password); 401/403 on the zones
  or devices page is "page refused" (spaced up to 1 h, the zones still
  published); 503 is a pause whose status says it may be the login, and a
  new address or login ends the pause.
- **Confirmation (review r1)**: a command is a success only when the zone
  read back shows the mode and setpoint written; a read-back beyond the
  bounds turns the zone off. Every "off" sets a guard of 2 min kept in
  /data, checked by reads every 20 s (after a restart too), "off" written
  again 3 times at most, lifted by a read showing off unless sticky.
- **Fresh read of a command**: release (identity) + zones read together,
  outside the read queue, shared by the commands arriving before it leaves
  (`setImmediate`), two in flight at most (review r3: a scene of 5 zones on
  a hub answering in 900 ms succeeds). A read-back showing the state of
  before is read once more 0.5 s later when the budget allows.
- **Weather temperature**: a zone with the issue `zone:using_weather_temp`
  publishes no temperature; a channel takes its node's `lastComms`; a
  device without any is sent on change only (no heartbeat).
- The template's demo files were removed with `git rm`.
