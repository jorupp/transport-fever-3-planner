import test from 'node:test';
import assert from 'node:assert/strict';
import { readSavedConfigs } from '../src/lib/saved-configs.ts';
import { DEFAULT_SETTINGS, calculateOptions } from '../src/lib/planner.ts';
import { stableFormationId, stableVehicleId } from '../src/lib/formation-identity.ts';
import data from '../src/data/tf3-vehicles.json' with { type: 'json' };

const cargoIds = ['PASSENGERS', 'COAL'];
const config = { id: '1960-city', name: '1960s intra-city passenger', checkedVehicles: [], settings: { ...DEFAULT_SETTINGS, year: 1960, extraYears: 9, trainLength: 120, tramLength: 40, distanceKm: 2.5, additionalStops: 0, paybackYears: 20, minTopSpeed: 50, cargos: ['PASSENGERS'], vehicleCostPercent: 125, maintenanceCostPercent: 125 } };
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
  delete legacySettings.includeObsolete;
  delete legacySettings.additionalStops;
  delete legacySettings.paybackYears;
  delete legacySettings.vehicleCostPercent;
  delete legacySettings.maintenanceCostPercent;
  assert.deepEqual(readSavedConfigs(stored([{ ...config, settings: legacySettings }]), cargoIds), [config]);
  const custom = { ...config, settings: { ...config.settings, vehicleCostPercent: 75, maintenanceCostPercent: 150, includeObsolete: true } };
  assert.deepEqual(readSavedConfigs(stored([custom]), cargoIds), [custom]);
  assert.deepEqual(readSavedConfigs(stored([{ ...config, settings: { ...config.settings, includeObsolete: "true" } }]), cargoIds), []);
  for (const invalid of [0, 60, 151, '125']) assert.deepEqual(readSavedConfigs(stored([{ ...config, settings: { ...config.settings, vehicleCostPercent: invalid } }]), cargoIds), []);
});

test('checked formations round-trip across all tabs; legacy or malformed checks load safely', () => {
  const checkedVehicles = ['train:swiss_re_44_i:1:cargo_car_1960:9', 'tram:toyama_8000:2:~:0', 'road:aboag:1:~:0'];
  const saved = { ...config, checkedVehicles };
  assert.deepEqual(readSavedConfigs(stored([saved]), cargoIds), [saved]);
  const legacy = { ...config }; delete legacy.checkedVehicles;
  assert.deepEqual(readSavedConfigs(stored([legacy]), cargoIds), [config]);
  for (const value of [null, 'broken', {}]) {
    assert.deepEqual(readSavedConfigs(stored([{ ...config, checkedVehicles: value }]), cargoIds), [config]);
  }
  assert.deepEqual(readSavedConfigs(stored([{ ...saved, checkedVehicles: [...checkedVehicles, checkedVehicles[0], null, 5, 'bad', 'road:aboag:0:~:0'] }]), cargoIds)[0].checkedVehicles, checkedVehicles);
});

test('formation identities use unique model filenames and counts, surviving catalog path and stat updates', () => {
  const ids = data.vehicles.map(stableVehicleId);
  assert.equal(new Set(ids).size, ids.length, 'model filenames must be unique across the catalog');
  assert(ids.includes('aboag')); assert(ids.includes('american_post_coach'));
  const settings = { ...DEFAULT_SETTINGS, year: 1960, extraYears: 0, cargos: ['LOGS'] };
  const engine = data.vehicles.find(v => v.name === 'Swiss Re 4/4 I');
  const wagon = data.vehicles.find(v => v.name === 'Cargo Car 1960');
  const rows = calculateOptions([engine, wagon], data.cargos, settings);
  const checked = rows.find(o => o.engines === 1);
  const saved = { ...config, checkedVehicles: [stableFormationId(checked)] };
  const restored = new Set(readSavedConfigs(stored([saved]), cargoIds)[0].checkedVehicles);
  const moved = v => ({ ...v, id: `updated/models/${v.id.split('/').pop()}`, name: `Renamed ${v.name}`, purchase: v.purchase * 2 });
  const updated = calculateOptions([moved(engine), moved(wagon)], data.cargos, { ...settings, distanceKm: 2, additionalStops: 2 });
  assert.equal(updated.filter(o => restored.has(stableFormationId(o))).length, 1);
  assert(restored.has(stableFormationId(updated.find(o => o.engines === 1))));
  for (const change of [{ engines: 2 }, { wagons: checked.wagons - 1 }, { wagon: null, wagons: 0 }, { mode: 'tram' }]) {
    assert(!restored.has(stableFormationId({ ...checked, ...change })));
  }
  assert.equal(stableVehicleId({ id: '', name: 'Swiss Re 4/4 I' }), 'name-swissre44i');
});
