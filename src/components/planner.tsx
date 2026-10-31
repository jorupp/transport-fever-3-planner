"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import data from "@/data/tf3-vehicles.json";
import { DEFAULT_SETTINGS, type Mode, type Option, type Settings } from "@/lib/planner";
import SavedConfigs from "@/components/saved-configs";
import { VehiclePreviewButton, VehicleThumbnail } from "@/components/vehicle-visuals";
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
const money = (v: number, compact = true) => "$" + (compact && v >= 1e6 ? number(v / 1e6, 2) + "m" : compact && v >= 1e3 ? number(v / 1e3, 1) + "k" : number(v));
const thousands = (value: number, decimals = 0) => number(value / 1000, decimals);
const exactPerformanceCost = (value: number) => `$${number(value, 2)} annualized cost per estimated unit/hour`;
const cargoName = (id: string) => data.cargos.find(c => c.id === id)?.name ?? id;
const optionCargoNames = (option: Option) => (option.cargos ?? [option.cargo]).map(cargoName).join(", ");
type SortKey = "name" | "capacity" | "length" | "speed" | "acceleration" | "loadSpeed" | "comfort" | "noise" | "pollution" | "purchase" | "running" | "throughput" | "costPerformance" | "yearFrom";
const columns: { key: SortKey; label: string; unit?: string; title?: string }[] = [
  { key: "name", label: "Vehicle & formation" },
  { key: "capacity", label: "Capacity", unit: "units" }, { key: "length", label: "Length", unit: "m" },
  { key: "speed", label: "Max speed", unit: "km/h" }, { key: "acceleration", label: "Accel.", unit: "m/s²", title: "Estimated acceleration" },
  { key: "loadSpeed", label: "Load", unit: "/s", title: "Loading speed in units per second, rounded to a whole number" }, { key: "comfort", label: "Comfort", unit: "/ 100" },
  { key: "noise", label: "Noise", unit: "score" }, { key: "pollution", label: "Pollution", unit: "score" },
  { key: "purchase", label: "Purchase", unit: "$000s", title: "Purchase price in thousands of dollars; hover a value for the exact price" }, { key: "running", label: "Running", unit: "$000s/yr", title: "Annual running cost in thousands of dollars; hover a value for the exact cost" },
  { key: "throughput", label: "Performance", unit: "units/h" },
  { key: "costPerformance", label: "Cost / perf.", unit: "$000s ↓", title: "Annualized cost ÷ estimated units/hour, in thousands of dollars. Lower is better. Hover a value for the exact cost." },
  { key: "yearFrom", label: "Available", unit: "years" },
];
const columnWidths: Record<SortKey, number> = {
  name: 260, capacity: 58, length: 52, speed: 54, acceleration: 56,
  loadSpeed: 42, comfort: 56, noise: 42, pollution: 56, purchase: 64, running: 64,
  throughput: 80, costPerformance: 74, yearFrom: 86,
};
const tableMinimumWidth = Object.values(columnWidths).reduce((sum, width) => sum + width, 0);

type Draft = { year: string; extraYears: string; trainLength: string; tramLength: string; distanceKm: string; minTopSpeed: string; cargos: string[] };
const initialDraft: Draft = { year: "1990", extraYears: "10", trainLength: String(DEFAULT_SETTINGS.trainLength), tramLength: "60", distanceKm: String(DEFAULT_SETTINGS.distanceKm), minTopSpeed: String(DEFAULT_SETTINGS.minTopSpeed), cargos: ["PASSENGERS"] };

