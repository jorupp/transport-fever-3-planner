import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeOption, calculateOptions, createRailMotion, DEFAULT_SETTINGS } from '../src/lib/planner.ts';
import data from '../src/data/tf3-vehicles.json' with { type: 'json' };

const settings={...DEFAULT_SETTINGS,year:1960,extraYears:0,cargos:['LOGS']};
const engine=data.vehicles.find(v=>v.name==='CLe 2/4 Roter Pfeil');
const wagon=data.vehicles.find(v=>v.name==='Cargo Car 1960');
const get=(overrides={})=>calculateOptions([engine,wagon],data.cargos,{...settings,...overrides}).find(o=>o.engines===1&&o.wagons===9);
const near=(actual,expected,tolerance=1e-6)=>assert(Math.abs(actual-expected)<tolerance,`${actual} vs ${expected}`);

test('modal breakdown exposes the actual traction/power transition and force balance',()=>{
  const o=get(), a=analyzeOption(o);
  assert.equal(a.power,315000); assert.equal(a.effort,45000); assert.equal(a.forceLimit,90000);
  assert.equal(a.mass,213000); near(a.resistance,.02); near(a.resistanceForce,4260);
  assert.equal(a.transitionSpeed,3.5); near(a.transitionTime,3.5/(90000/213000-.02));
  const launch=a.sampleAtTime(0);
  assert.equal(launch.phase,'Traction limited'); assert.equal(launch.powerUsed,0);
  assert.equal(launch.drivingForce,90000); near(launch.acceleration,90000/213000-.02);
  const curve=createRailMotion(a.mass,a.power,a.effort,o.speed/3.6,a.resistance);
  const sample=a.sampleAtTime(curve.atSpeed(50/3.6).time);
  assert.equal(sample.phase,'Power limited'); near(sample.speed,50);
  near(sample.drivingForce,22680,1e-3); near(sample.powerUsed,315000,1e-3);
  near(sample.netForce,18420,1e-3); near(sample.acceleration,18420/213000);
});

test('trip plot phases sum to the same distance, time and throughput as the worker result',()=>{
  const o=get(), a=analyzeOption(o), t=a.trip;
  near(t.accelerationDistance+t.cruiseDistance+t.brakingDistance,10000,1e-5);
  near(t.accelerationTime+t.cruiseTime+t.brakingTime,t.time);
  near(a.totalTime,t.time+120+120+2);
  near(o.capacity*3600/a.totalTime,o.throughput);
  near(a.annualizedCost/o.throughput,o.costPerformance);
  const brake=a.sampleAtTime(t.accelerationTime+t.cruiseTime+t.brakingTime/2);
  assert.equal(brake.phase,'Braking'); near(brake.acceleration,-2.5);
  near(brake.speed,o.peakSpeed/2); assert.equal(brake.powerUsed,0);
  const stopped=a.sampleAtTime(t.time); assert.equal(stopped.speed,0); near(stopped.distance,10000);
  let previous=0;
  for(let i=0;i<=180;i++) {
    const p=a.sampleAtTime(t.time*i/180);
    assert(p.distance>=previous-1e-5); assert(p.speed>=0&&p.speed<=o.peakSpeed+1e-5);
    previous=p.distance;
  }
});

test('short trips and uncalibrated road/tram graphs use their own movement models',()=>{
  const short=analyzeOption(get({distanceKm:.01}));
  assert.equal(short.transitionTime,null); near(short.trip.cruiseTime,0);
  assert(short.trip.speed<short.transitionSpeed);
  near(short.trip.accelerationDistance+short.trip.brakingDistance,10);
  const rows=calculateOptions(data.vehicles,data.cargos,{...DEFAULT_SETTINGS,cargos:['PASSENGERS']});
  for(const carrier of ['ROAD','TRAM']) {
    const o=rows.find(v=>v.engine.carrier===carrier), a=analyzeOption(o);
    assert.equal(a.rail,false); assert.equal(a.forceLimit,a.effort); assert.equal(a.resistance,0);
    near(a.sampleAtTime(a.trip.accelerationTime/2).speed,o.peakSpeed/2);
    near(o.capacity*3600/a.totalTime,o.throughput);
    near(a.sampleAtTime(a.trip.time).distance,o.distanceKm*1000);
  }
});

test('two locomotives sum their power and effort, with cruise power balancing resistance',()=>{
  const o=calculateOptions([engine,wagon],data.cargos,settings).find(v=>v.engines===2&&v.wagons===7);
  const a=analyzeOption(o);
  assert.equal(a.power,630000); assert.equal(a.effort,90000); assert.equal(a.forceLimit,180000);
  assert.equal(a.mass,206000); assert.equal(a.transitionSpeed,3.5);
  assert(a.trip.cruiseTime>0);
  const cruise=a.sampleAtTime(a.trip.accelerationTime+a.trip.cruiseTime/2);
  assert.equal(cruise.phase,'Cruising'); assert.equal(cruise.acceleration,0);
  near(cruise.drivingForce,a.resistanceForce);
  near(cruise.powerUsed,a.resistanceForce*o.peakSpeed/3.6);
  assert(cruise.powerUsed<a.power);
});
