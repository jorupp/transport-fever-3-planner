"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import data from "@/data/tf3-vehicles.json";
import { DEFAULT_SETTINGS, DEFAULT_FINANCE, FINANCE_PRESETS, DEFAULT_PAYBACK_YEARS, sameFormationSettings, formationLoadingFactors, isMultipleUnitMenuVehicle, type FinanceSettings, type Mode, type Option, type Settings } from "@/lib/planner";
import CalculationBreakdown, { LoadingBreakdown } from "@/components/calculation-breakdown";
import SavedConfigs from "@/components/saved-configs";
import { VehiclePreviewButton, VehicleThumbnail, VehicleMenuTag } from "@/components/vehicle-visuals";
import { useDevelopmentState } from "@/lib/use-development-state";

type IconName = "train" | "tram" | "road" | "arrow" | "chevron" | "search" | "info" | "check" | "close" | "sliders" | "download";
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    train: <><rect x="5" y="3" width="14" height="15" rx="4" /><path d="M5 11h14M12 3v8M7 21l2-3m8 3-2-3M8 14h1m6 0h1" /></>,
    tram: <><rect x="5" y="6" width="14" height="12" rx="3" /><path d="M5 12h14M9 6l3-4 3 4M8 2h8M8 21l1-3m7 3-1-3M8 15h1m6 0h1" /></>,
    road: <><rect x="3" y="6" width="18" height="12" rx="3" /><path d="M3 12h18M8 6v6m8-6v6M7 18v3m10-3v3M6 15h1m10 0h1" /></>,
    arrow: <path d="M4 12h15m-5-5 5 5-5 5" />, chevron: <path d="m9 5 7 7-7 7" />,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v.1" /></>,
    check: <path d="m5 12 4 4L19 6" />, close: <path d="m6 6 12 12M6 18 18 6" />,
    sliders: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
    download: <path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
const number = (v: number, d = 0) => v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d });
const estimateNumber = (value: number | null | undefined, decimals = 0) => value == null ? "—" : number(value, decimals);
const money = (v: number, compact = true) => "$" + (compact && v >= 1e6 ? number(v / 1e6, 2) + "m" : compact && v >= 1e3 ? number(v / 1e3, 1) + "k" : number(v));
const thousands = (value: number, decimals = 0) => number(value / 1000, decimals);
const exactPerformanceCost = (value: number) => `$${number(value, 2)} annualized cost per estimated unit/hour`;
const cargoName = (id: string) => data.cargos.find(c => c.id === id)?.name ?? id;
const optionCargoNames = (option: Option) => (option.cargos ?? [option.cargo]).map(cargoName).join(", ");
const standaloneFormationLabel = (option: Option) => isMultipleUnitMenuVehicle(option.engine)
  ? option.engine.fixedFormation ? "Max-length · complete sets" : "Max-length · multiple units only"
  : option.engine.fixedFormation ? "Complete fixed formation" : "Self-propelled vehicle";
const distanceTimingColumns = [
  { key: "timeTo1Km", km: 1 }, { key: "timeTo2Km", km: 2 }, { key: "timeTo3Km", km: 3 },
  { key: "timeTo4Km", km: 4 }, { key: "timeTo5Km", km: 5 },
] as const;
const visibleDistanceTimingColumns = distanceTimingColumns.filter(({ km }) => km === 1);
type SortKey = (typeof distanceTimingColumns)[number]["key"] | "name" | "capacity" | "length" | "speed" | "averageSpeed" | "acceleration" | "timeToMaxSpeed" | "distanceToMaxSpeed" | "loadSpeed" | "comfort" | "noise" | "pollution" | "purchase" | "running" | "throughput" | "costPerformance" | "yearFrom";
const columns: { key: SortKey; label: string; unit?: string; title?: string }[] = [
  { key: "name", label: "Vehicle & formation" },
  { key: "capacity", label: "Capacity", unit: "units" }, { key: "length", label: "Length", unit: "m" },
  { key: "speed", label: "Max speed", unit: "km/h" },
  { key: "averageSpeed", label: "Avg speed", unit: "km/h", title: "Trip distance divided by travel time, including acceleration, braking and all additional stops. Excludes loading, unloading and station pauses." }, { key: "acceleration", label: "Accel.", unit: "m/s²", title: "Estimated acceleration at launch. Rail uses doubled tractive effort, empty mass and rolling resistance, calibrated to TF3 recordings. Trams and road vehicles retain the loaded-mass estimate." },
  { key: "timeToMaxSpeed", label: "Time to max", unit: "s", title: "Time from rest to rated maximum speed, integrating the acceleration curve. Excludes loading and braking. A dash means the rail formation cannot reach its rated top speed on level track." },
  { key: "distanceToMaxSpeed", label: "Dist. to max", unit: "m", title: "Distance from rest to rated maximum speed, integrating the acceleration curve. Excludes braking distance. A dash means the rail formation cannot reach its rated top speed on level track." },
  ...visibleDistanceTimingColumns.map(({ key, km }) => ({ key, label: `Time to ${km}km`, unit: "s", title: `Elapsed time to ${km} km from a standing start, using the movement model, then cruising at top speed. Rail acceleration is calibrated to matching loaded/empty TF3 runs. Excludes loading, braking and additional stops; independent of the trip distance setting.` })),
  { key: "loadSpeed", label: "Load", unit: "/s", title: "Minimum cargo-carrying base rate × number of cargo-carrying vehicles × cargo factor. Vehicles load in parallel." }, { key: "comfort", label: "Comfort", unit: "/ 100" },
  { key: "noise", label: "Noise", unit: "score" }, { key: "pollution", label: "Pollution", unit: "score" },
  { key: "purchase", label: "Purchase", unit: "$000s", title: "Purchase price in thousands of dollars; hover a value for the exact price" }, { key: "running", label: "Running", unit: "$000s/yr", title: "Annual running cost in thousands of dollars; hover a value for the exact cost" },
  { key: "throughput", label: "Performance", unit: "units/h" },
  { key: "costPerformance", label: "Cost / perf.", unit: "$000s ↓", title: "Annualized cost ÷ estimated units/hour, in thousands of dollars. Lower is better. Hover a value for the exact cost." },
  { key: "yearFrom", label: "Available", unit: "years" },
];
const columnWidths: Record<SortKey, number> = {
  name: 260, capacity: 58, length: 52, speed: 54, averageSpeed: 58, acceleration: 56,
  timeToMaxSpeed: 66, distanceToMaxSpeed: 68,
  timeTo1Km: 66, timeTo2Km: 66, timeTo3Km: 66, timeTo4Km: 66, timeTo5Km: 66,
  loadSpeed: 42, comfort: 56, noise: 42, pollution: 56, purchase: 64, running: 64,
  throughput: 80, costPerformance: 74, yearFrom: 86,
};

