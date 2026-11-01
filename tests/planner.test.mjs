import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOptions, compatible, DEFAULT_SETTINGS, isMultipleUnitMenuVehicle } from '../src/lib/planner.ts';
import data from '../src/data/tf3-vehicles.json' with { type: 'json' };

const passenger = data.cargos.find(c=>c.id==='PASSENGERS');
const cargo = [passenger];
const v = (overrides={}) => ({id:'engine',name:'Engine',source:'test',category:'train',carrier:'RAIL',modes:['TRAIN'],engineModes:['TRAIN'],yearFrom:1950,yearTo:null,length:20,speed:100,power:1000,tractiveEffort:100,weightEmpty:50000,weightMaxPayload:0,friction:0.02,engineType:'DIESEL',capacities:{},loadSpeed:2,comfort:50,noise:20,pollution:10,purchase:600000,running:100000,fixedFormation:false,...overrides});
const w = (overrides={}) => v({id:'wagon',name:'Wagon',length:10,power:0,tractiveEffort:0,engineModes:[],capacities:{PASSENGERS:20},weightEmpty:10000,weightMaxPayload:5000,...overrides});

test('Multiple units menu tags follow powered rail capacity, including single railcars',()=>{
  const find = name => { const vehicle = data.vehicles.find(v=>v.name===name); assert(vehicle); return vehicle; };
  assert.equal(isMultipleUnitMenuVehicle(find('CLe 2/4 Roter Pfeil')),true);
  assert.equal(isMultipleUnitMenuVehicle(find('Swiss Re 4/4 I')),false);
  assert.equal(isMultipleUnitMenuVehicle(find('EMD F-Unit')),false,'a fixed locomotive formation has no carrying capacity');
  assert.equal(isMultipleUnitMenuVehicle(find('Toyama 8000')),false,'tram capacity does not put a tram in the rail Multiple units section');
  assert.equal(isMultipleUnitMenuVehicle(w()),false,'unpowered passenger cars are not multiple units');
});

test('one or two identical engines use exactly the maximum homogeneous wagon count',()=>{
  const rows=calculateOptions([v(),w()],cargo,{...DEFAULT_SETTINGS,trainLength:100});
  assert.deepEqual(rows.map(o=>[o.engines,o.wagons,o.length]),[[1,8,100],[2,6,100]]);
  for(const o of rows){assert(o.length+o.wagon.length>100);assert.equal(o.capacity,o.wagons*20);}
});
test('both parts must be simultaneously available, with inclusive boundary years',()=>{
  assert.equal(calculateOptions([v({yearTo:1992}),w({yearFrom:1993})],cargo,DEFAULT_SETTINGS).length,0);
  assert.equal(calculateOptions([v({yearTo:1992}),w({yearFrom:1992})],cargo,DEFAULT_SETTINGS).length,2);
});

test('include obsolete allows earlier stock without a shared purchase window, but excludes future introductions',()=>{
  const old=v({yearFrom:1900,yearTo:1930}),newCar=w({yearFrom:1960});
  const settings={...DEFAULT_SETTINGS,year:1960,extraYears:0,includeObsolete:true};
  assert.equal(calculateOptions([old,newCar],cargo,{...settings,includeObsolete:false}).length,0);
  const rows=calculateOptions([old,newCar],cargo,settings);
  assert.equal(rows.length,2);
  assert(rows.every(o=>o.yearFrom===1960&&o.yearTo===1930&&!o.availableAtStart&&!o.availableAtEnd&&!o.fullRange));
  assert.equal(calculateOptions([old,{...newCar,yearFrom:1961}],cargo,settings).length,0);
  assert.equal(calculateOptions([{...old,yearFrom:1961,yearTo:null},newCar],cargo,settings).length,0);
  const windowRows=calculateOptions([old,{...newCar,yearFrom:1961}],cargo,{...settings,extraYears:1});
  assert.equal(windowRows.length,2,'end-year introductions remain included');
  const bus=v({id:'old-bus',carrier:'ROAD',engineModes:['ROAD'],yearFrom:1900,yearTo:1930,capacities:{PASSENGERS:10}});
  assert.equal(calculateOptions([bus],cargo,settings).length,1);
  assert.equal(calculateOptions([bus],cargo,{...settings,includeObsolete:false}).length,0);
});

