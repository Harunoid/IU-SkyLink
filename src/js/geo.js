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

/** Geodesic distance between two positions, in metres. */
export function distanceMeters(from, to) {
  return turf().distance(from, to, { units: 'meters' });
}

/** Geodesic length of a path, in metres. */
export function pathLengthMeters(coordinates) {
  if (coordinates.length < 2) return 0;
  return turf().length(turf().lineString(coordinates), { units: 'meters' });
}

/** Position a given distance along a path, measured from its first vertex. */
export function positionAlong(coordinates, meters) {
  return turf().along(turf().lineString(coordinates), meters, { units: 'meters' }).geometry
    .coordinates;
}

/**
 * Polygon enclosing everything within `meters` of a path, as a GeoJSON
 * Feature. Used for the clearance corridor either side of a cable.
 */
export function corridorAround(coordinates, meters) {
  return turf().buffer(turf().lineString(coordinates), meters, { units: 'meters', steps: 8 });
}