type Draft = { year: string; extraYears: string; trainLength: string; tramLength: string; distanceKm: string; minTopSpeed: string; cargos: string[] };
const initialDraft: Draft = { year: "1990", extraYears: "10", trainLength: String(DEFAULT_SETTINGS.trainLength), tramLength: "60", distanceKm: String(DEFAULT_SETTINGS.distanceKm), minTopSpeed: String(DEFAULT_SETTINGS.minTopSpeed), cargos: ["PASSENGERS"] };

export default function Planner() {
  const [finance, setFinance] = useDevelopmentState<FinanceSettings>("planner.finance", DEFAULT_FINANCE);
  const [financeOpen, setFinanceOpen] = useState(false);
  const [additionalStops, setAdditionalStops] = useDevelopmentState("planner.additionalStops", "0");
  const [paybackYears, setPaybackYears] = useDevelopmentState("planner.paybackYears", String(DEFAULT_PAYBACK_YEARS));
  const financePreset = FINANCE_PRESETS.find(p => p.percent === finance.vehicleCostPercent && p.percent === finance.maintenanceCostPercent);
  const [draft, setDraft] = useDevelopmentState<Draft>("planner.draft", initialDraft);
  const [applied, setApplied] = useDevelopmentState<Settings>("planner.applied", DEFAULT_SETTINGS);
  const [options, setOptions] = useState<Option[]>([]);
  const [busy, setBusy] = useState(true), [progress, setProgress] = useState(0), [error, setError] = useState("");
  const [mode, setMode] = useDevelopmentState<Mode>("planner.mode", "train"), [search, setSearch] = useDevelopmentState("planner.search", "");
  const deferredSearch = useDeferredValue(search);
  const [sort, setSort] = useDevelopmentState<{ key: SortKey; asc: boolean }>("planner.sort", { key: "costPerformance", asc: true });
  const [page, setPage] = useDevelopmentState("planner.page", 0), [selected, setSelected] = useState<Option | null>(null);
  const [checkedIds, setCheckedIds] = useDevelopmentState<string[]>("planner.checkedIds", []);
  const [showOnlyChecked, setShowOnlyChecked] = useDevelopmentState("planner.showOnlyChecked", false);
  const [methodology, setMethodology] = useState(false), [cargoSearch, setCargoSearch] = useDevelopmentState("planner.cargoSearch", ""), [cargoOpen, setCargoOpen] = useState(false);
  const worker = useRef<Worker | null>(null), requestId = useRef(0), form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    try {
      const instance = new Worker(new URL("../lib/planner.worker.ts", import.meta.url));
      worker.current = instance;
      instance.onmessage = (event: MessageEvent<{ id: number; progress?: number; options?: Option[]; error?: string }>) => {
        if (event.data.id !== requestId.current) return;
        if (event.data.progress !== undefined) setProgress(event.data.progress);
        if (event.data.options) { setOptions(event.data.options); setBusy(false); setProgress(100); }
        if (event.data.error) { setError(event.data.error); setBusy(false); }
      };
      instance.onerror = () => { setError("The calculation worker could not start. Reload the page to try again."); setBusy(false); };
      return () => { instance.terminate(); worker.current = null; };
    } catch {
      queueMicrotask(() => { setError("Your browser could not start the calculation worker. Enable web workers and reload."); setBusy(false); });
    }
  }, []);
  useEffect(() => {
    // Fast Refresh recreates effects/workers. Rebuild the currently applied plan,
    // retaining any separate unsaved draft instead of reverting to defaults.
    worker.current?.postMessage({ id: ++requestId.current, settings: applied });
  }, [applied]);
  const parsedDraft: Settings = { year: Number(draft.year), extraYears: Number(draft.extraYears), trainLength: Number(draft.trainLength), tramLength: Number(draft.tramLength), distanceKm: Number(draft.distanceKm), additionalStops: Number(additionalStops), paybackYears: Number(paybackYears), minTopSpeed: Number(draft.minTopSpeed), cargos: draft.cargos, ...finance };
  const appliedDefaults = { ...applied, additionalStops: applied.additionalStops ?? 0, paybackYears: applied.paybackYears ?? DEFAULT_PAYBACK_YEARS, vehicleCostPercent: applied.vehicleCostPercent ?? DEFAULT_FINANCE.vehicleCostPercent, maintenanceCostPercent: applied.maintenanceCostPercent ?? DEFAULT_FINANCE.maintenanceCostPercent };
  const dirty = Object.entries(parsedDraft).some(([key, value]) => JSON.stringify(value) !== JSON.stringify(appliedDefaults[key as keyof Settings]));
  const showComfort = applied.cargos.includes("PASSENGERS");
  const visibleColumns = columns.filter(column => showComfort || column.key !== "comfort");
  const tableMinimumWidth = 32 + visibleColumns.reduce((sum, column) => sum + columnWidths[column.key], 0);
  const modeOptions = useMemo(() => options.filter(o => o.mode === mode), [options, mode]);
  const checked = useMemo(() => new Set(checkedIds), [checkedIds]);
  const checkedModeCount = checkedIds.filter(id => id.startsWith(`${mode}:`)).length;
  const hiddenCheckedCount = checkedModeCount - modeOptions.filter(o => checked.has(o.id)).length;
  const sortedOptions = useMemo(() => {
    return [...modeOptions].sort((a, b) => {
      const av = sort.key === "name" ? `${a.engine.name} ${a.wagon?.name ?? ""}` : a[sort.key];
      const bv = sort.key === "name" ? `${b.engine.name} ${b.wagon?.name ?? ""}` : b[sort.key];
      if (av === null) return bv === null ? a.id.localeCompare(b.id) : 1;
      if (bv === null) return -1;
      const cmp = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : Number(av) - Number(bv);
      return (sort.asc ? cmp : -cmp) || a.id.localeCompare(b.id);
    });
  }, [modeOptions, sort]);
  const searchMatches = useMemo(() => {
    const query = deferredSearch.toLowerCase().trim();
    return sortedOptions.filter(o => !query || `${o.engine.name} ${o.wagon?.name ?? ""} ${optionCargoNames(o)}`.toLowerCase().includes(query));
  }, [sortedOptions, deferredSearch]);
  // Comparison brings together choices collected under different searches.
  const filtered = useMemo(() => showOnlyChecked ? sortedOptions.filter(o => checked.has(o.id)) : searchMatches,
    [sortedOptions, searchMatches, showOnlyChecked, checked]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / 40)), currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * 40, currentPage * 40 + 40);
  const best = filtered.reduce<Option | null>((a, b) => !a || b.costPerformance < a.costPerformance ? b : a, null);
  const largest = filtered.reduce<Option | null>((a, b) => !a || b.capacity > a.capacity ? b : a, null);
  const fastest = filtered.reduce<Option | null>((a, b) => !a || b.speed > a.speed ? b : a, null);

  useEffect(() => {
    if (!cargoOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setCargoOpen(false); document.querySelector<HTMLButtonElement>(".cargo-trigger")?.focus(); } };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [cargoOpen]);

  function currentSettings(): Settings | null {
    if (!form.current?.reportValidity()) return null;
    if (!draft.cargos.length) { setError("Choose at least one item to transport."); return null; }
    return parsedDraft;
  }
  function runCalculation(settings: Settings) {
    if (!worker.current) { setError("The calculation worker is unavailable. Reload the page to try again."); return; }
    setError(""); setApplied(settings); setBusy(true); setOptions([]); setProgress(0); setPage(0); setSelected(null);
    if (!sameFormationSettings(applied, settings)) { setCheckedIds([]); setShowOnlyChecked(false); }
    if (!settings.cargos.includes("PASSENGERS") && sort.key === "comfort") setSort({ key: "costPerformance", asc: true });
  }
  function calculate(event: FormEvent) {
    event.preventDefault();
    const settings = currentSettings();
    if (settings) runCalculation(settings);
  }
  function loadConfig(settings: Settings) {
    setAdditionalStops(String(settings.additionalStops ?? 0));
    setPaybackYears(String(settings.paybackYears ?? DEFAULT_PAYBACK_YEARS));
    setFinance({ vehicleCostPercent: settings.vehicleCostPercent ?? DEFAULT_FINANCE.vehicleCostPercent, maintenanceCostPercent: settings.maintenanceCostPercent ?? DEFAULT_FINANCE.maintenanceCostPercent });
    setDraft({ year: String(settings.year), extraYears: String(settings.extraYears), trainLength: String(settings.trainLength), tramLength: String(settings.tramLength), distanceKm: String(settings.distanceKm), minTopSpeed: String(settings.minTopSpeed), cargos: [...settings.cargos] });
    setCargoOpen(false); setSearch("");
    runCalculation(settings);
  }
  function exportCsv() {
    const header = ["Engine", "Wagon", "Engines / sets", "Wagons", "Supported cargo", "Metrics cargo", "Capacity", "Length (m)", "Speed (km/h)", "Average speed (km/h; travel only)", "Acceleration estimate (m/s2)", "Mean acceleration to max (rail) / effective acceleration (other) (m/s2)", "Time to max speed (s)", "Distance to max speed (m)", ...distanceTimingColumns.map(({ km }) => `Time to ${km} km from rest (s; no braking)`), "Peak speed on trip (km/h)", "Braking deceleration (m/s2)", "Braking time from trip peak (s)", "Braking distance from trip peak (m)", "Destination arrival pause (s)", "Movement model", "Mass used for movement (kg)", "Theoretical loaded mass (kg)", "Loading (units/s)", "Comfort", "Noise score sum", "Pollution score sum", "Purchase ($)", "Yearly running ($)", "Vehicle costs (%)", "Maintenance (%)", "Purchase payback period (years)", "Trip distance (km)", "Additional stops", "Segment distance (km)", "Throughput estimate (units/h)", "Annualized cost / throughput", "Available from", "Available until", "Available at start", "Available at end", "Full range"];
    const rows = filtered.map(o => [o.engine.name, o.wagon?.name ?? "", o.engines, o.wagons, optionCargoNames(o), cargoName(o.cargo), o.capacity, o.length, o.speed, o.averageSpeed, o.acceleration, o.performanceAcceleration ?? "", o.timeToMaxSpeed ?? "", o.distanceToMaxSpeed ?? "", ...distanceTimingColumns.map(({ key }) => o[key]), o.peakSpeed, o.brakingAcceleration, o.brakingTime, o.brakingDistance, o.arrivalDelaySeconds, o.motionModel, o.motionMass, o.loadedMass, o.loadSpeed, o.comfort ?? "", o.noise, o.pollution, o.purchase, o.running, o.vehicleCostPercent, o.maintenanceCostPercent, o.paybackYears ?? DEFAULT_PAYBACK_YEARS, o.distanceKm, o.additionalStops ?? 0, o.distanceKm / ((o.additionalStops ?? 0) + 1), o.throughput, o.costPerformance, o.yearFrom, o.yearTo ?? "", o.availableAtStart, o.availableAtEnd, o.fullRange]);
    const csv = [header, ...rows].map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `tf3-${mode}-${applied.year}-${applied.year + applied.extraYears}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function changeMode(next: Mode) { setMode(next); setPage(0); }
  function toggleCargo(id: string) { setDraft(d => ({ ...d, cargos: d.cargos.includes(id) ? d.cargos.filter(c => c !== id) : [...d.cargos, id] })); }
  function toggleChecked(id: string) {
    setCheckedIds(ids => ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id]);
  }
  function checkCheapestByCurrentMetric() {
    let cheapest = Infinity;
    const ids: string[] = [];
    for (const option of searchMatches) {
      if (option.costPerformance < cheapest) {
        ids.push(option.id);
        cheapest = option.costPerformance;
      }
    }
    setCheckedIds(ids); setShowOnlyChecked(true); setPage(0);
  }

  return <div className="app-shell">
    <div className="main-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Transport Fever 3 Planner home"><span className="brand-symbol"><Icon name="train" size={23} /></span><span>TRANSPORT FEVER <b>3</b><small>PLANNING TOOLS</small></span></Link>
        <nav className="app-nav" aria-label="App navigation">
          <a href="#planner" className="nav-active" aria-current="page"><Icon name="sliders" size={17} /> Vehicle planner</a>
          <button type="button" onClick={() => setFinanceOpen(true)} title={`Vehicle costs ${finance.vehicleCostPercent}% · maintenance ${finance.maintenanceCostPercent}%`}><Icon name="sliders" size={16} /> Finance · {financePreset?.name ?? "Custom"}</button>
          <button type="button" onClick={() => setMethodology(true)}><Icon name="info" size={16} /> Data & methodology</button>
        </nav>
        <span className="dataset-status"><span className="online-dot" /> TF3 · {data.counts.vehicles} vehicles · {data.counts.cargoTypes} cargo types</span>
      </header>
      <main id="planner">
        <section className="page-heading"><h1>Build your fleet</h1></section>
        <section className="plan-card" aria-labelledby="plan-title">
          <div className="card-title"><h2 id="plan-title"><span className="step-number">01</span> Set your parameters</h2><SavedConfigs getSettings={currentSettings} onLoad={loadConfig} /></div>
          <form ref={form} onSubmit={calculate}>
            <div className="parameter-grid">
              <fieldset className="year-fields"><legend>Availability window</legend><div className="joined-fields"><label><span>Start year</span><input aria-label="Start year" type="number" required min="1800" max="2200" value={draft.year} onChange={e => setDraft({ ...draft, year: e.target.value })} /></label><span className="field-plus">+</span><label className="extra-years"><span>Additional years</span><div className="input-unit"><input aria-label="Additional years" type="number" min="0" max="200" value={draft.extraYears} placeholder="0" onChange={e => setDraft({ ...draft, extraYears: e.target.value })} /><span>yrs</span></div></label></div><div className="field-hint">Includes vehicles available at any point in the window</div></fieldset>
              <fieldset><legend>Maximum formation length</legend><div className="length-fields"><label><span><Icon name="train" size={14} /> Train</span><div className="input-unit"><input aria-label="Maximum train length" type="number" required min="1" max="2000" step="0.1" value={draft.trainLength} onChange={e => setDraft({ ...draft, trainLength: e.target.value })} /><span>m</span></div></label><label><span><Icon name="tram" size={14} /> Tram</span><div className="input-unit"><input aria-label="Maximum tram length" type="number" required min="1" max="500" step="0.1" value={draft.tramLength} onChange={e => setDraft({ ...draft, tramLength: e.target.value })} /><span>m</span></div></label></div><div className="field-hint">Engines and wagons included · road vehicles have no limit</div></fieldset>
              <fieldset><legend>Performance estimate</legend><div className="length-fields performance-fields"><label><span>Trip distance</span><div className="input-unit"><input aria-label="Trip distance" type="number" required min="0.01" step="any" value={draft.distanceKm} onChange={e => setDraft({ ...draft, distanceKm: e.target.value })} /><span>km</span></div></label><label><span>Additional stops</span><div className="input-unit"><input aria-label="Additional stops" title="Full stops equally spaced during the journey. Immediately restart; no loading or waiting at these stops." type="number" min="0" step="1" placeholder="0" value={additionalStops} onChange={e => setAdditionalStops(e.target.value)} /></div></label><label><span>Min. top speed</span><div className="input-unit"><input aria-label="Minimum top speed" type="number" min="0" step="1" placeholder="0" value={draft.minTopSpeed} onChange={e => setDraft({ ...draft, minTopSpeed: e.target.value })} /><span>km/h</span></div></label><label className="payback-field"><span>Purchase payback</span><div className="input-unit"><input aria-label="Purchase payback period" type="number" required min="0.01" step="any" value={paybackYears} onChange={e => setPaybackYears(e.target.value)} /><span>years</span></div></label></div><div className="field-hint">Extra stops divide the trip equally · no waiting or loading</div></fieldset>
              <div className="cargo-field"><label className="field-legend" id="cargo-label">Items to transport</label><div className="cargo-picker"><button type="button" className="cargo-trigger" aria-labelledby="cargo-label" aria-expanded={cargoOpen} onClick={() => setCargoOpen(!cargoOpen)}><span className="cargo-selected">{draft.cargos.length === 1 ? cargoName(draft.cargos[0]) : `${draft.cargos.length} items selected`}</span><span className="down-chevron">⌄</span></button>{cargoOpen && <><button className="popover-backdrop" type="button" aria-label="Close cargo picker" onClick={() => setCargoOpen(false)} /><div className="cargo-popover"><div className="cargo-popover-heading"><strong>Choose your cargo</strong><button className="icon-button" aria-label="Close cargo picker" type="button" onClick={() => setCargoOpen(false)}><Icon name="close" size={16} /></button></div><input type="search" placeholder="Find an item…" aria-label="Search cargo types" value={cargoSearch} onChange={e => setCargoSearch(e.target.value)} /><div className="cargo-actions"><button type="button" onClick={() => setDraft({ ...draft, cargos: data.cargos.map(c => c.id) })}>Select all</button><button type="button" onClick={() => setDraft({ ...draft, cargos: [] })}>Clear</button></div><div className="cargo-choices">{data.cargos.filter(c => c.name.toLowerCase().includes(cargoSearch.toLowerCase())).map(c => <label key={c.id}><input type="checkbox" checked={draft.cargos.includes(c.id)} onChange={() => toggleCargo(c.id)} /><span>{c.name}</span></label>)}</div><p>Each result must support every selected cargo. One row per formation; capacity is for one cargo load at a time.</p></div></>}</div><div className="field-hint">Must support all selected items</div></div>
            </div>
            <div className="plan-footer"><div><span className="parameter-note"><Icon name="info" size={15} /> One wagon type per formation. Always the maximum that fits.</span>{dirty && <span className="unsaved-dot">Parameters changed</span>}</div><button className="primary-button" disabled={busy || !draft.cargos.length} type="submit">{busy ? "Calculating…" : "Calculate options"}<Icon name="arrow" size={18} /></button></div>
          </form>
        </section>
        <section className="results-section" aria-label="Vehicle results" aria-busy={busy}>
          <div className="results-heading"><div><div className="eyebrow">EXPLORE THE POSSIBILITIES</div><div className="results-title-row"><h2>Your fleet options <span>{applied.year}<span className="year-arrow">→</span>{applied.year + applied.extraYears}</span></h2><PerformanceHelp distanceKm={applied.distanceKm} additionalStops={applied.additionalStops ?? 0} paybackYears={applied.paybackYears ?? DEFAULT_PAYBACK_YEARS} /></div></div><button className="secondary-button" onClick={exportCsv} disabled={busy || !filtered.length}><Icon name="download" size={16} /> Export CSV</button></div>
          {error && <div className="error-message" role="alert">{error}</div>}
          {busy && <div className="calculation-progress" role="progressbar" aria-label="Calculating vehicle options" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${progress}%` }} /><span>Calculating formations · {progress}%</span></div>}
          <div className="results-card">
            <div className="tabs" role="tablist" aria-label="Vehicle types">{(["train", "tram", "road"] as Mode[]).map(m => <button key={m} id={`tab-${m}`} type="button" role="tab" aria-selected={mode === m} aria-controls="vehicle-panel" tabIndex={mode === m ? 0 : -1} onKeyDown={e => { const modes: Mode[] = ["train", "tram", "road"]; const i = modes.indexOf(m); if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); const next = modes[(i + (e.key === "ArrowRight" ? 1 : 2)) % 3]; changeMode(next); document.getElementById(`tab-${next}`)?.focus(); } }} className={mode === m ? "tab active" : "tab"} onClick={() => changeMode(m)}><Icon name={m} />{m === "train" ? "Trains" : m === "tram" ? "Trams" : "Road vehicles"}<span>{options.filter(o => o.mode === m).length}</span></button>)}</div>
            <div id="vehicle-panel" role="tabpanel" aria-labelledby={`tab-${mode}`}>
              <div className="highlights"><Highlight option={best} label="BEST COST / PERFORMANCE" value={best ? thousands(best.costPerformance, 2) : "—"} unit="$000s / unit/h, annually" title={best ? exactPerformanceCost(best.costPerformance) : undefined} onClick={() => best && setSelected(best)} icon="↘" /><Highlight option={largest} label="LARGEST CAPACITY" value={largest ? number(largest.capacity, largest.capacity % 1 ? 1 : 0) : "—"} unit={largest && (largest.cargos?.length ?? 1) === 1 ? cargoName(largest.cargo).toLowerCase() : "units"} onClick={() => largest && setSelected(largest)} icon="▥" /><Highlight option={fastest} label="FASTEST OPTION" value={fastest ? number(fastest.speed) : "—"} unit="km/h" onClick={() => fastest && setSelected(fastest)} icon="↗" /></div>
              <div className="table-toolbar"><label className="search-field"><Icon name="search" size={17} /><input type="search" aria-label="Search vehicle options" disabled={showOnlyChecked} title={showOnlyChecked ? "Search is paused while comparing checked options." : undefined} placeholder="Search engines, wagons, cargo…" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} /></label><div className="comparison-controls"><button type="button" className="secondary-button check-cheapest" disabled={busy || deferredSearch !== search || !searchMatches.length} title="Replace all checks using search-matching options in this tab, across every page. In the current sort order, check only a strictly better cost/performance than every earlier row. Ignores the checked-only filter; equal costs are skipped." onClick={checkCheapestByCurrentMetric}>Check cheapest by current metric</button><button type="button" className="secondary-button compare-toggle" aria-pressed={showOnlyChecked} disabled={busy || (!checkedModeCount && !showOnlyChecked)} title="Show checked options in this tab, including those hidden by your search. Checks persist for distance, stops, speed and cost changes; year window, length or cargo changes reset them." onClick={() => { setShowOnlyChecked(value => !value); setPage(0); }}><Icon name="check" size={14} /> Show only checked ({checkedModeCount})</button><button type="button" className="clear-checks" disabled={busy || !checkedIds.length} title="Clear checked options in all tabs" onClick={() => { setCheckedIds([]); setShowOnlyChecked(false); setPage(0); }}>Clear checks</button></div><span className="engine-options-note">{mode === "road" ? "Single road vehicles" : mode === "train" ? "1–2 engines · 1–5 MUs + wagons · max-length MUs only" : "1 & 2 engines shown together"}</span></div>
              <div className="table-caption"><span><strong>{filtered.length}</strong> {showOnlyChecked ? "checked options · search paused" : "matching options"}{hiddenCheckedCount > 0 && !busy && <span> · {hiddenCheckedCount} checked hidden by minimum speed</span>} <span className="caption-separator">/</span> {number(applied.distanceKm, 2)} km trip{applied.minTopSpeed > 0 && <> · ≥ {number(applied.minTopSpeed)} km/h</>} <span className="caption-separator">/</span> {applied.cargos.map(cargoName).join(", ")}</span><div className="availability-legend"><span><i className="legend-dot full" />Full range</span><span><i className="legend-dot partial" />Unavailable at end</span><span><i className="legend-dot future" />Unavailable at start</span></div></div>
              <div className="table-scroll"><table className="vehicle-table" style={{ minWidth: tableMinimumWidth }}><colgroup><col style={{ width: 32 }} />{visibleColumns.map(col => <col key={col.key} style={col.key === "name" ? undefined : { width: columnWidths[col.key] }} />)}</colgroup><thead><tr><th className="sticky-column compare-cell" aria-label="Compare options" title="Check rows to compare; selections reset when the year window, lengths or cargo selection change"><Icon name="check" size={14} /></th>{visibleColumns.map(col => <th key={col.key} aria-sort={sort.key === col.key ? (sort.asc ? "ascending" : "descending") : "none"} className={col.key === "name" ? "sticky-column" : ""}><button title={col.title} onClick={() => { setSort({ key: col.key, asc: sort.key === col.key ? !sort.asc : !["speed", "averageSpeed", "capacity", "acceleration", "comfort", "throughput", "loadSpeed"].includes(col.key) }); setPage(0); }}><span>{col.label}<small>{col.unit ?? "click to inspect"}</small></span><span className={sort.key === col.key ? "sort-arrow selected" : "sort-arrow"}>{sort.key === col.key ? (sort.asc ? "↑" : "↓") : "↕"}</span></button></th>)}</tr></thead><tbody>{visible.map(o => <tr key={o.id} className={`${!o.availableAtStart ? "future-option" : ""} ${!o.availableAtEnd ? "partial-option" : ""} ${checked.has(o.id) ? "checked-option" : ""}`}>
                <td className="sticky-column compare-cell"><input type="checkbox" aria-label={`Compare ${o.engines}× ${o.engine.name}${o.wagon ? ` + ${o.wagons}× ${o.wagon.name}` : ""}`} checked={checked.has(o.id)} onChange={() => toggleChecked(o.id)} /></td>
                <td className="sticky-column vehicle-cell"><VehiclePreviewButton option={o} onClick={() => setSelected(o)}><span className="vehicle-description"><strong><span className="vehicle-name"><VehicleThumbnail vehicle={o.engine} />{o.engines}× {o.engine.name}</span><VehicleMenuTag vehicle={o.engine} /><AvailabilityBadges option={o} startYear={applied.year} />{o.lightRail && <em className="light-rail-badge" title="Light rail">LR</em>}</strong><small>{o.wagon ? <><VehicleThumbnail vehicle={o.wagon} />{o.wagons} × {o.wagon.name}</> : standaloneFormationLabel(o)}</small></span><Icon name="chevron" size={12} /></VehiclePreviewButton></td>
                <td className="capacity-cell"><strong>{number(o.capacity, o.capacity % 1 ? 1 : 0)}</strong></td><td>{number(o.length, 1)}</td><td className="strong-value">{number(o.speed)}</td><td>{estimateNumber(o.averageSpeed, 1)}</td><td>{number(o.acceleration, 2)}</td><td title={`${o.motionModel === "calibrated-rail" ? "Average acceleration to max" : "Effective constant acceleration"}: ${estimateNumber(o.performanceAcceleration, 3)} m/s². ${o.timeToMaxSpeed === null ? "Rated top speed is unreachable on level track. " : ""}Peak speed on this trip: ${estimateNumber(o.peakSpeed, 1)} km/h.`}>{estimateNumber(o.timeToMaxSpeed, 1)}</td><td title={`Acceleration distance only; add braking distance to check whether top speed fits the trip. Peak speed on this trip: ${estimateNumber(o.peakSpeed, 1)} km/h.`}>{estimateNumber(o.distanceToMaxSpeed)}</td>{visibleDistanceTimingColumns.map(({ key, km }) => <td key={key} title={`Time to ${km} km from rest, without loading or braking.`}>{estimateNumber(o[key], 1)}</td>)}<td title={`${number(o.loadSpeed, 6)} units/s = ${number(formationLoadingFactors(o.engine, o.wagon, o.engines, o.wagons, o.cargo).baseRate, 3)}× base rate × ${formationLoadingFactors(o.engine, o.wagon, o.engines, o.wagons, o.cargo).carryingVehicleCount} cargo-carrying vehicles × cargo factor. Vehicles load in parallel.`}>{o.loadSpeed.toLocaleString("en-US", { maximumFractionDigits: o.loadSpeed < 1 ? 4 : 0 })}</td>{showComfort && <td>{o.comfort === null ? "—" : number(o.comfort)}</td>}<td>{number(o.noise)}</td><td>{number(o.pollution)}</td><td title={money(o.purchase, false)}>{thousands(o.purchase)}</td><td title={`${money(o.running, false)} per year`}>{thousands(o.running)}</td><td>{number(o.throughput, 1)}</td><td className="value-cell" title={exactPerformanceCost(o.costPerformance)}><strong>{thousands(o.costPerformance, 2)}</strong>{o.id === best?.id && <span className="best-tag">BEST VALUE</span>}</td><td className="availability-cell" title={`Formation purchase window: ${o.yearFrom}–${o.yearTo ?? "ongoing"}`}><span>{o.yearFrom}–{o.yearTo ?? "∞"}</span></td>
              </tr>)}</tbody></table>{!visible.length && !busy && <div className="empty-state"><Icon name={mode} size={32} /><h3>{showOnlyChecked ? "No checked options in this tab" : "No formations found"}</h3><p>{showOnlyChecked ? "Show all options to choose more vehicles, or lower the minimum top speed to restore hidden checked options." : modeOptions.length ? "Try another vehicle or cargo search." : "Try a different year, a longer formation, fewer cargo requirements, or a lower minimum speed."}</p>{showOnlyChecked ? <button className="secondary-button" onClick={() => { setShowOnlyChecked(false); setPage(0); }}>Show all options</button> : modeOptions.length > 0 && <button className="secondary-button" onClick={() => setSearch("")}>Clear search</button>}</div>}</div>
              <div className="table-footer"><span>{filtered.length ? `${currentPage * 40 + 1}–${Math.min((currentPage + 1) * 40, filtered.length)}` : "0"} of {number(filtered.length)} options <span className="caption-separator">·</span> Scroll horizontally for all metrics</span><div className="pagination"><button aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>←</button><span>{currentPage + 1} / {pageCount}</span><button aria-label="Next page" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>→</button></div></div>
            </div>
          </div>
          <div className="results-note"><Icon name="info" size={16} /><p>Grey options are unavailable in {applied.year}. Yellow marks options unavailable in {applied.year + applied.extraYears}. Light rail appears in both eligible tabs and only couples to tram cars.</p><button onClick={() => setMethodology(true)}>How are metrics calculated? <Icon name="arrow" size={15} /></button></div>
        </section>
        <footer className="page-footer"><span>TRANSPORT FEVER 3 <b>/</b> INDEPENDENT PLANNING TOOLS</span><span>Made for the long haul.</span></footer>
      </main>
    </div>
    {selected && <OptionDialog option={selected} settings={applied} onClose={() => setSelected(null)} />}
    {financeOpen && <FinanceDialog initial={finance} onClose={() => setFinanceOpen(false)} onApply={next => { setFinance(next); runCalculation({ ...applied, ...next }); setFinanceOpen(false); }} />}
    {methodology && <Modal title="Data & methodology" onClose={() => setMethodology(false)}><div className="methodology"><p className="dialog-intro">A reproducible catalog from your installed copy of Transport Fever 3.</p><h3>Source data</h3><p>{data.counts.vehicles} vehicles and {data.counts.cargoTypes} cargo types, extracted on {data.extractedAt.slice(0, 10)}. Names, dimensions, transport modes, years, loading, comfort and emission scores come from TF3’s base definitions. Missing stats use TF3’s regression models. Purchase and yearly running costs use TF3’s base cost formula scaled by the selected finance multipliers. Hard (125% for both) is the default. Maintenance condition, company level and mods may cause further differences.</p><h3>Formations & availability</h3><p>Wagon formations use one or two identical engines, or one through five identical multiple units, and the maximum count of one compatible wagon type that fits the length limit. Multiple-unit-only trains use the maximum number of identical units or complete sets that fits the train length limit, so noise and pollution compare full-length formations. Every formation is purchasable at some point in the window. Grey marks options unavailable at the start; yellow marks options unavailable at the end. Both components must be purchasable together in at least one selected year. Year endpoints are inclusive; no retirement year means ongoing availability. Complete, game-authored multiple units are kept intact and labeled as fixed formations; their internal cars are not recombined. A light-rail option in the train tab uses the train length limit.</p><h3>Capacity, comfort & emissions</h3><p>TF3’s raw capacity is divided by four, following its own cost model. Every formation must support all selected cargo types, with one row per formation. Each cargo is evaluated as a separate full load; the displayed capacity, loading, acceleration and performance use the cargo with the lowest throughput. This checks cargo flexibility rather than simultaneous mixed-cargo allocation. Comfort is weighted by passenger capacity. Noise and pollution are sums of component scores, useful for comparing complete formations; they are not decibels or measured environmental exposure.</p><h3>Estimated acceleration</h3><p>Rail movement uses a speed-dependent curve: a(v) = min(2F/m, P/(mv)) − r. F is listed tractive effort in newtons, P is power in watts, m is empty formation mass in kilograms and r is the mass-weighted friction value (0.02 m/s² for the tested vehicles). Both loaded and empty runs of Swiss Re 4/4 I and CLe 2/4 Roter Pfeil with nine Cargo Car 1960 wagons support this calibration. Cargo weight has no effect on rail movement in this model; cargo capacity and loading still affect throughput. Trams, including light rail, and road vehicles retain the previous constant estimate using loaded mass. Other builds, mods and vehicle maintenance can differ.</p><h3>Cost per performance · lower is better</h3><p>Performance is estimated units per hour over the selected {number(applied.distanceKm, 2)} km trip, starting and ending at rest, plus one full load and unload. Rail travel integrates the calibrated acceleration curve and solves for the peak speed that leaves room to brake. Trams and road vehicles use the constant power/traction estimate at half maximum speed. Rail braking uses the lowest component brake deceleration (2.5 m/s² in the current catalog), consistent with the recorded Roter Pfeil approach. A measured two-second pause before destination loading/unloading is included once per rail trip. Origin loading starts ready; departure/door-closing pauses are not modeled. Trams and road vehicles retain the uncalibrated 1 m/s² braking estimate. Additional stops split the trip into equally spaced segments, each beginning and ending at rest. Intermediate stops immediately restart without loading, unloading or station pauses. Cargo handling and the arrival pause are counted only at the journey endpoints. Loading uses the minimum base rate among cargo-carrying components, multiplied by the number of cargo-carrying vehicles and the cargo’s load-speed factor. Vehicles load in parallel. The recorded 135-log load with nine Cargo Car 1960 wagons rated 2× took about 120 seconds at normal time with a 1× station. Follow-up tests support parallel loading: seven Stake Car 1945 wagons loaded from 1/140 to 140/140 in 80 seconds (predicted 79.43), and one Cargo Car 1960 loaded from 1/15 to 15/15 in 113 seconds (predicted 112). The benchmark excludes traffic waits, curves, grades and return trips.</p><div className="formula">Annual cost / throughput<br /><strong>(yearly running cost + purchase price ÷ {number(applied.paybackYears ?? DEFAULT_PAYBACK_YEARS, 2)}) ÷ units per hour</strong></div><p>This blends capacity, top speed, acceleration and loading speed. It is a comparison metric, not profit or an in-game income forecast. Compare like cargo types; different units and loading factors affect the ranking.</p><h3>Refresh after a game update</h3><code>npm run data:extract</code><p>The extractor is in <code>scripts/extract_tf3.py</code>. It reads game files once and generates the committed JSON catalog. The app never reads the installation at runtime.</p><details><summary>Catalog fingerprint</summary><code className="hash">{data.definitionHash}</code></details></div></Modal>}
  </div>;
}


