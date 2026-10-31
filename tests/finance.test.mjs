import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOptions, DEFAULT_SETTINGS, FINANCE_PRESETS } from '../src/lib/planner.ts';
import data from '../src/data/tf3-vehicles.json' with { type: 'json' };

const engine = data.vehicles.find(v => v.name === 'Swiss Re 4/4 I');
const wagon = data.vehicles.find(v => v.name === 'Cargo Car 1960');
const settings = { ...DEFAULT_SETTINGS, year: 1960, extraYears: 0, trainLength: engine.length + 9 * wagon.length + .01, cargos: [Object.keys(wagon.capacities)[0]] };
const option = finance => calculateOptions([engine, wagon], data.cargos, { ...settings, ...finance }).find(o => o.engines === 1);

test('Hard defaults reproduce the reported Swiss Re 4/4 I with nine Cargo Car 1960 costs', () => {
  const normal = option({ vehicleCostPercent: 100, maintenanceCostPercent: 100 });
  assert.equal(normal.wagons, 9);
  assert.equal(normal.purchase, 14069904);
  assert.equal(normal.running, 2344984);
  const hard = option({});
  assert.equal(hard.purchase, 17587380);
  assert.equal(hard.running, 2931230);
  assert.equal(hard.throughput, normal.throughput);
});

test('difficulty presets and independent finance sliders affect all cost metrics', () => {
  assert.deepEqual(FINANCE_PRESETS.map(p => [p.id, p.percent]), [['easy', 50], ['normal', 100], ['hard', 125], ['very-hard', 150]]);
  const normal = option({ vehicleCostPercent: 100, maintenanceCostPercent: 100 });
  for (const purchasePercent of [50, 75, 100, 125, 150]) for (const maintenancePercent of [50, 75, 100, 125, 150]) {
    const row = option({ vehicleCostPercent: purchasePercent, maintenanceCostPercent: maintenancePercent });
    assert.equal(row.purchase, Math.round(normal.purchase * purchasePercent / 100));
    assert.equal(row.running, Math.round(normal.running * maintenancePercent / 100));
    assert.equal(row.costPerformance, (row.running + row.purchase / 20) / row.throughput);
    assert.equal(row.timeToMaxSpeed, normal.timeToMaxSpeed);
  }
  for (const invalid of [-1, 60, 200, NaN, Infinity]) assert.throws(() => option({ vehicleCostPercent: invalid }), /Finance multipliers/);
});
