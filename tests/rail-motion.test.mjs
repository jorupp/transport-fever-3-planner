import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOptions, createRailMotion, DEFAULT_SETTINGS } from '../src/lib/planner.ts';
import data from '../src/data/tf3-vehicles.json' with { type: 'json' };
import observations from './fixtures/rail-runs.json' with { type: 'json' };
import brakingRun from './fixtures/rail-braking.json' with { type: 'json' };

test('calibrated rail curve matches all four loaded/empty TF3 recordings',()=>{
  const wagon=data.vehicles.find(v=>v.name==='Cargo Car 1960');
  for (const run of observations.runs) {
    const engine=data.vehicles.find(v=>v.name===run.engine);
    const settings={...DEFAULT_SETTINGS,year:1960,extraYears:0,cargos:[run.cargo]};
    const row=calculateOptions([engine,wagon],data.cargos,settings).find(o=>o.engines===1&&o.wagons===9);
    assert(row); assert.equal(row.capacity,135); assert.equal(row.motionModel,'calibrated-rail');
    assert.equal(row.motionMass,engine.weightEmpty+9*wagon.weightEmpty);
    const curve=createRailMotion(row.motionMass,engine.power*1000,engine.tractiveEffort*1000,row.speed/3.6,.02);
    for (const point of run.checkpoints) {
      const elapsed=point.timestampSeconds-run.startTimestampSeconds;
      const predicted=curve.launchAtDistance(point.km*1000);
      assert(Math.abs(row[`timeTo${point.km}Km`]-elapsed)<3.1,`${run.engine}, ${run.cargoUnits} logs, ${point.km} km: time ${row[`timeTo${point.km}Km`]} vs ${elapsed}`);
      assert(Math.abs(predicted.speed*3.6-point.speedKmh)<.6,`${run.engine}: speed ${predicted.speed*3.6} vs ${point.speedKmh}`);
    }
    const noPayload=calculateOptions([{...engine,weightMaxPayload:0},{...wagon,weightMaxPayload:0}],data.cargos,settings).find(o=>o.id===row.id);
    for (const key of ['acceleration','timeToMaxSpeed','distanceToMaxSpeed','timeTo1Km','timeTo5Km','peakSpeed','throughput']) assert.equal(row[key],noPayload[key],key);
    assert.equal(row.loadSpeed,1.125); // 135 logs still take 120 s to load and 120 s to unload.
    assert.equal(row.arrivalDelaySeconds,2);
    assert(Math.abs(row.throughput-135*3600/(curve.trip(10000).time+240+2))<1e-9);
  }
});

test('rail trip joins acceleration, cruising and braking continuously',()=>{
  // Constant 2 m/s² to 20 m/s: 10 s / 100 m. Braking at 1 m/s²: 20 s / 200 m.
  const curve=createRailMotion(10000,1000000,10000,20,0);
  assert.equal(curve.timeToMaxSpeed,10); assert.equal(curve.distanceToMaxSpeed,100);
  assert.equal(curve.launchAtDistance(1000).time,55);
  assert.equal(curve.trip(1000,1).time,65);
  const boundary=curve.trip(300,1); assert(Math.abs(boundary.time-30)<1e-6);
  const short=curve.trip(30,1);
  assert(Math.abs(short.speed-Math.sqrt(40))<1e-6);
  assert(Math.abs(short.time-(short.speed/2+short.speed))<1e-6);
  assert(short.speed<20);
});