test('Atlantic with Cargo Car 1960 survives filter round trips with the same checked identity',async()=>{
  const {stableFormationId}=await import('../src/lib/formation-identity.ts');
  const engine=data.vehicles.find(v=>v.name==='4-4-2 Atlantic');
  const car=data.vehicles.find(v=>v.name==='Cargo Car 1960');
  assert(engine);assert(car);
  const settings={...DEFAULT_SETTINGS,year:1960,extraYears:0,cargos:['LOGS'],includeObsolete:true};
  const initial=calculateOptions([engine,car],data.cargos,settings);
  assert.equal(initial.length,2);
  const checked=new Set(initial.map(stableFormationId));
  for(const filters of [{includeObsolete:false},{year:1959},{minTopSpeed:999}]) {
    assert.equal(calculateOptions([engine,car],data.cargos,{...settings,...filters}).filter(o=>checked.has(stableFormationId(o))).length,0);
  }
  const restored=calculateOptions([engine,car],data.cargos,{...settings,distanceKm:3,additionalStops:2,paybackYears:5});
  assert.equal(restored.filter(o=>checked.has(stableFormationId(o))).length,2);
});
test('future arrivals are dim candidates and partial intervals never count as full coverage',()=>{
  const [later]=calculateOptions([v({yearFrom:1995}),w()],cargo,DEFAULT_SETTINGS);
  assert.equal(later.availableAtStart,false);assert.equal(later.availableAtEnd,true);assert.equal(later.fullRange,false);
  const [retiring]=calculateOptions([v({yearTo:1995}),w()],cargo,DEFAULT_SETTINGS);
  assert.equal(retiring.availableAtStart,true);assert.equal(retiring.availableAtEnd,false);assert.equal(retiring.fullRange,false);
  const [singleYear]=calculateOptions([v({yearTo:1990}),w()],cargo,{...DEFAULT_SETTINGS,extraYears:0});
  assert.equal(singleYear.fullRange,true);assert.equal(singleYear.availableAtEnd,true);
  const [middleOnly]=calculateOptions([v({yearFrom:1992,yearTo:1998}),w()],cargo,DEFAULT_SETTINGS);
  assert.equal(middleOnly.availableAtStart,false);assert.equal(middleOnly.availableAtEnd,false);
  const [endBoundary]=calculateOptions([v({yearFrom:1995,yearTo:2000}),w()],cargo,DEFAULT_SETTINGS);
  assert.equal(endBoundary.availableAtEnd,true);
});
test('light rail appears in both tabs and cannot couple to railway wagons',()=>{
  const engine=v({carrier:'TRAM',category:'tram',engineModes:['ELECTRIC_TRAM','ELECTRIC_TRAM_TRACK'],modes:['TRAM','ELECTRIC_TRAM','TRAM_TRACK','ELECTRIC_TRAM_TRACK'],capacities:{PASSENGERS:10}});
  assert.equal(compatible(engine,w()),false);
  const rows=calculateOptions([engine,w()],cargo,DEFAULT_SETTINGS);
  assert.deepEqual([...new Set(rows.map(o=>o.mode))],['train','tram']);
  assert(rows.every(o=>o.wagon===null));
  const tramCar=w({carrier:'TRAM',category:'tram',modes:['TRAM','ELECTRIC_TRAM']});
  const withCars=calculateOptions([engine,tramCar,w()],cargo,DEFAULT_SETTINGS);
  assert(withCars.filter(o=>o.mode==='tram').every(o=>o.wagon?.carrier==='TRAM'));
  assert(withCars.filter(o=>o.mode==='train').every(o=>o.wagon===null),'rail-ineligible trailers must not enter light-rail formations');
  assert(withCars.filter(o=>o.mode==='tram').every(o=>o.length<=DEFAULT_SETTINGS.tramLength));
});
test('fixed passenger sets stay intact; road vehicles remain single vehicles',()=>{
  const fixed=v({fixedFormation:true,capacities:{PASSENGERS:100},length:80});
  const sets=calculateOptions([fixed,w()],cargo,{...DEFAULT_SETTINGS,trainLength:200});
  assert(sets.every(o=>o.wagon===null));assert.equal(sets.length,1);assert.equal(sets[0].engines,2);
  const road=v({carrier:'ROAD',category:'bus',modes:['BUS'],engineModes:['BUS'],capacities:{PASSENGERS:20},length:200});
  const rows=calculateOptions([road],cargo,{...DEFAULT_SETTINGS,trainLength:1,tramLength:1});
  assert.equal(rows.length,1);assert.equal(rows[0].engines,1);assert.equal(rows[0].mode,'road');
});

