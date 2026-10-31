export type Vehicle = {
  id: string; name: string; source: string; category: string; carrier: string;
  modes: string[]; engineModes: string[]; yearFrom: number; yearTo: number | null;
  length: number; speed: number; power: number; tractiveEffort: number;
  weightEmpty: number; weightMaxPayload: number; friction: number; engineType: string | null;
  brakeDeceleration?: number;
  capacities: Record<string, number>; loadSpeed: number; comfort: number; noise: number;
  pollution: number; purchase: number; running: number; fixedFormation: boolean;
  parts?: { name: string; source: string }[];
};
export type Cargo = { id: string; name: string; classes: string[]; weightFactor: number; loadSpeedFactor: number };
export type Mode = "train" | "tram" | "road";
export type FinanceSettings = { vehicleCostPercent: number; maintenanceCostPercent: number };
export const DEFAULT_FINANCE: FinanceSettings = { vehicleCostPercent: 125, maintenanceCostPercent: 125 };
export const FINANCE_PRESETS = [{ id: "easy", name: "Easy", percent: 50 }, { id: "normal", name: "Normal", percent: 100 }, { id: "hard", name: "Hard", percent: 125 }, { id: "very-hard", name: "Very hard", percent: 150 }] as const;
export type Settings = { year: number; extraYears: number; trainLength: number; tramLength: number; distanceKm: number; minTopSpeed: number; cargos: string[]; vehicleCostPercent?: number; maintenanceCostPercent?: number };
export type Option = {
  id: string; mode: Mode; engine: Vehicle; wagon: Vehicle | null; engines: number; wagons: number;
  cargo: string; // The selected cargo with the lowest estimated throughput (the metrics benchmark).
  cargos: string[]; capacity: number; length: number; speed: number; acceleration: number;
  performanceAcceleration: number | null; timeToMaxSpeed: number | null; distanceToMaxSpeed: number | null; peakSpeed: number;
  motionModel: "calibrated-rail" | "constant-estimate"; motionMass: number;
  brakingAcceleration: number; brakingTime: number; brakingDistance: number; arrivalDelaySeconds: number;
  timeTo1Km: number; timeTo2Km: number; timeTo3Km: number; timeTo4Km: number; timeTo5Km: number;
  noise: number; pollution: number; comfort: number | null; purchase: number; running: number;
  vehicleCostPercent: number; maintenanceCostPercent: number;
  loadSpeed: number; throughput: number; costPerformance: number; distanceKm: number; yearFrom: number; yearTo: number | null;
  availableAtStart: boolean; availableAtEnd: boolean; fullRange: boolean; lightRail: boolean; loadedMass: number;
};
// Leave a 5 m buffer below the game's default 160 m station length.
export const DEFAULT_SETTINGS: Settings = { year: 1990, extraYears: 10, trainLength: 155, tramLength: 60, distanceKm: 10, minTopSpeed: 0, cargos: ["PASSENGERS"] };
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
  if (mode === "road") return v.carrier === "ROAD";
  if (mode === "tram") return v.carrier === "TRAM";
  return v.carrier === "RAIL" || v.modes.some(m => m === "TRAM_TRACK" || m === "ELECTRIC_TRAM_TRACK");
}

export function compatible(engine: Vehicle, wagon: Vehicle) {
  // A tram can use rails without being able to couple to a railway wagon.
  return engine.carrier === wagon.carrier && engine.engineModes.some(m => wagon.modes.includes(m));
}

