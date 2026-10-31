# Transport Fever 3 Planner

A local Next.js app for comparing train, tram and road formations against a year window, length limits and selected cargo. The catalog is extracted from **Transport Fever 3**, not Transport Fever 2. The installed game is never accessed by the web app at runtime.

## Run

Developed and verified with Node.js 25.9.0. Python 3.10+ is needed only to regenerate the catalog.

```powershell
npm install
npm run dev
```

Open http://localhost:3000. Production: `npm run build`, then `npm start`.

## Refresh the TF3 catalog

```powershell
npm run data:extract
# A different Steam library:
npm run data:extract -- --game-dir "D:\SteamLibrary\steamapps\common\Transport Fever 3"
```

`scripts/extract_tf3.py` uses Python's standard library. It checks for `TransportFever3.exe`, reads the base ZIP archives without unpacking or executing Lua, resolves English names from the game's gettext catalog, and writes `src/data/tf3-vehicles.json`. The generated catalog is included in the project. No game install or Python is needed to build or use the app.

The extractor reads:

- `base/content/vehicle/{train,tram,waggon,bus,truck}/*.zip`: vehicle metadata and multiple-unit definitions.
- `base/content/cargos/*.zip`: cargo classes, weight and loading factors.
- `base/content/base.zip`: generated vehicle-stat regression weights and cost formulas.
- `base/strings/en/LC_MESSAGES/base.mo`: English display names.

It exports numerical metadata and names, not vehicle meshes, textures or audio. The catalog contains source paths, extraction time, counts and a SHA-256 fingerprint. It fails on unsupported literal syntax or missing formation parts, instead of silently omitting vehicles. A fingerprint guard detects changes to the ported cost functions; if a game update changes them, review and update `normalize()` and its expected hash before regenerating. Mods and save-specific overrides are outside this base catalog.

## Formation rules

- The year window includes both endpoints. A missing retirement year is unlimited. A formation must have at least one purchase year shared by all its components within the selected window.
- All options available at some point in the window are shown, with one- and two-engine options together. Rows unavailable at the start are greyed out; rows unavailable at the end are yellow. Both markings can apply to the same option.
- One or two identical powered vehicles; one wagon type, repeated as many times as fits. The length includes all powered vehicles and wagons.
- Compatibility uses TF3 carrier and engine/vehicle transport modes. Light rail appears in both eligible tabs, with the length limit of the active tab. Every component must support that tab's transport mode; railway wagons and tram engines never mix.
- Authored multiple units are treated as complete fixed vehicles, with one or two identical sets. Loose formation parts are excluded. An engine-only fixed pair can pull wagons; a complete passenger set is kept intact. This is the explicit exception to custom homogeneous-wagon construction.
- Minimum top speed is optional (0 = no minimum), applies to the complete formation, and uses the rounded km/h shown in the table. Click **Calculate options** to apply it across all tabs.
- Self-propelled vehicles without a fitting compatible wagon remain valid if they carry the selected cargo. Road vehicles are single vehicles without a formation-length limit.
- Selecting multiple cargo types produces **alternative loads**, one row per cargo. It does not assert simultaneous multi-cargo capacity.

## Metrics

Capacity follows TF3's raw-capacity `/ 4` convention. Maximum speed is the slowest component. Passenger comfort is capacity-weighted. Noise and pollution are sums of the extracted component scores, **not decibels or physical exposure**. Purchase and running costs reproduce the installed TF3 base cost model and per-vehicle scales, before difficulty, company, maintenance-condition or mod adjustments.

Initial loaded acceleration is estimated as tractive effort in newtons divided by loaded mass in kilograms. Payload uses TF3's cargo weight factor. This estimate excludes drag, grades and adhesion.

The reference performance benchmark is capacity transported per hour over the user-entered trip distance (10 km by default), starting and ending at rest, including a full load and unload. Enter a positive distance in kilometers and click **Calculate options** to update throughput and cost per performance. Travel uses constant estimated acceleration limited by traction and power at half top speed, and 1 m/s² braking. Loading applies the cargo's loading factor. It excludes curves, gradients, traffic, return trips and income. Each CSV row and vehicle detail includes the distance used.

```
annualized cost = yearly running cost + purchase cost / 20
cost per performance = annualized cost / reference throughput (units/hour)
```

Lower cost per performance is better. Compare like cargo units. This is a planning heuristic, not profit or an exact game simulation. The info tooltip beside **Your fleet options** explains the performance formula on hover, keyboard focus or tap. The app's Data & methodology dialog provides further detail.

## Responsiveness and verification

Calculations run in a web worker after clicking **Calculate options**, with progress reporting and request IDs. Search uses React deferred values. The table sorts numerically before pagination and renders at most 40 rows; all filtered rows are included in CSV exports. Vehicle details retain full-precision money and source definitions.

```powershell
npm test
npm run test:extractor
npx tsc --noEmit
npm run build
```

Tests cover homogeneous maximum-length formations, one/two engines, simultaneous and boundary availability, future/retiring vehicles, rail eligibility of tram trailers, fixed sets, road vehicles and finite metrics across every cargo in five eras. They use Node's built-in test runner; no test framework dependency is required.

Main files: `src/components/planner.tsx` (UI), `src/lib/planner.ts` (pure calculations), `src/lib/planner.worker.ts` (worker), `src/data/tf3-vehicles.json` (generated catalog).