function AvailabilityBadges({ option: o, startYear }: { option: Option; startYear: number }) {
  const introductionSource = o.wagon && o.wagon.yearFrom > o.engine.yearFrom ? o.wagon.name : o.engine.name;
  const removalSource = o.wagon && (o.wagon.yearTo ?? Infinity) < (o.engine.yearTo ?? Infinity) ? o.wagon.name : o.engine.name;
  return <>
    {!o.availableAtStart && <span className="name-year-badge introduction" title={`${introductionSource} becomes available in ${o.yearFrom}. Wait ${o.yearFrom - startYear} years from the plan's start.`}>From {o.yearFrom} · +{o.yearFrom - startYear}y</span>}
    {!o.availableAtEnd && <span className="name-year-badge removal" title={`${removalSource} is last available for purchase in ${o.yearTo}.`}>Until {o.yearTo}</span>}
  </>;
}

function PerformanceHelp({ distanceKm, additionalStops, paybackYears }: { distanceKm: number; additionalStops: number; paybackYears: number }) {
  const [open, setOpen] = useState(false);
  return <span className="performance-help"
    onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
    onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
    onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}>
    <button type="button" className="icon-button performance-help-trigger"
      aria-label="How performance is calculated" aria-describedby={open ? "performance-tooltip" : undefined}
      onClick={() => setOpen(true)}><Icon name="info" size={17} /></button>
    {open && <span id="performance-tooltip" role="tooltip" className="performance-tooltip">
      <strong>Performance = estimated units per hour</strong>
      <span className="tooltip-formula">capacity × 3,600 ÷ (travel + loading + unloading + arrival pause)</span>
      <span>A full cargo load over {number(distanceKm, 2)} km, starting and ending at rest. Rail braking uses the vehicle brake value (currently 2.5 m/s²), plus a measured two-second destination arrival pause. Loading and unloading use the cargo’s loading-speed factor.</span>
      <span>Rail: a(v) = min(2F/m, P/(mv)) − r, using empty formation mass and mass-weighted friction. Calibrated to recorded loaded/empty TF3 tests. Time and distance integrate the changing acceleration; short trips leave room to brake. A dash means rated top speed is unreachable. Details summarize average acceleration.</span>
      <span>Time to 1–5 km follows uninterrupted travel from rest; checkpoints exclude braking and station pauses. Trams/light rail and roads retain the constant loaded-mass model and 1 m/s² braking. Departure pauses are not modeled.</span>
      <span>{additionalStops} additional stops split the trip into {additionalStops + 1} equal segments of {number(distanceKm / (additionalStops + 1), 3)} km. Each segment starts and ends at rest. Intermediate stops immediately restart, with no station pause or cargo handling.</span>
      <span>With multiple cargos, each formation must support all of them. Metrics use the selected cargo with the lowest throughput, evaluated as a full load.</span>
      <span>Excludes return trips, traffic, curves and gradients. Cost per performance divides yearly running cost plus purchase price divided by {number(paybackYears, 2)} years by this throughput.</span>
    </span>}
  </span>;
}

