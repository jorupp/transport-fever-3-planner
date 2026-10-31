import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeOption, calculateOptions, DEFAULT_SETTINGS } from '../src/lib/planner.ts';
import data from '../src/data/tf3-vehicles.json' with { type: 'json' };

const settings={...DEFAULT_SETTINGS,year:1960,extraYears:0,cargos:['LOGS']};
const engine=data.vehicles.find(v=>v.name==='CLe 2/4 Roter Pfeil');
const wagon=data.vehicles.find(v=>v.name==='Cargo Car 1960');
const calculate=(distanceKm,additionalStops)=>calculateOptions([engine,wagon],data.cargos,{...settings,distanceKm,additionalStops}).find(o=>o.engines===1&&o.wagons===9);
const near=(a,b,tolerance=1e-6)=>assert(Math.abs(a-b)<tolerance,`${a} vs ${b}`);

test('12 km with three additional stops is four 3 km runs, with endpoint handling only once',()=>{
  const multi=calculate(12,3),single=calculate(3,0),uninterrupted=calculate(12,0);
  const a=analyzeOption(multi),b=analyzeOption(single);
  assert.equal(multi.additionalStops,3); assert.equal(a.segmentCount,4); assert.equal(a.segmentDistance,3000);
  near(a.trip.time,4*b.trip.time); near(multi.peakSpeed,single.peakSpeed);
  near(a.totalTime,4*b.trip.time+120+120+2);
  near(multi.throughput,135*3600/a.totalTime);
  near(multi.averageSpeed,12*3600/a.trip.time);
  near(multi.averageSpeed,single.averageSpeed);
  assert(multi.averageSpeed<uninterrupted.averageSpeed);
  assert(multi.averageSpeed<multi.peakSpeed);
  assert.equal(a.loadingTime,120); assert.equal(a.arrivalTime,2);
  assert(multi.throughput<uninterrupted.throughput);
  assert(multi.costPerformance>uninterrupted.costPerformance);
  for(const km of [1,2,3,4,5]) assert.equal(multi[`timeTo${km}Km`],uninterrupted[`timeTo${km}Km`]);
});

test('whole-journey graph stops at each equal boundary and immediately restarts',()=>{
  const a=analyzeOption(calculate(12,3));
  for(let i=1;i<=3;i++) {
    const t=i*a.segment.time;
    const stop=a.sampleAtTime(t); near(stop.speed,0); near(stop.distance,i*3000);
    const after=a.sampleAtTime(t+.01);
    assert(after.speed>0); assert(after.distance>i*3000); assert.equal(after.segment,i+1);
    assert.equal(after.phase,'Traction limited');
  }
  const last=a.sampleAtTime(a.trip.time); near(last.distance,12000); assert.equal(last.speed,0);
  near(a.trip.accelerationDistance+a.trip.cruiseDistance+a.trip.brakingDistance,12000,1e-5);
  near(a.trip.accelerationTime+a.trip.cruiseTime+a.trip.brakingTime,a.trip.time);
});

test('tram and road estimates also repeat complete rest-to-rest segments',()=>{
  const multi=calculateOptions(data.vehicles,data.cargos,{...settings,distanceKm:12,additionalStops:3});
  const singles=calculateOptions(data.vehicles,data.cargos,{...settings,distanceKm:3,additionalStops:0});
  for(const carrier of ['TRAM','ROAD']) {
    const row=multi.find(o=>o.engine.carrier===carrier),one=singles.find(o=>o.id===row.id);
    const a=analyzeOption(row),b=analyzeOption(one);
    near(a.trip.time,4*b.trip.time); near(row.peakSpeed,one.peakSpeed);
    near(row.throughput,row.capacity*3600/(a.trip.time+2*a.loadingTime+a.arrivalTime));
    near(row.averageSpeed,12*3600/a.trip.time);
    near(row.averageSpeed,one.averageSpeed);
  }
});

test('omitted stops preserve old results, invalid counts are rejected, and large counts stay finite',()=>{
  assert.deepEqual(calculate(12,undefined),calculate(12,0));
  for(const count of [-1,.5,NaN,Infinity,'3',Number.MAX_SAFE_INTEGER]) {
    assert.throws(()=>calculate(12,count),/Additional stops/);
  }
  const many=calculate(12,1000000);
  assert(Number.isFinite(many.throughput)&&many.throughput>0);
  near(analyzeOption(many).trip.time,1000001*analyzeOption(many).segment.time);
});
