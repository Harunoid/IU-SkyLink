#!/usr/bin/env node
/**
 * Builds public/data/transit-matrix.json: a modelled door-to-door campus bus
 * time for every ordered pair of stations.
 *
 *   npm run build:transit
 *
 * This is NOT timetable data. It applies one set of service assumptions,
 * patterned on a frequent campus circulator such as IU Campus Bus Route A,
 * to the road distance between each pair of host buildings. Replace
 * SERVICE with measured values, or swap the model for GTFS, when available.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { distanceMeters } from '../src/js/osm.js';

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/data');

const SERVICE = {
  label: 'Campus bus',
  basis: 'Modelled on a frequent campus circulator (IU Campus Bus Route A pattern)',
  /** Minutes between buses during class-change peaks. */
  headwaySeconds: 600,
  /** Walk between a building door and its nearest stop, each end. */
  stopAccessSeconds: 120,
  /** Streets are longer than the straight line between two buildings. */
  roadDetourFactor: 1.4,
  /** Running speed between stops on campus streets. */
  runningSpeedMps: 7.0,
  stopSpacingMeters: 400,
  dwellSecondsPerStop: 25,
  /** Extra running time in class-change traffic and at crossings. */
  trafficDelayShare: 0.2,
};

const network = JSON.parse(await readFile(resolve(DATA_DIR, 'skylink-data.geojson'), 'utf8'));
const stations = network.features.filter((f) => f.properties.feature_type === 'station');

const pairs = {};
for (const origin of stations) {
  for (const destination of stations) {
    if (origin.id === destination.id) continue;
    const meters =
      distanceMeters(origin.geometry.coordinates, destination.geometry.coordinates) *
      SERVICE.roadDetourFactor;
    const runSeconds = meters / SERVICE.runningSpeedMps;
    const intermediateStops = Math.max(0, Math.round(meters / SERVICE.stopSpacingMeters) - 1);
    const parts = {
      waitSeconds: SERVICE.headwaySeconds / 2,
      accessSeconds: 2 * SERVICE.stopAccessSeconds,
      runSeconds: Math.round(runSeconds),
      dwellSeconds: intermediateStops * SERVICE.dwellSecondsPerStop,
      delaySeconds: Math.round(runSeconds * SERVICE.trafficDelayShare),
    };
    pairs[`${origin.id}|${destination.id}`] = {
      meters: Math.round(meters),
      intermediateStops,
      ...parts,
      totalSeconds: Object.values(parts).reduce((sum, seconds) => sum + seconds, 0),
    };
  }
}

await writeFile(
  resolve(DATA_DIR, 'transit-matrix.json'),
  `${JSON.stringify({ generated: new Date().toISOString().slice(0, 10), service: SERVICE, pairs }, null, 2)}\n`,
);
console.log(`Wrote ${Object.keys(pairs).length} station pairs.`);
