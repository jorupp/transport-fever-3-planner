import type { Option, Vehicle } from "./planner";

export function stableVehicleId(vehicle: Pick<Vehicle, "id" | "name">) {
  // Model filenames are unique in the catalog and survive directory changes.
  const filename = vehicle.id.replaceAll("\\", "/").split("/").pop()?.replace(/\.[^.]+$/, "");
  if (filename) return filename;
  return `name-${vehicle.name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
}

export function stableFormationId(option: Pick<Option, "mode" | "engine" | "wagon" | "engines" | "wagons">) {
  return `${option.mode}:${encodeURIComponent(stableVehicleId(option.engine))}:${option.engines}:${option.wagon ? encodeURIComponent(stableVehicleId(option.wagon)) : "~"}:${option.wagons}`;
}
