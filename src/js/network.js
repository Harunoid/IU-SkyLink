/**
 * Network model: parses the SkyLink GeoJSON into stations and lines and
 * answers trip questions. No DOM or Leaflet code lives here so the timing
 * model can be reasoned about (and tested) on its own.
 */

/** Operating assumptions behind every time estimate shown in the UI. */
export const OPERATIONS = Object.freeze({
  lineSpeedMps: 6.0,
  peakHeadwaySeconds: 30,
  cabinCapacity: 10,
  /** Rooftop access at each end of the trip: elevator ride plus fare tap. */
  stationAccessSeconds: 60,
  /** Cabins detach and creep through intermediate stations. */
  throughStationSeconds: 40,
  /** Platform-to-platform walk and re-boarding when changing lines. */
  transferSeconds: 75,
  walkSpeedMps: 1.34,
  /** Campus paths are not straight lines; scales crow-fly distance. */
  walkDetourFactor: 1.3,
  passingPeriodSeconds: 15 * 60,
});

const EARTH_RADIUS_M = 6371008.8;
const toRadians = (degrees) => (degrees * Math.PI) / 180;

/** Great-circle distance in metres between two [lng, lat] positions. */
export function haversineMeters([lngA, latA], [lngB, latB]) {
  const dLat = toRadians(latB - latA);
  const dLng = toRadians(lngB - lngA);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(latA)) * Math.cos(toRadians(latB)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
}

export async function loadNetwork(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Network data request failed (${response.status})`);
  }
  return buildNetwork(await response.json());
}

export function buildNetwork(featureCollection) {
  const stations = new Map();
  const lines = [];

  for (const feature of featureCollection.features) {
    const { feature_type: featureType, ...properties } = feature.properties;
    if (featureType === 'station') {
      stations.set(feature.id, {
        id: feature.id,
        coordinates: feature.geometry.coordinates,
        ...properties,
      });
    } else if (featureType === 'alignment') {
      lines.push({
        id: feature.id,
        coordinates: feature.geometry.coordinates,
        ...properties,
      });
    }
  }

  for (const line of lines) {
    line.lengthMeters = pathLength(line.coordinates);
    for (const stationId of line.stations) {
      if (!stations.has(stationId)) {
        throw new Error(`Line "${line.id}" references unknown station "${stationId}"`);
      }
    }
  }

  return { stations, lines, edges: buildEdges(stations, lines) };
}

function pathLength(coordinates) {
  let total = 0;
  for (let i = 1; i < coordinates.length; i += 1) {
    total += haversineMeters(coordinates[i - 1], coordinates[i]);
  }
  return total;
}

/** One bidirectional edge per span between consecutive stations on a line. */
function buildEdges(stations, lines) {
  const edges = new Map([...stations.keys()].map((id) => [id, []]));
  for (const line of lines) {
    for (let i = 1; i < line.stations.length; i += 1) {
      const from = line.stations[i - 1];
      const to = line.stations[i];
      const meters = haversineMeters(
        stations.get(from).coordinates,
        stations.get(to).coordinates,
      );
      edges.get(from).push({ to, lineId: line.id, meters });
      edges.get(to).push({ to: from, lineId: line.id, meters });
    }
  }
  return edges;
}

/**
 * Fastest SkyLink itinerary between two stations.
 *
 * Dijkstra over (station, line) states so that staying on a cabin through a
 * station and changing lines there are priced differently.
 */
export function planTrip(network, originId, destinationId) {
  if (originId === destinationId) return null;

  const stateKey = (stationId, lineId) => `${stationId}|${lineId}`;
  const best = new Map();
  const previous = new Map();
  const queue = [];

  for (const edge of network.edges.get(originId)) {
    const key = stateKey(originId, edge.lineId);
    if (!best.has(key)) {
      best.set(key, 0);
      queue.push({ stationId: originId, lineId: edge.lineId, seconds: 0 });
    }
  }

  let arrival = null;
  while (queue.length > 0) {
    queue.sort((a, b) => a.seconds - b.seconds);
    const current = queue.shift();
    const currentKey = stateKey(current.stationId, current.lineId);
    if (current.seconds > best.get(currentKey)) continue;
    if (current.stationId === destinationId) {
      arrival = current;
      break;
    }

    for (const edge of network.edges.get(current.stationId)) {
      const isTransfer = edge.lineId !== current.lineId;
      const atOrigin = current.stationId === originId;
      let stationPenalty = 0;
      if (!atOrigin) {
        stationPenalty = isTransfer
          ? OPERATIONS.transferSeconds
          : OPERATIONS.throughStationSeconds;
      }
      const seconds =
        current.seconds + stationPenalty + edge.meters / OPERATIONS.lineSpeedMps;
      const nextKey = stateKey(edge.to, edge.lineId);
      if (seconds < (best.get(nextKey) ?? Infinity)) {
        best.set(nextKey, seconds);
        previous.set(nextKey, { ...current, meters: edge.meters });
        queue.push({ stationId: edge.to, lineId: edge.lineId, seconds });
      }
    }
  }

  if (!arrival) return null;

  // Walk the predecessor chain back to the origin, then group spans by line.
  const spans = [];
  let cursor = arrival;
  while (previous.has(stateKey(cursor.stationId, cursor.lineId))) {
    const from = previous.get(stateKey(cursor.stationId, cursor.lineId));
    spans.unshift({
      from: from.stationId,
      to: cursor.stationId,
      lineId: cursor.lineId,
      meters: from.meters,
    });
    cursor = from;
  }

  const legs = [];
  for (const span of spans) {
    const lastLeg = legs[legs.length - 1];
    if (lastLeg && lastLeg.lineId === span.lineId) {
      lastLeg.stationIds.push(span.to);
      lastLeg.meters += span.meters;
    } else {
      legs.push({
        lineId: span.lineId,
        stationIds: [span.from, span.to],
        meters: span.meters,
      });
    }
  }

  const origin = network.stations.get(originId);
  const destination = network.stations.get(destinationId);
  const rideMeters = legs.reduce((sum, leg) => sum + leg.meters, 0);
  const averageWaitSeconds = OPERATIONS.peakHeadwaySeconds / 2;
  const skylinkSeconds =
    arrival.seconds + 2 * OPERATIONS.stationAccessSeconds + averageWaitSeconds;

  const walkMeters =
    haversineMeters(origin.coordinates, destination.coordinates) *
    OPERATIONS.walkDetourFactor;
  const walkSeconds = walkMeters / OPERATIONS.walkSpeedMps;

  return {
    origin,
    destination,
    legs,
    transfers: legs.length - 1,
    rideMeters,
    inCabinSeconds: arrival.seconds,
    skylinkSeconds,
    walkMeters,
    walkSeconds,
    savedSeconds: walkSeconds - skylinkSeconds,
    coordinates: [
      origin.coordinates,
      ...spans.map((span) => network.stations.get(span.to).coordinates),
    ],
  };
}

/** Theoretical one-direction throughput of a line at peak headway. */
export function peakCapacityPerHour() {
  return (3600 / OPERATIONS.peakHeadwaySeconds) * OPERATIONS.cabinCapacity;
}
