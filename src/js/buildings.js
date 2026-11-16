/**
 * Loads the footprints of the buildings that carry stations.
 *
 * The committed snapshot (written by `npm run fetch:data`) is preferred. If
 * it is absent the outlines are requested live from OpenStreetMap and cached
 * for the browser session, so the map never depends on that request.
 */
import { OVERPASS_ENDPOINTS, hostBuildingCollection, overpassRequest } from './osm.js';

const SNAPSHOT_URL = 'public/data/campus-buildings.geojson';
const CACHE_KEY = 'skylink:host-buildings:v1';
const LIVE_TIMEOUT_MS = 20_000;

/**
 * @param {Iterable<{id: string, coordinates: [number, number]}>} stations
 * @returns {Promise<object|null>} GeoJSON FeatureCollection, or null if unavailable
 */
export async function loadHostBuildings(stations) {
  try {
    return (await loadSnapshot()) ?? (await loadLive([...stations]));
  } catch (error) {
    console.warn('Host building footprints unavailable:', error);
    return null;
  }
}

async function loadSnapshot() {
  const response = await fetch(SNAPSHOT_URL);
  if (!response.ok) return null;
  const collection = await response.json();
  return collection.features?.length ? collection : null;
}

async function loadLive(stations) {
  const cached = sessionStorage.getItem(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  let lastError;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const [url, options] = overpassRequest(endpoint);
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(LIVE_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { elements } = await response.json();
      const collection = hostBuildingCollection(stations, elements);
      if (collection.features.length === 0) return null;
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(collection));
      return collection;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
