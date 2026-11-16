# IU SkyLink

An interactive presentation of **IU SkyLink**, a concept for a rooftop-to-rooftop aerial cable transit network at Indiana University Bloomington. Stations sit on existing campus buildings, so the system adds cross-campus capacity without taking new land.

The site has five parts:

- **System map** – both lines, all seven stations, and simulated cabin positions on a tilted 3D map of campus.
- **Trip comparison** – door-to-door time by SkyLink, on foot and by campus bus for any station pair, checked against IU's 15-minute passing period.
- **Layout sandbox** – unlock the network, drag any station, and watch the cables, span lengths and trip times follow.
- **Station surveys** – a panel per station with site photos, roof elevations and clearance notes.
- **Cabin viewer** – an orbitable 3D model of the 10-passenger cabin with annotated specifications.

The map also outlines each host building from OpenStreetMap and can show a 15 m clearance corridor around every cable, the trip panel draws an elevation profile with a regenerative-braking estimate, and the header shows a live wind-based operating status.

Built for Design Practice (W200) at IU Bloomington, Fall 2026.

## The network (v2)

| Line | Stations | Length |
| --- | --- | --- |
| Crimson Line (north–south) | Memorial Stadium · Wells Library · Indiana Memorial Union · Ballantine Hall · School of Optometry | 2.68 km |
| Limestone Line (east–west) | Indiana Memorial Union · Hamilton Lugar School · Eigenmann Hall | 1.37 km |
| 10th Street Relief Spur | Wells Library · Eigenmann Hall | 0.71 km |

Continuous-loop detachable monocable, 6.0 m/s line speed, 30-second peak headway, 10-passenger cabins. That gives a theoretical 1,200 riders per hour in each direction on each line.

## Architecture

No build step and no framework: static files served as they are, with ES modules loaded natively by the browser.

```mermaid
flowchart LR
  data[(public/data/<br>skylink-data.geojson)] --> network
  subgraph src/js
    app[app.js<br>entry point and wiring]
    network[network.js<br>data model and routing]
    map[map.js<br>MapLibre 3D map]
    basemap[basemap.js<br>map style]
    planner[planner.js<br>trip comparison UI]
    survey[survey.js<br>station survey dialog]
    viewer[viewer.js<br>3D cabin dialog]
    geo[geo.js<br>Turf.js wrappers]
  end
  matrix[(transit-matrix.json)] --> network
  surveys[(stations.json)] --> survey
  app --> survey
  network --> geo
  map --> geo
  geo -. Turf.js 7 .-> cdn1
  app --> network
  app --> map
  app --> planner
  app --> viewer
  planner --> network
  map --> basemap
  map -. MapLibre GL JS 5 .-> cdn1((unpkg))
  basemap -. vector tiles .-> ofm((OpenFreeMap))
  viewer -. model-viewer 4 .-> cdn2((Google CDN))
  app --> buildings[buildings.js<br>host footprints]
  app --> weather[weather.js<br>wind status]
  planner --> profile[profile.js<br>elevation profile]
  buildings --> osm[osm.js<br>Overpass parsing]
  buildings -. fallback .-> overpass((Overpass API))
  weather -.-> meteo((Open-Meteo))
  viewer --> glb[(public/models/<br>skylink-cabin.glb)]
```

```
.
├── index.html                  Page markup: header, map, panels, dialogs
├── public/
│   ├── data/
│   │   ├── skylink-data.geojson    Stations and alignments
│   │   ├── stations.json           Survey photos and clearance notes
│   │   └── transit-matrix.json     Campus bus estimates (generated)
│   ├── images/stations/            Survey photos
│   └── models/skylink-cabin.glb    Cabin model (generated)
├── src/
│   ├── css/
│   │   ├── tokens.css          Colour, type and spacing tokens
│   │   └── main.css            Component styles
│   └── js/
│       ├── app.js              Loads data, connects the modules
│       ├── network.js          Network model, timing, fastest-route search
│       ├── geo.js              Distances, lengths and buffers (Turf.js)
│       ├── map.js              3D map, lines, stations, sandbox, cabins
│       ├── basemap.js          Dark map style with extruded buildings
│       ├── planner.js          SkyLink, walking and bus comparison
│       ├── profile.js          Elevation profile and energy estimate
│       ├── buildings.js        Host building footprints (snapshot or live)
│       ├── osm.js              Overpass query and geometry parsing
│       ├── weather.js          Live wind operating status
│       ├── survey.js           Station survey photos and section card
│       └── viewer.js           model-viewer setup, camera presets, hotspots
└── tools/
    ├── build-cabin-model.mjs   Regenerates the cabin .glb
    ├── build-transit-matrix.mjs  Regenerates the campus bus matrix
    └── fetch-campus-data.mjs   Refreshes footprints and elevations
```

