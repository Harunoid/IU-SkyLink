/**
 * OpenStreetMap helpers: builds the Overpass query for the buildings that
 * carry stations and turns the response into footprint polygons.
 *
 * Pure functions with no DOM or Node APIs, so the browser and
 * tools/fetch-campus-data.mjs share one implementation.
 */

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

/** South, west, north, east: the IU Bloomington campus plus the stadium. */
const CAMPUS_BBOX = [39.16, -86.532, 39.186, -86.503];

/** How each station's host building is named in OpenStreetMap. */
const HOST_BUILDING_PATTERNS = {
  stadium: /memorial stadium/i,
  wells: /wells library/i,
  imu: /indiana memorial union/i,
  ballantine: /ballantine/i,
  optometry: /optometry/i,
  gisb: /international studies|hamilton lugar/i,
  eigenmann: /eigenmann/i,
};

/** A match further than this from the station is treated as a different building. */
const MAX_MATCH_DISTANCE_M = 400;

const round = (value, places) => Number(value.toFixed(places));

export function hostBuildingQuery() {
  const names = Object.values(HOST_BUILDING_PATTERNS)
    .map((pattern) => pattern.source)
    .join('|');
  return `[out:json][timeout:25];wr["name"~"${names}",i](${CAMPUS_BBOX.join(',')});out tags geom;`;
}

export function overpassRequest(endpoint) {
  return [
    endpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(hostBuildingQuery())}`,
    },
  ];
}

export function distanceMeters([lngA, latA], [lngB, latB]) {
  const metersPerDegree = 111320;
  const x = (lngB - lngA) * metersPerDegree * Math.cos(((latA + latB) / 2) * (Math.PI / 180));
  const y = (latB - latA) * metersPerDegree;
  return Math.hypot(x, y);
}

const toRing = (geometry) => geometry.map(({ lon, lat }) => [round(lon, 6), round(lat, 6)]);
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];
const isClosed = (ring) => ring.length >= 4 && samePoint(ring[0], ring[ring.length - 1]);

/** Joins the outer member ways of a multipolygon relation into closed rings. */
function assembleRings(segments) {
  const open = segments.map((segment) => [...segment]);
  const rings = [];
  while (open.length > 0) {
    const ring = open.shift();
    let extended = true;
    while (!isClosed(ring) && extended) {
      extended = false;
      const tail = ring[ring.length - 1];
      for (let i = 0; i < open.length; i += 1) {
        const candidate = open[i];
        if (samePoint(candidate[0], tail)) {
          ring.push(...candidate.slice(1));
        } else if (samePoint(candidate[candidate.length - 1], tail)) {
          ring.push(...[...candidate].reverse().slice(1));
        } else {
          continue;
        }
        open.splice(i, 1);
        extended = true;
        break;
      }
    }
    if (isClosed(ring)) rings.push(ring);
  }
  return rings;
}

/** Outer rings only: courtyards are not needed at map scale. */
function outerRings(element) {
  if (element.type === 'way') {
    const ring = toRing(element.geometry ?? []);
    return isClosed(ring) ? [ring] : [];
  }
  const outerWays = (element.members ?? [])
    .filter((member) => member.type === 'way' && member.role !== 'inner' && member.geometry)
    .map((member) => toRing(member.geometry));
  return assembleRings(outerWays);
}

function ringAreaAndCentroid(ring) {
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[i + 1];
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (twiceArea === 0) return { area: 0, centroid: ring[0] };
  return {
    area: Math.abs(twiceArea / 2),
    centroid: [cx / (3 * twiceArea), cy / (3 * twiceArea)],
  };
}

export function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Overpass elements with a usable outline, reduced to what the app needs. */
export function describeBuildings(elements) {
  const buildings = [];
  for (const element of elements) {
    const rings = outerRings(element);
    if (rings.length === 0 || !element.tags?.name) continue;
    const largest = rings
      .map((ring) => ringAreaAndCentroid(ring))
      .reduce((a, b) => (b.area > a.area ? b : a));
    buildings.push({
      osmId: `${element.type}/${element.id}`,
      name: element.tags.name,
      tags: element.tags,
      rings,
      centroid: largest.centroid.map((value) => round(value, 6)),
    });
  }
  return buildings;
}

/**
 * Candidate host buildings for a station, nearest first. Only the first is
 * a match, and only if `isMatch` is true; the rest are returned for logging.
 *
 * @param {{id: string, coordinates: [number, number]}} station
 */
export function rankHostBuildings(station, buildings) {
  const pattern = HOST_BUILDING_PATTERNS[station.id];
  if (!pattern) return [];
  return buildings
    .filter((building) => pattern.test(building.name))
    .map((building) => {
      const meters = distanceMeters(station.coordinates, building.centroid);
      return { building, meters, isMatch: meters <= MAX_MATCH_DISTANCE_M };
    })
    .sort((a, b) => a.meters - b.meters);
}

export function footprintFeature(stationId, building) {
  return {
    type: 'Feature',
    id: stationId,
    geometry:
      building.rings.length === 1
        ? { type: 'Polygon', coordinates: building.rings }
        : { type: 'MultiPolygon', coordinates: building.rings.map((ring) => [ring]) },
    properties: {
      station: stationId,
      name: building.name,
      osm_id: building.osmId,
      levels: building.tags['building:levels'] ?? null,
      height: building.tags.height ?? null,
    },
  };
}

/** FeatureCollection of the matched footprint for each station that has one. */
export function hostBuildingCollection(stations, elements) {
  const buildings = describeBuildings(elements);
  const features = [];
  for (const station of stations) {
    const [best] = rankHostBuildings(station, buildings);
    if (best?.isMatch) features.push(footprintFeature(station.id, best.building));
  }
  return { type: 'FeatureCollection', features };
}
