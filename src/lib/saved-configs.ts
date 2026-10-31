import type { Settings } from "./planner";

export const CONFIG_STORAGE_KEY = "tf3-planner.configs.v1";
export type SavedConfig = { id: string; name: string; settings: Settings };

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
    const vehicleCostPercent = s.vehicleCostPercent ?? 125, maintenanceCostPercent = s.maintenanceCostPercent ?? 125;
    const additionalStops = s.additionalStops ?? 0;
    if (!Number.isSafeInteger(additionalStops) || (additionalStops as number) < 0 || (additionalStops as number) >= Number.MAX_SAFE_INTEGER) continue;
    if (typeof vehicleCostPercent !== "number" || typeof maintenanceCostPercent !== "number" || ![50, 75, 100, 125, 150].includes(vehicleCostPercent) || ![50, 75, 100, 125, 150].includes(maintenanceCostPercent)) continue;
    if (!inRange(s.year, 1800, 2200, true) || !inRange(s.extraYears, 0, 200, true) ||
      !inRange(s.trainLength, 1, 2000) || !inRange(s.tramLength, 1, 500) ||
      !inRange(s.distanceKm, .01, Number.MAX_VALUE) || !inRange(s.minTopSpeed, 0, Number.MAX_VALUE, true) || !Array.isArray(s.cargos)) continue;
    const cargos = [...new Set(s.cargos.filter((id): id is string => typeof id === "string" && cargoIds.includes(id)))];
    const name = entry.name.trim();
    if (!cargos.length || configs.some(c => c.id === entry.id || c.name.toLowerCase() === name.toLowerCase())) continue;
    configs.push({ id: entry.id, name, settings: {
      year: s.year, extraYears: s.extraYears, trainLength: s.trainLength, tramLength: s.tramLength,
      distanceKm: s.distanceKm, additionalStops: additionalStops as number, minTopSpeed: s.minTopSpeed, cargos,
      vehicleCostPercent, maintenanceCostPercent,
    } });
  }
  return configs;
}
