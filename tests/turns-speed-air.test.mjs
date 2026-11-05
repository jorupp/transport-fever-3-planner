import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOptions, analyzeOption, DEFAULT_SETTINGS, sameFormationSettings } from '../src/lib/planner.ts';
import { createTurnJourney } from '../src/lib/turn-motion.ts';
import { readSavedConfigs } from '../src/lib/saved-configs.ts';
import data from '../src/data/tf3-vehicles.json' with { type:'json' };
import visuals from '../src/data/tf3-vehicle-visuals.json' with { type:'json' };

const settings={...DEFAULT_SETTINGS,year:2050,extraYears:0,includeObsolete:true,cargos:['PASSENGERS']};
const bus=data.vehicles.find(v=>v.carrier==='ROAD'&&v.capacities.PASSENGERS>0);
const row=(updates={})=>calculateOptions([bus],data.cargos,{...settings,...updates})[0];
const close=(a,b,tolerance=1e-8)=>assert(Math.abs(a-b)<tolerance,`${a} vs ${b}`);

test('turns halve actual short-route approach speeds at equal distance boundaries, preserving continuity',()=>{
  const route=createTurnJourney(400,3,1,1,100);
  assert.equal(route.sections.length,4);
  for(let i=0;i<route.sections.length;i++){
    const s=route.sections[i];
    close(s.accelerationDistance+s.cruiseDistance+s.brakingDistance,100);
    assert(s.speed<100,'the route is too short to reach the speed ceiling');
    if(i<3){
      close(s.exit,s.speed/2);
      close(route.sections[i+1].entry,s.exit);
      const end=route.sampleAtTime(s.startTime+s.time);
      close(end.distance,(i+1)*100);close(end.speed/3.6,s.exit);
    } else assert.equal(s.exit,0);
  }
  // Independent numeric integration of the sampled speed must recover distance.
  const dt=route.trip.time/100000;
  let integrated=0;
  for(let i=0;i<100000;i++) integrated+=route.sampleAtTime((i+.5)*dt).speed/3.6*dt;
  close(integrated,400,1e-5);
  close(route.sampleAtTime(route.trip.time).distance,400);
  assert.equal(route.sampleAtTime(route.trip.time).speed,0);
  const huge=createTurnJourney(10000,1e9,1,1,30);
  assert(huge.sections.length<100);assert(Number.isFinite(huge.trip.time));
});

test('turns are slower than uninterrupted travel, faster than full stops, and use consistent throughput/graph totals',()=>{
  const plain=row({distanceKm:2}),turning=row({distanceKm:2,turns:3}),stopping=row({distanceKm:2,additionalStops:3});
  assert(plain.averageSpeed>turning.averageSpeed);assert(turning.averageSpeed>stopping.averageSpeed);
  const a=analyzeOption(turning);
  close(turning.averageSpeed,turning.distanceKm*3600/a.trip.time);
  close(turning.throughput,turning.capacity*3600/a.totalTime);
  close(a.trip.accelerationDistance+a.trip.cruiseDistance+a.trip.brakingDistance,2000);
  assert.equal(a.loadingTime,analyzeOption(plain).loadingTime);
  for(const turns of [-1,1.5,NaN,Infinity]) assert.throws(()=>row({turns}),/Turns/);
  assert.throws(()=>row({turns:1,additionalStops:1}),/not both/);
});

test('trams in Road share the tram length limit and movement model; turns follow the carrier',()=>{
  const tram=data.vehicles.find(v=>v.carrier==='TRAM'&&v.capacities.PASSENGERS>0);
  const rows=calculateOptions([tram],data.cargos,{...settings,tramLength:1,trainLength:1,turns:2});
  assert.equal(rows.length,0,'trams respect the tram length limit in Road too');
  const road=calculateOptions([tram],data.cargos,{...settings,turns:2}).find(o=>o.mode==='road');
  const sameTram=calculateOptions([tram],data.cargos,{...settings,turns:2}).find(o=>o.mode==='tram'&&o.engines===1);
  close(road.throughput,sameTram.throughput);
  for(const carrier of ['RAIL','WATER','AIR']){
    const vehicle=data.vehicles.find(v=>v.carrier===carrier&&v.capacities.PASSENGERS>0&&v.engineModes.length>0&&(v.power>0||v.thrust>0)&&v.length<=155);
    const options=updates=>calculateOptions([vehicle],data.cargos,{...settings,...updates});
    const base=options({}),turned=options({turns:5});
    assert(base.length>0);assert.deepEqual(turned.map(o=>o.throughput),base.map(o=>o.throughput));
    assert(turned.every(o=>o.turns===0));
  }
});

