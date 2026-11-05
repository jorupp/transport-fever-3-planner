import type { Settings } from "./planner";

export const CONFIG_STORAGE_KEY = "tf3-planner.configs.v1";
export type SavedConfig = { id: string; name: string; settings: Settings; checkedVehicles: string[] };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const inRange = (value: unknown, min: number, max: number, integer = false): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));

// Treat browser storage as untrusted input, including after catalog/schema updates.
export function readSavedConfigs(raw: string | null, cargoIds: readonly string[]): SavedConfig[] {
  if (raw === null) return [];
  const value: unknown = JSON.parse(raw);
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.configs)) throw new Error("Unsupported saved configurations");
  const configs: SavedConfig[] = [];
  for (const entry of value.configs) {
    if (!isRecord(entry) || typeof entry.id !== "string" || !entry.id || entry.id.length > 100 ||
      typeof entry.name !== "string" || !entry.name.trim() || entry.name.trim().length > 100 || !isRecord(entry.settings)) continue;
    const s = entry.settings;
    const includeObsolete = s.includeObsolete ?? false;
    if (typeof includeObsolete !== "boolean") continue;
    const vehicleCostPercent = s.vehicleCostPercent ?? 125, maintenanceCostPercent = s.maintenanceCostPercent ?? 125;
    const additionalStops = s.additionalStops ?? 0, paybackYears = s.paybackYears ?? 20;
    const turns = s.turns ?? 0, speedLimit = s.speedLimit ?? 0;
    if (!inRange(turns, 0, Number.MAX_SAFE_INTEGER - 1, true) || !inRange(speedLimit, 0, Number.MAX_VALUE)) continue;
    if (turns > 0 && (additionalStops as number) > 0) continue;
    if (typeof paybackYears !== "number" || !Number.isFinite(paybackYears) || paybackYears <= 0) continue;
    if (!Number.isSafeInteger(additionalStops) || (additionalStops as number) < 0 || (additionalStops as number) >= Number.MAX_SAFE_INTEGER) continue;
    if (typeof vehicleCostPercent !== "number" || typeof maintenanceCostPercent !== "number" || ![50, 75, 100, 125, 150].includes(vehicleCostPercent) || ![50, 75, 100, 125, 150].includes(maintenanceCostPercent)) continue;
    if (!inRange(s.year, 1800, 2200, true) || !inRange(s.extraYears, 0, 200, true) ||
      !inRange(s.trainLength, 1, 2000) || !inRange(s.tramLength, 1, 500) ||
      !inRange(s.distanceKm, .01, Number.MAX_VALUE) || !inRange(s.minTopSpeed, 0, Number.MAX_VALUE, true) || !Array.isArray(s.cargos)) continue;
    const cargos = [...new Set(s.cargos.filter((id): id is string => typeof id === "string" && cargoIds.includes(id)))];
    const name = entry.name.trim();
    if (!cargos.length || configs.some(c => c.id === entry.id || c.name.toLowerCase() === name.toLowerCase())) continue;
    configs.push({ id: entry.id, name, checkedVehicles: readCheckedVehicles(entry.checkedVehicles), settings: {
      year: s.year, extraYears: s.extraYears, includeObsolete, trainLength: s.trainLength, tramLength: s.tramLength,
      distanceKm: s.distanceKm, additionalStops: additionalStops as number, minTopSpeed: s.minTopSpeed, cargos,
      vehicleCostPercent, maintenanceCostPercent, paybackYears, turns, speedLimit,
    } });
  }
  return configs;
}

function readCheckedVehicles(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && id.length <= 2048
    && /^(train|tram|road|boat|airplane):[^:]+:[1-9]\d*:[^:]+:\d+$/.test(id)))];
}
