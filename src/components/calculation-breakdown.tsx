"use client";

import { useMemo, useState } from "react";
import { analyzeOption, formationLoadingFactors, DEFAULT_PAYBACK_YEARS, type Option, type Settings } from "@/lib/planner";

const n = (value: number, decimals = 1) => value.toLocaleString("en-US", { maximumFractionDigits: decimals });
type Analysis = ReturnType<typeof analyzeOption>;
type Point = ReturnType<Analysis["sampleAtTime"]>;

export default function CalculationBreakdown({ option: o, settings, cargoName }: { option: Option; settings: Settings; cargoName: string }) {
  const a = useMemo(() => analyzeOption(o), [o]);
  const components = [{ vehicle: o.engine, count: o.engines, label: o.engine.fixedFormation ? "Powered set" : "Engine / vehicle" },
    ...(o.wagon ? [{ vehicle: o.wagon, count: o.wagons, label: "Wagon" }] : [])];
  const lengthLimit = o.mode === "train" ? settings.trainLength : o.mode === "tram" || o.engine.carrier === "TRAM" ? settings.tramLength : null;
  const effectiveA = o.performanceAcceleration ?? 0;
  const speeds = Array.from(new Set([0, ...(a.rail && a.transitionSpeed * 3.6 < o.peakSpeed ? [a.transitionSpeed * 3.6] : []),
    o.peakSpeed / 4, o.peakSpeed / 2, o.peakSpeed * .75, o.peakSpeed])).sort((x, y) => x - y);
  return <div className="calculation-breakdown">
    <p className="calculation-context">{settings.year}–{settings.year + settings.extraYears} · {lengthLimit === null ? "No formation length limit" : `${n(lengthLimit)} m formation limit`} · {n(o.distanceKm, 2)} km trip · {a.additionalStops} additional stops · {a.turns} turns · {a.segmentCount} × {n(a.segmentDistance / 1000, 3)} km segments · {cargoName}{(o.cargos?.length ?? 1) > 1 ? " (lowest-throughput cargo)" : ""}</p>
    {a.turns > 0 && <p className="calculation-note">{a.turns} equally spaced turns, {n(a.segmentDistance / 1000, 3)} km apart. Each intermediate segment exits at half its own approach peak, then accelerates again. Only origin and destination are complete stops.</p>}
    <TripGraph analysis={a} />
    <section className="calculation-section">
      <h3>1. Formation inputs</h3>
      <p>Values below are per vehicle or complete authored set; the quantity column supplies the multiplier.</p>
      <table className="calculation-inputs"><thead><tr><th>Component</th><th>Qty</th><th>Length<br />m</th><th>Empty mass<br />t</th><th>Power<br />kW</th><th>{o.mode === "airplane" ? "Thrust" : "Listed effort"}<br />kN</th><th>Capacity<br />units</th><th>Base rate<br />×</th></tr></thead><tbody>
        {components.map(({ vehicle: v, count, label }) => <tr key={v.id}><th>{v.name}<small>{label}</small></th><td>{count}</td><td>{n(v.length, 2)}</td><td>{n(v.weightEmpty / 1000)}</td><td>{v.carrier === "AIR" ? "—" : n(v.power, 0)}</td><td>{v.carrier === "AIR" ? n((v.thrust ?? 0) / 1000, 2) : v.carrier === "WATER" ? "—" : n(v.tractiveEffort, 2)}</td><td>{n(v.capacities[o.cargo] ?? 0, 2)}</td><td>{n(v.capacities[o.cargo] ? v.loadSpeed : 0, 2)}</td></tr>)}
        <tr className="calculation-total"><th>Formation total</th><td>—</td><td>{n(a.length, 2)}</td><td>{n(a.emptyMass / 1000)}</td><td>{o.mode === "airplane" ? "—" : n(a.power / 1000, 0)}</td><td>{o.mode === "airplane" ? n((o.engine.thrust ?? 0) / 1000, 2) : o.mode === "boat" ? "—" : n(a.effort / 1000, 2)}</td><td>{n(o.capacity, 2)}</td><td title="Minimum among components carrying the metrics cargo; not a sum">{n(a.baseLoadSpeed, 2)} (min)</td></tr>
      </tbody></table>
      <div className="calculation-equations">
        {o.wagon && lengthLimit !== null && <p><b>Maximum wagon count</b><code>floor(({n(lengthLimit, 2)} − {o.engines} × {n(o.engine.length, 2)}) ÷ {n(o.wagon.length, 2)}) = {o.wagons}</code><span>The calculation uses unrounded lengths.</span></p>}
        <p><b>Speed ceiling</b><code>min({n(o.engine.speed, 2)}{o.wagon ? `, ${n(o.wagon.speed, 2)}` : ""}{o.speedLimit > 0 ? `, ${n(o.speedLimit, 2)} route limit` : ""}) = {n(o.effectiveSpeed ?? o.speed, 2)} km/h = {n((o.effectiveSpeed ?? o.speed) / 3.6, 4)} m/s</code><span>Rated vehicle speed is unchanged. Acceleration capability still uses rated speed; lowering the route ceiling does not increase engine power or acceleration.</span></p>
        <p><b>Mass used for movement</b><code>m = {n(a.mass, 0)} kg{a.rail ? " (empty formation)" : " (empty mass + cargo payload)"}</code><span>Theoretical loaded mass: {n(o.loadedMass / 1000)} t.{a.rail ? " Matching loaded and empty TF3 recordings support ignoring payload for rail movement in this calibration." : " Payload uses the selected cargo’s weight factor."}</span></p>
      </div>
    </section>
    <section className="calculation-section">
      <h3>2. Power, tractive effort and acceleration</h3>
      {a.rail ? <>
        <div className="calculation-equations">
          <p><b>Installed power</b><code>P = {components.map(({ vehicle: v, count }) => `${count} × ${n(v.power, 0)}`).join(" + ")} = {n(a.power / 1000, 0)} kW = {n(a.power, 0)} W</code></p>
          <p><b>Traction limit</b><code>Fmax = 2 × ({components.map(({ vehicle: v, count }) => `${count} × ${n(v.tractiveEffort, 2)}`).join(" + ")}) = {n(a.forceLimit / 1000, 2)} kN</code><span>The factor of two is part of the observed TF3 rail calibration.</span></p>
          <p><b>Rolling resistance</b><code>r = Σ(empty mass × friction) ÷ Σ(empty mass) = {n(a.resistance, 4)} m/s²</code><code>Fresist = m × r = {n(a.mass, 0)} × {n(a.resistance, 4)} = {n(a.resistanceForce / 1000, 3)} kN</code></p>
          <p><b>Traction-limited launch</b><code>a₀ = Fmax ÷ m − r = {n(a.forceLimit, 0)} ÷ {n(a.mass, 0)} − {n(a.resistance, 4)} = {n(o.acceleration, 4)} m/s²</code><span>Force stays at Fmax while power use rises with speed: Pused = Fmax × v. At rest, force is finite and power use is zero.</span></p>
          <p><b>Transition to the power limit</b><code>v* = P ÷ Fmax = {n(a.power, 0)} ÷ {n(a.forceLimit, 0)} = {n(a.transitionSpeed, 4)} m/s = {n(a.transitionSpeed * 3.6, 2)} km/h</code><span>{a.transitionTime === null ? "This trip starts braking or reaches its speed ceiling before entering the power-limited phase." : `Reached after ${n(a.transitionTime, 2)} s on this trip.`}</span></p>
          <p><b>Power-limited acceleration</b><code>Fdrive(v) = P ÷ v; a(v) = (Fdrive(v) − Fresist) ÷ m</code><span>Above v*, installed power stays constant while driving force and acceleration fall as speed rises. During cruising the model reduces power to balance rolling resistance; during braking engine power is zero.</span></p>
        </div>
        <table className="calculation-forces"><thead><tr><th>Speed<br />km/h</th><th>Limit</th><th>Driving force<br />kN</th><th>Resistance<br />kN</th><th>Net force<br />kN</th><th>Power used<br />kW</th><th>Acceleration<br />m/s²</th></tr></thead><tbody>{speeds.map(kmh => {
          const v = kmh / 3.6, force = Math.min(a.forceLimit, v > 0 ? a.power / v : Infinity);
          return <tr key={kmh}><td>{n(kmh, 2)}</td><td>{v <= a.transitionSpeed ? "Traction" : "Power"}</td><td>{n(force / 1000, 3)}</td><td>{n(a.resistanceForce / 1000, 3)}</td><td>{n((force - a.resistanceForce) / 1000, 3)}</td><td>{n(force * v / 1000, 2)}</td><td>{n(force / a.mass - a.resistance, 4)}</td></tr>;
        })}</tbody></table>
        <p className="calculation-note">This table shows the force available while accelerating at each speed. Cruising and braking use the phases shown in the graph.</p>
      </> : o.mode === "airplane" ? <div className="calculation-equations"><p><b>Thrust-based airplane estimate (uncalibrated)</b><code>a = thrust / loaded mass = {n(o.engine.thrust ?? 0, 0)} N / {n(a.mass, 0)} kg = {n(effectiveA, 4)} m/s²</code><span>Uses TF3’s maximum thrust as constant force, with a 1 m/s² braking assumption. Thrust ramp-up, aerodynamic drag, taxiing, takeoff, climb, descent, landing and airport queues are not modeled. This is a comparative estimate, not a flight simulation.</span></p></div> : o.mode === "boat" ? <div className="calculation-equations">
        <p><b>Power-based boat estimate (uncalibrated)</b><code>P = {n(a.power / 1000, 0)} kW = {n(a.power, 0)} W</code><code>a = P ÷ (m × max(vmax ÷ 2, 1)) = {n(a.power, 0)} ÷ ({n(a.mass, 0)} × {n(Math.max(o.speed / 7.2, 1), 4)}) = {n(effectiveA, 4)} m/s²</code><span>TF3 supplies available power and mass for boats, but no listed tractive effort. This constant approximation uses power at half top speed and loaded mass. Propeller thrust, hull drag, turning, docking and currents are not modeled. Boat braking uses the uncalibrated 1 m/s² assumption. Rail calibration does not apply.</span></p>
      </div> : <div className="calculation-equations">
        <p><b>Constant estimate for tram / road equipment</b><code>a₀ = F ÷ m = {n(a.effort, 0)} ÷ {n(a.mass, 0)} = {n(o.acceleration, 4)} m/s²</code><code>a = min(a₀, P ÷ (m × max(vmax ÷ 2, 1))) = {n(effectiveA, 4)} m/s²</code><span>{n(a.power / 1000, 0)} kW installed power, {n(a.effort / 1000, 2)} kN listed effort. This carrier uses the earlier constant approximation; the doubled rail traction and rail resistance model do not apply.</span></p>
      </div>}
    </section>
    <section className="calculation-section">
      <h3>3. Travel, braking and station handling</h3>
      <p>{a.rail ? "Time and distance integrate the changing acceleration: t = ∫dv/a(v), x = ∫v·dv/a(v)." : a.turns ? "Each segment uses tacc = (vpeak - ventry)/a and xacc = (vpeak² - ventry²)/(2a), with analogous braking differences." : "Time and distance use t = v/a and x = v²/(2a)."} {a.turns ? "For intermediate segments vexit = vpeak/2, so xbrake = 0.75vpeak²/(2b). The final segment brakes to zero. Solve xacc + xbrake = segment distance, capped by the route ceiling." : "The trip peak solves xaccel(v) + v²/(2b) = segment distance, capped by the route ceiling."} Any remaining distance is cruising.</p>
      <p><strong>{n(o.distanceKm, 3)} km ÷ ({a.turns || a.additionalStops} + 1) = {n(a.segmentDistance / 1000, 3)} km per segment.</strong> {a.turns ? "Intermediate turns retain half the actual approach peak. Only origin and destination are at rest." : `Each of the ${a.segmentCount} segments starts and ends at rest.`} The totals below sum all segments; intermediate stops have no waiting or cargo handling.</p>
      <table className="calculation-phases"><thead><tr><th>Phase</th><th>Time, s</th><th>Distance, m</th><th>Calculation</th></tr></thead><tbody>
        <tr><th>Accelerate</th><td>{n(a.trip.accelerationTime, 3)}</td><td>{n(a.trip.accelerationDistance, 3)}</td><td>{a.turns ? "Sum (vpeak - ventry) / a; (vpeak² - ventry²) / (2a)" : `${a.segmentCount}× (${a.rail ? "integrate the traction / power curve" : "vpeak / a; vpeak² / (2a)"})`}</td></tr>
        <tr><th>Cruise</th><td>{n(a.trip.cruiseTime, 3)}</td><td>{n(a.trip.cruiseDistance, 3)}</td><td>{a.turns ? "Sum remaining distance / each segment peak speed" : `${a.segmentCount}× (remaining segment distance / ${n(a.trip.speed, 4)} m/s)`}</td></tr>
        <tr><th>Brake</th><td>{n(a.trip.brakingTime, 3)}</td><td>{n(a.trip.brakingDistance, 3)}</td><td>{a.turns ? "Sum (vpeak - vexit) / b; (vpeak² - vexit²) / (2b); vexit = vpeak/2 at turns, 0 at destination" : `${a.segmentCount}× (${n(a.trip.speed, 4)} / ${n(o.brakingAcceleration, 2)}; vpeak² / (2b))`}</td></tr>
        <tr className="calculation-total"><th>Moving total</th><td>{n(a.trip.time, 3)}</td><td>{n(o.distanceKm * 1000, 3)}</td><td>Accelerate + cruise + brake</td></tr>
      </tbody></table>
      <div className="calculation-equations">
        <p><b>Average speed</b><code>{n(o.distanceKm, 3)} km × 3,600 ÷ {n(a.trip.time, 3)} s = {n(o.averageSpeed, 3)} km/h</code><span>Includes acceleration, braking, additional stops and applicable turns. Excludes cargo handling and station pauses.</span></p>
        <p><b>Total time used for throughput</b><code>{n(a.trip.time, 3)} travel + {n(a.loadingTime, 3)} loading + {n(a.unloadingTime, 3)} unloading + {n(a.arrivalTime, 2)} arrival pause = {n(a.totalTime, 3)} s</code><span>Origin loading starts ready; the destination arrival pause is counted once. Intermediate stops immediately restart and add no handling or waiting. Departure and door-closing pauses are excluded.</span></p>
        <p><b>Performance</b><code>{n(o.capacity, 2)} × 3,600 ÷ {n(a.totalTime, 3)} = {n(o.throughput, 3)} units/hour</code></p>
      </div>
      <LoadingBreakdown option={o} settings={settings} cargoName={cargoName} />
    </section>
    <section className="calculation-section">
      <h3>4. Costs and other totals</h3>
      <div className="calculation-equations">
        <p><b>Purchase</b><code>round(${n(a.basePurchase, 0)} × {o.vehicleCostPercent}%) = ${n(o.purchase, 0)}</code></p>
        <p><b>Yearly running cost</b><code>round(${n(a.baseRunning, 0)} × {o.maintenanceCostPercent}%) = ${n(o.running, 0)}</code></p>
        <p><b>Annualized cost</b><code>${n(o.running, 0)} + ${n(o.purchase, 0)} ÷ {n(o.paybackYears ?? DEFAULT_PAYBACK_YEARS, 2)} years = ${n(a.annualizedCost, 2)}/year</code></p>
        <p><b>Cost per performance</b><code>${n(a.annualizedCost, 2)} ÷ {n(o.throughput, 3)} = ${n(o.costPerformance, 2)} per unit/hour annually</code></p>
        <p><b>Noise and pollution</b><code>Σ(quantity × vehicle score): noise {n(a.noise, 0)}, pollution {n(a.pollution, 0)}</code></p>
        {o.comfort !== null && <p><b>Passenger comfort</b><code>Σ(quantity × passenger capacity × comfort) ÷ {n(o.capacity, 2)} = {n(o.comfort, 2)} / 100</code></p>}
      </div>
      <p className="calculation-note">Displayed substitutions are rounded for readability; calculations retain full precision. This is a flat-track estimate excluding traffic, gradients, curves, return trips and maintenance effects.</p>
    </section>
  </div>;
}