function Highlight({ option, label, value, unit, icon, onClick, title }: { option: Option | null; label: string; value: string; unit: string; icon: string; onClick: () => void; title?: string }) {
  return <VehiclePreviewButton option={option} className="highlight" title={title} onClick={onClick}><span className="highlight-icon">{icon}</span><span className="highlight-content"><span className="highlight-label">{label}</span><span className="highlight-value">{value} <small>{unit}</small></span><span className="highlight-content highlight-formation">{option ? <><span className="highlight-name"><VehicleThumbnail vehicle={option.engine} />{option.engines}× {option.engine.name}<VehicleMenuTag vehicle={option.engine} /></span><span className="highlight-name">{option.wagon ? <><VehicleThumbnail vehicle={option.wagon} />{option.wagons}× {option.wagon.name}</> : standaloneFormationLabel(option)}</span></> : <span className="highlight-name">No matching options</span>}</span></span><Icon name="chevron" size={14} /></VehiclePreviewButton>;
}
function Modal({ title, children, onClose, className = "" }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className={`modal ${className}`} aria-label={title} onClose={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" autoFocus onClick={onClose}><Icon name="close" /></button></div><div className="modal-body">{children}</div></dialog>;
}
function FinanceDialog({ initial, onApply, onClose }: { initial: FinanceSettings; onApply: (settings: FinanceSettings) => void; onClose: () => void }) {
  const [values, setValues] = useState(initial);
  const preset = FINANCE_PRESETS.find(p => p.percent === values.vehicleCostPercent && p.percent === values.maintenanceCostPercent);
  return <Modal title="Finance settings" onClose={onClose}>
    <p className="dialog-intro">Match your game’s finance sliders. These multipliers adjust purchase prices, yearly running costs, and cost per performance.</p>
    <form className="finance-form" onSubmit={event => { event.preventDefault(); onApply(values); }}>
      <label className="finance-difficulty">Difficulty<select aria-label="Difficulty" value={preset?.id ?? "custom"} onChange={event => {
        const next = FINANCE_PRESETS.find(p => p.id === event.target.value);
        if (next) setValues({ vehicleCostPercent: next.percent, maintenanceCostPercent: next.percent });
      }}>{FINANCE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.name} · {p.percent}%</option>)}<option value="custom" disabled>Custom</option></select></label>
      {([{ key: "vehicleCostPercent", label: "Vehicle costs" }, { key: "maintenanceCostPercent", label: "Vehicle maintenance" }] as const).map(({ key, label }) => <div className="finance-slider" key={key}>
        <label htmlFor={key}>{label}<output htmlFor={key}>{values[key]}%</output></label>
        <input id={key} aria-label={label} aria-valuetext={`${values[key]}%`} type="range" min="50" max="150" step="25" value={values[key]} onChange={event => setValues(previous => ({ ...previous, [key]: Number(event.target.value) }))} />
        <div className="finance-ticks" aria-hidden="true">{[50, 75, 100, 125, 150].map(percent => <span key={percent}>{percent}%</span>)}</div>
      </div>)}
      <p className="finance-note">Hard defaults to 125% for both costs. Changing either slider can create a custom preset. Finance settings are included in saved configurations.</p>
      <div className="finance-actions"><button className="secondary-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit">Apply finance settings</button></div>
    </form>
  </Modal>;
}

