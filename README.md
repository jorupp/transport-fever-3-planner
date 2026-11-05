# Transport Fever 3 Planner

A local Next.js app for comparing train, tram, road, boat and airplane options against a year window, length limits and selected cargo. The catalog is extracted from **Transport Fever 3**, not Transport Fever 2. The installed game is never accessed by the web app at runtime.

## Run

Developed and verified with Node.js 25.9.0. Python 3.10+ is needed only to regenerate the catalog.

```powershell
npm install
npm run dev
```

Open http://localhost:3040. Production: `npm run build`, then `npm start`.

## Refresh the TF3 catalog

```powershell
npm run data:extract
# A different Steam library:
npm run data:extract -- --game-dir "D:\SteamLibrary\steamapps\common\Transport Fever 3"
```

`scripts/extract_tf3.py` uses Python's standard library. It checks for `TransportFever3.exe`, reads the base ZIP archives without unpacking or executing Lua, resolves English names from the game's gettext catalog, and writes `src/data/tf3-vehicles.json`. The generated catalog is included in the project. No game install or Python is needed to build or use the app.

The extractor reads:

- `base/content/vehicle/{train,tram,waggon,bus,truck,ship,plane}/*.zip`: vehicle metadata and multiple-unit definitions.
- `base/content/cargos/*.zip`: cargo classes, weight and loading factors.
- `base/content/base.zip`: generated vehicle-stat regression weights and cost formulas.
- `base/strings/en/LC_MESSAGES/base.mo`: English display names.

It exports numerical metadata and names, not vehicle meshes, textures or audio. The catalog contains source paths, extraction time, counts and a SHA-256 fingerprint. It fails on unsupported literal syntax or missing formation parts, instead of silently omitting vehicles. A fingerprint guard detects changes to the ported cost functions; if a game update changes them, review and update `normalize()` and its expected hash before regenerating. Mods and save-specific overrides are outside this base catalog.

## Saved configurations

During `next dev`, the current parameter draft, applied plan, tab, search, sort, page and named-config selection survive Fast Refresh and component remounts. Worker restarts recalculate the applied plan without overwriting uncalculated edits. The browser Navigation API also preserves these values through script-triggered full reloads (including development-server restarts) using a one-time session snapshot. A manual browser refresh resets this temporary state; named configurations in localStorage remain saved. Browsers without the Navigation API still retain state through Fast Refresh, but cannot distinguish automatic full reloads from manual refreshes. Production does not enable temporary development persistence.

Named configurations save the year window and Include obsolete filter, train/tram lengths, trip distance, minimum top speed and selected cargo types, plus checked vehicle formations from all tabs, in this browser's `localStorage` (`tf3-planner.configs.v1`). Use **Save new** to create one, select a saved config to restore and recalculate, or use **Update** to replace its name/settings and **Delete** to remove it. Configurations stay on this browser/device and survive page reloads. Saving captures the current parameter fields even before calculating them. Loading restores checks on matching formations; older configs have no checked vehicles. Formation identifiers use the unique model filename (for example `aboag`), engine/wagon counts, and tab. They do not depend on catalog order, model directories, prices or performance values. Missing models or formations that no longer fit remain unmatched rather than selecting a different formation.

## Formation rules

- The year window includes both endpoints. A missing retirement year is unlimited. With Include obsolete off, a formation must have at least one purchase year shared by all its components within the selected window. Include obsolete also permits retired stock and disjoint purchase windows.
- All options available at some point in the window are shown, with one- and two-engine options together. Rows unavailable at the start are greyed out; rows unavailable at the end are yellow. Both markings can apply to the same option. Badges beside the vehicle name show the complete formation’s future introduction year (with years to wait) and removal year when unavailable at the end; a limiting wagon’s dates count too.
- Wagon formations use one or two identical engines, or one through five identical Multiple units menu vehicles, and one wagon type repeated as many times as fits. The length includes all powered vehicles and wagons.
- Compatibility uses TF3 carrier and engine/vehicle transport modes. Light rail appears in both eligible tabs, with the length limit of the active tab. Every component must support that tab's transport mode; railway wagons and tram engines never mix.
- Multiple-unit wagon formations allow one through five units. Multiple-unit-only trains show exactly one formation per vehicle: the maximum number of identical units or complete sets that fits the train length limit, even when wagon options are available. This standalone count can exceed five; noise, pollution and all other totals include every unit. Each unit must support all selected cargos itself. Multiple units are identified by the same rule as the menu tag (powered rail vehicles with carrying capacity), even when hauling freight rather than passengers. Authored sets stay intact and their loose parts stay excluded. An engine-only fixed pair can pull wagons; a complete passenger set is kept intact.
- Minimum top speed is optional (0 = no minimum), applies to the complete formation, and uses the rounded km/h shown in the table. Click **Calculate options** to apply it across all tabs.
- Self-propelled vehicles without a fitting compatible wagon remain valid if they carry the selected cargo. Road vehicles are single vehicles without a formation-length limit.
- Selecting multiple cargo types is an **AND filter**: every result must support all selected items, with one row per formation. Wagons must support every selected cargo; self-propelled/fixed vehicles must do so themselves. Each cargo is evaluated as an individual full load, and all cargo-dependent table metrics use the selected cargo with the lowest throughput. This checks cargo flexibility, not simultaneous mixed-cargo allocation. Vehicle details and CSV exports list the supported selection and the cargo used for the metrics.

