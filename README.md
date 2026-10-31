# Transport Fever 3 Planner

A local Next.js app for comparing train, tram and road formations against a year window, length limits and selected cargo. The catalog is extracted from **Transport Fever 3**, not Transport Fever 2. The installed game is never accessed by the web app at runtime.

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

- `base/content/vehicle/{train,tram,waggon,bus,truck}/*.zip`: vehicle metadata and multiple-unit definitions.
- `base/content/cargos/*.zip`: cargo classes, weight and loading factors.
- `base/content/base.zip`: generated vehicle-stat regression weights and cost formulas.
- `base/strings/en/LC_MESSAGES/base.mo`: English display names.

It exports numerical metadata and names, not vehicle meshes, textures or audio. The catalog contains source paths, extraction time, counts and a SHA-256 fingerprint. It fails on unsupported literal syntax or missing formation parts, instead of silently omitting vehicles. A fingerprint guard detects changes to the ported cost functions; if a game update changes them, review and update `normalize()` and its expected hash before regenerating. Mods and save-specific overrides are outside this base catalog.

## Saved configurations

During `next dev`, the current parameter draft, applied plan, tab, search, sort, page and named-config selection survive Fast Refresh and component remounts. Worker restarts recalculate the applied plan without overwriting uncalculated edits. The browser Navigation API also preserves these values through script-triggered full reloads (including development-server restarts) using a one-time session snapshot. A manual browser refresh resets this temporary state; named configurations in localStorage remain saved. Browsers without the Navigation API still retain state through Fast Refresh, but cannot distinguish automatic full reloads from manual refreshes. Production does not enable temporary development persistence.

Named configurations save the year window, train/tram lengths, trip distance, minimum top speed and selected cargo types in this browser's `localStorage` (`tf3-planner.configs.v1`). Use **Save new** to create one, select a saved config to restore and recalculate, or use **Update** to replace its name/settings and **Delete** to remove it. Configurations stay on this browser/device and survive page reloads. Saving captures the current parameter fields even before calculating them.

## Formation rules

- The year window includes both endpoints. A missing retirement year is unlimited. A formation must have at least one purchase year shared by all its components within the selected window.
- All options available at some point in the window are shown, with one- and two-engine options together. Rows unavailable at the start are greyed out; rows unavailable at the end are yellow. Both markings can apply to the same option. Badges beside the vehicle name show the complete formation’s introduction year (with years to wait) and removal year when either falls inside the plan’s window; a limiting wagon’s dates count too.
- One or two identical powered vehicles; one wagon type, repeated as many times as fits. The length includes all powered vehicles and wagons.
- Compatibility uses TF3 carrier and engine/vehicle transport modes. Light rail appears in both eligible tabs, with the length limit of the active tab. Every component must support that tab's transport mode; railway wagons and tram engines never mix.
- Authored multiple units are treated as complete fixed vehicles, with one or two identical sets. Loose formation parts are excluded. An engine-only fixed pair can pull wagons; a complete passenger set is kept intact. This is the explicit exception to custom homogeneous-wagon construction.
- Minimum top speed is optional (0 = no minimum), applies to the complete formation, and uses the rounded km/h shown in the table. Click **Calculate options** to apply it across all tabs.
- Self-propelled vehicles without a fitting compatible wagon remain valid if they carry the selected cargo. Road vehicles are single vehicles without a formation-length limit.
- Selecting multiple cargo types is an **AND filter**: every result must support all selected items, with one row per formation. Wagons must support every selected cargo; self-propelled/fixed vehicles must do so themselves. Each cargo is evaluated as an individual full load, and all cargo-dependent table metrics use the selected cargo with the lowest throughput. This checks cargo flexibility, not simultaneous mixed-cargo allocation. Vehicle details and CSV exports list the supported selection and the cargo used for the metrics.

## Vehicle identification

Vehicle rows and summary cards include tiny TF3 menu images beside the engine and wagon names. Thumbnails have a fixed 10 px height and retain each image's natural aspect ratio, so longer vehicles appear wider; they load lazily and share assets with the larger previews. The exporter measures the visible artwork's alpha bounds, and a thumbnail-only vertical offset centers that artwork within the text line despite uneven transparent padding. Hover or keyboard-focus a vehicle row or summary card to see the larger TF3 menu icons. These are the base artwork colors; company recoloring can change their in-game appearance. Fixed formations show their first authored component's icon. Hover previews render outside the scrolling table so they are not clipped.