function OptionDialog({ option: o, settings, onClose }: { option: Option; settings: Settings; onClose: () => void }) {
  const [view, setView] = useState<"overview" | "calculations">("overview");
  return <Modal title={o.engine.name} onClose={onClose} className="vehicle-modal"><p className="dialog-intro">{o.engines} × {o.engine.name}{o.wagon ? ` + ${o.wagons} × ${o.wagon.name}` : ""}</p><div className="vehicle-detail-tabs" role="group" aria-label="Vehicle detail views"><button type="button" aria-pressed={view === "overview"} onClick={() => setView("overview")}>Overview</button><button type="button" aria-pressed={view === "calculations"} onClick={() => setView("calculations")}>Calculations & graph</button></div>{view === "calculations" ? <CalculationBreakdown option={o} settings={settings} cargoName={cargoName(o.cargo)} /> : <><div className="formation-preview" aria-label="Formation diagram">{Array.from({ length: o.engines }, (_, i) => <span className="engine-block" key={`e${i}`}><Icon name={o.mode} /></span>)}{Array.from({ length: Math.min(o.wagons, 18) }, (_, i) => <span className="wagon-block" key={`w${i}`} />)}{o.wagons > 18 && <span>+{o.wagons - 18}</span>}</div><div className="detail-grid">{[
    ["Supported cargo", optionCargoNames(o)], ["Metrics cargo", `${cargoName(o.cargo)}${(o.cargos?.length ?? 1) > 1 ? " (lowest throughput)" : ""}`], ["Capacity", `${number(o.capacity, 1)} units`], ["Length", `${number(o.length, 2)} m`], ["Maximum speed", `${number(o.speed)} km/h`], ["Average speed (travel only)", `${estimateNumber(o.averageSpeed, 1)} km/h`], ["Acceleration at launch (est.)", `${number(o.acceleration, 3)} m/s²`], [o.motionModel === "calibrated-rail" ? "Average acceleration to max (est.)" : "Effective constant acceleration (est.)", `${estimateNumber(o.performanceAcceleration, 3)} m/s²`], ["Time to max speed (est.)", `${estimateNumber(o.timeToMaxSpeed, 1)} s`], ["Distance to max speed (est.)", `${estimateNumber(o.distanceToMaxSpeed, 1)} m`], ...distanceTimingColumns.map(({ key, km }) => [`Time to ${km} km from rest (est.)`, `${estimateNumber(o[key], 1)} s`]), ["Peak speed on trip (est.)", `${estimateNumber(o.peakSpeed, 1)} km/h`], ["Braking deceleration", `${estimateNumber(o.brakingAcceleration, 2)} m/s²`], ["Braking time from trip peak", `${estimateNumber(o.brakingTime, 1)} s`], ["Braking distance from trip peak", `${estimateNumber(o.brakingDistance, 1)} m`], ["Destination arrival pause", `${estimateNumber(o.arrivalDelaySeconds)} s`], ["Movement model", o.motionModel === "calibrated-rail" ? "Calibrated TF3 rail curve" : "Constant acceleration estimate"], ["Mass used for movement", `${number((o.motionMass ?? o.loadedMass) / 1000, 1)} t${o.motionModel === "calibrated-rail" ? " (empty mass)" : " (loaded mass)"}`], ["Theoretical loaded mass", `${number(o.loadedMass / 1000, 1)} t`], ["Loading speed", `${number(o.loadSpeed, 6)} units/s`], ["Comfort", o.comfort === null ? "Not applicable" : `${number(o.comfort, 1)} / 100`], ["Total noise score", number(o.noise)], ["Total pollution score", number(o.pollution)], ["Vehicle cost multiplier", `${o.vehicleCostPercent ?? 125}%`], ["Maintenance multiplier", `${o.maintenanceCostPercent ?? 125}%`], ["Purchase price", money(o.purchase, false)], ["Yearly running cost", money(o.running, false)], ["Purchase payback period", `${number(o.paybackYears ?? DEFAULT_PAYBACK_YEARS, 2)} years`], ["Trip distance", `${number(o.distanceKm, 2)} km`], ["Additional stops", number(o.additionalStops ?? 0)], ["Segment distance", `${number(o.distanceKm / ((o.additionalStops ?? 0) + 1), 3)} km`], ["Performance (est.)", `${number(o.throughput, 1)} units/h`], ["Annual cost / performance", money(o.costPerformance, false)], ["Purchase availability", `${o.yearFrom}–${o.yearTo ?? "ongoing"}`], ["Power type", o.engine.engineType ?? "—"],
  ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><LoadingBreakdown option={o} settings={settings} cargoName={cargoName(o.cargo)} />{o.engine.fixedFormation && <p className="detail-note">This is a complete game-authored fixed formation. Engine count represents complete sets. Its internal cars are not recombined with other vehicles.</p>}{o.lightRail && <p className="detail-note">Light rail: rail-capable tram equipment. Uses the train length limit in this tab and couples only to compatible tram cars.</p>}<details className="source-details"><summary>Source definitions</summary><code>{o.engine.source}</code>{o.engine.parts?.map((p, i) => <code key={i}>{p.source}</code>)}{o.wagon && <code>{o.wagon.source}</code>}</details></>}</Modal>;
}
