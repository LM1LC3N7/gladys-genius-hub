# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.2] - 2026-10-26

### Changed

- Integration SDK 0.16 (no change for the devices).

## [0.1.1] - 2026-10-26

### Added

- First version: a Genius Hub read through its local API v3 (port 1223, no
  cloud): one device per zone (radiator room, wet underfloor, hot water,
  on/off timer) with its temperature, setpoint, thermostat mode, heat demand,
  Genius mode, override left, occupancy and issues; one read-only device per
  radiator valve, thermostat, plug or sensor behind the hub (temperature,
  valve setpoint, battery, luminance, motion, output), published only when
  the device talked to the hub since, never when older than 2 h.
- Commands on the zones: a setpoint (an override for the configured
  duration, bounded by the configuration, hot water never above 60 °C), the
  thermostat mode, the Genius modes, the hot water mode, an on/off zone.
  Setpoint and mode commands off by default; "Off" needs no option, goes
  through a pause and past a refused login, and is enforced for two minutes
  after a setting that just left.
- Reads every 60 s (never sooner, kept across restarts), follow-up reads 5 s
  and 20 s after a command, pauses after a 429/5xx kept in /data, a refused
  login stopping the reads until the test button or a new login, the hub
  recognised by its unique id (a Scan adopts another hub).
- "Test the connection" button, status messages in English and French, docs
  en/fr.
- A command is a success only when the zone read back shows what was
  written; an override or a boost never keeps a setpoint of the hub outside
  the bounds; every "Off" is checked for two minutes and written again while
  the zone shows on, after a restart too.
- A page of zones or devices refused to an accepted login no longer stops
  the reads; a 503 says it may be the login, and a new login ends the pause;
  the configuration is read again when Gladys cannot give it at start.
- The fresh read of a command no longer waits behind a periodic read and
  checks the identity of the hub; a zone on the outside temperature
  publishes no temperature; a device channel takes the age of its node.
- A hub applying a command a little after its answer is no longer taken
  for a failure: the follow-up reads of 5 s and 20 s confirm the command,
  say when it was not applied or applied otherwise, and turn the zone off
  only for a new value beyond the bounds (with a status note of its own);
  the fresh read of the commands reads the identity and the zones together,
  two at most in flight; a read-back still showing the state of before is
  read once more 0.5 s later; one follow-up read per due time; an "Off"
  ends the check of a command left unconfirmed.

[Unreleased]: https://github.com/LM1LC3N7/gladys-genius-hub/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-genius-hub/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-genius-hub/releases/tag/v0.1.1