export function LoadingBreakdown({ option: o, settings, cargoName }: { option: Option; settings: Settings; cargoName: string }) {
  const loading = formationLoadingFactors(o.engine, o.wagon, o.engines, o.wagons, o.cargo);
  const base = loading.baseRate;
  const factor = loading.parallelBaseRate > 0 ? o.loadSpeed / loading.parallelBaseRate : 0;
  const seconds = o.capacity / Math.max(o.loadSpeed, .001);
  const components = [{ vehicle: o.engine, count: o.engines }, ...(o.wagon ? [{ vehicle: o.wagon, count: o.wagons }] : [])];
  const carrying = components.filter(({ vehicle }) => vehicle.capacities[o.cargo] > 0);
  const limit = o.mode === "train" ? settings.trainLength : settings.tramLength;
  const sources: Record<string, string> = { explicit: "Vehicle definition", default: "Default 1× (omitted in definition)", regression: "TF3 regression (explicit −1)", "formation-minimum": "Minimum among carrying set parts" };
  return <section className="loading-breakdown calculation-section" aria-label="Loading calculation">
    <h3>Loading and unloading · {cargoName}</h3>
    <p>The formation uses the slowest base loading rate among components carrying this cargo. Components that cannot carry {cargoName} are excluded. Cargo-carrying vehicles load in parallel.</p>
    <table><thead><tr><th>Component</th><th>Qty</th><th>Capacity each</th><th>Base rate</th><th>Rate source</th></tr></thead><tbody>{components.map(({ vehicle: v, count }) => <tr key={v.id}><th>{v.name}</th><td>{count}</td><td>{n(v.capacities[o.cargo] ?? 0, 2)}</td><td>{v.capacities[o.cargo] ? `${n(v.loadSpeed, 3)}×` : "Excluded"}</td><td>{v.capacities[o.cargo] ? sources[v.loadSpeedSource ?? ""] ?? "Catalog value" : "Does not carry this cargo"}</td></tr>)}</tbody></table>
    <div className="calculation-equations">
      <p><b>Formation base rate</b><code>min({carrying.map(({ vehicle }) => n(vehicle.loadSpeed, 3)).join(", ")}) = {n(base, 3)}×</code></p>
      <p><b>Measured loading checks</b><span>135 logs in nine Cargo Car 1960 wagons rated 2× took about 120 seconds at normal time and a 1× station (predicted 120 s). Seven 4× Stake Car 1945 wagons took 80 s from 1 to 140 logs (predicted 79.43 s); one 2× Cargo Car 1960 took 113 s from 1 to 15 logs (predicted 112 s). These intervals exclude arrival and departure pauses.</span></p>
      <p><b>Parallel loading</b><code>{n(base, 3)}× base rate × {loading.carryingVehicleCount} cargo-carrying vehicles = {n(loading.parallelBaseRate, 3)}× combined rate</code><span>Only vehicles carrying {cargoName} count. A complete authored set counts as one catalog vehicle.</span></p>
      <p><b>Cargo-adjusted loading rate · Load/s</b><code>{n(base, 3)} × {loading.carryingVehicleCount} vehicles × {n(factor, 6)} cargo factor = {n(o.loadSpeed, 6)} units/s</code><span>Assumes normal time and a 1× station. This is units per second for the formation, rather than the vehicle’s in-game × rating. The table rounds small fractional rates to four decimal places; hover for the precise value.</span></p>
      <p><b>Full load and unload</b><code>{n(o.capacity, 2)} units ÷ {n(o.loadSpeed, 6)} units/s = {n(seconds, 3)} s ({n(seconds / 60, 2)} min) each</code><span>Two full handling operations contribute {n(seconds * 2, 3)} s to performance. Additional journey stops do not load or unload.</span></p>
      {o.wagon && <p><b>Why this wagon count?</b><code>floor(({n(limit, 3)} m − {o.engines} × {n(o.engine.length, 5)} m) ÷ {n(o.wagon.length, 5)} m) = {o.wagons} wagons</code><span>Every row uses the maximum wagons that fit. Longer or more numerous engines leave less room; different wagon lengths also change the count. Calculations use unrounded lengths.</span></p>}
    </div>
    {(o.cargos?.length ?? 1) > 1 && <p className="calculation-note">Each selected cargo is evaluated as a separate full load. This breakdown uses {cargoName}, the cargo with the lowest throughput for this formation.</p>}
    <p className="calculation-note">Parallel loading is supported by the recorded homogeneous-wagon rail tests. Mixed-rate formations, other carriers and unloading still extrapolate from those observations.</p>
  </section>;
}

