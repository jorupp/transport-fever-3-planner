import { createTurnJourney } from "./turn-motion.ts";

export type Vehicle = {
  id: string; name: string; source: string; category: string; carrier: string;
  modes: string[]; engineModes: string[]; yearFrom: number; yearTo: number | null;
  length: number; speed: number; power: number; tractiveEffort: number;
  weightEmpty: number; weightMaxPayload: number; friction: number; engineType: string | null;
  brakeDeceleration?: number;
  thrust?: number; timeToFullThrust?: number;
  capacities: Record<string, number>; loadSpeed: number; comfort: number; noise: number;
  loadSpeedSource?: string;
  pollution: number; purchase: number; running: number; fixedFormation: boolean;
  parts?: { name: string; source: string }[];
};
export type Cargo = { id: string; name: string; classes: string[]; weightFactor: number; loadSpeedFactor: number };
export type Mode = "train" | "tram" | "road" | "boat" | "airplane";
export const MODES: Mode[] = ["train", "tram", "road", "boat", "airplane"];
export type FinanceSettings = { vehicleCostPercent: number; maintenanceCostPercent: number };
export const DEFAULT_FINANCE: FinanceSettings = { vehicleCostPercent: 125, maintenanceCostPercent: 125 };
export const FINANCE_PRESETS = [{ id: "easy", name: "Easy", percent: 50 }, { id: "normal", name: "Normal", percent: 100 }, { id: "hard", name: "Hard", percent: 125 }, { id: "very-hard", name: "Very hard", percent: 150 }] as const;
export type Settings = { year: number; extraYears: number; includeObsolete?: boolean; trainLength: number; tramLength: number; distanceKm: number; additionalStops?: number; turns?: number; speedLimit?: number; minTopSpeed: number; cargos: string[]; vehicleCostPercent?: number; maintenanceCostPercent?: number; paybackYears?: number };
export type Option = {
  id: string; mode: Mode; engine: Vehicle; wagon: Vehicle | null; engines: number; wagons: number;
  cargo: string; // The selected cargo with the lowest estimated throughput (the metrics benchmark).
  cargos: string[]; capacity: number; length: number; speed: number; acceleration: number;
  performanceAcceleration: number | null; timeToMaxSpeed: number | null; distanceToMaxSpeed: number | null; peakSpeed: number; averageSpeed: number;
  motionModel: "calibrated-rail" | "constant-estimate" | "water-estimate" | "air-estimate"; motionMass: number;
  turns: number; speedLimit: number; effectiveSpeed: number;
  brakingAcceleration: number; brakingTime: number; brakingDistance: number; arrivalDelaySeconds: number;
  timeTo1Km: number; timeTo2Km: number; timeTo3Km: number; timeTo4Km: number; timeTo5Km: number;
  noise: number; pollution: number; comfort: number | null; purchase: number; running: number;
  vehicleCostPercent: number; maintenanceCostPercent: number; paybackYears: number;
  loadSpeed: number; throughput: number; costPerformance: number; distanceKm: number; additionalStops: number; yearFrom: number; yearTo: number | null;
  availableAtStart: boolean; availableAtEnd: boolean; fullRange: boolean; lightRail: boolean; loadedMass: number;
};
// Leave a 5 m buffer below the game's default 160 m station length.
export const DEFAULT_SETTINGS: Settings = { year: 1990, extraYears: 10, includeObsolete: false, trainLength: 155, tramLength: 60, distanceKm: 10, turns: 0, speedLimit: 0, minTopSpeed: 0, cargos: ["PASSENGERS"] };
export const DEFAULT_PAYBACK_YEARS = 20;
export const DEFAULT_RAIL_BRAKING = 2.5;
// Measured stop-to-loading interval. Count it once at the trip's destination;
// origin loading starts ready. Departure/door-closing pauses remain unmeasured.
export const RAIL_ARRIVAL_DELAY_SECONDS = 2;