`map.js`, `planner.js`, `survey.js` and `viewer.js` do not import one another. `app.js` passes callbacks between them (for example, a planned trip is handed to the map to highlight), which keeps each module usable on its own.

## Data schema

`public/data/skylink-data.geojson` is a single GeoJSON `FeatureCollection` in WGS 84 (`[longitude, latitude]`). Each feature has a stable string `id` and a `feature_type` of `station` or `alignment`.

**Station** (`Point`)

| Property | Type | Notes |
| --- | --- | --- |
| `name`, `short_name` | string | Full name and map label |
| `role` | string | Function in the network |
| `host_building`, `address` | string | Building carrying the rooftop station |
| `lines` | string[] | Ids of the alignments serving the station |
| `is_transfer` | boolean | More than one line stops here |
| `elevators` | number | Redundant elevator count (2 at every station) |
| `level_boarding` | boolean | Platform flush with cabin floor |
| `fare_media` | string[] | Accepted payment: CrimsonCard and open-loop contactless |
| `coordinate_source` | string | Where the position came from |
| `ground_elevation_m` | number | Ground level above sea level (USGS 3DEP) |
| `platform_height_m` | number | Rooftop platform height above the ground |
| `ground_elevation_source`, `platform_height_source` | string | Provenance of the two values above |

**Alignment** (`LineString`)

| Property | Type | Notes |
| --- | --- | --- |
| `name`, `description` | string | Display name and role |
| `service` | `"main"` \| `"spur"` | Controls line styling |
| `color` | string | Hex stroke colour |
| `stations` | string[] | Station ids in order along the line |
| `line_speed_mps` | number | 6.0 |
| `peak_headway_s` | number | 30 |

Spans are straight because a monocable can only change direction inside a station, so the site draws each line from its ordered `stations` list and the stations' positions. The `LineString` coordinates are kept in step for other GIS tools.

### Coordinate provenance

Four stations are placed from published coordinates: Memorial Stadium, Indiana Memorial Union, Eigenmann Hall and the Global and International Studies Building (the last two from City of Bloomington address records). Wells Library, Ballantine Hall and the School of Optometry are positioned from the campus map and marked as such in `coordinate_source`; confirm them against a survey or GIS layer before using the distances for engineering.

### Open data

