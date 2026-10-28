// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ACTIONS,
  HOT_WATER_SETPOINT,
  OVERRIDE_MINUTES,
  POLL_INTERVAL,
  ROOM_SETPOINT,
} from '../src/constants.js';
import { buildZoneDevice, buildHubDevice, capabilitiesOf } from '../src/devices.js';
import { parseDevices, parseZones } from '../src/model.js';
import { dataManagerPage, zonesPage } from './fixtures/genius.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const handlers = read('src/handlers.js');
const dockerfile = read('Dockerfile');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics; one version everywhere (the Release workflow owns it)', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-genius-hub:${manifest.version}`);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(pkg.name, 'gladys-genius-hub');
  assert.equal(pkg.license, 'Apache-2.0');
  assert.deepEqual(manifest.categories, ['climate']);
  assert.deepEqual(manifest.transports, ['local']);
  assert.match(manifest.gladys_version, />=\s*5\.1\.0/);
  assert.ok(!('keywords' in manifest) && !('countries' in manifest), 'Gladys 5.3 fields: later');
  assert.match(
    manifest.cover_image,
    /^https:\/\/raw\.githubusercontent\.com\/LM1LC3N7\/gladys-genius-hub\//,
  );
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /Non officiel/);
});

test('the cover is an 800 x 534 PNG', () => {
  const png = readFileSync(new URL('../cover.png', import.meta.url));
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 800);
  assert.equal(png.readUInt32BE(20), 534);
});

test('the docs say it was never tested with a real hub', () => {
  assert.match(read('docs/fr.md'), /[Jj]amais\s+testé\s+avec\s+un\s+vrai\s+(Genius\s+)?[Hh]ub/);
  assert.match(read('docs/en.md'), /[Nn]ever\s+tested\s+with\s+a\s+real\s+(Genius\s+)?[Hh]ub/);
  assert.match(read('README.md'), /[Nn]ever\s+tested\s+with\s+a\s+real\s+(Genius\s+)?[Hh]ub/);
});

test('every text is in English and French; placeholders too', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
  for (const field of manifest.config_schema) {
    if ('placeholder' in field) {
      assert.equal(typeof field.placeholder, 'object', `${field.key}.placeholder`);
    }
  }
});

test('the configuration matches the code: address, login, pace, options, ceilings', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  assert.deepEqual(Object.keys(fields), [
    'intro',
    'address',
    'username',
    'password',
    'poll_interval',
    'override_duration',
    'allow_setpoint',
    'allow_modes',
    'max_setpoint',
    'max_hot_water',
  ]);
  for (const key of Object.keys(fields)) {
    assert.ok(
      !key.startsWith('gladys_'),
      `${key}: a gladys_ key would never reach the integration`,
    );
  }
  assert.equal(fields.address.required, true);
  assert.equal(fields.username.required, true);
  assert.equal(fields.password.type, 'secret');
  assert.equal(fields.password.required, true);
  for (const field of manifest.config_schema.filter((f) => f.type === 'secret')) {
    assert.ok(!('default' in field), `${field.key}: never a default on a secret`);
  }
  assert.match(fields.password.description.en, /Kept by Gladys in its database, never shown again/);
  assert.deepEqual(
    [fields.poll_interval.default, fields.poll_interval.min, fields.poll_interval.max],
    [POLL_INTERVAL.default, POLL_INTERVAL.min, POLL_INTERVAL.max],
  );
  assert.deepEqual(
    [fields.override_duration.default, fields.override_duration.min, fields.override_duration.max],
    [OVERRIDE_MINUTES.default, OVERRIDE_MINUTES.min, OVERRIDE_MINUTES.max],
  );
  for (const key of ['allow_setpoint', 'allow_modes']) {
    assert.equal(fields[key].type, 'boolean');
    assert.equal(fields[key].default, false, `${key} is off by default`);
  }
  assert.deepEqual(
    [fields.max_setpoint.default, fields.max_setpoint.min, fields.max_setpoint.max],
    [ROOM_SETPOINT.defaultMax, ROOM_SETPOINT.min, ROOM_SETPOINT.max],
  );
  assert.deepEqual(
    [fields.max_hot_water.default, fields.max_hot_water.min, fields.max_hot_water.max],
    [HOT_WATER_SETPOINT.defaultMax, HOT_WATER_SETPOINT.min, HOT_WATER_SETPOINT.max],
  );
  assert.equal(HOT_WATER_SETPOINT.max, 65, 'never above 65 °C');
  assert.equal(HOT_WATER_SETPOINT.defaultMax, 65);
  for (const link of fields.intro.links) {
    assert.match(link.url, /^https:\/\//);
  }
});

