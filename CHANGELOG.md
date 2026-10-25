# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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
