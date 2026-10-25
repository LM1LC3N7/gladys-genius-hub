# Genius Hub for Gladys Assistant

Unofficial integration, not affiliated with Genius Hub (Heat Genius Ltd). It
reads a Genius Hub through its **local API** (port 1223 of the hub, no cloud)
and lets Gladys see and drive the heating zones of the house. **Never tested
with a real Genius Hub**: built from the public documentation and the
geniushub-client library, the one of Home Assistant. Please report what
differs on your hub.

## What you get

One Gladys device per **zone** of the hub:

| Zone kind                     | Read                                                                                                                     | Commands                                                                                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Radiator room, wet underfloor | temperature, setpoint, thermostat mode, heat demand, Genius mode, override left, occupancy (zones with a sensor), issues | setpoint, thermostat mode (off / heating), Genius mode (off, timer, footprint, override) |
| Hot water                     | water temperature, setpoint, hot water mode, heating, override left, issues                                              | setpoint, hot water mode (off / timer / override)                                        |
| On/off timer                  | on, Genius mode, override left, issues                                                                                   | on / off, Genius mode (off, timer, override)                                             |

And one **read-only** device per device behind the hub (radiator valve, room
thermostat, smart plug, receiver, motion or room sensor): temperature, valve
setpoint, battery, luminance, motion, output. The hub drives them from its
zones; Gladys never commands them. The "My House" manager zone, the groups
and the OpenTherm add-on are not offered.

## Configuration

1. Find the **IP address** of the hub (your router, or the Genius Hub app:
   Settings > Hub). Give it a fixed address in your router if you can.
2. Enter the **user name and password of the hub** (the ones of its local
   web interface, as asked by the hub itself; not the my.geniushub.co.uk
   account). The password is kept by Gladys in its database, never shown
   again, never logged, and sent only to the hub, as the hub asks (HTTP on
   your network, the password as a hash).
3. Save, then open the **Discover** tab and create the zones and devices you
   want.
4. Commands are **off by default**: turn on "Allow the setpoint commands"
   and/or "Allow the mode and on commands" when you want to drive the
   heating from Gladys. "Off" needs no option.

The hub is read every 60 s by default (never less), and the zones again 5 s
and 20 s after a command.

## Commands, in detail

- A **setpoint** sent from Gladys is an **override** of the zone for the
  configured duration (60 min by default, 10 to 1440), as the "boost" of the
  app; the zone then goes back to its timer or mode. Room setpoints: 4 to
  28 °C by half degrees, capped by "Highest room setpoint" (25 °C by
  default). Hot water: whole degrees, 30 to 60 °C, capped by "Highest hot
  water setpoint" (55 °C by default, 60 at most).
- **Thermostat mode**: "Heating" sets the zone to its timer; "Off" turns it
  off. **Genius mode**: off, timer, footprint (zones with an occupancy
  sensor only), override (the current setpoint for the configured
  duration). **Hot water mode**: off, timer, override (boost at the current
  setpoint). **On/off zone**: "on" is an override of the configured
  duration, "off" turns the zone off.
- Before a setpoint, a mode or an "on" leaves, the zones are read again:
  the command is decided on that fresh read, never on values in memory. It
  is refused, nothing sent, when: its option is off; the value is not valid
  or out of the bounds above; the hub does not list the zone, or lists it
  with another kind; another hub answers at the address (run a Scan to
  adopt it); the hub refuses the login; the hub asked to wait after an
  error (a pause); the zone is still handling a command or one left less
  than 2 s before; "Off" was sent to the zone less than 2 min before (see
  below); the hub took more than about 3 s to answer the fresh read. The
  message of the refusal says which.
- **"Off"** (thermostat mode, Genius mode, hot water mode or on/off state)
  needs no option, waits for no read, goes through a pause and past a
  refused login (one try), and cancels a setpoint or mode of the same zone
  not sent yet. It is refused, nothing sent, only when: the hub address or
  login is not set; the request could not leave within about 3 s (a write
  of the same zone still leaving, a hub that refuses the connection); the
  hub rejects it (error number in the message). When a setpoint or a mode
  of the zone left less than 2 min before the "Off", the hub may still apply
  it after: the "Off" is then **enforced** for 2 min (the follow-up reads
  write it again if the zone shows on, 3 times at most) and no command
  that would start the zone is taken meanwhile; the status says so.
- A write the hub did not answer (silence, dropped connection, server
  error) is told "sent, without confirmation": the next reads show whether
  the hub applied it. A write the hub answered is read back at once when
  the budget leaves time, and in any case 5 s and 20 s after.

## Values

- The values of a zone are published at every read. Those of a device
  behind the hub are published only when the device talked to the hub
  since the last values published (the hub gives the time of its last
  communication), and not when that was more than 2 h before: the status
  then counts those devices.
- Unchanged values are sent again every 30 min.

## Status and pauses

- A login refused by the hub (HTTP 401 or 403) stops the reads until you
  change it or click "Test the connection", which tries once more.
- After a 429 or a 5xx of the hub, the reads pause (1 min, doubled up to
  6 h, or the delay the hub asks), kept across restarts. An unreachable hub
  is tried again after 30 s, 1 min, 2 min... up to 10 min, never sooner
  than the read interval.
- The hub is recognised by its unique id. If another hub answers at the
  address, nothing is published to the devices of the former one until you
  run a Scan from the Discover tab, which adopts the new hub.

## Not in this version

The cloud API v1 (my.geniushub.co.uk), the schedules (timer and footprint
programmes), the "My House" manager zone and the house-wide modes, the
groups, the OpenTherm boiler add-on, the issues as separate devices,
commands on the devices themselves (plugs, valves). See `TODO.md`.