export function isMultipleUnitMenuVehicle(vehicle: Vehicle) {
  // TF3's train store groups powered vehicles with their own capacity under Multiple units.
  // This also includes single railcars, independently of authored fixed formations.
  return vehicle.carrier === "RAIL" && vehicle.power > 0 && vehicle.engineModes.length > 0
    && Object.values(vehicle.capacities).some(capacity => capacity > 0);
}

export function belongsToMode(v: Vehicle, mode: Mode) {
  if (mode === "airplane") return v.carrier === "AIR";
  if (mode === "boat") return v.carrier === "WATER";
  if (mode === "road") return v.carrier === "ROAD" || v.carrier === "TRAM";
  if (mode === "tram") return v.carrier === "TRAM";
  return v.carrier === "RAIL" || v.modes.some(m => m === "TRAM_TRACK" || m === "ELECTRIC_TRAM_TRACK");
}

export function compatible(engine: Vehicle, wagon: Vehicle) {
  // A tram can use rails without being able to couple to a railway wagon.
  return engine.carrier === wagon.carrier && engine.engineModes.some(m => wagon.modes.includes(m));
}

export function sameFormationSettings(a: Settings, b: Settings) {
  return a.trainLength === b.trainLength && a.tramLength === b.tramLength
    && [...new Set(a.cargos)].sort().join(",") === [...new Set(b.cargos)].sort().join(",");
}

export function formationBaseLoadSpeed(engine: Vehicle, wagon: Vehicle | null, cargo: string) {
  const rates = [engine, wagon].filter((v): v is Vehicle => !!v && v.capacities[cargo] > 0).map(v => v.loadSpeed);
  return rates.length ? Math.min(...rates) : 0;
}

export function formationLoadingFactors(engine: Vehicle, wagon: Vehicle | null, engines: number, wagons: number, cargo: string) {
  const baseRate = formationBaseLoadSpeed(engine, wagon, cargo);
  // Count cargo-carrying catalog vehicles only; a complete authored set is one
  // catalog vehicle. A locomotive that cannot carry this cargo contributes zero.
  const carryingVehicleCount = (engine.capacities[cargo] > 0 ? engines : 0) + (wagon && wagon.capacities[cargo] > 0 ? wagons : 0);
  return { baseRate, carryingVehicleCount, parallelBaseRate: baseRate * carryingVehicleCount };
}