| Data | Source | How it gets here |
| --- | --- | --- |
| Ground elevation | [USGS 3DEP Elevation Point Query Service](https://apps.nationalmap.gov/epqs/) | Stored per station in the GeoJSON |
| Host building footprints | [OpenStreetMap](https://www.openstreetmap.org/copyright) via the Overpass API | `public/data/campus-buildings.geojson` if present, otherwise requested live by the browser and cached for the session |
| Wind speed and gusts | [Open-Meteo](https://open-meteo.com/) | Requested live every 10 minutes |

`npm run fetch:data` refreshes the first two. It writes the footprint snapshot, moves the three estimated stations onto the centroid of their real footprint, re-reads ground elevation at every station, and replaces a platform height with OpenStreetMap's `height` or `building:levels` tag where one is mapped. Run it once and commit the result so the site no longer depends on a live Overpass request.

Platform heights are currently **design estimates** of each roof's height above grade. The energy shown under the elevation profile is the potential energy of a full peak hour of 80 kg riders across the platform height difference, with 60% recovered on a descent and an 85% efficient drive on a climb. It is an order-of-magnitude figure, not a drive-system model.

The wind status uses planning-level gust limits (reduced speed from 15 m/s, hold from 20 m/s); a real installation's limits come from the manufacturer.

## How trip times are estimated

All assumptions live in `OPERATIONS` at the top of `src/js/network.js`.

Every figure is door to door, and distances are geodesic, measured with [Turf.js](https://turfjs.org/).

**SkyLink**

| Component | Value |
| --- | --- |
| Fare tap, elevator call and doors, each end | 45 s |
| Elevator ride, each end | platform height ÷ 2 m/s |
| Average wait at peak | 15 s (half the headway) |
| Cruise | span distance ÷ 6.0 m/s |
| Passing through an intermediate station | 40 s |
| Changing lines | 75 s |

**Walking**

| Component | Value |
| --- | --- |
| Distance | straight line × 1.3 for real paths |
| Pace | 1.3 m/s |
| Climbing | 6 s for each metre of ground gained |

**Campus bus**

`public/data/transit-matrix.json` holds a precalculated time for all 42 station pairs, written by `npm run build:transit`. It is a **modelled estimate, not a timetable**: it assumes one service comparable to IU Campus Bus Route A, with the parameters stored in the file's `service` block.

| Component | Value |
| --- | --- |
| Average wait | 5 min (half a 10-minute headway) |
| Walk to and from stops | 2 min each end |
| Street distance | straight line × 1.4 |
| Running speed between stops | 7 m/s |
| Stops | 25 s every 400 m |
| Traffic delay | 20% of driving time |

Replacing this file with times derived from the Bloomington Transit GTFS feed is the intended next step; the page only needs the `pairs` to keep the same shape.

The route search is Dijkstra's algorithm over (station, line) pairs, so staying aboard through a station and transferring there are costed differently. These are planning-level estimates, not a simulation; short hops such as Wells Library to Hamilton Lugar correctly come out faster on foot.

## Layout sandbox and clearance corridor

**Edit network layout** makes every station pin draggable. While a pin moves, `network.js` re-derives each line's geometry and span lengths from the station positions, the map redraws the cables, and the open trip is re-planned, so the comparison updates as you drag. **Reset to default layout** puts every station back on its surveyed position. Nothing is saved; reloading the page also restores the default.

Only horizontal distance follows a moved station. Ground elevations, platform heights and the bus matrix stay as surveyed, and the page says so while a layout is modified.

**Show FAA / canopy clearance corridor** draws a 15 m buffer either side of each visible cable (`turf.buffer`). It is a planning aid for spotting conflicts with trees and roofs, not a regulatory surface.

## Station surveys

Each station popup opens a survey panel. Photos and notes come from `public/data/stations.json`:

```json
"stadium": {
  "station_type": "End terminal with drive machinery and cabin storage",
  "photos": [
    { "url": "images/stations/stadium-1.jpg", "caption": "North Terminal site inspection", "credit": "Harun" }
  ],
  "clearance_notes": ["..."]
}
```

`url` is relative to `public/`. A station with an empty `photos` list shows a schematic section drawn from its ground level and platform height instead. Clearance notes are design intent, not survey findings.

## The cabin model

`public/models/skylink-cabin.glb` is a **massing model**, not the final CAD export. It is generated from a parts list by `tools/build-cabin-model.mjs` and matches the specified overall dimensions (2.00 m × 2.20 m footprint, 2.16 m cabin height, 0.90 m clear door opening) and livery, without surface detail.

To swap in a detailed model, export it as `.glb` with metres as the unit and +Y up, replace the file, then adjust the hotspot `position` values in `src/js/viewer.js` to suit the new geometry.

## The map

The basemap is drawn in the browser by MapLibre GL JS from [OpenFreeMap](https://openfreemap.org/) vector tiles, which need no API key or account. The style is defined in `src/js/basemap.js`: a dark slate rendering with buildings extruded to their mapped height, so the network reads against the real massing of campus. The **3D view** button switches between the tilted view and a flat plan; right-drag (or two-finger drag on a trackpad with Ctrl) rotates and tilts freely.

If the tile service cannot be reached, the lines, stations and planner still work on a plain background.

## Running locally

ES modules and `fetch` need an HTTP origin, so open the site through a local server rather than from the file system.

```bash
git clone https://github.com/Harunoid/IU-SkyLink.git
cd IU-SkyLink
npm start            # python3 -m http.server 8080
```

Then visit <http://localhost:8080>. Any static server works; there are no dependencies to install.

To refresh footprints and elevations from open data (Node 18 or newer, needs internet):

```bash
npm run fetch:data
```

To regenerate the bus matrix after moving a station in the data or changing the bus assumptions:

```bash
npm run build:transit
```

To regenerate the cabin model after editing the parts list (Node 18 or newer):

```bash
npm run build:model
```

## Making changes

See [docs/updating-the-site.md](docs/updating-the-site.md) for a step-by-step guide to editing, previewing and publishing, and a table of which file controls what.

## Deployment

The repository root is the site. On GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**, choose `main` and `/ (root)`. The empty `.nojekyll` file tells Pages to serve the files untouched.

## Credits

- Building footprints © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (ODbL); elevation from the U.S. Geological Survey; weather data by [Open-Meteo](https://open-meteo.com/) (CC BY 4.0)
- Basemap tiles by [OpenFreeMap](https://openfreemap.org), © [OpenMapTiles](https://www.openmaptiles.org/), data from [OpenStreetMap](https://www.openstreetmap.org/copyright)
- [MapLibre GL JS](https://maplibre.org/), [Turf.js](https://turfjs.org/) and [`<model-viewer>`](https://modelviewer.dev/)
- IU Crimson `#990000` (with `#7A1705` as its dark shade) and Cream `#EEEDEB` follow Indiana University's brand palette. This is a student project and is not affiliated with or endorsed by the university.