## Vehicle identification

Check the left-hand box on any result to keep it for comparison. Checks follow formation IDs across sorting, searches, pagination and vehicle tabs. **Show only checked** displays the selected rows in the current tab and temporarily ignores the search, so choices collected under different searches appear together. Toggle it off to resume searching; **Clear checks** clears all tabs. Recalculating trip distance, additional stops, minimum speed, payback period or finance multipliers preserves checks and the comparison view. Raising minimum speed can hide selected rows; lowering it restores them. Changes to train/tram length or cargo selection reset checks. Year window and Include obsolete changes retain checks, including temporarily hidden rows. Loading a config restores the checks saved with it. CSV export follows the displayed selection. **Check cheapest by current metric** replaces all checks, scans search-matching options in the current tab in the current sort order (across all pages, ignoring the checked-only filter), and checks each new strict best cost/performance. The first row is included; equal cost/performance does not qualify. It then enables **Show only checked**.

Vehicle rows and summary cards include tiny TF3 menu images beside the engine and wagon names. Thumbnails have a fixed 10 px height and retain each image's natural aspect ratio, so longer vehicles appear wider; they load lazily and share assets with the larger previews. The exporter measures the visible artwork's alpha bounds, and a thumbnail-only vertical offset centers that artwork within the text line despite uneven transparent padding. Hover or keyboard-focus a vehicle row or summary card to see the larger TF3 menu icons. These are the base artwork colors; company recoloring can change their in-game appearance. Fixed formations show their first authored component's icon. Hover previews render outside the scrolling table so they are not clipped.

`npm run data:extract-visuals` reruns the standard-library Python exporter in `scripts/extract_tf3_visuals.py` after refreshing the vehicle catalog. It converts the installed TF3 TGA menu icons to portable PNGs in `public/vehicles`, and writes paths, image sizes, source references, an icon fingerprint and approximate body colors to `src/data/tf3-vehicle-visuals.json`. The app reads only these locally generated assets; images in `public/vehicles` are intentionally ignored by Git and can be regenerated with the command above. The swatch algorithm samples opaque body pixels, excludes dark undercarriages and transparent backgrounds, and groups similar shaded colors; it estimates visual appearance rather than reading a paint specification.

## Finance settings

The **Finance** button opens independent vehicle-cost and maintenance sliders from 50–150% in 25% steps. Easy/Normal/Hard/Very hard set both to 50/100/125/150%; Hard is the default. Apply recalculates the current results and cost per performance, while retaining uncalculated parameter edits. Named configurations include both multipliers; older configs use Hard defaults. Purchase and running totals are scaled independently and rounded to whole dollars.

## Metrics

Capacity follows TF3's raw-capacity `/ 4` convention. Maximum speed is the slowest component. Passenger comfort is capacity-weighted. Noise and pollution are sums of the extracted component scores, **not decibels or physical exposure**. Purchase and running costs reproduce the installed TF3 base cost model and per-vehicle scales, scaled by the selected finance sliders, before company, maintenance-condition or mod adjustments.

Rail acceleration is calibrated against four user-recorded runs on a completely flat TF3 map at 1x speed: Swiss Re 4/4 I and CLe 2/4 Roter Pfeil, each with nine Cargo Car 1960 wagons, tested with 135 logs and empty. Empty/loaded timing and speeds match within recording precision. Raw timestamps and speeds are preserved in `tests/fixtures/rail-runs.json`. The model matches all 17 checkpoints within 3 seconds and 0.5 km/h.