test('multiple units haul maximum wagons with one through five units; locomotives remain capped at two',()=>{
  const unit=v({capacities:{PASSENGERS:20},length:20,yearFrom:1995,yearTo:1998});
  const coach=w();
  const all=calculateOptions([unit,coach],cargo,{...DEFAULT_SETTINGS,trainLength:130});
  const rows=all.filter(o=>o.wagon);
  assert.deepEqual(all.filter(o=>!o.wagon).map(o=>o.engines),[6]);
  assert.deepEqual(rows.map(o=>[o.engines,o.wagons]),[[1,11],[2,9],[3,7],[4,5],[5,3]]);
  assert.equal(new Set(rows.map(o=>o.id)).size,rows.length);
  for(const row of rows){
    assert.equal(row.wagon,coach);assert.equal(row.length,130);
    assert.equal(row.capacity,row.engines*20+row.wagons*20);
    assert.equal(row.purchase,Math.round((row.engines*unit.purchase+row.wagons*coach.purchase)*1.25));
    assert.equal(row.running,Math.round((row.engines*unit.running+row.wagons*coach.running)*1.25));
    assert.equal(row.loadSpeed,Math.min(unit.loadSpeed,coach.loadSpeed)*passenger.loadSpeedFactor*(row.engines+row.wagons));
    assert.equal(row.noise,row.engines*unit.noise+row.wagons*coach.noise);
    assert.equal(row.pollution,row.engines*unit.pollution+row.wagons*coach.pollution);
    assert.equal(row.availableAtStart,false);assert.equal(row.availableAtEnd,false);
    assert(row.averageSpeed>0&&row.throughput>0);
  }
  assert.deepEqual(calculateOptions([unit,coach],cargo,{...DEFAULT_SETTINGS,trainLength:100}).filter(o=>o.wagon).map(o=>o.engines),[1,2,3,4]);
  assert.deepEqual(calculateOptions([v(),coach],cargo,{...DEFAULT_SETTINGS,trainLength:130}).map(o=>o.engines),[1,2]);
  assert.deepEqual(calculateOptions([unit],cargo,{...DEFAULT_SETTINGS,trainLength:130}).map(o=>o.engines),[6]);
  assert.equal(calculateOptions([unit,coach],cargo,{...DEFAULT_SETTINGS,minTopSpeed:101}).length,0);
});

test('authored passenger sets show only the maximum number of complete sets',()=>{
  const unit=v({fixedFormation:true,capacities:{PASSENGERS:100},length:50});
  const rows=calculateOptions([unit,w()],cargo,{...DEFAULT_SETTINGS,trainLength:400});
  assert.deepEqual(rows.map(o=>[o.engines,o.wagons,o.length,o.capacity]),[[8,0,400,800]]);
  assert(rows.every(o=>o.wagon===null));
});

test('real Roter Pfeil offers one through five units with coaches and freight wagons',()=>{
  const unit=data.vehicles.find(v=>v.name==='CLe 2/4 Roter Pfeil');
  for(const [name,cargoId] of [['Chinese Type YZ 22','PASSENGERS'],['Cargo Car 1960','LOGS']]){
    const wagon=data.vehicles.find(v=>v.name===name);
    const all=calculateOptions([unit,wagon],data.cargos,{...DEFAULT_SETTINGS,year:1960,extraYears:0,cargos:[cargoId]});
    const rows=all.filter(o=>o.wagon);
    assert.deepEqual(all.filter(o=>!o.wagon).map(o=>o.engines),cargoId==='PASSENGERS'?[6]:[]);
    assert.deepEqual(rows.map(o=>o.engines),[1,2,3,4,5]);
    assert(rows.every(o=>o.wagon===wagon&&o.wagons>=1&&o.length<=155));
    assert(rows.every(o=>o.length+wagon.length>155));
  }
});

test('multiple-unit-only formations fill the limit and sum emissions for every unit',()=>{
  const unit=v({capacities:{PASSENGERS:20},length:20});
  for(const [limit,count] of [[19,0],[20,1],[39.9,1],[40,2],[155,7],[400,20]]){
    const rows=calculateOptions([unit],cargo,{...DEFAULT_SETTINGS,trainLength:limit});
    assert.equal(rows.length,count?1:0);
    if(!count) continue;
    const [row]=rows;
    assert.equal(row.engines,count);assert.equal(row.wagons,0);assert.equal(row.wagon,null);
    assert.equal(row.noise,count*unit.noise);assert.equal(row.pollution,count*unit.pollution);
    assert.equal(row.capacity,count*20);assert.equal(row.length,count*20);
    assert(row.length<=limit&&row.length+unit.length>limit);
  }
});

