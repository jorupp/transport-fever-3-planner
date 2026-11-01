import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOptions, analyzeOption, DEFAULT_SETTINGS } from '../src/lib/planner.ts';
import { stableFormationId } from '../src/lib/formation-identity.ts';
import data from '../src/data/tf3-vehicles.json' with { type: 'json' };
import visuals from '../src/data/tf3-vehicle-visuals.json' with { type: 'json' };

const boats = data.vehicles.filter(v => v.carrier === 'WATER');
const settings = {...DEFAULT_SETTINGS,year:2025,extraYears:10,includeObsolete:true,trainLength:1,tramLength:1};

test('all extracted TF3 boats have artwork and generate single vessels without length limits',()=>{
  assert.equal(boats.length,27);
  const rows=data.cargos.flatMap(c=>calculateOptions(boats,data.cargos,{...settings,cargos:[c.id]}));
  assert.deepEqual(new Set(rows.map(o=>o.engine.id)),new Set(boats.map(v=>v.id)));
  for(const row of rows){
    assert.equal(row.mode,'boat');assert.equal(row.engines,1);assert.equal(row.wagon,null);assert.equal(row.wagons,0);
    assert(row.length>1,'boats must ignore both length limits');
    assert.equal(row.capacity,row.engine.capacities[row.cargo]);
    assert.equal(row.motionModel,'water-estimate');
    assert(row.acceleration>0&&Number.isFinite(row.timeToMaxSpeed));
    assert.equal(row.purchase,Math.round(row.engine.purchase*1.25));
    const visual=visuals.vehicles[row.engine.id];assert(visual);
    assert(visual.image.startsWith('/vehicles/ship/'));
  }
});

test('boats require every selected cargo and obey year, obsolete and speed filters',()=>{
  const selected={...settings,cargos:['LOGS','COAL']};
  const rows=calculateOptions(boats,data.cargos,selected);assert(rows.length>0);
  assert.equal(new Set(rows.map(o=>o.id)).size,rows.length);
  assert(rows.every(o=>o.engine.capacities.LOGS>0&&o.engine.capacities.COAL>0));
  assert.equal(calculateOptions(boats,data.cargos,{...selected,minTopSpeed:999}).length,0);
  const current=calculateOptions(boats,data.cargos,{...selected,includeObsolete:false,year:1960,extraYears:0});
  assert(current.every(o=>o.engine.yearFrom<=1960&&(o.engine.yearTo===null||o.engine.yearTo>=1960)));
  assert(!current.some(o=>o.engine.yearFrom>1960));
});

test('boat power estimate, repeated stops, analysis graph and payback use consistent metrics',()=>{
  const boat=boats.find(v=>v.name==='Baltica');
  const calculate=overrides=>calculateOptions([boat],data.cargos,{...settings,cargos:['LOGS'],...overrides})[0];
  const row=calculate({distanceKm:12,additionalStops:3});
  const a=boat.power*1000/(row.loadedMass*Math.max(row.speed/7.2,1));
  assert.equal(row.acceleration,a);assert.equal(row.performanceAcceleration,a);
  assert.equal(row.timeToMaxSpeed,(row.speed/3.6)/a);
  const segment=calculate({distanceKm:3,additionalStops:0});
  assert.equal(row.averageSpeed,segment.averageSpeed);
  const analysis=analyzeOption(row);
  assert.equal(analysis.rail,false);assert.equal(analysis.segmentCount,4);
  assert(Math.abs(row.throughput-row.capacity*3600/analysis.totalTime)<1e-9);
  const endpoint=analysis.sampleAtTime(analysis.trip.time);
  assert.equal(endpoint.speed,0);assert.equal(endpoint.distance,12000);
  assert.equal(stableFormationId(row),stableFormationId(calculate({distanceKm:5,paybackYears:5})));
  assert(calculate({paybackYears:5}).costPerformance>calculate({paybackYears:20}).costPerformance);
});