export function calculateOptions(vehicles: Vehicle[], cargos: Cargo[], settings: Settings, progress?: (value: number) => void): Option[] {
  if (!Number.isSafeInteger(settings.turns ?? 0) || (settings.turns ?? 0) < 0 || (settings.turns ?? 0) >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Turns must be a nonnegative whole number below the safe integer limit.");
  }
  if ((settings.turns ?? 0) > 0 && (settings.additionalStops ?? 0) > 0) throw new RangeError("Use turns or additional stops, not both.");
  if (!Number.isFinite(settings.speedLimit ?? 0) || (settings.speedLimit ?? 0) < 0) throw new RangeError("Speed limit must be nonnegative; zero means unlimited.");
  if (!Number.isFinite(settings.paybackYears ?? DEFAULT_PAYBACK_YEARS) || (settings.paybackYears ?? DEFAULT_PAYBACK_YEARS) <= 0) {
    throw new RangeError("Purchase payback period must be a positive number of years.");
  }
  for (const percent of [settings.vehicleCostPercent ?? DEFAULT_FINANCE.vehicleCostPercent, settings.maintenanceCostPercent ?? DEFAULT_FINANCE.maintenanceCostPercent]) {
    if (![50, 75, 100, 125, 150].includes(percent)) throw new RangeError("Finance multipliers must be 50–150% in 25% increments.");
  }
  if (!Number.isFinite(settings.distanceKm) || settings.distanceKm <= 0) {
    throw new RangeError("Trip distance must be a positive number of kilometers.");
  }
  if (!Number.isSafeInteger(settings.additionalStops ?? 0) || (settings.additionalStops ?? 0) < 0 || (settings.additionalStops ?? 0) >= Number.MAX_SAFE_INTEGER) {
    throw new RangeError("Additional stops must be a nonnegative whole number below the safe integer limit.");
  }
  if (!Number.isFinite(settings.minTopSpeed) || settings.minTopSpeed < 0) {
    throw new RangeError("Minimum top speed must be a nonnegative number of kilometers per hour.");
  }
  const endYear = settings.year + settings.extraYears;
  const selectedCargos = cargos.filter(c => settings.cargos.includes(c.id));
  if (!selectedCargos.length || selectedCargos.length !== new Set(settings.cargos).size) return [];
  const available = vehicles.filter(v => v.yearFrom <= endYear && (settings.includeObsolete || v.yearTo === null || v.yearTo >= settings.year));
  const result: Option[] = [];
  const powered = available.filter(v => (v.power > 0 || (v.thrust ?? 0) > 0) && v.engineModes.length > 0);
  const wagons = available.filter(v => v.power === 0 && Object.keys(v.capacities).length > 0);
  let done = 0;
  for (const engine of powered) {
    for (const mode of MODES) {
      if (!belongsToMode(engine, mode)) continue;
      const roadTram = mode === "road" && engine.carrier === "TRAM";
      const limit = mode === "train" ? settings.trainLength : mode === "tram" || roadTram ? settings.tramLength : Infinity;
      const multipleUnit = isMultipleUnitMenuVehicle(engine);
      if (multipleUnit && Number.isFinite(limit) && engine.length > 0
        && selectedCargos.every(c => engine.capacities[c.id] > 0)) {
        // Compare whole formations at the length limit, including total emissions.
        const maximum = Math.floor((limit + 1e-7) / engine.length);
        if (maximum >= 1) result.push(makeMultiCargoOption(engine, null, maximum, 0, mode, selectedCargos, settings));
      }
      const single = (mode === "road" && !roadTram) || mode === "boat" || mode === "airplane";
      const engineCounts = single ? [1] : multipleUnit ? [1, 2, 3, 4, 5] : [1, 2];
      for (const engines of engineCounts) {
        if (engine.length * engines > limit + 1e-7) continue;
        let hasWagonOption = false;
        // An authored passenger multiple unit is one complete vehicle. Its loose parts never enter the catalog.
        const selfContained = engine.fixedFormation && Object.keys(engine.capacities).length > 0;
        if (!single && !selfContained) {
          for (const wagon of wagons) {
            if (!selectedCargos.every(c => wagon.capacities[c.id] > 0) || !belongsToMode(wagon, mode) || !compatible(engine, wagon)) continue;
            const count = Math.floor((limit - engine.length * engines + 1e-7) / wagon.length);
            if (count < 1) continue;
            const from = Math.max(engine.yearFrom, wagon.yearFrom, settings.year);
            const to = Math.min(engine.yearTo ?? Infinity, wagon.yearTo ?? Infinity, endYear);
            if (!settings.includeObsolete && from > to) continue; // Obsolete stock may be combined with newer purchases.
            result.push(makeMultiCargoOption(engine, wagon, engines, count, mode, selectedCargos, settings));
            hasWagonOption = true;
          }
        }
        if (!multipleUnit && !hasWagonOption && selectedCargos.every(c => engine.capacities[c.id] > 0)) {
          result.push(makeMultiCargoOption(engine, null, engines, 0, mode, selectedCargos, settings));
        }
      }
    }
    progress?.(++done / powered.length);
  }
  // Match the whole-km/h speeds displayed in the game/table, avoiding conversion
  // artifacts such as 79.999 km/h excluding a nominal 80 km/h vehicle.
  return result.filter(option => Math.round(option.speed) >= settings.minTopSpeed);
}

function makeMultiCargoOption(engine: Vehicle, wagon: Vehicle | null, engines: number, wagons: number, mode: Mode, cargos: Cargo[], settings: Settings): Option {
  // One row for the formation. Keep every cargo-dependent metric from the same
  // lowest-throughput load, rather than combining incompatible best-case stats.
  const loads = cargos.map(cargo => makeOption(engine, wagon, engines, wagons, mode, cargo, settings));
  const worst = loads.reduce((a, b) => b.throughput < a.throughput ? b : a);
  return { ...worst, cargos: cargos.map(c => c.id) };
}