For **RAIL** vehicles, movement uses empty formation mass and a speed-dependent acceleration curve:

```
a(v) = min(2 × listed tractive effort / mass, power / (mass × v)) − r
```

Here power is in watts, effort in newtons, mass in kilograms and speed in m/s. At rest the tractive-effort limit applies. Resistance `r` is the empty-mass-weighted component friction value (0.02 m/s² for every current rail vehicle). The doubled effort, empty mass and resistance interpretation are a calibration to these observations, rather than a claim about every build, mod or game setting. Theoretical loaded mass remains available separately in details and CSV; payload has no effect on the calibrated rail movement. Cargo quantity, capacity and loading factors still affect throughput.

Closed-form integrals give elapsed time and distance at each speed across the traction/power transition. A bounded search finds the speed at each distance and the peak that leaves enough room to brake. The sortable **Time to max** and **Dist. to max** columns use this curve. Details show average acceleration to max as a summary, not a constant used for movement. A dash in these columns means the formation cannot reach its rated top speed against resistance; distance checkpoints and trip calculations still use its attainable speeds.

The sortable **Time to 1km–5km** columns show uninterrupted elapsed seconds from rest to each marker, excluding loading and braking, independently of the trip distance setting. Details and CSV include all five checkpoints. These are the same checkpoints used by the recording regression tests.

**TRAM** vehicles (including light rail appearing in the train tab) and road vehicles retain the previous uncalibrated approximation: initial acceleration is effort divided by loaded mass; effective constant acceleration is the lesser of that and power divided by loaded mass and half top speed (minimum 1 m/s). Their payload uses the cargo weight factor. The rail calibration has not been extrapolated to these carriers.

The performance benchmark is capacity transported per hour over the user-entered distance (10 km by default), starting and ending at rest, with a full load and unload. Rail travel follows the calibrated curve; other carriers use their constant estimate. Rail braking uses the lowest component `brakeDeceleration` extracted from TF3 (2.5 m/s² for every current rail vehicle). The Roter Pfeil station-approach recording in `tests/fixtures/rail-braking.json` supports this rate: approximately 110 km/h to rest in 12 seconds, followed by a two-second pause before loading. That arrival pause is counted once at the destination; the benchmark starts with origin loading ready. Departure/door-closing pauses are unmeasured and excluded. Braking time and distance from the selected trip’s peak speed, deceleration, and destination pause are shown in details and CSV. Tram/light-rail and road braking retain the **uncalibrated 1 m/s² assumption**. Loading uses the minimum base rate among cargo-carrying components × number of cargo-carrying catalog vehicles × cargo loading factor. Vehicles load in parallel. Omitted loading rates use 1×, explicit −1 requests the TF3 regression, and authored sets use the minimum among carrying parts. Cargo Car 1899 therefore has base 1× and Cargo Car 1913 has explicit 2×. The original normal-time, 1×-station test (135 logs in nine 2× Cargo Car 1960 wagons, about 120 seconds) matches the 120-second estimate. Two follow-ups at the same station also support parallel loading:

| Formation | Measured cargo interval | Observed seconds | Parallel-loading prediction |
| --- | --- | ---: | ---: |
| 7× Stake Car 1945 (4× base) | 1/140 at 0:33 → 140/140 at 1:53 | 80 | 139 / (7 × 4 × 0.0625) = 79.43 |
| 1× Cargo Car 1960 (2× base) | 1/15 at 0:26 → 15/15 at 2:19 | 113 | 14 / (1 × 2 × 0.0625) = 112 |

The first displayed unit is already loaded, so the comparisons use 139 and 14 units respectively. Full-load estimates from empty are 80 seconds for the 140-log stake-car train and 120 seconds for both one and nine Cargo Car 1960 wagons. Arrival/loading-status/departure timestamps include separate pauses and are retained without being folded into the rate calibration. The raw follow-up timestamps are in `tests/fixtures/loading-follow-ups.json`; regression tests allow 1.1 seconds of timestamp precision. The original observation remains in `tests/fixtures/loading-run.json`.

