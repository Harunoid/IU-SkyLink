/**
 * Geometry helpers backed by Turf.js. Everything that measures or derives
 * geometry goes through here, so the rest of the app never touches the
 * library's GeoJSON plumbing.
 *
 * Turf is loaded from the CDN as a classic script and read off `globalThis`.
 * Positions are [longitude, latitude].
 */

function turf() {
  if (!globalThis.turf) throw new Error('Turf.js failed to load');
  return globalThis.turf;
}

const isPosition = (position) =>
  Array.isArray(position) && Number.isFinite(position[0]) && Number.isFinite(position[1]);

/**
 * The usable vertices of a path: finite positions, with consecutive
 * duplicates dropped. A path needs at least two of these to have a length.
 */
function validPath(coordinates) {
  const path = [];
  for (const position of coordinates ?? []) {
    const last = path[path.length - 1];
    if (isPosition(position) && !(last && last[0] === position[0] && last[1] === position[1])) {
      path.push(position);
    }
  }
  return path;
}

/** Geodesic distance between two positions, in metres. */
export function distanceMeters(from, to) {
  if (!isPosition(from) || !isPosition(to)) return 0;
  return turf().distance(from, to, { units: 'meters' });
}

/** Geodesic length of a path, in metres. */
export function pathLengthMeters(coordinates) {
  const path = validPath(coordinates);
  if (path.length < 2) return 0;
  return turf().length(turf().lineString(path), { units: 'meters' });
}

/**
 * Position a given distance along a path, measured from its first vertex,
 * or null when the path is degenerate (for example two stations dragged
 * onto the same spot).
 */
export function positionAlong(coordinates, meters) {
  const path = validPath(coordinates);
  if (path.length < 2 || !Number.isFinite(meters)) return null;
  const position = turf().along(turf().lineString(path), meters, { units: 'meters' }).geometry
    .coordinates;
  return isPosition(position) ? position : null;
}

/**
 * Polygon enclosing everything within `meters` of a path, as a GeoJSON
 * Feature. Used for the clearance corridor either side of a cable. A
 * degenerate path gives an empty FeatureCollection, which draws nothing.
 */
export function corridorAround(coordinates, meters) {
  const path = validPath(coordinates);
  const corridor =
    path.length < 2
      ? null
      : turf().buffer(turf().lineString(path), meters, { units: 'meters', steps: 8 });
  return corridor ?? { type: 'FeatureCollection', features: [] };
}