test('speed limits cap all carriers, preserve rated speed/filter identity, and do not increase acceleration',()=>{
  for(const carrier of ['RAIL','TRAM','ROAD','WATER','AIR']){
    const vehicle=data.vehicles.find(v=>v.carrier===carrier&&v.capacities.PASSENGERS>0&&v.engineModes.length>0&&(v.power>0||v.thrust>0)&&v.length<=155);
    const options=updates=>calculateOptions([vehicle],data.cargos,{...settings,...updates});
    const base=options({})[0],limited=options({speedLimit:10})[0];
    assert.equal(limited.speed,base.speed);assert.equal(limited.effectiveSpeed,10);
    assert(limited.peakSpeed<=10+1e-9);assert(limited.averageSpeed<=10+1e-9);
    close(limited.acceleration,base.acceleration);
    assert(limited.timeTo1Km>base.timeTo1Km);
    const graph=analyzeOption(limited);
    close(limited.averageSpeed,limited.distanceKm*3600/graph.trip.time);
    assert(options({speedLimit:10,minTopSpeed:Math.floor(base.speed)}).length>0);
  }
  for(const speedLimit of [-1,NaN,Infinity]) assert.throws(()=>row({speedLimit}),/Speed limit/);
  assert(sameFormationSettings(settings,{...settings,turns:3,speedLimit:30}));
});

test('Road includes the same tram-and-wagon configurations as Tram, with identical metrics',()=>{
  const signature=o=>`${o.engine.id}:${o.engines}:${o.wagon?.id ?? 'self'}:${o.wagons}`;
  let wagonRows=0;
  for(const cargos of [['PASSENGERS'],['LOGS'],['LOGS','COAL']]){
    const plan={...settings,year:1960,tramLength:60,cargos,turns:3,speedLimit:40};
    const rows=calculateOptions(data.vehicles,data.cargos,plan);
    const trams=rows.filter(o=>o.mode==='tram');
    const roadTrams=rows.filter(o=>o.mode==='road'&&o.engine.carrier==='TRAM');
    assert.deepEqual(roadTrams.map(signature).sort(),trams.map(signature).sort());
    for(const road of roadTrams){
      const tram=trams.find(o=>signature(o)===signature(road));
      close(road.throughput,tram.throughput);close(road.averageSpeed,tram.averageSpeed);
      assert(road.length<=60+1e-6);
      if(road.wagon){
        wagonRows++;assert.equal(road.wagon.carrier,'TRAM');
        assert(road.length+road.wagon.length>60-1e-6,'maximum homogeneous wagon count');
      }
    }
    assert(rows.filter(o=>o.mode==='road'&&o.engine.carrier==='ROAD').every(o=>o.engines===1&&o.wagon===null));
  }
  assert(wagonRows>0,'the real TF3 catalog must exercise tram trailers');
});

test('airplane catalog, thrust model, artwork and saved performance settings round-trip',()=>{
  const planes=data.vehicles.filter(v=>v.carrier==='AIR');assert.equal(planes.length,30);
  const rows=data.cargos.flatMap(c=>calculateOptions(planes,data.cargos,{...settings,cargos:[c.id],trainLength:1,tramLength:1}));
  assert.equal(new Set(rows.map(o=>o.engine.id)).size,planes.length);
  for(const o of rows){
    assert.equal(o.mode,'airplane');assert.equal(o.engines,1);assert.equal(o.wagon,null);
    assert.equal(o.motionModel,'air-estimate');close(o.acceleration,o.engine.thrust/o.loadedMass);
    assert(visuals.vehicles[o.engine.id].image.startsWith('/vehicles/plane/'));
  }
  const config={id:'test',name:'Test',settings:{...settings,turns:2,speedLimit:70},checkedVehicles:['airplane:airbus_a320:1:~:0']};
  const read=c=>readSavedConfigs(JSON.stringify({version:1,configs:[c]}),data.cargos.map(c=>c.id));
  assert.equal(read(config)[0].settings.turns,2);assert.equal(read(config)[0].settings.speedLimit,70);
  assert.deepEqual(read(config)[0].checkedVehicles,config.checkedVehicles);
  assert.equal(read({...config,settings:{...config.settings,additionalStops:2}}).length,0);
  const legacy={...config,settings:{...settings}};delete legacy.settings.turns;delete legacy.settings.speedLimit;
  assert.equal(read(legacy)[0].settings.turns,0);assert.equal(read(legacy)[0].settings.speedLimit,0);
});