The parallel loading model is implemented in `formationLoadingFactors` in `src/lib/planner.ts`. Only cargo-carrying catalog vehicles count (including powered railcars with the selected cargo, excluding locomotives without it); an authored set counts as one catalog vehicle. The modal and Load/s tooltip show the formula and carrying-vehicle count. The observations support homogeneous-wagon rail loading; mixed-rate formations, other carriers and unloading remain extrapolations. Traffic, curves, grades, return trips, maintenance condition and income are excluded. CSV and vehicle details include the trip distance and movement model.

```
annualized cost = yearly running cost + purchase cost / paybackYears
cost per performance = annualized cost / reference throughput (units/hour)
```

Lower cost per performance is better. Compare like cargo units. This is a planning heuristic, not profit or an exact game simulation. The info tooltip beside **Your fleet options** explains the performance formula on hover, keyboard focus or tap. The app's Data & methodology dialog provides further detail.

**Additional stops** defaults to zero. A journey with `n` additional stops is split into `n + 1` equal rest-to-rest segments: for example, 12 km with 3 stops uses four 3 km movement calculations. Total travel time is the single-segment time multiplied by the segment count, including full braking and re-acceleration each time. Cargo loading/unloading and the destination arrival pause are counted only once per journey; intermediate stops have no dwell or cargo handling. This applies to all vehicle tabs. Saved configs include the count; older configs load with zero. The 1–5 km calibration columns continue to describe uninterrupted acceleration from rest.

## Vehicle calculation breakdown

**Purchase payback** in Performance estimate sets a positive number of years (default 20); the annualized purchase term is price divided by that period. It is saved with named configs, shown in details and CSV, and older configs default to 20 years. It does not change vehicle purchase prices, running costs or throughput.

Each vehicle modal has an **Overview** and **Calculations & graph** view. Both include a loading breakdown: per-component rate, quantity and source, exclusion of components without the metrics cargo, minimum base rate, cargo conversion factor, full load/unload time and the length formula explaining the wagon count. The latter shows per-component counts, power, listed effort, empty mass, capacity and loading speed, followed by substituted formulas for wagon count, speed, calibrated force/resistance, the power transition, time/distance integration, braking, cargo handling, throughput and annualized cost. Rail force tables distinguish listed effort from the doubled traction limit and available versus used power. Other carriers explain their constant approximation.

Two aligned SVG plots show speed and acceleration against moving-trip time, with traction/power/cruise/brake phase shading. Hover the plot or use the keyboard-accessible time slider to inspect position, speed, acceleration, driving force and power use. Cruising power balances rolling resistance; braking power is zero. Whole-trip graphs repeat the motion curve across the equally spaced stops. Above 50 segments the graph shows one representative segment to bound rendering work, while numeric totals still include all segments. Graph sampling and breakdown calculations run only when the calculation view is opened, reuse the same rail curve as the worker, and do not generate graph data for result-table rows. The phase sums and force balance are covered by regression tests.

## Responsiveness and verification

Calculations run in a web worker after clicking **Calculate options**, with progress reporting and request IDs. Search uses React deferred values. The table sorts numerically before pagination and renders at most 40 rows; all filtered rows are included in CSV exports. Engine/set counts appear beside vehicle names. Monetary table values are shown in thousands of dollars, with exact dollar amounts in hover tooltips and vehicle details; cost per performance retains two decimal places in thousands. Noise and pollution are displayed as whole numbers; loading retains up to four decimal places below 1 unit/s so small rates stay meaningful, with exact values in tooltips and details. Numeric columns keep compact fixed widths while the vehicle column takes the remaining width. Sorting, calculations and CSV exports retain the underlying precision and dollar amounts.

```powershell
npm test
npm run test:extractor
npx tsc --noEmit
npm run build
```

Tests cover homogeneous maximum-length formations, one/two engines, simultaneous and boundary availability, future/retiring vehicles, rail eligibility of tram trailers, fixed sets, road vehicles and finite metrics across every cargo in five eras. They use Node's built-in test runner; no test framework dependency is required.

Main files: `src/components/planner.tsx` (UI), `src/lib/planner.ts` (pure calculations), `src/lib/planner.worker.ts` (worker), `src/data/tf3-vehicles.json` (generated catalog).

### Parameter groups and obsolete stock

- **Vehicle construction:** maximum train/tram length and cargo selection. Only changes here clear checked formations.
- **Filters:** availability window, Include obsolete, and minimum top speed. Checked formations remain selected when these filters hide them and return checked when visible again.
- **Performance targets:** trip distance, additional stops or turns, route speed limit, and purchase payback. These update the metrics while retaining checks.

