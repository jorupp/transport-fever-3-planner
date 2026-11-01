import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOptions, analyzeOption, DEFAULT_SETTINGS, sameFormationSettings, formationLoadingFactors } from '../src/lib/planner.ts';
import data from '../src/data/tf3-vehicles.json' with { type: 'json' };
import loadingRun from './fixtures/loading-run.json' with { type: 'json' };
import followUps from './fixtures/loading-follow-ups.json' with { type: 'json' };

const engine=data.vehicles.find(v=>v.name==='Swiss Re 4/4 I');
const wagon=data.vehicles.find(v=>v.name==='Cargo Car 1960');
const settings={...DEFAULT_SETTINGS,year:1960,extraYears:0,cargos:['LOGS']};
const option=overrides=>calculateOptions([engine,wagon],data.cargos,{...settings,...overrides}).find(o=>o.engines===1);

test('the measured 135-log loading scenario takes 120 seconds at normal speed and a 1x station',()=>{
  assert.equal(engine.name,loadingRun.engine);assert.equal(wagon.name,loadingRun.wagon);
  const row=option();
  assert.equal(row.cargo,loadingRun.cargo);assert.equal(row.wagons,loadingRun.wagonCount);
  assert.equal(row.capacity,loadingRun.units);assert.equal(wagon.loadSpeed,loadingRun.vehicleLoadingRating);
  assert.equal(row.loadSpeed,loadingRun.units/loadingRun.loadingSeconds);
  const a=analyzeOption(row);
  assert.equal(a.cargoLoadFactor,.0625);
  assert.equal(a.loadingTime,loadingRun.loadingSeconds);
  assert.equal(a.unloadingTime,loadingRun.loadingSeconds);
});

test('identical wagons load in parallel: more wagons increase rate and capacity equally',()=>{
  const nine=option(),short=option({trainLength:100});
  assert.equal(nine.wagons,9);assert(short.wagons<9);
  assert.equal(nine.loadSpeed,1.125);assert.equal(short.loadSpeed,short.wagons*.125);
  assert.equal(analyzeOption(nine).loadingTime,120);
  assert.equal(analyzeOption(short).loadingTime,analyzeOption(nine).loadingTime);
  const carryingEngine={...engine,capacities:{LOGS:10},loadSpeed:1};
  const rows=calculateOptions([carryingEngine,wagon],data.cargos,settings).filter(o=>o.wagon);
  assert.deepEqual(rows.map(o=>o.engines),[1,2,3,4,5]);
  assert(rows.every(o=>o.loadSpeed===(o.engines+o.wagons)*.0625));
});

test('parallel loading matches both follow-up loading intervals within timestamp precision',()=>{
  for(const run of followUps.runs){
    const car=data.vehicles.find(v=>v.name===run.wagon);
    assert.equal(car.loadSpeed,run.vehicleLoadingRating);
    // The test did not specify its engine. Use the same non-cargo locomotive
    // only to create the requested homogeneous wagon count, not to fit the rate.
    const trainLength=engine.length+run.wagonCount*car.length+.001;
    const row=optionFor(car,trainLength);
    assert.equal(row.wagons,run.wagonCount);assert.equal(row.capacity,run.capacity);
    const units=run.fullCargo.units-run.firstCargo.units;
    const observed=run.fullCargo.timestampSeconds-run.firstCargo.timestampSeconds;
    const predicted=units/row.loadSpeed;
    assert(Math.abs(predicted-observed)<=1.1,`${run.wagon}: ${predicted} vs ${observed}`);

  }
  function optionFor(car,trainLength){
    return calculateOptions([engine,car],data.cargos,{...settings,trainLength}).find(o=>o.engines===1);
  }
});

test('parallel loading counts only vehicles carrying the selected cargo',()=>{
  const ordinary=formationLoadingFactors(engine,wagon,2,9,'LOGS');
  assert.equal(ordinary.carryingVehicleCount,9);
  assert.equal(ordinary.parallelBaseRate,18);
  const carryingEngine={...engine,capacities:{LOGS:10},loadSpeed:1};
  const mixed=formationLoadingFactors(carryingEngine,wagon,2,3,'LOGS');
  assert.equal(mixed.carryingVehicleCount,5);assert.equal(mixed.baseRate,1);assert.equal(mixed.parallelBaseRate,5);
});

test('1899 defaults to 1x and 1913 explicitly defines 2x; their rates scale by wagon count',()=>{
  const old=data.vehicles.find(v=>v.name==='Cargo Car 1899');
  const next=data.vehicles.find(v=>v.name==='Cargo Car 1913');
  assert.equal(old.loadSpeed,1);assert.equal(old.loadSpeedSource,'default');
  assert.equal(next.loadSpeed,2);assert.equal(next.loadSpeedSource,'explicit');
  const rows=calculateOptions([engine,old,next],data.cargos,{...settings,year:1950});
  assert(rows.filter(o=>o.wagon===old).every(o=>o.loadSpeed===o.wagons*.0625));
  assert(rows.filter(o=>o.wagon===next).every(o=>o.loadSpeed===o.wagons*.125));
});

test('payback changes annualized cost without changing the formation or performance',()=>{
  const standard=option(),five=option({paybackYears:5});
  assert.equal(standard.paybackYears,20);assert.equal(five.paybackYears,5);
  for(const key of ['id','engines','wagons','capacity','purchase','running','throughput','averageSpeed']) assert.equal(standard[key],five[key],key);
  assert.equal(five.costPerformance,(five.running+five.purchase/5)/five.throughput);
  assert.equal(analyzeOption(five).annualizedCost,five.running+five.purchase/5);
  assert(five.costPerformance>standard.costPerformance);
  for(const paybackYears of [0,-1,NaN,Infinity,'5']) assert.throws(()=>option({paybackYears}),/payback period/);
});

test('filters and performance preserve formation identity; only lengths and cargo reset selections',()=>{
  for(const update of [{year:1950},{extraYears:10},{includeObsolete:true},{distanceKm:3},{additionalStops:5},{minTopSpeed:150},{paybackYears:5},{vehicleCostPercent:75},{maintenanceCostPercent:150}]) {
    assert(sameFormationSettings(settings,{...settings,...update}));
  }
  for(const update of [{trainLength:200},{tramLength:80},{cargos:['COAL']}]) {
    assert(!sameFormationSettings(settings,{...settings,...update}));
  }
  assert(sameFormationSettings({...settings,cargos:['LOGS','COAL']},{...settings,cargos:['COAL','LOGS','COAL']}));
  const selected=option();
  assert.equal(option({distanceKm:3,additionalStops:2,paybackYears:5}).id,selected.id);
  assert.equal(option({minTopSpeed:200}),undefined);
  assert.equal(option({minTopSpeed:0}).id,selected.id);
});