function TripGraph({ analysis: a }: { analysis: Analysis }) {
  const [index, setIndex] = useState(0);
  const [scope, setScope] = useState<"acceleration" | "trip">("acceleration");
  // Bound SVG complexity for very large stop counts; the numeric totals always
  // include every segment. A representative segment remains fully inspectable.
  const showFullJourney = a.segmentCount <= 50;
  const plottedCount = scope === "acceleration" || !showFullJourney ? 1 : a.segmentCount;
  const plotSegments = useMemo(() => a.turnSections
    ? a.turnSections.flatMap(section => Array.from({ length: Math.min(section.repeat, plottedCount) }, (_, i) => ({ ...section, startTime: section.startTime + i * section.time }))).slice(0, plottedCount)
    : Array.from({ length: plottedCount }, (_, i) => ({ ...a.segment, startTime: i * a.segment.time })), [a, plottedCount]);
  const duration = scope === "acceleration" ? a.segment.accelerationTime : showFullJourney ? a.trip.time : a.segment.time;
  const points = useMemo(() => {
    if (!Number.isFinite(duration) || duration <= 0) return [];
    const times = Array.from({ length: 181 }, (_, i) => i === 180 ? duration : duration * i / 180);
    const epsilon = Math.min(.0001, duration * 1e-7, a.segment.time * 1e-5);
    for (const segment of plotSegments) {
      for (const local of [a.transitionTime, segment.accelerationTime, segment.accelerationTime + segment.cruiseTime, segment.time]) {
        if (local === null) continue;
        const t = segment.startTime + local;
        if (t > 0 && t <= duration) {
          times.push(t, Math.max(0, t - epsilon));
          if (t + epsilon < duration) times.push(t + epsilon);
        }
      }
    }
    return Array.from(new Set(times)).sort((x, y) => x - y).map(time =>
      scope === "acceleration" && time === duration
        ? { ...a.sampleAtTime(Math.max(0, duration - Math.min(.0001, duration * 1e-7))), time }
        : a.sampleAtTime(time));
  }, [a, duration, scope, plotSegments]);
  if (!points.length) return <p className="calculation-note">This formation cannot complete the trip under the movement model.</p>;
  const selected = points[Math.min(index, points.length - 1)];
  const left = 64, right = 930, width = right - left;
  const x = (time: number) => left + time / duration * width;
  const speedMax = Math.max(1, a.trip.speed * 3.6 * 1.08);
  const accelerationMax = Math.max(.1, ...points.map(p => p.acceleration)) * 1.12;
  const accelerationMin = scope === "acceleration" ? 0 : Math.min(-.1, ...points.map(p => p.acceleration)) * 1.12;
  const sy = (v: number) => 150 - v / speedMax * 120;
  const ay = (v: number) => 272 - (v - accelerationMin) / (accelerationMax - accelerationMin) * 92;
  const line = (y: (p: Point) => number) => points.map(p => `${x(p.time).toFixed(3)},${y(p).toFixed(3)}`).join(" ");
  const phases = plotSegments.map((segment, i) => [
    { name: a.rail ? "Traction limited" : "Constant estimate", end: a.transitionTime ?? segment.accelerationTime, color: "#e2eee8" },
    ...(a.transitionTime === null ? [] : [{ name: "Power limited", end: segment.accelerationTime, color: "#fff0cf" }]),
    { name: "Cruising", end: segment.accelerationTime + segment.cruiseTime, color: "#e3edf8" },
    { name: "Braking", end: segment.time, color: "#f8e4e0" },
  ].map(p => ({ ...p, id: `${i}-${p.name}`, end: Math.min(segment.startTime + p.end, duration) }))).flat();
  const legend = phases.filter((p, i) => p.end - (phases[i - 1]?.end ?? 0) > 1e-6)
    .filter((p, i, all) => all.findIndex(other => other.name === p.name) === i);
  function inspect(clientX: number, rect: DOMRect) {
    const time = Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width * 960 - left) / width * duration));
    let nearest = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(points[i].time - time) < Math.abs(points[nearest].time - time)) nearest = i;
    setIndex(nearest);
  }
  return <section className="trip-graph" aria-label="Trip speed and acceleration graph">
    <div className="trip-graph-heading"><h3>Speed and acceleration · {n(duration)} seconds</h3><span>Hover the plot or move the time slider</span></div>
    <div className="trip-graph-scope" role="group" aria-label="Graph time range">{(["acceleration", "trip"] as const).map(value => <button type="button" key={value} aria-pressed={scope === value} onClick={() => { setScope(value); setIndex(0); }}>{value === "acceleration" ? "Acceleration only" : showFullJourney ? "Whole trip" : "One segment"}</button>)}</div>
    {a.segmentCount > 1 && <p className="calculation-note">{a.segmentCount} {a.turns ? "turn-separated segments" : "identical segments"} of {n(a.segmentDistance / 1000, 3)} km. {showFullJourney ? a.turns ? "Whole trip shows each slowdown to half the approach speed and subsequent acceleration." : "Acceleration view shows the first launch; whole trip shows each complete stop and restart." : "The graph shows one representative segment to stay responsive; performance totals include every segment."}</p>}
    <div className="trip-phase-legend">{legend.map(p => <span key={p.name}><i style={{ background: p.color }} />{p.name}</span>)}</div>
    <svg viewBox="0 0 960 314" role="img" aria-label="Speed in kilometers per hour and acceleration in meters per second squared against travel time in seconds" onPointerMove={e => inspect(e.clientX, e.currentTarget.getBoundingClientRect())}>
      <title>Trip speed and acceleration</title><desc>The upper panel shows speed, the lower panel acceleration. Shading identifies traction, power, cruise and brake phases. Use the time slider for numeric values.</desc>
      {phases.map((p, i) => <rect key={p.id} x={x(phases[i - 1]?.end ?? 0)} y="24" width={Math.max(0, x(p.end) - x(phases[i - 1]?.end ?? 0))} height="254" fill={p.color} />)}
      {[0, .5, 1].map(f => <g key={f}><line x1={left} x2={right} y1={sy(f * speedMax)} y2={sy(f * speedMax)} className="chart-grid" /><text x={left - 8} y={sy(f * speedMax) + 4} textAnchor="end">{n(f * speedMax, 0)}</text></g>)}
      {(scope === "acceleration" ? [0, accelerationMax / 2.24, accelerationMax / 1.12] : [accelerationMin / 1.12, 0, accelerationMax / 1.12]).map(v => <g key={v}><line x1={left} x2={right} y1={ay(v)} y2={ay(v)} className="chart-grid" /><text x={left - 8} y={ay(v) + 4} textAnchor="end">{n(v, 2)}</text></g>)}
      <text x={left} y="15" className="chart-speed-label">Speed · km/h</text><text x={left} y="171" className="chart-acceleration-label">Acceleration · m/s²</text>
      <polyline points={line(p => sy(p.speed))} className="chart-speed" /><polyline points={line(p => ay(p.acceleration))} className="chart-acceleration" />
      {[0, .2, .4, .6, .8, 1].map(f => <g key={f}><line x1={x(f * duration)} x2={x(f * duration)} y1="24" y2="278" className="chart-grid vertical" /><text x={x(f * duration)} y="296" textAnchor="middle">{n(f * duration, 0)}</text></g>)}
      <text x="930" y="313" textAnchor="end">{scope === "acceleration" ? "Time from rest · s (acceleration only)" : "Travel time · s (loading and station pauses excluded)"}</text>
      <line x1={x(selected.time)} x2={x(selected.time)} y1="24" y2="278" className="chart-cursor" /><circle cx={x(selected.time)} cy={sy(selected.speed)} r="4" className="chart-speed-dot" /><circle cx={x(selected.time)} cy={ay(selected.acceleration)} r="4" className="chart-acceleration-dot" />
    </svg>
    <input className="trip-time-slider" type="range" aria-label="Inspect trip time" aria-valuetext={`${n(selected.time)} seconds, ${selected.phase}, ${n(selected.speed)} kilometers per hour`} min="0" max={points.length - 1} step="1" value={Math.min(index, points.length - 1)} onChange={e => setIndex(Number(e.target.value))} />
    <div className="trip-inspector" aria-live="off"><strong>{n(selected.time)} s · {selected.phase}{a.segmentCount > 1 ? ` · Segment ${selected.segment} of ${a.segmentCount}` : ""}</strong><span>{n(selected.distance)} m</span><span>{n(selected.speed, 2)} km/h</span><span>{n(selected.acceleration, 4)} m/s²</span>{a.rail && <><span>Drive {n(selected.drivingForce / 1000, 3)} kN</span><span>Power {n(selected.powerUsed / 1000, 2)} kW</span></>}</div>
  </section>;
}