**Include obsolete** defaults to off and is saved with named configurations. When enabled, any component introduced by the window's end year is eligible, including retired stock. Engine and wagon purchase windows do not need to overlap, allowing combinations such as 4-4-2 Atlantic with Cargo Car 1960. Compatibility and maximum length still apply. Grey/yellow styling and retirement badges continue to describe actual purchase availability; combinations with disjoint windows show **No overlap** instead of an inverted year range. Earlier saved configurations default to excluding obsolete vehicles.

### Boats

The **Boats** tab includes 27 base-game TF3 boats, ferries, hovercraft and towboat assemblies. Each result is one complete vessel with no length limit or wagon combinations. Cargo flexibility, availability/obsolete and speed filters, comfort for passengers, checked comparisons, named configs and CSV export work as in the other tabs. Physical hull length is informational only.

Boat extraction reads `waterVehicle` metadata: `availPower` is converted from watts to kW, while speed, mass and cargo capacities come from the game definitions. WATER stat regressions include `maxRpm`. Costs follow TF3's WATER formula: average speed is 65% of raw top speed, running cost is based on speed and capacity with no locomotive-power surcharge, and base purchase price is six times base running cost unless explicitly overridden. Finance sliders apply afterward.

Boat movement uses an **uncalibrated power-based constant estimate**: `a = availablePower / (loadedMass * max(topSpeed / 2, 1))` in SI units, with the existing 1 m/s² non-rail braking assumption. The planner shows this model in details and CSV. There is no fabricated tractive-effort figure. Propeller thrust, hull drag, turning, docking and currents are not modeled; the observed rail acceleration calibration does not apply. Loading uses the boat's base rate and cargo loading factor; rail loading measurements have not calibrated boat handling. The details graph, additional stops and cost/performance use this same estimate consistently.

### Airplanes, shared road/tram comparisons, turns and speed limits

**Airplanes** includes 30 base-game TF3 aircraft, with extracted menu artwork. Each option is one aircraft without a length limit. The extractor reads `airVehicle.maxThrust` in newtons, mass, top speed and time to full thrust; thrust is not mislabeled as kW. TF3's AIR regression uses raw thrust under its `power` feature name. Costs use TF3's AIR average-speed polynomial `(-0.0000203 * min(v_kmh, 4000)^2 + 0.17 * min(v_kmh, 4000) + 28.36) / 3.6`, followed by capacity and the standard cost factors. Movement is an **uncalibrated constant-thrust estimate**, `a = maxThrust / loadedMass`, with braking deceleration equal to acceleration pending in-game calibration. Thrust ramp-up, flight phases, aerodynamic drag, taxiing and airport queues are excluded.

**Road vehicles** also includes every powered tram supporting the selected cargos. Trams retain the same engine counts, compatible wagons and tram-length limit as in the Tram tab, including complete articulated sets. Ordinary road vehicles remain single vehicles with no length limit. Physical TRAM carriers share the same movement model across tabs, including when light rail appears in Trains.

**Turns** defaults to zero and applies only to ROAD/TRAM carriers. Turns and additional stops are mutually exclusive; entering a positive value clears the other field, and validation rejects conflicting saved or programmatic settings. Place `n` turns at distances `D/(n+1), 2D/(n+1), ...`. For each intermediate segment, brake before the turn to half the actual approach peak, rather than half the vehicle's rated top speed. Carry that exit speed into the next segment and accelerate again. Only the journey endpoints are complete stops. With entry speed `u`, acceleration `a`, braking `b`, segment length `L`, and exit/peak ratio `r` (0.5 at turns, zero at the destination), the unconstrained peak is `sqrt((2L + u^2/a) / (1/a + (1-r^2)/b))`, capped at the route ceiling. Remaining distance is cruising. The graph and throughput sum these different segments, and very large turn counts pack the steady middle to stay responsive.

**Speed limit** defaults to zero (unlimited) and caps all carriers. Effective ceiling = minimum of rated formation speed and any positive route limit. It affects travel, checkpoint times, time/distance to ceiling, graphs and cost/performance, but leaves rated speed, purchase/running costs, the minimum-top-speed filter, and acceleration capability unchanged. Checkpoint times describe uninterrupted launch under the route ceiling, excluding intermediate stops/turns. Both settings are saved with named configs, exported to CSV, and retain checked formations. Older configs default to zero turns and no speed limit.