test('does not invent a cargo-carrying engine-only option or overlong formation',()=>{
  assert.equal(calculateOptions([v(),w()],cargo,{...DEFAULT_SETTINGS,trainLength:25}).length,0);
  assert.equal(calculateOptions([v({capacities:{PASSENGERS:20},length:30})],cargo,{...DEFAULT_SETTINGS,trainLength:25}).length,0);
});
test('a second engine improves estimated launch acceleration but doubles only its own cost',()=>{
  const rows=calculateOptions([v(),w()],cargo,DEFAULT_SETTINGS);
  assert(rows[1].acceleration>rows[0].acceleration);
  for(const o of rows){
    assert.equal(o.purchase,(o.engines*600000+o.wagons*600000)*1.25);
    assert.equal(o.noise,o.engines*20+o.wagons*20);
    assert(o.throughput>0&&Number.isFinite(o.costPerformance));
    assert.equal(o.costPerformance,(o.running+o.purchase/20)/o.throughput);
  }
});
test('an engine does not load unselected cargo when hauling freight wagons',()=>{
  const coal=data.cargos.find(c=>c.id==='COAL');
  const engine=v({capacities:{PASSENGERS:10},weightMaxPayload:5000});
  const wagon=w({capacities:{COAL:20},weightMaxPayload:10000});
  const [row]=calculateOptions([engine,wagon],[coal],{...DEFAULT_SETTINGS,trainLength:100,cargos:['COAL']});
  assert.equal(row.loadedMass,50000+8*(10000+10000*coal.weightFactor));
  assert.equal(row.comfort,null);
});
test('trip distance changes throughput and cost per performance without changing the formation',()=>{
  const engine=v({capacities:{PASSENGERS:20}});
  const option=distanceKm=>calculateOptions([engine],cargo,{...DEFAULT_SETTINGS,distanceKm})[0];
  const short=option(0.01), normal=option(10), long=option(100);
  assert(short.throughput>normal.throughput&&normal.throughput>long.throughput);
  assert(short.costPerformance<normal.costPerformance&&normal.costPerformance<long.costPerformance);
  for(const row of [short,normal,long]){
    assert.equal(row.capacity,140);assert.equal(row.length,140);assert.equal(row.speed,100);
    assert(Number.isFinite(row.throughput)&&row.throughput>0);
  }
  assert.equal(long.distanceKm,100);
});
test('trip distance must be finite and positive',()=>{
  for(const distanceKm of [0,-1,NaN,Infinity]){
    assert.throws(()=>calculateOptions([],cargo,{...DEFAULT_SETTINGS,distanceKm}),/Trip distance/);
  }
});
test('minimum top speed applies to the slowest component and matches displayed km/h',()=>{
  const vehicles=[v({speed:120}),w({speed:79.999})];
  const options=minTopSpeed=>calculateOptions(vehicles,cargo,{...DEFAULT_SETTINGS,minTopSpeed});
  assert.equal(options(0).length,2);
  assert.equal(options(80).length,2);
  assert.deepEqual(options(80).map(o=>o.engines),[1,2]);
  assert.equal(options(81).length,0);
  assert.equal(options(100).length,0,'a fast engine must not mask a slower wagon');
  const road=v({carrier:'ROAD',category:'bus',modes:['BUS'],engineModes:['BUS'],capacities:{PASSENGERS:20},speed:90});
  assert.equal(calculateOptions([road],cargo,{...DEFAULT_SETTINGS,minTopSpeed:91}).length,0);
  assert.equal(calculateOptions([road],cargo,{...DEFAULT_SETTINGS,minTopSpeed:90}).length,1);
  for(const minTopSpeed of [-1,NaN,Infinity]){
    assert.throws(()=>options(minTopSpeed),/Minimum top speed/);
  }
});
test('uncalibrated tram time and distance retain the existing constant estimate', () => {
  const engine = v({ carrier: 'TRAM', category: 'tram', modes: ['TRAM'], engineModes: ['TRAM'], speed: 72, weightEmpty: 10000, weightMaxPayload: 0, tractiveEffort: 10, power: 1000, capacities: { PASSENGERS: 20 } });
  const [tractionLimited] = calculateOptions([engine], cargo, DEFAULT_SETTINGS);
  assert.equal(tractionLimited.acceleration, 1);
  assert.equal(tractionLimited.performanceAcceleration, 1);
  assert.equal(tractionLimited.timeToMaxSpeed, 20);
  assert.equal(tractionLimited.distanceToMaxSpeed, 200);
  assert.equal(tractionLimited.peakSpeed, 72);
  const powered = { ...engine, power: 50 };
  const [powerLimited] = calculateOptions([powered], cargo, DEFAULT_SETTINGS);
  assert.equal(powerLimited.acceleration, 1, 'initial traction-based acceleration is unchanged');
  assert.equal(powerLimited.performanceAcceleration, .5);
  assert.equal(powerLimited.timeToMaxSpeed, 40);
  assert.equal(powerLimited.distanceToMaxSpeed, 400);
  const [short] = calculateOptions([powered], cargo, { ...DEFAULT_SETTINGS, distanceKm: .01 });
  assert.equal(short.timeToMaxSpeed, 40, 'theoretical launch-to-max metrics do not depend on the trip length');
  assert.equal(short.distanceToMaxSpeed, 400);
  assert(short.peakSpeed < short.speed, 'braking on a short trip prevents reaching max speed');
});