test('the actions of the manifest are the handlers of the code', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  assert.ok(handlers.includes('onAction(ACTIONS.TEST'));
  assert.ok(handlers.includes('onSetValue'));
  assert.ok(handlers.includes('onDeviceCreated'));
  assert.ok(handlers.includes("on('connected'"));
  assert.ok(
    !('scene_triggers' in manifest) && !('scene_actions' in manifest) && !('widgets' in manifest),
  );
  const client = read('src/client.js');
  const code = client.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const word of ["'POST'", "'PUT'", "'DELETE'", 'https://', 'User-Agent', 'logger']) {
    assert.ok(!code.includes(word), `never ${word}`);
  }
});

test('the devices: core units only, labels are strings, no switch for a protective command', () => {
  const ids = {
    externalIds: (type, id) => ({
      device: `ext:genius-hub:${type}:${id}`,
      feature: (key) => `ext:genius-hub:${type}:${id}:${key}`,
    }),
  };
  const units = {
    'temperature-sensor': ['celsius'],
    thermostat: ['celsius', undefined],
    'water-heater': ['celsius', undefined],
    battery: ['percent'],
    'light-sensor': ['lux'],
    'motion-sensor': [undefined],
    'presence-sensor': [undefined],
    switch: [undefined],
    input: [undefined],
    text: [undefined],
  };
  const built = [
    ...parseZones(zonesPage()).map((z) => buildZoneDevice(ids, z, { uid: 'x' })),
    ...parseDevices(dataManagerPage()).map((d) =>
      buildHubDevice(ids, d, capabilitiesOf(d), { uid: 'x' }),
    ),
  ].filter(Boolean);
  assert.equal(built.length, 10);
  for (const device of built) {
    for (const feature of device.features) {
      assert.ok(units[feature.category], `${feature.external_id}: ${feature.category}`);
      assert.ok(units[feature.category].includes(feature.unit), feature.external_id);
      for (const option of feature.supported_options ?? []) {
        assert.equal(typeof option.label, 'string');
        assert.ok(option.label.trim().length > 0);
      }
      if (feature.category === 'switch' && device.external_id.includes(':device:')) {
        assert.equal(feature.read_only, true, 'a plug is never commanded');
      }
    }
  }
  const writable = built.flatMap((d) =>
    d.features.filter((f) => !f.read_only).map((f) => f.external_id),
  );
  assert.deepEqual(writable, [
    'ext:genius-hub:zone:1:setpoint',
    'ext:genius-hub:zone:1:heating-mode',
    'ext:genius-hub:zone:1:zone-mode',
    'ext:genius-hub:zone:2:setpoint',
    'ext:genius-hub:zone:2:heating-mode',
    'ext:genius-hub:zone:2:zone-mode',
    'ext:genius-hub:zone:3:setpoint',
    'ext:genius-hub:zone:3:heating-mode',
    'ext:genius-hub:zone:3:zone-mode',
    'ext:genius-hub:zone:4:setpoint',
    'ext:genius-hub:zone:4:water-mode',
    'ext:genius-hub:zone:5:state',
    'ext:genius-hub:zone:5:zone-mode',
  ]);
});

test('the licenses ship in the image; no name in LICENSE', () => {
  assert.match(dockerfile, /COPY LICENSE THIRD_PARTY_NOTICES\.md/);
  const license = read('LICENSE');
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/);
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /geniushub-client/);
  assert.match(notices, /Copyright \(c\) 2019 The Python Packaging Authority/);
  assert.match(notices, /MIT License/);
});

test('the code never feeds the energy endpoints nor scene events', () => {
  for (const file of ['index.js', 'src/app.js', 'src/devices.js', 'src/publisher.js']) {
    assert.doesNotMatch(read(file), /publishEnergyConsumption\(/, file);
    assert.doesNotMatch(read(file), /publishSceneEvent\(/, file);
  }
});
