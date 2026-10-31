import data from "@/data/tf3-vehicles.json";
import { calculateOptions, type Vehicle, type Settings } from "./planner";

self.onmessage = (event: MessageEvent<{ id: number; settings: Settings }>) => {
  const { id, settings } = event.data;
  try {
    let lastProgress = -1;
    const options = calculateOptions(data.vehicles as Vehicle[], data.cargos, settings, fraction => {
      const progress = Math.round(fraction * 100);
      if (progress !== lastProgress) { self.postMessage({ id, progress }); lastProgress = progress; }
    });
    self.postMessage({ id, options });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : "Calculation failed" });
  }
};
