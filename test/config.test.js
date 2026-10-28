// -----------------------------------------------------------------------------
// The configuration normalized: the address, the login, the pace, the
// options and the ceilings.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isComplete, normalizeConfig, parseAddress } from '../src/config.js';

test('the address: host, port, pasted URL, IPv6, refused forms', () => {
  assert.deepEqual(parseAddress(' 192.168.1.50 '), { address: '192.168.1.50' });
  assert.deepEqual(parseAddress('http://192.168.1.50:1223/v3/zones'), {
    address: '192.168.1.50:1223',
  });
  assert.deepEqual(parseAddress('Hub.Local:8080'), { address: 'hub.local:8080' });
  assert.deepEqual(parseAddress('[fe80::1]:1223'), { address: '[fe80::1]:1223' });
  assert.deepEqual(parseAddress('fe80::1'), { address: '[fe80::1]' });
  assert.deepEqual(parseAddress(''), { address: '' });
  assert.deepEqual(parseAddress('user:pw@host'), { error: 'invalid' });
  assert.deepEqual(parseAddress('host:70000'), { error: 'invalid' });
  assert.deepEqual(parseAddress('bad host'), { error: 'invalid' });
});

test('the defaults, the bounds, the flags', () => {
  const config = normalizeConfig({ address: '192.168.1.50', username: 'u', password: 'p' });
  assert.equal(config.pollInterval, 60);
  assert.equal(config.overrideMinutes, 60);
  assert.equal(config.allowSetpoint, false);
  assert.equal(config.allowModes, false);
  assert.equal(config.maxSetpoint, 25);
  assert.equal(config.maxHotWater, 65);
  assert.ok(isComplete(config));
  const set = normalizeConfig({
    address: '192.168.1.50',
    username: 'u',
    password: 'p',
    poll_interval: '120',
    override_duration: 30,
    allow_setpoint: 'true',
    allow_modes: true,
    max_setpoint: 22.5,
    max_hot_water: '50',
  });
  assert.equal(set.pollInterval, 120);
  assert.equal(set.overrideMinutes, 30);
  assert.equal(set.allowSetpoint, true);
  assert.equal(set.allowModes, true);
  assert.equal(set.maxSetpoint, 22.5);
  assert.equal(set.maxHotWater, 50);
  const out = normalizeConfig({
    poll_interval: 10,
    override_duration: 5000,
    max_setpoint: 40,
    max_hot_water: 70,
    allow_setpoint: 'yes',
  });
  assert.equal(out.pollInterval, 60);
  assert.equal(out.overrideMinutes, 60);
  assert.equal(out.maxSetpoint, 25);
  assert.equal(out.maxHotWater, 65, 'never above 65, the default when out of bounds');
  assert.equal(out.allowSetpoint, false);
  assert.equal(normalizeConfig({}).maxHotWater, 65, '65 °C by default');
  assert.equal(normalizeConfig({ max_hot_water: 65 }).maxHotWater, 65);
  assert.equal(normalizeConfig({ max_hot_water: 60 }).maxHotWater, 60);
  assert.equal(normalizeConfig({ max_hot_water: 66 }).maxHotWater, 65);
  assert.equal(normalizeConfig({ max_hot_water: 65.5 }).maxHotWater, 65, 'never above 65');
  assert.equal(normalizeConfig({ max_hot_water: 55.5 }).maxHotWater, 65, 'whole degrees');
});

test('the login: both fields, no ":" in the user name, no control byte; incomplete forms', () => {
  assert.equal(normalizeConfig({ address: 'h' }).login, null);
  assert.ok(!isComplete(normalizeConfig({ address: 'h' })));
  const half = normalizeConfig({ address: 'h', username: 'u' });
  assert.equal(half.login, null);
  assert.equal(half.invalidLogin, true);
  assert.equal(
    normalizeConfig({ address: 'h', username: 'a:b', password: 'p' }).invalidLogin,
    true,
  );
  assert.equal(
    normalizeConfig({ address: 'h', username: 'u', password: 'p\r\n' }).invalidLogin,
    true,
  );
  assert.equal(
    normalizeConfig({ address: 'h', username: 'u', password: 'x'.repeat(129) }).invalidLogin,
    true,
  );
  const bad = normalizeConfig({ address: 'bad host', username: 'u', password: 'p' });
  assert.equal(bad.address, '');
  assert.equal(bad.invalidAddress, true);
  assert.ok(!isComplete(bad));
});