export default function Planner() {
  const [draft, setDraft] = useDevelopmentState<Draft>("planner.draft", initialDraft);
  const [applied, setApplied] = useDevelopmentState<Settings>("planner.applied", DEFAULT_SETTINGS);
  const [options, setOptions] = useState<Option[]>([]);
  const [busy, setBusy] = useState(true), [progress, setProgress] = useState(0), [error, setError] = useState("");
  const [mode, setMode] = useDevelopmentState<Mode>("planner.mode", "train"), [search, setSearch] = useDevelopmentState("planner.search", "");
  const deferredSearch = useDeferredValue(search);
  const [sort, setSort] = useDevelopmentState<{ key: SortKey; asc: boolean }>("planner.sort", { key: "costPerformance", asc: true });
  const [page, setPage] = useDevelopmentState("planner.page", 0), [selected, setSelected] = useState<Option | null>(null);
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
  const parsedDraft: Settings = { year: Number(draft.year), extraYears: Number(draft.extraYears), trainLength: Number(draft.trainLength), tramLength: Number(draft.tramLength), distanceKm: Number(draft.distanceKm), minTopSpeed: Number(draft.minTopSpeed), cargos: draft.cargos };
  const dirty = JSON.stringify(parsedDraft) !== JSON.stringify(applied);
  const modeOptions = useMemo(() => options.filter(o => o.mode === mode), [options, mode]);
  const filtered = useMemo(() => {
    const query = deferredSearch.toLowerCase().trim();
    const rows = modeOptions.filter(o => !query || `${o.engine.name} ${o.wagon?.name ?? ""} ${optionCargoNames(o)}`.toLowerCase().includes(query));
    return rows.sort((a, b) => {
      const av = sort.key === "name" ? `${a.engine.name} ${a.wagon?.name ?? ""}` : a[sort.key];
      const bv = sort.key === "name" ? `${b.engine.name} ${b.wagon?.name ?? ""}` : b[sort.key];
      if (av === null) return bv === null ? a.id.localeCompare(b.id) : 1;
      if (bv === null) return -1;
      const cmp = typeof av === "string" && typeof bv === "string" ? av.localeCompare(bv) : Number(av) - Number(bv);
      return (sort.asc ? cmp : -cmp) || a.id.localeCompare(b.id);
    });
  }, [modeOptions, deferredSearch, sort]);
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
  }
  function calculate(event: FormEvent) {
    event.preventDefault();
    const settings = currentSettings();
    if (settings) runCalculation(settings);
  }
  function loadConfig(settings: Settings) {
    setDraft({ year: String(settings.year), extraYears: String(settings.extraYears), trainLength: String(settings.trainLength), tramLength: String(settings.tramLength), distanceKm: String(settings.distanceKm), minTopSpeed: String(settings.minTopSpeed), cargos: [...settings.cargos] });
    setCargoOpen(false); setSearch("");
    runCalculation(settings);
  }
  function exportCsv() {
    const header = ["Engine", "Wagon", "Engines / sets", "Wagons", "Supported cargo", "Metrics cargo", "Capacity", "Length (m)", "Speed (km/h)", "Acceleration estimate (m/s2)", "Loading (units/s)", "Comfort", "Noise score sum", "Pollution score sum", "Purchase ($)", "Yearly running ($)", "Trip distance (km)", "Throughput estimate (units/h)", "Annualized cost / throughput", "Available from", "Available until", "Available at start", "Available at end", "Full range"];
    const rows = filtered.map(o => [o.engine.name, o.wagon?.name ?? "", o.engines, o.wagons, optionCargoNames(o), cargoName(o.cargo), o.capacity, o.length, o.speed, o.acceleration, o.loadSpeed, o.comfort ?? "", o.noise, o.pollution, o.purchase, o.running, o.distanceKm, o.throughput, o.costPerformance, o.yearFrom, o.yearTo ?? "", o.availableAtStart, o.availableAtEnd, o.fullRange]);
    const csv = [header, ...rows].map(row => row.map(v => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = `tf3-${mode}-${applied.year}-${applied.year + applied.extraYears}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function changeMode(next: Mode) { setMode(next); setPage(0); }
  function toggleCargo(id: string) { setDraft(d => ({ ...d, cargos: d.cargos.includes(id) ? d.cargos.filter(c => c !== id) : [...d.cargos, id] })); }

  return <div className="app-shell">
    <div className="main-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Transport Fever 3 Planner home"><span className="brand-symbol"><Icon name="train" size={23} /></span><span>TRANSPORT FEVER <b>3</b><small>PLANNING TOOLS</small></span></Link>
        <nav className="app-nav" aria-label="App navigation">
          <a href="#planner" className="nav-active" aria-current="page"><Icon name="sliders" size={17} /> Vehicle planner</a>
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
              <fieldset><legend>Performance estimate</legend><div className="length-fields"><label><span>Trip distance</span><div className="input-unit"><input aria-label="Trip distance" type="number" required min="0.01" step="any" value={draft.distanceKm} onChange={e => setDraft({ ...draft, distanceKm: e.target.value })} /><span>km</span></div></label><label><span>Minimum top speed</span><div className="input-unit"><input aria-label="Minimum top speed" type="number" min="0" step="1" placeholder="0" value={draft.minTopSpeed} onChange={e => setDraft({ ...draft, minTopSpeed: e.target.value })} /><span>km/h</span></div></label></div><div className="field-hint">Distance for units/hr · 0 km/h = any speed</div></fieldset>
              <div className="cargo-field"><label className="field-legend" id="cargo-label">Items to transport</label><div className="cargo-picker"><button type="button" className="cargo-trigger" aria-labelledby="cargo-label" aria-expanded={cargoOpen} onClick={() => setCargoOpen(!cargoOpen)}><span className="cargo-selected">{draft.cargos.length === 1 ? cargoName(draft.cargos[0]) : `${draft.cargos.length} items selected`}</span><span className="down-chevron">⌄</span></button>{cargoOpen && <><button className="popover-backdrop" type="button" aria-label="Close cargo picker" onClick={() => setCargoOpen(false)} /><div className="cargo-popover"><div className="cargo-popover-heading"><strong>Choose your cargo</strong><button className="icon-button" aria-label="Close cargo picker" type="button" onClick={() => setCargoOpen(false)}><Icon name="close" size={16} /></button></div><input type="search" placeholder="Find an item…" aria-label="Search cargo types" value={cargoSearch} onChange={e => setCargoSearch(e.target.value)} /><div className="cargo-actions"><button type="button" onClick={() => setDraft({ ...draft, cargos: data.cargos.map(c => c.id) })}>Select all</button><button type="button" onClick={() => setDraft({ ...draft, cargos: [] })}>Clear</button></div><div className="cargo-choices">{data.cargos.filter(c => c.name.toLowerCase().includes(cargoSearch.toLowerCase())).map(c => <label key={c.id}><input type="checkbox" checked={draft.cargos.includes(c.id)} onChange={() => toggleCargo(c.id)} /><span>{c.name}</span></label>)}</div><p>Each result must support every selected cargo. One row per formation; capacity is for one cargo load at a time.</p></div></>}</div><div className="field-hint">Must support all selected items</div></div>
            </div>
            <div className="plan-footer"><div><span className="parameter-note"><Icon name="info" size={15} /> One wagon type per formation. Always the maximum that fits.</span>{dirty && <span className="unsaved-dot">Parameters changed</span>}</div><button className="primary-button" disabled={busy || !draft.cargos.length} type="submit">{busy ? "Calculating…" : "Calculate options"}<Icon name="arrow" size={18} /></button></div>
          </form>
        </section>
        <section className="results-section" aria-label="Vehicle results" aria-busy={busy}>
          <div className="results-heading"><div><div className="eyebrow">EXPLORE THE POSSIBILITIES</div><div className="results-title-row"><h2>Your fleet options <span>{applied.year}<span className="year-arrow">→</span>{applied.year + applied.extraYears}</span></h2><PerformanceHelp distanceKm={applied.distanceKm} /></div></div><button className="secondary-button" onClick={exportCsv} disabled={busy || !filtered.length}><Icon name="download" size={16} /> Export CSV</button></div>
          {error && <div className="error-message" role="alert">{error}</div>}
          {busy && <div className="calculation-progress" role="progressbar" aria-label="Calculating vehicle options" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${progress}%` }} /><span>Calculating formations · {progress}%</span></div>}
          <div className="results-card">
            <div className="tabs" role="tablist" aria-label="Vehicle types">{(["train", "tram", "road"] as Mode[]).map(m => <button key={m} id={`tab-${m}`} type="button" role="tab" aria-selected={mode === m} aria-controls="vehicle-panel" tabIndex={mode === m ? 0 : -1} onKeyDown={e => { const modes: Mode[] = ["train", "tram", "road"]; const i = modes.indexOf(m); if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); const next = modes[(i + (e.key === "ArrowRight" ? 1 : 2)) % 3]; changeMode(next); document.getElementById(`tab-${next}`)?.focus(); } }} className={mode === m ? "tab active" : "tab"} onClick={() => changeMode(m)}><Icon name={m} />{m === "train" ? "Trains" : m === "tram" ? "Trams" : "Road vehicles"}<span>{options.filter(o => o.mode === m).length}</span></button>)}</div>
            <div id="vehicle-panel" role="tabpanel" aria-labelledby={`tab-${mode}`}>
              <div className="highlights"><Highlight option={best} label="BEST COST / PERFORMANCE" value={best ? thousands(best.costPerformance, 2) : "—"} unit="$000s / unit/h, annually" title={best ? exactPerformanceCost(best.costPerformance) : undefined} onClick={() => best && setSelected(best)} icon="↘" /><Highlight option={largest} label="LARGEST CAPACITY" value={largest ? number(largest.capacity, largest.capacity % 1 ? 1 : 0) : "—"} unit={largest && (largest.cargos?.length ?? 1) === 1 ? cargoName(largest.cargo).toLowerCase() : "units"} onClick={() => largest && setSelected(largest)} icon="▥" /><Highlight option={fastest} label="FASTEST OPTION" value={fastest ? number(fastest.speed) : "—"} unit="km/h" onClick={() => fastest && setSelected(fastest)} icon="↗" /></div>
              <div className="table-toolbar"><label className="search-field"><Icon name="search" size={17} /><input type="search" aria-label="Search vehicle options" placeholder="Search engines, wagons, cargo…" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} /></label><span className="engine-options-note">{mode === "road" ? "Single road vehicles" : "1 & 2 engines shown together"}</span></div>
              <div className="table-caption"><span><strong>{filtered.length}</strong> matching options <span className="caption-separator">/</span> {number(applied.distanceKm, 2)} km trip{applied.minTopSpeed > 0 && <> · ≥ {number(applied.minTopSpeed)} km/h</>} <span className="caption-separator">/</span> {applied.cargos.map(cargoName).join(", ")}</span><div className="availability-legend"><span><i className="legend-dot full" />Full range</span><span><i className="legend-dot partial" />Unavailable at end</span><span><i className="legend-dot future" />Unavailable at start</span></div></div>
              <div className="table-scroll"><table style={{ minWidth: tableMinimumWidth }}><colgroup>{columns.map(col => <col key={col.key} style={col.key === "name" ? undefined : { width: columnWidths[col.key] }} />)}</colgroup><thead><tr>{columns.map(col => <th key={col.key} aria-sort={sort.key === col.key ? (sort.asc ? "ascending" : "descending") : "none"} className={col.key === "name" ? "sticky-column" : ""}><button title={col.title} onClick={() => { setSort({ key: col.key, asc: sort.key === col.key ? !sort.asc : !["speed", "capacity", "acceleration", "comfort", "throughput", "loadSpeed"].includes(col.key) }); setPage(0); }}><span>{col.label}<small>{col.unit ?? "click to inspect"}</small></span><span className={sort.key === col.key ? "sort-arrow selected" : "sort-arrow"}>{sort.key === col.key ? (sort.asc ? "↑" : "↓") : "↕"}</span></button></th>)}</tr></thead><tbody>{visible.map(o => <tr key={o.id} className={`${!o.availableAtStart ? "future-option" : ""} ${!o.availableAtEnd ? "partial-option" : ""}`}>
                <td className="sticky-column vehicle-cell"><VehiclePreviewButton option={o} onClick={() => setSelected(o)}><span className="vehicle-description"><strong><span className="vehicle-name"><VehicleThumbnail vehicle={o.engine} />{o.engines}× {o.engine.name}</span><AvailabilityBadges option={o} startYear={applied.year} />{o.lightRail && <em className="light-rail-badge" title="Light rail">LR</em>}</strong><small>{o.wagon ? <><VehicleThumbnail vehicle={o.wagon} />{o.wagons} × {o.wagon.name}</> : o.engine.fixedFormation ? "Complete fixed formation" : "Self-propelled vehicle"}</small></span><Icon name="chevron" size={12} /></VehiclePreviewButton></td>
                <td className="capacity-cell"><strong>{number(o.capacity, o.capacity % 1 ? 1 : 0)}</strong></td><td>{number(o.length, 1)}</td><td className="strong-value">{number(o.speed)}</td><td>{number(o.acceleration, 2)}</td><td>{number(o.loadSpeed)}</td><td>{o.comfort === null ? "—" : number(o.comfort)}</td><td>{number(o.noise)}</td><td>{number(o.pollution)}</td><td title={money(o.purchase, false)}>{thousands(o.purchase)}</td><td title={`${money(o.running, false)} per year`}>{thousands(o.running)}</td><td>{number(o.throughput, 1)}</td><td className="value-cell" title={exactPerformanceCost(o.costPerformance)}><strong>{thousands(o.costPerformance, 2)}</strong>{o.id === best?.id && <span className="best-tag">BEST VALUE</span>}</td><td className="availability-cell" title={`Formation purchase window: ${o.yearFrom}–${o.yearTo ?? "ongoing"}`}><span>{o.yearFrom}–{o.yearTo ?? "∞"}</span></td>
              </tr>)}</tbody></table>{!visible.length && !busy && <div className="empty-state"><Icon name={mode} size={32} /><h3>No formations found</h3><p>{modeOptions.length ? "Try another vehicle or cargo search." : "Try a different year, a longer formation, fewer cargo requirements, or a lower minimum speed."}</p>{modeOptions.length > 0 && <button className="secondary-button" onClick={() => setSearch("")}>Clear search</button>}</div>}</div>
              <div className="table-footer"><span>{filtered.length ? `${currentPage * 40 + 1}–${Math.min((currentPage + 1) * 40, filtered.length)}` : "0"} of {number(filtered.length)} options <span className="caption-separator">·</span> Scroll horizontally for all metrics</span><div className="pagination"><button aria-label="Previous page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>←</button><span>{currentPage + 1} / {pageCount}</span><button aria-label="Next page" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>→</button></div></div>
            </div>
          </div>
          <div className="results-note"><Icon name="info" size={16} /><p>Grey options are unavailable in {applied.year}. Yellow marks options unavailable in {applied.year + applied.extraYears}. Light rail appears in both eligible tabs and only couples to tram cars.</p><button onClick={() => setMethodology(true)}>How are metrics calculated? <Icon name="arrow" size={15} /></button></div>
        </section>
        <footer className="page-footer"><span>TRANSPORT FEVER 3 <b>/</b> INDEPENDENT PLANNING TOOLS</span><span>Made for the long haul.</span></footer>
      </main>
    </div>
    {selected && <OptionDialog option={selected} onClose={() => setSelected(null)} />}
    {methodology && <Modal title="Data & methodology" onClose={() => setMethodology(false)}><div className="methodology"><p className="dialog-intro">A reproducible catalog from your installed copy of Transport Fever 3.</p><h3>Source data</h3><p>{data.counts.vehicles} vehicles and {data.counts.cargoTypes} cargo types, extracted on {data.extractedAt.slice(0, 10)}. Names, dimensions, transport modes, years, loading, comfort and emission scores come from TF3’s base definitions. Missing stats use TF3’s regression models. Purchase and yearly running costs use TF3’s base cost formula, before difficulty, maintenance condition, company level or mods.</p><h3>Formations & availability</h3><p>We use one or two identical powered vehicles and the maximum count of one compatible wagon type. Both engine counts are always shown together, with every formation purchasable at some point in the window. Grey marks options unavailable at the start; yellow marks options unavailable at the end. Both components must be purchasable together in at least one selected year. Year endpoints are inclusive; no retirement year means ongoing availability. Complete, game-authored multiple units are kept intact and labeled as fixed formations; their internal cars are not recombined. A light-rail option in the train tab uses the train length limit.</p><h3>Capacity, comfort & emissions</h3><p>TF3’s raw capacity is divided by four, following its own cost model. Every formation must support all selected cargo types, with one row per formation. Each cargo is evaluated as a separate full load; the displayed capacity, loading, acceleration and performance use the cargo with the lowest throughput. This checks cargo flexibility rather than simultaneous mixed-cargo allocation. Comfort is weighted by passenger capacity. Noise and pollution are sums of component scores, useful for comparing complete formations; they are not decibels or measured environmental exposure.</p><h3>Estimated acceleration</h3><p>Initial acceleration = total tractive effort (N) ÷ fully loaded mass (kg). Loaded mass uses empty weight plus maximum payload × the cargo’s TF3 weight factor. This is an ideal estimate on flat track, excluding drag, grades and adhesion limits.</p><h3>Cost per performance · lower is better</h3><p>Performance is estimated units per hour over the selected {number(applied.distanceKm, 2)} km trip, starting and ending at rest, plus one full load and unload. Travel uses power and traction limited acceleration evaluated at half maximum speed, and 1 m/s² braking. Loading uses the cargo’s load-speed factor. The benchmark excludes traffic, curves, grades and return trips.</p><div className="formula">Annual cost / throughput<br /><strong>(yearly running cost + purchase price ÷ 20) ÷ units per hour</strong></div><p>This blends capacity, top speed, acceleration and loading speed. It is a comparison metric, not profit or an in-game income forecast. Compare like cargo types; different units and loading factors affect the ranking.</p><h3>Refresh after a game update</h3><code>npm run data:extract</code><p>The extractor is in <code>scripts/extract_tf3.py</code>. It reads game files once and generates the committed JSON catalog. The app never reads the installation at runtime.</p><details><summary>Catalog fingerprint</summary><code className="hash">{data.definitionHash}</code></details></div></Modal>}
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

