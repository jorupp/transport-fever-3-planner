import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOptions, DEFAULT_SETTINGS } from '../src/lib/planner.ts';
import data from '../src/data/tf3-vehicles.json' with { type: 'json' };

const cargos = [
  { id: 'A', name: 'A', classes: [], weightFactor: 1, loadSpeedFactor: 1 },
  { id: 'B', name: 'B', classes: [], weightFactor: 2, loadSpeedFactor: .25 },
];
const engine = (overrides = {}) => ({ id: 'engine', name: 'Engine', source: 'test', category: 'train', carrier: 'RAIL', modes: ['TRAIN'], engineModes: ['TRAIN'], yearFrom: 1950, yearTo: null, length: 20, speed: 100, power: 1000, tractiveEffort: 100, weightEmpty: 50000, weightMaxPayload: 0, friction: .02, engineType: 'DIESEL', capacities: {}, loadSpeed: 2, comfort: 50, noise: 20, pollution: 10, purchase: 600000, running: 100000, fixedFormation: false, ...overrides });
const wagon = (overrides = {}) => engine({ id: 'wagon', name: 'Wagon', length: 10, power: 0, tractiveEffort: 0, engineModes: [], capacities: { A: 20, B: 20 }, weightEmpty: 10000, weightMaxPayload: 10000, ...overrides });
const settings = { ...DEFAULT_SETTINGS, trainLength: 100, cargos: ['A', 'B'] };

test('all selected cargos must be supported by the same wagon, with one row per formation', () => {
  const onlyA = wagon({ id: 'only-a', capacities: { A: 20 } });
  const onlyB = wagon({ id: 'only-b', capacities: { B: 20 } });
  const rows = calculateOptions([engine(), wagon(), onlyA, onlyB], cargos, settings);
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map(o => o.id)).size, 2);
  assert.deepEqual(rows.map(o => [o.engines, o.wagons]), [[1, 8], [2, 6]]);
  assert(rows.every(o => o.wagon.id === 'wagon'));
  assert(rows.every(o => o.cargos.join(',') === 'A,B'));
  assert.equal(calculateOptions([engine({ capacities: { A: 5 } }), onlyB], cargos, settings).length, 0,
    'a partial wagon cannot qualify by combining different engine and wagon cargo support');
});

test('multi-cargo metrics use a consistent lowest-throughput load, independent of selection order', () => {
  const vehicles = [engine(), wagon({ capacities: { A: 20, B: 15 } })];
  const calculate = selected => calculateOptions(vehicles, cargos, { ...settings, cargos: selected });
  const rows = calculate(['A', 'B']);
  const a = calculate(['A']), b = calculate(['B']);
  for (const row of rows) {
    const loads = [a.find(o => o.id === row.id), b.find(o => o.id === row.id)];
    const worst = loads.reduce((x, y) => x.throughput <= y.throughput ? x : y);
    assert.equal(row.throughput, Math.min(...loads.map(o => o.throughput)));
    assert.equal(row.costPerformance, Math.max(...loads.map(o => o.costPerformance)));
    for (const key of ['cargo', 'capacity', 'acceleration', 'loadedMass', 'loadSpeed', 'comfort']) assert.equal(row[key], worst[key], key);
  }
  assert.deepEqual(calculate(['B', 'A', 'A']), rows);
  assert.equal(calculate([]).length, 0);
  assert.equal(calculate(['A', 'MISSING']).length, 0);
});

test('road and fixed vehicles must support every cargo themselves and do not repeat for each cargo', () => {
  const road = engine({ id: 'truck', carrier: 'ROAD', modes: ['TRUCK'], engineModes: ['TRUCK'], capacities: { A: 20, B: 20 } });
  const fixed = engine({ id: 'set', fixedFormation: true, capacities: { A: 20, B: 20 } });
  const partial = engine({ id: 'partial', carrier: 'ROAD', modes: ['TRUCK'], engineModes: ['TRUCK'], capacities: { A: 20 } });
  const rows = calculateOptions([road, fixed, partial], cargos, settings);
  assert.equal(rows.filter(o => o.engine.id === 'truck').length, 1);
  assert.equal(rows.filter(o => o.engine.id === 'set').length, 2);
  assert(rows.every(o => o.wagon === null && o.cargos.length === 2));
  assert(!rows.some(o => o.engine.id === 'partial'));
});

test('real TF3 liquid-cargo selection yields unique formations supporting all three liquids', () => {
  const selected = ['CHEMICALS', 'CRUDE_OIL', 'FUEL'];
  const rows = calculateOptions(data.vehicles, data.cargos, { ...settings, trainLength: 155, year: 1950, extraYears: 30, cargos: selected });
  assert(rows.length > 0);
  assert.equal(new Set(rows.map(o => o.id)).size, rows.length);
  assert(rows.some(o => o.wagon?.name === 'Tank Car 1950'));
  for (const row of rows) assert(selected.every(id => (row.wagon ?? row.engine).capacities[id] > 0));
});
