// -----------------------------------------------------------------------------
// The answers of the hub -> plain objects: the shapes of geniushub-client,
// hostile or odd values left out, other shapes refused.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  kindOf,
  parseDevices,
  parsePatch,
  parseRelease,
  parseZone,
  parseZones,
} from '../src/model.js';
import { ZONE_KIND } from '../src/constants.js';
import {
  NOW_SECONDS,
  ZONE,
  dataManagerPage,
  releasePage,
  zone,
  zonesPage,
} from './fixtures/genius.js';

test('zones: the kinds, the modes, the values of the fixtures', () => {
  const zones = parseZones(zonesPage());
  assert.equal(zones.length, 6);
  const byId = Object.fromEntries(zones.map((z) => [z.id, z]));
  assert.equal(byId[ZONE.MANAGER].kind, ZONE_KIND.MANAGER);
  assert.deepEqual(
    { ...byId[ZONE.LOUNGE], issues: undefined, buildDate: undefined },
    {
      id: 1,
      name: 'Lounge',
      kind: ZONE_KIND.RADIATOR,
      mode: 'timer',
      temperature: 20.5,
      usingWeather: false,
      setpoint: 21,
      on: undefined,
      overrideSetpoint: 0,
      overrideLeft: 0,
      hasPir: true,
      heating: 1,
      occupied: 1,
      issues: undefined,
      buildDate: undefined,
    },
  );
  assert.equal(byId[ZONE.KITCHEN].mode, 'off');
  assert.equal(byId[ZONE.KITCHEN].hasPir, false);
  assert.equal(byId[ZONE.KITCHEN].occupied, undefined);
  assert.deepEqual(byId[ZONE.KITCHEN].issues, [{ id: 'zone:using_weather_temp', level: 1 }]);
  assert.equal(byId[ZONE.KITCHEN].usingWeather, true);
  assert.equal(
    byId[ZONE.KITCHEN].temperature,
    undefined,
    'the outside temperature is not the room',
  );
  assert.equal(byId[ZONE.FLOOR].kind, ZONE_KIND.UNDERFLOOR);
  assert.equal(byId[ZONE.WATER].kind, ZONE_KIND.HOT_WATER);
  assert.equal(byId[ZONE.WATER].mode, 'override');
  assert.equal(byId[ZONE.WATER].overrideLeft, 1800);
  assert.equal(byId[ZONE.TOWEL].kind, ZONE_KIND.ON_OFF);
  assert.equal(byId[ZONE.TOWEL].setpoint, undefined);
  assert.equal(byId[ZONE.TOWEL].on, 1);
});

test('zones: a TPI zone of sub type 0 is an underfloor, the other sub types the hot water', () => {
  assert.equal(kindOf(5, 0), ZONE_KIND.UNDERFLOOR);
  assert.equal(kindOf(5, 1), ZONE_KIND.HOT_WATER);
  assert.equal(kindOf(4, 7), ZONE_KIND.UNDERFLOOR);
  assert.equal(kindOf(7, 0), ZONE_KIND.OPENTHERM);
  assert.equal(kindOf(99, 0), undefined);
});

test('zones: odd values are left out, odd zones and other shapes refused', () => {
  assert.equal(parseZones({ data: 'x' }), undefined);
  assert.equal(parseZones([]), undefined);
  assert.equal(parseZone({ iID: -1 }), undefined);
  assert.equal(parseZone({ iID: 1, iType: 42 }), undefined);
  const odd = parseZone(
    zone({
      fPV: 'warm',
      fSP: 500,
      iMode: 3,
      strName: 'A\u0000B',
      iBoostTimeRemaining: -5,
      lstIssues: 'x',
    }),
  );
  assert.equal(odd.temperature, undefined);
  assert.equal(odd.setpoint, undefined);
  assert.equal(odd.mode, 'unknown');
  assert.equal(odd.name, 'A B');
  assert.equal(odd.overrideLeft, 0);
  assert.deepEqual(odd.issues, []);
  assert.equal(parseZone(zone({ strName: '' })).name, 'Zone 1');
  const twice = parseZones(zonesPage([zone(), zone()]));
  assert.equal(twice.length, 1);
});

test('devices: the nodes and channels of data_manager, the hub and the weather left out', () => {
  const devices = parseDevices(dataManagerPage());
  assert.deepEqual(
    devices.map((d) => d.addr),
    ['2', '3', '4', '4-1', '5'],
  );
  const valve = devices[0];
  assert.equal(valve.model, 'Radiator Valve');
  assert.equal(valve.sku, 'DA-WRV-B');
  assert.equal(valve.zoneName, 'Lounge');
  assert.equal(valve.battery, 85);
  assert.equal(valve.temperature, 20.5);
  assert.equal(valve.setpoint, 21);
  assert.equal(valve.lastComms, NOW_SECONDS - 60);
  assert.equal(valve.minSetpoint, 4);
  assert.equal(valve.maxSetpoint, 28);
  const plug = devices[2];
  assert.equal(plug.output, 1);
  assert.equal(plug.battery, undefined);
  const channel = devices[3];
  assert.equal(channel.output, 1);
  assert.equal(channel.lastComms, plug.lastComms, 'a channel takes the lastComms of its node');
  assert.equal(channel.model, undefined);
  const pir = devices[4];
  assert.equal(pir.luminance, 120);
  assert.equal(pir.motion, 1);
});

test('devices: odd values are left out, odd addresses refused, other shapes refused', () => {
  assert.equal(parseDevices({ data: {} }), undefined);
  assert.equal(parseDevices(null), undefined);
  const page = dataManagerPage({
    bad: { addr: 'x y', childValues: {} },
    7: {
      addr: '7',
      childValues: { Battery: { val: 150 }, TEMPERATURE: { val: 'hot' }, lastComms: { val: -1 } },
    },
    __proto__: { addr: '8', childValues: {} },
  });
  const devices = parseDevices(page);
  assert.deepEqual(
    devices.map((d) => d.addr),
    ['7'],
  );
  assert.equal(devices[0].battery, undefined);
  assert.equal(devices[0].temperature, undefined);
  assert.equal(devices[0].lastComms, undefined);
  assert.equal(devices[0].model, undefined);
});

test('release and patch answers', () => {
  assert.deepEqual(parseRelease(releasePage()), { uid: 'ab:cd:ef:01:02:03', release: '5.3.6' });
  assert.equal(parseRelease({ data: { UID: 'bad uid!' } }), undefined);
  assert.equal(parseRelease({ data: { UID: 'x', release: 'a'.repeat(40) } }).release, undefined);
  assert.deepEqual(parsePatch({ error: 0, data: {} }), { ok: true, error: 0 });
  assert.deepEqual(parsePatch({ error: 5 }), { ok: false, error: 5 });
  assert.equal(parsePatch({}), undefined);
  assert.equal(parsePatch('ok'), undefined);
});