function makeOption(engine: Vehicle, wagon: Vehicle | null, engines: number, wagons: number, mode: Mode, cargo: Cargo, settings: Settings): Option {
  const sum = (key: "length" | "power" | "tractiveEffort" | "noise" | "pollution" | "purchase" | "running" | "weightEmpty" | "weightMaxPayload") => engine[key] * engines + (wagon?.[key] ?? 0) * wagons;
  const capacity = (engine.capacities[cargo.id] ?? 0) * engines + (wagon?.capacities[cargo.id] ?? 0) * wagons;
  const payload = (engine.capacities[cargo.id] ? engine.weightMaxPayload * engines : 0)
    + (wagon?.capacities[cargo.id] ? wagon.weightMaxPayload * wagons : 0);
  const loadedMass = sum("weightEmpty") + payload * cargo.weightFactor;
  const speed = Math.min(engine.speed, wagon?.speed ?? Infinity);
  const speedLimit = settings.speedLimit ?? 0;
  const effectiveSpeed = speedLimit > 0 ? Math.min(speed, speedLimit) : speed;
  const loading = formationLoadingFactors(engine, wagon, engines, wagons, cargo.id);
  const loadSpeed = loading.parallelBaseRate * cargo.loadSpeedFactor;
  const paybackYears = settings.paybackYears ?? DEFAULT_PAYBACK_YEARS;
  // Rail calibration: loaded and empty runs have matching acceleration. Keep
  // theoretical loadedMass for reference; use empty mass for rail movement.
  // Tram/light-rail and road equipment retain their uncalibrated estimate.
  const motionMass = engine.carrier === "RAIL" ? sum("weightEmpty") : loadedMass;
  const vmax = effectiveSpeed / 3.6;
  const referenceSpeed = speed / 3.6; // A route speed cap does not change the vehicle's acceleration capability.
  const turns = engine.carrier === "ROAD" || engine.carrier === "TRAM" ? settings.turns ?? 0 : 0;
  const additionalStops = settings.additionalStops ?? 0, segmentCount = additionalStops + 1;
  const distanceMeters = settings.distanceKm * 1000 / segmentCount;
  const rail = engine.carrier === "RAIL" ? createRailMotion(motionMass, sum("power") * 1000, sum("tractiveEffort") * 1000, vmax,
    (engine.friction * engine.weightEmpty * engines + (wagon ? wagon.friction * wagon.weightEmpty * wagons : 0)) / motionMass) : null;
  const brakingAcceleration = rail ? Math.min(engine.brakeDeceleration ?? DEFAULT_RAIL_BRAKING,
    wagon ? (wagon.brakeDeceleration ?? DEFAULT_RAIL_BRAKING) : Infinity) : 1;
  const arrivalDelaySeconds = rail ? RAIL_ARRIVAL_DELAY_SECONDS : 0;
  const railTrip = rail?.trip(distanceMeters, brakingAcceleration);
  // Boats expose available shaft power, but no listed tractive effort. Use the
  // power at half top speed for an uncalibrated constant acceleration estimate.
  const acceleration = engine.carrier === "AIR" ? (engine.thrust ?? 0) / motionMass : engine.carrier === "WATER"
    ? sum("power") * 1000 / (motionMass * Math.max(referenceSpeed / 2, 1))
    : rail?.initialAcceleration ?? sum("tractiveEffort") * 1000 / motionMass;
  const a = engine.carrier === "AIR" ? acceleration : Math.min(acceleration, sum("power") * 1000 / (motionMass * Math.max(referenceSpeed / 2, 1)));
  const constantTimeToMax = vmax / a, constantDistanceToMax = vmax * vmax / (2 * a);
  const timeToMaxSpeed = rail ? rail.timeToMaxSpeed : constantTimeToMax;
  const distanceToMaxSpeed = rail ? rail.distanceToMaxSpeed : constantDistanceToMax;
  const [timeTo1Km, timeTo2Km, timeTo3Km, timeTo4Km, timeTo5Km] = [1000, 2000, 3000, 4000, 5000].map(distance => rail
    ? rail.launchAtDistance(distance).time
    : distance <= constantDistanceToMax ? Math.sqrt(2 * distance / a) : constantTimeToMax + (distance - constantDistanceToMax) / vmax);
  const turnJourney = turns > 0 ? createTurnJourney(settings.distanceKm * 1000, turns, a, brakingAcceleration, vmax) : null;
  const peak = turnJourney?.trip.speed ?? (railTrip ? railTrip.speed : Math.min(vmax, Math.sqrt(2 * distanceMeters / (1 / a + 1))));
  const segmentSeconds = railTrip ? railTrip.time
    : peak / a + peak + Math.max(0, distanceMeters - peak * peak / (2 * a) - peak * peak / 2) / peak;
  const travelSeconds = turnJourney?.trip.time ?? segmentSeconds * segmentCount;
  const brakingTime = turnJourney ? turnJourney.sections[turnJourney.sections.length - 1].brakingTime : peak / brakingAcceleration;
  const brakingDistance = turnJourney ? turnJourney.sections[turnJourney.sections.length - 1].brakingDistance : peak * peak / (2 * brakingAcceleration);
  const throughput = capacity * 3600 / (travelSeconds + 2 * capacity / Math.max(loadSpeed, 0.001) + arrivalDelaySeconds);
  const vehicleCostPercent = settings.vehicleCostPercent ?? DEFAULT_FINANCE.vehicleCostPercent;
  const maintenanceCostPercent = settings.maintenanceCostPercent ?? DEFAULT_FINANCE.maintenanceCostPercent;
  const purchase = Math.round(sum("purchase") * vehicleCostPercent / 100), running = Math.round(sum("running") * maintenanceCostPercent / 100);
  const yearFrom = Math.max(engine.yearFrom, wagon?.yearFrom ?? 0);
  const until = Math.min(engine.yearTo ?? Infinity, wagon?.yearTo ?? Infinity);
  return {
    id: `${mode}:${engine.id}:${engines}:${wagon?.id ?? "self"}`, mode, engine, wagon, engines, wagons, cargo: cargo.id, cargos: [cargo.id],
    capacity, length: sum("length"), speed, acceleration, noise: sum("noise"), pollution: sum("pollution"),
    performanceAcceleration: rail ? (timeToMaxSpeed === null ? null : vmax / timeToMaxSpeed) : a,
    timeToMaxSpeed, distanceToMaxSpeed, peakSpeed: peak * 3.6, averageSpeed: settings.distanceKm * 3600 / travelSeconds,
    motionModel: rail ? "calibrated-rail" : engine.carrier === "AIR" ? "air-estimate" : engine.carrier === "WATER" ? "water-estimate" : "constant-estimate", motionMass,
    turns, speedLimit, effectiveSpeed,
    brakingAcceleration, brakingTime, brakingDistance, arrivalDelaySeconds,
    timeTo1Km, timeTo2Km, timeTo3Km, timeTo4Km, timeTo5Km,
    comfort: cargo.id === "PASSENGERS" ? ((engine.capacities.PASSENGERS ?? 0) * engines * engine.comfort + (wagon?.capacities.PASSENGERS ?? 0) * wagons * (wagon?.comfort ?? 0)) / capacity : null,
    purchase, running, loadSpeed, throughput, distanceKm: settings.distanceKm, additionalStops, paybackYears, costPerformance: throughput > 0 ? (running + purchase / paybackYears) / throughput : Infinity,
    vehicleCostPercent, maintenanceCostPercent,
    yearFrom, yearTo: Number.isFinite(until) ? until : null,
    availableAtStart: yearFrom <= settings.year && until >= settings.year,
    availableAtEnd: yearFrom <= settings.year + settings.extraYears && until >= settings.year + settings.extraYears,
    fullRange: yearFrom <= settings.year && until >= settings.year + settings.extraYears,
    lightRail: engine.carrier === "TRAM" && mode === "train", loadedMass,
  };
}

