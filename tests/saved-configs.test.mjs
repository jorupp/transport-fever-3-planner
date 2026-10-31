import test from 'node:test';
import assert from 'node:assert/strict';
import { readSavedConfigs } from '../src/lib/saved-configs.ts';
import { DEFAULT_SETTINGS } from '../src/lib/planner.ts';

const cargoIds = ['PASSENGERS', 'COAL'];
const config = { id: '1960-city', name: '1960s intra-city passenger', settings: { ...DEFAULT_SETTINGS, year: 1960, extraYears: 9, trainLength: 120, tramLength: 40, distanceKm: 2.5, minTopSpeed: 50, cargos: ['PASSENGERS'] } };
const stored = configs => JSON.stringify({ version: 1, configs });

test('saved configurations round-trip every planner setting and preserve multiple named entries', () => {
  const second = { ...config, id: '1980-cargo', name: '1980s cross-map cargo', settings: { ...config.settings, year: 1980, distanceKm: 35, cargos: ['COAL'] } };
  assert.deepEqual(readSavedConfigs(stored([config, second]), cargoIds), [config, second]);
  assert.deepEqual(readSavedConfigs(null, cargoIds), []);
});

test('corrupt or unsupported storage is rejected instead of being trusted as settings', () => {
  for (const raw of ['broken JSON', 'null', '{}', '{"version":2,"configs":[]}']) {
    assert.throws(() => readSavedConfigs(raw, cargoIds));
  }
  const invalid = [
    null, {}, { ...config, name: '  ' },
    ...[{ year: 1799 }, { extraYears: -1 }, { trainLength: 0 }, { tramLength: 501 }, { distanceKm: 0 }, { minTopSpeed: -1 }, { year: '1960' }, { cargos: [] }].map(settings => ({ ...config, settings: { ...config.settings, ...settings } })),
  ];
  assert.deepEqual(readSavedConfigs(stored([...invalid, config]), cargoIds), [config]);
});

test('catalog changes remove unknown cargo IDs and configs with no supported cargo', () => {
  const mixed = { ...config, settings: { ...config.settings, cargos: ['COAL', 'REMOVED', 'COAL', 5] } };
  assert.deepEqual(readSavedConfigs(stored([mixed]), cargoIds)[0].settings.cargos, ['COAL']);
  assert.deepEqual(readSavedConfigs(stored([config]), ['COAL']), []);
});

test('duplicate IDs or names cannot make a saved selection ambiguous', () => {
  const duplicateName = { ...config, id: 'other', name: ` ${config.name.toUpperCase()} ` };
  assert.deepEqual(readSavedConfigs(stored([config, duplicateName, { ...config, name: 'Other' }]), cargoIds), [config]);
});
