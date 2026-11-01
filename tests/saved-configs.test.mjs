import test from 'node:test';
import assert from 'node:assert/strict';
import { readSavedConfigs } from '../src/lib/saved-configs.ts';
import { DEFAULT_SETTINGS } from '../src/lib/planner.ts';

const cargoIds = ['PASSENGERS', 'COAL'];
const config = { id: '1960-city', name: '1960s intra-city passenger', settings: { ...DEFAULT_SETTINGS, year: 1960, extraYears: 9, trainLength: 120, tramLength: 40, distanceKm: 2.5, additionalStops: 0, paybackYears: 20, minTopSpeed: 50, cargos: ['PASSENGERS'], vehicleCostPercent: 125, maintenanceCostPercent: 125 } };
const stored = configs => JSON.stringify({ version: 1, configs });

test('saved configurations round-trip every planner setting and preserve multiple named entries', () => {
  const second = { ...config, id: '1980-cargo', name: '1980s cross-map cargo', settings: { ...config.settings, year: 1980, distanceKm: 35, additionalStops: 3, paybackYears: 5, cargos: ['COAL'] } };
  assert.deepEqual(readSavedConfigs(stored([config, second]), cargoIds), [config, second]);
  assert.deepEqual(readSavedConfigs(null, cargoIds), []);
});

test('corrupt or unsupported storage is rejected instead of being trusted as settings', () => {
  for (const raw of ['broken JSON', 'null', '{}', '{"version":2,"configs":[]}']) {
    assert.throws(() => readSavedConfigs(raw, cargoIds));
  }
  const invalid = [
    null, {}, { ...config, name: '  ' },
    ...[{ year: 1799 }, { extraYears: -1 }, { trainLength: 0 }, { tramLength: 501 }, { distanceKm: 0 }, { minTopSpeed: -1 }, { additionalStops: -1 }, { additionalStops: 1.5 }, { additionalStops: '3' }, { additionalStops: 9007199254740991 }, { paybackYears: 0 }, { paybackYears: -2 }, { paybackYears: '20' }, { year: '1960' }, { cargos: [] }].map(settings => ({ ...config, settings: { ...config.settings, ...settings } })),
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

test('legacy configurations default to Hard and independent custom finance values round-trip', () => {
  const legacySettings = { ...config.settings };
  delete legacySettings.additionalStops;
  delete legacySettings.paybackYears;
  delete legacySettings.vehicleCostPercent;
  delete legacySettings.maintenanceCostPercent;
  assert.deepEqual(readSavedConfigs(stored([{ ...config, settings: legacySettings }]), cargoIds), [config]);
  const custom = { ...config, settings: { ...config.settings, vehicleCostPercent: 75, maintenanceCostPercent: 150 } };
  assert.deepEqual(readSavedConfigs(stored([custom]), cargoIds), [custom]);
  for (const invalid of [0, 60, 151, '125']) assert.deepEqual(readSavedConfigs(stored([{ ...config, settings: { ...config.settings, vehicleCostPercent: invalid } }]), cargoIds), []);
});