test('distance checkpoint times accelerate from rest then cruise, independently of trip length',()=>{
  const engine = v({ speed: 72, weightEmpty: 10000, weightMaxPayload: 0, tractiveEffort: 5, power: 1000, friction: 0, capacities: { PASSENGERS: 20 } });
  const [cruising] = calculateOptions([engine],cargo,DEFAULT_SETTINGS);
  // 20 seconds and 200 m accelerating to 20 m/s, then cruise the remaining distance.
  assert.deepEqual([1,2,3,4,5].map(km=>cruising[`timeTo${km}Km`]),[60,110,160,210,260]);
  const [slow] = calculateOptions([{...engine, tractiveEffort: .25}],cargo,DEFAULT_SETTINGS);
  // At .05 m/s², top speed is reached at 4 km. Earlier markers are still accelerating.
  for (const km of [1,2,3]) assert(Math.abs(slow[`timeTo${km}Km`]-Math.sqrt(2*km*1000/.05))<1e-6);
  assert(Math.abs(slow.timeTo4Km-400)<1e-6);
  assert(Math.abs(slow.timeTo5Km-450)<1e-6);
  const [short] = calculateOptions([engine],cargo,{...DEFAULT_SETTINGS,distanceKm:.01});
  for (const km of [1,2,3,4,5]) assert.equal(short[`timeTo${km}Km`],cruising[`timeTo${km}Km`]);
});

test('real TF3 catalog invariants across multiple eras and every cargo',()=>{
  assert.equal(data.game,'Transport Fever 3');assert.equal(data.vehicles.length,data.counts.vehicles);
  assert.equal(new Set(data.vehicles.map(v=>v.id)).size,data.vehicles.length);
  for(const vehicle of data.vehicles){
    assert(!vehicle.name.startsWith('VEHICLE_'),vehicle.id);
    for(const key of ['length','speed','power','tractiveEffort','weightEmpty','weightMaxPayload','loadSpeed','comfort','noise','pollution','purchase','running'])assert(Number.isFinite(vehicle[key])&&vehicle[key]>=0,`${vehicle.id}: ${key}`);
  }
  const parts=new Set(data.vehicles.flatMap(v=>v.parts?.map(p=>p.source)??[]));
  assert(data.vehicles.every(v=>!parts.has(v.id)),'MU parts must not leak into independently purchasable equipment');
  for(const year of [1850,1900,1950,1990,2020]){
    const settings={...DEFAULT_SETTINGS,year,extraYears:20};
    const start=performance.now();const rows=data.cargos.flatMap(c=>calculateOptions(data.vehicles,data.cargos,{...settings,cargos:[c.id]}));
    assert.equal(new Set(rows.map(o=>`${o.id}:${o.cargo}`)).size,rows.length);
    for(const o of rows){
      const limit=o.mode==='train'?settings.trainLength:o.mode==='tram'?settings.tramLength:Infinity;
      assert(o.length<=limit+1e-6);assert(o.capacity>0);assert(o.yearFrom<=(o.yearTo??Infinity));
      assert(o.yearFrom<=year+20&&(o.yearTo??Infinity)>=year);
      assert(Number.isFinite(o.acceleration)&&o.acceleration>0);assert(Number.isFinite(o.costPerformance)&&o.costPerformance>0);
      assert(o.timeToMaxSpeed===null||(Number.isFinite(o.timeToMaxSpeed)&&o.timeToMaxSpeed>0));assert(o.distanceToMaxSpeed===null||(Number.isFinite(o.distanceToMaxSpeed)&&o.distanceToMaxSpeed>0));
      for(const km of [1,2,3,4,5]) assert(Number.isFinite(o[`timeTo${km}Km`])&&o[`timeTo${km}Km`]>0);
      if(o.wagon){assert(compatible(o.engine,o.wagon));assert(o.length+o.wagon.length>limit-1e-6);}
    }
    console.log(`${year}: ${rows.length} options in ${(performance.now()-start).toFixed(1)} ms`);
  }
});
