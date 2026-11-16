#!/usr/bin/env node
/**
 * Refreshes the surveyed context for each station from open data:
 *
 *   - host building footprints from OpenStreetMap (Overpass API)
 *   - ground elevation from the USGS 3DEP Elevation Point Query Service,
 *     falling back to Open-Meteo's elevation API if USGS is unavailable
 *
 * Writes public/data/campus-buildings.geojson and updates station positions
 * and elevations in public/data/skylink-data.geojson.
 *
 *   npm run fetch:data
 *
 * Needs network access and Node 18+ (global fetch). No dependencies.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OVERPASS_ENDPOINTS,
  describeBuildings,
  distanceMeters,
  footprintFeature,
  overpassRequest,
  pointInRing,
  rankHostBuildings,
} from '../src/js/osm.js';

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data');
const NETWORK_FILE = resolve(DATA_DIR, 'skylink-data.geojson');
const BUILDINGS_FILE = resolve(DATA_DIR, 'campus-buildings.geojson');
const USER_AGENT = 'iu-skylink-data-refresh/1.0 (student design project)';

/**
 * Stations whose position was only estimated: these are moved onto the
 * centroid of the matched footprint. The rest keep their published position.
 */
const SNAP_TO_FOOTPRINT = new Set(['wells', 'ballantine', 'optometry']);

const round = (value, places) => Number(value.toFixed(places));

async function fetchJson(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: { 'User-Agent': USER_AGENT, ...options.headers },
        signal: AbortSignal.timeout(90_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      console.warn(`  attempt ${attempt} failed for ${new URL(url).host}: ${error.message}`);
      await new Promise((done) => setTimeout(done, 2000 * attempt));
    }
  }
  throw lastError;
}

async function fetchHostBuildings() {
  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`Querying ${new URL(endpoint).host} for host buildings…`);
      const result = await fetchJson(...overpassRequest(endpoint));
      return describeBuildings(result.elements);
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`All Overpass endpoints failed: ${lastError.message}`);
}

async function fetchGroundElevation([lng, lat]) {
  try {
    const usgs = await fetchJson(
      `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&wkid=4326&units=Meters&includeDate=false`,
    );
    const value = Number.parseFloat(usgs.value);
    if (!Number.isFinite(value) || value < -1000) {
      throw new Error(`unexpected payload ${JSON.stringify(usgs).slice(0, 120)}`);
    }
    return { meters: round(value, 1), source: 'USGS 3DEP Elevation Point Query Service' };
  } catch (error) {
    console.warn(`  USGS unavailable (${error.message}); using Open-Meteo`);
    const fallback = await fetchJson(
      `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`,
    );
    return {
      meters: round(fallback.elevation[0], 1),
      source: 'Open-Meteo elevation API (Copernicus DEM)',
    };
  }
}

/** Building height from OSM tags, where mappers have recorded one. */
function taggedHeight(tags) {
  const height = Number.parseFloat(tags.height);
  if (Number.isFinite(height)) return { meters: round(height, 1), source: 'OSM height tag' };
  const levels = Number.parseFloat(tags['building:levels']);
  if (Number.isFinite(levels)) {
    return { meters: round(levels * 4, 1), source: `OSM building:levels (${levels} × 4.0 m)` };
  }
  return null;
}

const network = JSON.parse(await readFile(NETWORK_FILE, 'utf8'));
const stations = network.features.filter((f) => f.properties.feature_type === 'station');
const alignments = network.features.filter((f) => f.properties.feature_type === 'alignment');

const buildings = await fetchHostBuildings();
console.log(`Received ${buildings.length} candidate outlines.`);

const footprints = [];
for (const station of stations) {
  const { properties } = station;
  console.log(`\n${properties.name}`);

  const candidates = rankHostBuildings(
    { id: station.id, coordinates: station.geometry.coordinates },
    buildings,
  );
  for (const { building, meters } of candidates) {
    console.log(`  candidate "${building.name}" (${building.osmId}), ${Math.round(meters)} m away`);
  }

  const host = candidates[0]?.isMatch ? candidates[0].building : null;
  if (!host) {
    console.warn('  no footprint matched; position and height left as they are');
  } else {
    if (SNAP_TO_FOOTPRINT.has(station.id)) {
      const moved = distanceMeters(station.geometry.coordinates, host.centroid);
      station.geometry.coordinates = host.centroid;
      properties.coordinate_source = `OpenStreetMap footprint centroid (${host.osmId})`;
      console.log(`  moved ${Math.round(moved)} m onto the footprint centroid`);
    } else {
      const inside = host.rings.some((ring) => pointInRing(station.geometry.coordinates, ring));
      console.log(`  position kept (${inside ? 'inside' : 'OUTSIDE'} the matched footprint)`);
    }

    const height = taggedHeight(host.tags);
    if (height) {
      properties.platform_height_m = height.meters;
      properties.platform_height_source = height.source;
      console.log(`  platform height ${height.meters} m from ${height.source}`);
    }
    footprints.push(footprintFeature(station.id, host));
  }

  const ground = await fetchGroundElevation(station.geometry.coordinates);
  properties.ground_elevation_m = ground.meters;
  properties.ground_elevation_source = ground.source;
  console.log(`  ground elevation ${ground.meters} m (${ground.source})`);
}

// Alignment vertices are the station positions, so rebuild them after any move.
const stationById = new Map(stations.map((station) => [station.id, station]));
for (const alignment of alignments) {
  alignment.geometry.coordinates = alignment.properties.stations.map(
    (id) => stationById.get(id).geometry.coordinates,
  );
}

const today = new Date().toISOString().slice(0, 10);
network.metadata.updated = today;
await writeFile(NETWORK_FILE, `${JSON.stringify(network, null, 2)}\n`);
await writeFile(
  BUILDINGS_FILE,
  `${JSON.stringify({
    type: 'FeatureCollection',
    name: 'iu-skylink-host-buildings',
    metadata: {
      source: 'OpenStreetMap via Overpass API',
      license: 'ODbL 1.0, © OpenStreetMap contributors',
      retrieved: today,
    },
    features: footprints,
  })}\n`,
);
console.log(`\nMatched ${footprints.length} of ${stations.length} host buildings.`);