test('rail force curve handles the power transition, tiny friction, and unreachable top speeds',()=>{
  const curve=createRailMotion(10000,50000,10000,20,0);
  assert(Math.abs(curve.timeToMaxSpeed-40.625)<1e-9);
  assert(Math.abs(curve.distanceToMaxSpeed-533.8541666666666)<1e-9);
  const tiny=createRailMotion(10000,50000,10000,20,1e-12);
  assert(Math.abs(tiny.timeToMaxSpeed-curve.timeToMaxSpeed)<1e-6);
  const limited=createRailMotion(10000,5000,10000,20,.1);
  assert.equal(limited.timeToMaxSpeed,null); assert.equal(limited.distanceToMaxSpeed,null);
  const sample=limited.launchAtDistance(5000);
  assert(Number.isFinite(sample.time)); assert(sample.speed<5);
  assert(Number.isFinite(limited.trip(5000).time));
  const stalled=createRailMotion(10000,5000,100,20,.1);
  assert.equal(stalled.initialAcceleration,0); assert.equal(stalled.launchAtDistance(1000).time,Infinity);
});

test('vehicle rail braking and destination arrival pause match the recorded station approach',()=>{
  const engine=data.vehicles.find(v=>v.name===brakingRun.engine);
  const wagon=data.vehicles.find(v=>v.name==='Cargo Car 1960');
  const rows=calculateOptions([engine,wagon],data.cargos,{...DEFAULT_SETTINGS,year:1960,extraYears:0,cargos:['LOGS']});
  const row=rows.find(o=>o.engines===1&&o.wagons===9);
  assert.equal(row.brakingAcceleration,2.5);
  assert.equal(row.arrivalDelaySeconds,brakingRun.loadingTimestampSeconds-brakingRun.stoppedTimestampSeconds);
  const samples=brakingRun.checkpoints.filter(p=>p.timestampSeconds>=brakingRun.brakeStartTimestampSeconds);
  const startSpeed=samples[0].speedKmh/3.6;
  assert(Math.abs(startSpeed/row.brakingAcceleration-(brakingRun.stoppedTimestampSeconds-brakingRun.brakeStartTimestampSeconds))<1);
  for (const sample of samples) {
    const predicted=Math.max(0,startSpeed-row.brakingAcceleration*(sample.timestampSeconds-brakingRun.brakeStartTimestampSeconds))*3.6;
    // Sampled once per video second: allow under half a second of speed change.
    assert(Math.abs(predicted-sample.speedKmh)<=4.5);
  }
  const entry=samples.filter(p=>p.timestampSeconds>=brakingRun.stationEntryTimestampSeconds);
  const integrated=entry.slice(1).reduce((sum,p,i)=>sum+(p.speedKmh+entry[i].speedKmh)/2/3.6*(p.timestampSeconds-entry[i].timestampSeconds),0);
  assert(Math.abs(integrated-brakingRun.stationLengthMeters)<10);
  assert.equal(row.brakingTime,row.peakSpeed/3.6/row.brakingAcceleration);
  assert.equal(row.brakingDistance,(row.peakSpeed/3.6)**2/(2*row.brakingAcceleration));
});

test('rail throughput uses formation braking, with the arrival pause counted once',()=>{
  const engine=data.vehicles.find(v=>v.name==='Swiss Re 4/4 I');
  const wagon=data.vehicles.find(v=>v.name==='Cargo Car 1960');
  const settings={...DEFAULT_SETTINGS,year:1960,extraYears:0,distanceKm:.2,cargos:['LOGS']};
  const get=w=>calculateOptions([engine,w],data.cargos,settings).find(o=>o.engines===1&&o.wagons===9);
  const normal=get(wagon),slow=get({...wagon,brakeDeceleration:1});
  assert.equal(slow.brakingAcceleration,1);
  assert(normal.peakSpeed>slow.peakSpeed); assert(normal.throughput>slow.throughput);
  const curve=createRailMotion(normal.motionMass,engine.power*1000,engine.tractiveEffort*1000,normal.speed/3.6,.02);
  assert(Math.abs(normal.throughput-135*3600/(curve.trip(200,2.5).time+240+2))<1e-9);
  // Uninterrupted acceleration checkpoints do not incorporate braking or the arrival pause.
  assert.equal(normal.timeTo1Km,slow.timeTo1Km); assert.equal(normal.timeTo5Km,slow.timeTo5Km);
});