function PerformanceHelp({ distanceKm }: { distanceKm: number }) {
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
      <span className="tooltip-formula">capacity × 3,600 ÷ (travel + loading + unloading seconds)</span>
      <span>A fully loaded {number(distanceKm, 2)} km trip, starting and ending at rest. Travel accounts for power, loaded acceleration, the slowest vehicle’s top speed and 1 m/s² braking. Loading and unloading use the cargo’s loading-speed factor.</span>
      <span>With multiple cargos, each formation must support all of them. Metrics use the selected cargo with the lowest throughput, evaluated as a full load.</span>
      <span>Excludes return trips, traffic, curves and gradients. Cost per performance divides yearly running cost plus 1/20 of the purchase price by this throughput.</span>
    </span>}
  </span>;
}

function Highlight({ option, label, value, unit, icon, onClick, title }: { option: Option | null; label: string; value: string; unit: string; icon: string; onClick: () => void; title?: string }) {
  return <VehiclePreviewButton option={option} className="highlight" title={title} onClick={onClick}><span className="highlight-icon">{icon}</span><span className="highlight-content"><span className="highlight-label">{label}</span><span className="highlight-value">{value} <small>{unit}</small></span><span className="highlight-content highlight-formation">{option ? <><span className="highlight-name"><VehicleThumbnail vehicle={option.engine} />{option.engines}× {option.engine.name}</span><span className="highlight-name">{option.wagon ? <><VehicleThumbnail vehicle={option.wagon} />{option.wagons}× {option.wagon.name}</> : option.engine.fixedFormation ? "Complete fixed formation" : "Self-propelled vehicle"}</span></> : <span className="highlight-name">No matching options</span>}</span></span><Icon name="chevron" size={14} /></VehiclePreviewButton>;
}
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="modal" aria-label={title} onClose={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" autoFocus onClick={onClose}><Icon name="close" /></button></div><div className="modal-body">{children}</div></dialog>;
}
function OptionDialog({ option: o, onClose }: { option: Option; onClose: () => void }) {
  return <Modal title={o.engine.name} onClose={onClose}><p className="dialog-intro">{o.engines} × {o.engine.name}{o.wagon ? ` + ${o.wagons} × ${o.wagon.name}` : ""}</p><div className="formation-preview" aria-label="Formation diagram">{Array.from({ length: o.engines }, (_, i) => <span className="engine-block" key={`e${i}`}><Icon name={o.mode} /></span>)}{Array.from({ length: Math.min(o.wagons, 18) }, (_, i) => <span className="wagon-block" key={`w${i}`} />)}{o.wagons > 18 && <span>+{o.wagons - 18}</span>}</div><div className="detail-grid">{[
    ["Supported cargo", optionCargoNames(o)], ["Metrics cargo", `${cargoName(o.cargo)}${(o.cargos?.length ?? 1) > 1 ? " (lowest throughput)" : ""}`], ["Capacity", `${number(o.capacity, 1)} units`], ["Length", `${number(o.length, 2)} m`], ["Maximum speed", `${number(o.speed)} km/h`], ["Acceleration (est.)", `${number(o.acceleration, 3)} m/s²`], ["Loaded mass (est.)", `${number(o.loadedMass / 1000, 1)} t`], ["Loading speed", `${number(o.loadSpeed)} units/s`], ["Comfort", o.comfort === null ? "Not applicable" : `${number(o.comfort, 1)} / 100`], ["Total noise score", number(o.noise)], ["Total pollution score", number(o.pollution)], ["Purchase price", money(o.purchase, false)], ["Yearly running cost", money(o.running, false)], ["Trip distance", `${number(o.distanceKm, 2)} km`], ["Performance (est.)", `${number(o.throughput, 1)} units/h`], ["Annual cost / performance", money(o.costPerformance, false)], ["Purchase availability", `${o.yearFrom}–${o.yearTo ?? "ongoing"}`], ["Power type", o.engine.engineType ?? "—"],
  ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>{o.engine.fixedFormation && <p className="detail-note">This is a complete game-authored fixed formation. Engine count represents complete sets. Its internal cars are not recombined with other vehicles.</p>}{o.lightRail && <p className="detail-note">Light rail: rail-capable tram equipment. Uses the train length limit in this tab and couples only to compatible tram cars.</p>}<details className="source-details"><summary>Source definitions</summary><code>{o.engine.source}</code>{o.engine.parts?.map((p, i) => <code key={i}>{p.source}</code>)}{o.wagon && <code>{o.wagon.source}</code>}</details></Modal>;
}