`npm run data:extract-visuals` reruns the standard-library Python exporter in `scripts/extract_tf3_visuals.py` after refreshing the vehicle catalog. It converts the installed TF3 TGA menu icons to portable PNGs in `public/vehicles`, and writes paths, image sizes, source references, an icon fingerprint and approximate body colors to `src/data/tf3-vehicle-visuals.json`. The app reads only these included assets. The swatch algorithm samples opaque body pixels, excludes dark undercarriages and transparent backgrounds, and groups similar shaded colors; it estimates visual appearance rather than reading a paint specification.

## Finance settings

The **Finance** button opens independent vehicle-cost and maintenance sliders from 50–150% in 25% steps. Easy/Normal/Hard/Very hard set both to 50/100/125/150%; Hard is the default. Apply recalculates the current results and cost per performance, while retaining uncalculated parameter edits. Named configurations include both multipliers; older configs use Hard defaults. Purchase and running totals are scaled independently and rounded to whole dollars.

## Metrics

Capacity follows TF3's raw-capacity `/ 4` convention. Maximum speed is the slowest component. Passenger comfort is capacity-weighted. Noise and pollution are sums of the extracted component scores, **not decibels or physical exposure**. Purchase and running costs reproduce the installed TF3 base cost model and per-vehicle scales, scaled by the selected finance sliders, before company, maintenance-condition or mod adjustments.

Initial loaded acceleration is estimated as tractive effort in newtons divided by loaded mass in kilograms. Payload uses TF3's cargo weight factor. This estimate excludes drag, grades and adhesion.

The sortable **Time to max** (seconds) and **Dist. to max** (meters) columns use the same constant effective acceleration as throughput: `a = min(initial traction acceleration, power / (loaded mass × max(top speed / 2, 1)))`, with speed in m/s and power in watts. Time is `v / a`; distance is `v² / (2a)`. They measure acceleration from rest, excluding loading and braking, independently of trip length. Vehicle details and CSV exports also expose effective performance acceleration and the peak speed actually reached on the selected trip (which can be below top speed when braking must start early). This makes the current approximation auditable without changing its behavior.

The reference performance benchmark is capacity transported per hour over the user-entered trip distance (10 km by default), starting and ending at rest, including a full load and unload. Enter a positive distance in kilometers and click **Calculate options** to update throughput and cost per performance. Travel uses constant estimated acceleration limited by traction and power at half top speed, and 1 m/s² braking. Loading applies the cargo's loading factor. It excludes curves, gradients, traffic, return trips and income. Each CSV row and vehicle detail includes the distance used.

```
annualized cost = yearly running cost + purchase cost / 20
cost per performance = annualized cost / reference throughput (units/hour)
```

Lower cost per performance is better. Compare like cargo units. This is a planning heuristic, not profit or an exact game simulation. The info tooltip beside **Your fleet options** explains the performance formula on hover, keyboard focus or tap. The app's Data & methodology dialog provides further detail.

## Responsiveness and verification

Calculations run in a web worker after clicking **Calculate options**, with progress reporting and request IDs. Search uses React deferred values. The table sorts numerically before pagination and renders at most 40 rows; all filtered rows are included in CSV exports. Engine/set counts appear beside vehicle names. Monetary table values are shown in thousands of dollars, with exact dollar amounts in hover tooltips and vehicle details; cost per performance retains two decimal places in thousands. Loading, noise and pollution are displayed as whole numbers. Numeric columns keep compact fixed widths while the vehicle column takes the remaining width. Sorting, calculations and CSV exports retain the underlying precision and dollar amounts.

```powershell
npm test
npm run test:extractor
npx tsc --noEmit
npm run build
```

Tests cover homogeneous maximum-length formations, one/two engines, simultaneous and boundary availability, future/retiring vehicles, rail eligibility of tram trailers, fixed sets, road vehicles and finite metrics across every cargo in five eras. They use Node's built-in test runner; no test framework dependency is required.

Main files: `src/components/planner.tsx` (UI), `src/lib/planner.ts` (pure calculations), `src/lib/planner.worker.ts` (worker), `src/data/tf3-vehicles.json` (generated catalog).
