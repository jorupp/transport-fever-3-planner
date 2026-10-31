export type Vehicle = {
  id: string; name: string; source: string; category: string; carrier: string;
  modes: string[]; engineModes: string[]; yearFrom: number; yearTo: number | null;
  length: number; speed: number; power: number; tractiveEffort: number;
  weightEmpty: number; weightMaxPayload: number; friction: number; engineType: string | null;
  capacities: Record<string, number>; loadSpeed: number; comfort: number; noise: number;
  pollution: number; purchase: number; running: number; fixedFormation: boolean;
  parts?: { name: string; source: string }[];
};
export type Cargo = { id: string; name: string; classes: string[]; weightFactor: number; loadSpeedFactor: number };
export type Mode = "train" | "tram" | "road";
export type Settings = { year: number; extraYears: number; trainLength: number; tramLength: number; distanceKm: number; minTopSpeed: number; cargos: string[] };
export type Option = {
  id: string; mode: Mode; engine: Vehicle; wagon: Vehicle | null; engines: number; wagons: number;
  cargo: string; // The selected cargo with the lowest estimated throughput (the metrics benchmark).
  cargos: string[]; capacity: number; length: number; speed: number; acceleration: number;
  performanceAcceleration: number; timeToMaxSpeed: number; distanceToMaxSpeed: number; peakSpeed: number;
  noise: number; pollution: number; comfort: number | null; purchase: number; running: number;
  loadSpeed: number; throughput: number; costPerformance: number; distanceKm: number; yearFrom: number; yearTo: number | null;
  availableAtStart: boolean; availableAtEnd: boolean; fullRange: boolean; lightRail: boolean; loadedMass: number;
};
// Leave a 5 m buffer below the game's default 160 m station length.
export const DEFAULT_SETTINGS: Settings = { year: 1990, extraYears: 10, trainLength: 155, tramLength: 60, distanceKm: 10, minTopSpeed: 0, cargos: ["PASSENGERS"] };

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
  const acceleration = sum("tractiveEffort") * 1000 / loadedMass;
  const loadSpeed = ((engine.capacities[cargo.id] ? engine.loadSpeed * engines : 0) + (wagon?.loadSpeed ?? 0) * wagons) * cargo.loadSpeedFactor;
  // A flat, fully loaded trip over the selected distance, including load/unload.
  // Idealized power/traction-limited average acceleration; no grades, drag, traffic or curves.
  const vmax = speed / 3.6;
  const a = Math.min(acceleration, sum("power") * 1000 / (loadedMass * Math.max(vmax / 2, 1)));
  const timeToMaxSpeed = vmax / a;
  const distanceToMaxSpeed = vmax * vmax / (2 * a);
  const distanceMeters = settings.distanceKm * 1000;
  const peak = Math.min(vmax, Math.sqrt(2 * distanceMeters / (1 / a + 1)));
  const acceleratingDistance = peak * peak / (2 * a);
  const brakingDistance = peak * peak / 2;
  const travelSeconds = peak / a + peak + Math.max(0, distanceMeters - acceleratingDistance - brakingDistance) / peak;
  const throughput = capacity * 3600 / (travelSeconds + 2 * capacity / Math.max(loadSpeed, 0.001));
  const purchase = sum("purchase"), running = sum("running");
  const yearFrom = Math.max(engine.yearFrom, wagon?.yearFrom ?? 0);
  const until = Math.min(engine.yearTo ?? Infinity, wagon?.yearTo ?? Infinity);
  return {
    id: `${mode}:${engine.id}:${engines}:${wagon?.id ?? "self"}`, mode, engine, wagon, engines, wagons, cargo: cargo.id, cargos: [cargo.id],
    capacity, length: sum("length"), speed, acceleration, noise: sum("noise"), pollution: sum("pollution"),
    performanceAcceleration: a, timeToMaxSpeed, distanceToMaxSpeed, peakSpeed: peak * 3.6,
    comfort: cargo.id === "PASSENGERS" ? ((engine.capacities.PASSENGERS ?? 0) * engines * engine.comfort + (wagon?.capacities.PASSENGERS ?? 0) * wagons * (wagon?.comfort ?? 0)) / capacity : null,
    purchase, running, loadSpeed, throughput, distanceKm: settings.distanceKm, costPerformance: throughput > 0 ? (running + purchase / 20) / throughput : Infinity,
    yearFrom, yearTo: Number.isFinite(until) ? until : null,
    availableAtStart: yearFrom <= settings.year && until >= settings.year,
    availableAtEnd: yearFrom <= settings.year + settings.extraYears && until >= settings.year + settings.extraYears,
    fullRange: yearFrom <= settings.year && until >= settings.year + settings.extraYears,
    lightRail: engine.carrier === "TRAM" && mode === "train", loadedMass,
  };
}
