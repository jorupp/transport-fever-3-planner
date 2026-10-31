import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOptions, compatible, DEFAULT_SETTINGS } from '../src/lib/planner.ts';
import data from '../src/data/tf3-vehicles.json' with { type: 'json' };

const passenger = data.cargos.find(c=>c.id==='PASSENGERS');
const cargo = [passenger];
const v = (overrides={}) => ({id:'engine',name:'Engine',source:'test',category:'train',carrier:'RAIL',modes:['TRAIN'],engineModes:['TRAIN'],yearFrom:1950,yearTo:null,length:20,speed:100,power:1000,tractiveEffort:100,weightEmpty:50000,weightMaxPayload:0,friction:0.02,engineType:'DIESEL',capacities:{},loadSpeed:2,comfort:50,noise:20,pollution:10,purchase:600000,running:100000,fixedFormation:false,...overrides});
const w = (overrides={}) => v({id:'wagon',name:'Wagon',length:10,power:0,tractiveEffort:0,engineModes:[],capacities:{PASSENGERS:20},weightEmpty:10000,weightMaxPayload:5000,...overrides});

test('one or two identical engines use exactly the maximum homogeneous wagon count',()=>{
  const rows=calculateOptions([v(),w()],cargo,{...DEFAULT_SETTINGS,trainLength:100});
  assert.deepEqual(rows.map(o=>[o.engines,o.wagons,o.length]),[[1,8,100],[2,6,100]]);
  for(const o of rows){assert(o.length+o.wagon.length>100);assert.equal(o.capacity,o.wagons*20);}
});
test('both parts must be simultaneously available, with inclusive boundary years',()=>{
  assert.equal(calculateOptions([v({yearTo:1992}),w({yearFrom:1993})],cargo,DEFAULT_SETTINGS).length,0);
  assert.equal(calculateOptions([v({yearTo:1992}),w({yearFrom:1992})],cargo,DEFAULT_SETTINGS).length,2);
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
  assert(sets.every(o=>o.wagon===null));assert.equal(sets.length,2);
  const road=v({carrier:'ROAD',category:'bus',modes:['BUS'],engineModes:['BUS'],capacities:{PASSENGERS:20},length:200});
  const rows=calculateOptions([road],cargo,{...DEFAULT_SETTINGS,trainLength:1,tramLength:1});
  assert.equal(rows.length,1);assert.equal(rows[0].engines,1);assert.equal(rows[0].mode,'road');
});
test('does not invent a cargo-carrying engine-only option or overlong formation',()=>{
  assert.equal(calculateOptions([v(),w()],cargo,{...DEFAULT_SETTINGS,trainLength:25}).length,0);
  assert.equal(calculateOptions([v({capacities:{PASSENGERS:20},length:30})],cargo,{...DEFAULT_SETTINGS,trainLength:25}).length,0);
});
test('a second engine improves estimated launch acceleration but doubles only its own cost',()=>{
  const rows=calculateOptions([v(),w()],cargo,DEFAULT_SETTINGS);
  assert(rows[1].acceleration>rows[0].acceleration);
  for(const o of rows){
    assert.equal(o.purchase,o.engines*600000+o.wagons*600000);
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
    assert.equal(row.capacity,20);assert.equal(row.length,20);assert.equal(row.speed,100);
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
    const settings={...DEFAULT_SETTINGS,year,extraYears:20,cargos:data.cargos.map(c=>c.id)};
    const start=performance.now();const rows=calculateOptions(data.vehicles,data.cargos,settings);
    assert.equal(new Set(rows.map(o=>o.id)).size,rows.length);
    for(const o of rows){
      const limit=o.mode==='train'?settings.trainLength:o.mode==='tram'?settings.tramLength:Infinity;
      assert(o.length<=limit+1e-6);assert(o.capacity>0);assert(o.yearFrom<=(o.yearTo??Infinity));
      assert(o.yearFrom<=year+20&&(o.yearTo??Infinity)>=year);
      assert(Number.isFinite(o.acceleration)&&o.acceleration>0);assert(Number.isFinite(o.costPerformance)&&o.costPerformance>0);
      if(o.wagon){assert(compatible(o.engine,o.wagon));assert(o.length+o.wagon.length>limit-1e-6);}
    }
    console.log(`${year}: ${rows.length} options in ${(performance.now()-start).toFixed(1)} ms`);
  }
});