export function calculateOptions(vehicles: Vehicle[], cargos: Cargo[], settings: Settings, progress?: (value: number) => void): Option[] {
  for (const percent of [settings.vehicleCostPercent ?? DEFAULT_FINANCE.vehicleCostPercent, settings.maintenanceCostPercent ?? DEFAULT_FINANCE.maintenanceCostPercent]) {
    if (![50, 75, 100, 125, 150].includes(percent)) throw new RangeError("Finance multipliers must be 50–150% in 25% increments.");
  }
  if (!Number.isFinite(settings.distanceKm) || settings.distanceKm <= 0) {
    throw new RangeError("Trip distance must be a positive number of kilometers.");
  }
  if (!Number.isFinite(settings.minTopSpeed) || settings.minTopSpeed < 0) {
    throw new RangeError("Minimum top speed must be a nonnegative number of kilometers per hour.");
  }
  const endYear = settings.year + settings.extraYears;
  const selectedCargos = cargos.filter(c => settings.cargos.includes(c.id));
  if (!selectedCargos.length || selectedCargos.length !== new Set(settings.cargos).size) return [];
  const available = vehicles.filter(v => v.yearFrom <= endYear && (v.yearTo === null || v.yearTo >= settings.year));
  const result: Option[] = [];
  const powered = available.filter(v => v.power > 0 && v.engineModes.length > 0);
  const wagons = available.filter(v => v.power === 0 && Object.keys(v.capacities).length > 0);
  let done = 0;
  for (const engine of powered) {
    for (const mode of ["train", "tram", "road"] as const) {
      if (!belongsToMode(engine, mode)) continue;
      const limit = mode === "train" ? settings.trainLength : mode === "tram" ? settings.tramLength : Infinity;
      for (const engines of mode === "road" ? [1] : [1, 2]) {
        if (engine.length * engines > limit + 1e-7) continue;
        let hasWagonOption = false;
        // An authored passenger multiple unit is one complete vehicle. Its loose parts never enter the catalog.
        const selfContained = engine.fixedFormation && Object.keys(engine.capacities).length > 0;
        if (mode !== "road" && !selfContained) {
          for (const wagon of wagons) {
            if (!selectedCargos.every(c => wagon.capacities[c.id] > 0) || !belongsToMode(wagon, mode) || !compatible(engine, wagon)) continue;
            const count = Math.floor((limit - engine.length * engines + 1e-7) / wagon.length);
            if (count < 1) continue;
            const from = Math.max(engine.yearFrom, wagon.yearFrom, settings.year);
            const to = Math.min(engine.yearTo ?? Infinity, wagon.yearTo ?? Infinity, endYear);
            if (from > to) continue; // Components must be purchasable together, not just individually in the interval.
            result.push(makeMultiCargoOption(engine, wagon, engines, count, mode, selectedCargos, settings));
            hasWagonOption = true;
          }
        }
        if (!hasWagonOption && selectedCargos.every(c => engine.capacities[c.id] > 0)) {
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
  const loadSpeed = ((engine.capacities[cargo.id] ? engine.loadSpeed * engines : 0) + (wagon?.loadSpeed ?? 0) * wagons) * cargo.loadSpeedFactor;
  // Rail calibration: loaded and empty runs have matching acceleration. Keep
  // theoretical loadedMass for reference; use empty mass for rail movement.
  // Tram/light-rail and road equipment retain their uncalibrated estimate.
  const motionMass = engine.carrier === "RAIL" ? sum("weightEmpty") : loadedMass;
  const vmax = speed / 3.6;
  const distanceMeters = settings.distanceKm * 1000;
  const rail = engine.carrier === "RAIL" ? createRailMotion(motionMass, sum("power") * 1000, sum("tractiveEffort") * 1000, vmax,
    (engine.friction * engine.weightEmpty * engines + (wagon ? wagon.friction * wagon.weightEmpty * wagons : 0)) / motionMass) : null;
  const brakingAcceleration = rail ? Math.min(engine.brakeDeceleration ?? DEFAULT_RAIL_BRAKING,
    wagon ? (wagon.brakeDeceleration ?? DEFAULT_RAIL_BRAKING) : Infinity) : 1;
  const arrivalDelaySeconds = rail ? RAIL_ARRIVAL_DELAY_SECONDS : 0;
  const railTrip = rail?.trip(distanceMeters, brakingAcceleration);
  const acceleration = rail?.initialAcceleration ?? sum("tractiveEffort") * 1000 / motionMass;
  const a = Math.min(acceleration, sum("power") * 1000 / (motionMass * Math.max(vmax / 2, 1)));
  const constantTimeToMax = vmax / a, constantDistanceToMax = vmax * vmax / (2 * a);
  const timeToMaxSpeed = rail ? rail.timeToMaxSpeed : constantTimeToMax;
  const distanceToMaxSpeed = rail ? rail.distanceToMaxSpeed : constantDistanceToMax;
  const [timeTo1Km, timeTo2Km, timeTo3Km, timeTo4Km, timeTo5Km] = [1000, 2000, 3000, 4000, 5000].map(distance => rail
    ? rail.launchAtDistance(distance).time
    : distance <= constantDistanceToMax ? Math.sqrt(2 * distance / a) : constantTimeToMax + (distance - constantDistanceToMax) / vmax);
  const peak = railTrip ? railTrip.speed : Math.min(vmax, Math.sqrt(2 * distanceMeters / (1 / a + 1)));
  const travelSeconds = railTrip ? railTrip.time
    : peak / a + peak + Math.max(0, distanceMeters - peak * peak / (2 * a) - peak * peak / 2) / peak;
  const brakingTime = peak / brakingAcceleration, brakingDistance = peak * peak / (2 * brakingAcceleration);
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
    timeToMaxSpeed, distanceToMaxSpeed, peakSpeed: peak * 3.6,
    motionModel: rail ? "calibrated-rail" : "constant-estimate", motionMass,
    brakingAcceleration, brakingTime, brakingDistance, arrivalDelaySeconds,
    timeTo1Km, timeTo2Km, timeTo3Km, timeTo4Km, timeTo5Km,
    comfort: cargo.id === "PASSENGERS" ? ((engine.capacities.PASSENGERS ?? 0) * engines * engine.comfort + (wagon?.capacities.PASSENGERS ?? 0) * wagons * (wagon?.comfort ?? 0)) / capacity : null,
    purchase, running, loadSpeed, throughput, distanceKm: settings.distanceKm, costPerformance: throughput > 0 ? (running + purchase / 20) / throughput : Infinity,
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
    launchAtDistance(distance: number) {
      const sample = peakForDistance(distance, Infinity);
      return { time: sample.time + (sample.speed > 0 ? Math.max(0, distance - sample.distance) / sample.speed : 0), speed: sample.speed };
    },
    trip(distance: number, braking = DEFAULT_RAIL_BRAKING) {
      const sample = peakForDistance(distance, braking);
      const cruise = Math.max(0, distance - sample.distance - sample.speed * sample.speed / (2 * braking));
      return { time: sample.time + sample.speed / braking + (sample.speed > 0 ? cruise / sample.speed : 0), speed: sample.speed };
    },
  };
}