/** Flat-track rail movement calibrated against four loaded/empty TF3 recordings.
 * SI units: kg, W, N, m/s; resistance is an acceleration in m/s².
 * a(v) = min(2F / m, P / (mv)) - r. See tests/fixtures/rail-runs.json.
 */
export function createRailMotion(mass: number, power: number, effort: number, topSpeed: number, resistance: number) {
  const k = power / mass, forceAcceleration = 2 * effort / mass;
  const initialAcceleration = Math.max(0, forceAcceleration - resistance);
  const transitionSpeed = k / forceAcceleration;
  const ceiling = Math.min(topSpeed, resistance > 0 ? k / resistance : Infinity);
  const reachesMax = initialAcceleration > 0 && (resistance === 0 || topSpeed < k / resistance);

  // Closed-form integrals of dt/dv = v/(k-rv) and dx/dv = v²/(k-rv).
  // A short series avoids cancellation when resistance is tiny or zero.
  function primitive(v: number) {
    const z = resistance * v / k;
    let timeFactor: number, distanceFactor: number;
    if (z < 0.01) {
      let term = 1; timeFactor = 0; distanceFactor = 0;
      for (let n = 0; n < 7; n++) {
        timeFactor += term / (n + 2); distanceFactor += term / (n + 3); term *= z;
      }
    } else {
      const log = -Math.log1p(-z);
      timeFactor = (log - z) / (z * z);
      distanceFactor = (log - z - z * z / 2) / (z * z * z);
    }
    return { time: v * v / k * timeFactor, distance: v * v * v / k * distanceFactor };
  }
  const transition = transitionSpeed < ceiling ? primitive(transitionSpeed) : { time: 0, distance: 0 };
  function atSpeed(v: number) {
    if (v === 0) return { time: 0, distance: 0, speed: 0 };
    if (initialAcceleration === 0) return { time: Infinity, distance: Infinity, speed: 0 };
    if (v <= transitionSpeed) return { time: v / initialAcceleration, distance: v * v / (2 * initialAcceleration), speed: v };
    const integral = primitive(v);
    return {
      time: transitionSpeed / initialAcceleration + integral.time - transition.time,
      distance: transitionSpeed * transitionSpeed / (2 * initialAcceleration) + integral.distance - transition.distance,
      speed: v,
    };
  }
  const maximum = reachesMax ? atSpeed(topSpeed) : null;
  // Solve for the peak speed within the available acceleration + braking distance.
  // Fixed bounded iterations keep worker calculations independent of trip duration.
  function peakForDistance(distance: number, braking: number) {
    if (initialAcceleration === 0) return { time: Infinity, distance: 0, speed: 0 };
    if (maximum && maximum.distance + topSpeed * topSpeed / (2 * braking) <= distance) return maximum;
    // Tiny segments can be solved exactly while still traction limited.
    const tractionEnd = Math.min(transitionSpeed, ceiling);
    const tractionDistance = tractionEnd * tractionEnd / (2 * initialAcceleration) + tractionEnd * tractionEnd / (2 * braking);
    if (distance <= tractionDistance) return atSpeed(Math.sqrt(2 * distance / (1 / initialAcceleration + 1 / braking)));
    let low = 0, high = ceiling;
    for (let i = 0; i < 32; i++) {
      const mid = (low + high) / 2, sample = atSpeed(mid);
      if (sample.distance + mid * mid / (2 * braking) > distance) high = mid;
      else low = mid;
    }
    return atSpeed((low + high) / 2);
  }
  return {
    initialAcceleration,
    timeToMaxSpeed: maximum?.time ?? null,
    distanceToMaxSpeed: maximum?.distance ?? null,
    atSpeed,
    atTime(time: number) {
      if (time <= 0) return atSpeed(0);
      if (maximum && time >= maximum.time) return { time, speed: topSpeed, distance: maximum.distance + (time - maximum.time) * topSpeed };
      let low = 0, high = ceiling;
      for (let i = 0; i < 32; i++) {
        const mid = (low + high) / 2;
        if (atSpeed(mid).time > time) high = mid;
        else low = mid;
      }
      return atSpeed((low + high) / 2);
    },
    launchAtDistance(distance: number) {
      const sample = peakForDistance(distance, Infinity);
      return { time: sample.time + (sample.speed > 0 ? Math.max(0, distance - sample.distance) / sample.speed : 0), speed: sample.speed };
    },
    trip(distance: number, braking = DEFAULT_RAIL_BRAKING) {
      const sample = peakForDistance(distance, braking);
      const cruise = Math.max(0, distance - sample.distance - sample.speed * sample.speed / (2 * braking));
      const cruiseTime = sample.speed > 0 ? cruise / sample.speed : 0;
      return { time: sample.time + sample.speed / braking + cruiseTime, speed: sample.speed,
        accelerationTime: sample.time, accelerationDistance: sample.distance, cruiseTime, cruiseDistance: cruise,
        brakingTime: sample.speed / braking, brakingDistance: sample.speed * sample.speed / (2 * braking) };
    },
  };
}

