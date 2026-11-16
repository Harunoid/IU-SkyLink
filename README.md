# IU SkyLink

An interactive presentation of **IU SkyLink**, a concept for a rooftop-to-rooftop aerial cable transit network at Indiana University Bloomington. Stations sit on existing campus buildings, so the system adds cross-campus capacity without taking new land.

The site has three parts:

- **System map** – both lines, all seven stations, and simulated cabin positions on a Leaflet map.
- **Trip comparison** – door-to-door time by SkyLink against walking for any station pair, checked against IU's 15-minute passing period.
- **Cabin viewer** – an orbitable 3D model of the 10-passenger cabin with annotated specifications.

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
    map[map.js<br>Leaflet map]
    planner[planner.js<br>trip comparison UI]
    viewer[viewer.js<br>3D cabin dialog]
  end
  app --> network
  app --> map
  app --> planner
  app --> viewer
  planner --> network
  map -. Leaflet 1.9 .-> cdn1((unpkg))
  viewer -. model-viewer 4 .-> cdn2((Google CDN))
  viewer --> glb[(public/models/<br>skylink-cabin.glb)]
```

```
.
├── index.html                  Page markup: header, map, panels, viewer dialog
├── public/
│   ├── data/skylink-data.geojson   Stations and alignments
│   └── models/skylink-cabin.glb    Cabin model (generated)
├── src/
│   ├── css/
│   │   ├── tokens.css          Colour, type and spacing tokens
│   │   └── main.css            Component styles
│   └── js/
│       ├── app.js              Loads data, connects the modules
│       ├── network.js          Parsing, distances, fastest-route search
│       ├── map.js              Basemap, lines, stations, cabin simulation
│       ├── planner.js          Walking vs. SkyLink comparison
│       └── viewer.js           model-viewer setup, camera presets, hotspots
└── tools/build-cabin-model.mjs Regenerates the cabin .glb
```

`map.js`, `planner.js` and `viewer.js` do not import one another. `app.js` passes callbacks between them (for example, a planned trip is handed to the map to highlight), which keeps each module usable on its own.

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

**Alignment** (`LineString`)

| Property | Type | Notes |
| --- | --- | --- |
| `name`, `description` | string | Display name and role |
| `service` | `"main"` \| `"spur"` | Controls line styling |
| `color` | string | Hex stroke colour |
| `stations` | string[] | Station ids in order along the line |
| `line_speed_mps` | number | 6.0 |
| `peak_headway_s` | number | 30 |

Alignment vertices coincide with station positions. Spans are straight because a monocable can only change direction inside a station.

### Coordinate provenance

Four stations are placed from published coordinates: Memorial Stadium, Indiana Memorial Union, Eigenmann Hall and the Global and International Studies Building (the last two from City of Bloomington address records). Wells Library, Ballantine Hall and the School of Optometry are positioned from the campus map and marked as such in `coordinate_source`; confirm them against a survey or GIS layer before using the distances for engineering.

## How trip times are estimated

All assumptions live in `OPERATIONS` at the top of `src/js/network.js`.

| Component | Value |
| --- | --- |
| Rooftop access (elevator and fare tap), each end | 60 s |
| Average wait at peak | 15 s (half the headway) |
| Ride | span distance ÷ 6.0 m/s |
| Passing through an intermediate station | 40 s |
| Changing lines | 75 s |
| Walking | straight-line distance × 1.3, at 1.34 m/s |

The route search is Dijkstra's algorithm over (station, line) pairs, so staying aboard through a station and transferring there are costed differently. These are planning-level estimates, not a simulation; short hops such as Wells Library to Hamilton Lugar correctly come out faster on foot.

## The cabin model

`public/models/skylink-cabin.glb` is a **massing model**, not the final CAD export. It is generated from a parts list by `tools/build-cabin-model.mjs` and matches the specified overall dimensions (2.00 m × 2.20 m footprint, 2.16 m cabin height, 0.90 m clear door opening) and livery, without surface detail.

To swap in a detailed model, export it as `.glb` with metres as the unit and +Y up, replace the file, then adjust the hotspot `position` values in `src/js/viewer.js` to suit the new geometry.

## Running locally

ES modules and `fetch` need an HTTP origin, so open the site through a local server rather than from the file system.

```bash
git clone https://github.com/Harunoid/IU-SkyLink.git
cd IU-SkyLink
npm start            # python3 -m http.server 8080
```

Then visit <http://localhost:8080>. Any static server works; there are no dependencies to install.

To regenerate the cabin model after editing the parts list (Node 18 or newer):

```bash
npm run build:model
```

## Deployment

The repository root is the site. On GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**, choose `main` and `/ (root)`. The empty `.nojekyll` file tells Pages to serve the files untouched.

## Credits

- Basemap © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, © [CARTO](https://carto.com/attributions)
- [Leaflet](https://leafletjs.com/) and [`<model-viewer>`](https://modelviewer.dev/)
- IU Crimson `#990000` and Cream `#EEEDEB` follow Indiana University's brand palette. This is a student project and is not affiliated with or endorsed by the university.