/** On-demand modal analysis. Uses the same curve as worker calculations, with no
 * per-row graph generation or numerical time-stepping in the result table. */
export function analyzeOption(o: Option) {
  const sum = (key: "power" | "tractiveEffort" | "weightEmpty" | "length" | "purchase" | "running" | "noise" | "pollution") =>
    o.engine[key] * o.engines + (o.wagon?.[key] ?? 0) * o.wagons;
  const power = sum("power") * 1000, effort = sum("tractiveEffort") * 1000, mass = o.motionMass;
  const rail = o.motionModel === "calibrated-rail";
  const resistance = rail ? (o.engine.friction * o.engine.weightEmpty * o.engines
    + (o.wagon ? o.wagon.friction * o.wagon.weightEmpty * o.wagons : 0)) / mass : 0;
  const forceLimit = effort * (rail ? 2 : 1), transitionSpeed = power / forceLimit;
  const curve = rail ? createRailMotion(mass, power, effort, (o.effectiveSpeed ?? o.speed) / 3.6, resistance) : null;
  const turns = o.turns ?? 0;
  const additionalStops = o.additionalStops ?? 0, segmentCount = (turns || additionalStops) + 1;
  const journeyDistance = o.distanceKm * 1000, distance = journeyDistance / segmentCount;
  const peak = o.peakSpeed / 3.6, braking = o.brakingAcceleration;
  const constantA = o.performanceAcceleration ?? 0;
  const accelerationTime = peak / constantA, accelerationDistance = peak * peak / (2 * constantA);
  const brakingTime = peak / braking, brakingDistance = peak * peak / (2 * braking);
  const cruiseDistance = Math.max(0, distance - accelerationDistance - brakingDistance);
  const turnJourney = turns > 0 ? createTurnJourney(journeyDistance, turns, constantA, braking, (o.effectiveSpeed ?? o.speed) / 3.6) : null;
  const segment = turnJourney ? turnJourney.sections[0] : curve ? curve.trip(distance, braking) : {
    accelerationTime, accelerationDistance, cruiseDistance, cruiseTime: cruiseDistance / peak,
    brakingTime, brakingDistance, speed: peak,
    time: accelerationTime + cruiseDistance / peak + brakingTime,
  };
  const trip = turnJourney?.trip ?? { speed: segment.speed, time: segment.time * segmentCount,
    accelerationTime: segment.accelerationTime * segmentCount, accelerationDistance: segment.accelerationDistance * segmentCount,
    cruiseTime: segment.cruiseTime * segmentCount, cruiseDistance: segment.cruiseDistance * segmentCount,
    brakingTime: segment.brakingTime * segmentCount, brakingDistance: segment.brakingDistance * segmentCount };
  const loading = formationLoadingFactors(o.engine, o.wagon, o.engines, o.wagons, o.cargo);
  const baseLoadSpeed = loading.baseRate;
  const loadingTime = o.capacity / Math.max(o.loadSpeed, .001), arrivalTime = o.arrivalDelaySeconds;
  const totalTime = trip.time + 2 * loadingTime + arrivalTime;
  const transitionTime = curve && transitionSpeed < segment.speed ? curve.atSpeed(transitionSpeed).time : null;
  const annualizedCost = o.running + o.purchase / (o.paybackYears ?? DEFAULT_PAYBACK_YEARS);
  function sampleAtTime(seconds: number) {
    if (turnJourney) {
      const sample = turnJourney.sampleAtTime(seconds);
      return { ...sample, netForce: sample.acceleration * mass };
    }
    const time = Math.max(0, Math.min(seconds, trip.time));
    const boundary = Math.round(time / segment.time);
    const onBoundary = boundary > 0 && boundary < segmentCount
      && Math.abs(time - boundary * segment.time) <= Number.EPSILON * Math.max(1, time) * 4;
    const segmentIndex = onBoundary ? boundary : Math.min(segmentCount - 1, Math.floor(time / segment.time));
    const localTime = onBoundary ? 0 : time - segmentIndex * segment.time;
    let speed: number, position: number, acceleration: number, phase: string;
    const brakeStart = segment.accelerationTime + segment.cruiseTime;
    if (time >= trip.time) { speed = 0; position = distance; acceleration = 0; phase = "Stopped"; }
    else if (segmentIndex > 0 && localTime === 0) { speed = 0; position = 0; acceleration = 0; phase = "Intermediate stop"; }
    else if (localTime >= brakeStart) {
      const dt = localTime - brakeStart;
      speed = Math.max(0, segment.speed - braking * dt);
      position = segment.accelerationDistance + segment.cruiseDistance + segment.speed * dt - braking * dt * dt / 2;
      acceleration = -braking; phase = "Braking";
    } else if (localTime >= segment.accelerationTime) {
      speed = segment.speed; position = segment.accelerationDistance + (localTime - segment.accelerationTime) * speed;
      acceleration = 0; phase = "Cruising";
    } else {
      const sample = curve?.atTime(localTime);
      speed = sample ? sample.speed : constantA * localTime;
      position = sample ? sample.distance : constantA * localTime * localTime / 2;
      acceleration = rail ? Math.min(forceLimit / mass, speed > 0 ? power / (mass * speed) : Infinity) - resistance : constantA;
      phase = rail ? (speed <= transitionSpeed ? "Traction limited" : "Power limited") : "Constant estimate";
    }
    const accelerating = phase === "Traction limited" || phase === "Power limited";
    const drivingForce = rail && accelerating ? Math.min(forceLimit, speed > 0 ? power / speed : Infinity)
      : rail && phase === "Cruising" ? mass * resistance : 0;
    return { time, speed: speed * 3.6, distance: Math.min(distance, Math.max(0, position)) + segmentIndex * distance, acceleration, phase, segment: segmentIndex + 1,
      drivingForce, powerUsed: drivingForce * speed, netForce: acceleration * mass };
  }
  return {
    rail, power, effort, forceLimit, mass, resistance, resistanceForce: mass * resistance,
    transitionSpeed, transitionTime, trip, segment, segmentCount, segmentDistance: distance, additionalStops, turns,
    turnSections: turnJourney?.sections ?? null,
    baseLoadSpeed, loading, cargoLoadFactor: loading.parallelBaseRate > 0 ? o.loadSpeed / loading.parallelBaseRate : 0,
    loadingTime, unloadingTime: loadingTime, arrivalTime, totalTime, annualizedCost,
    basePurchase: sum("purchase"), baseRunning: sum("running"), emptyMass: sum("weightEmpty"),
    length: sum("length"), noise: sum("noise"), pollution: sum("pollution"), sampleAtTime,
  };
}
