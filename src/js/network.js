/**
 * Network model: parses the SkyLink GeoJSON into stations and lines and
 * answers trip questions. No DOM or map-library code lives here so the timing
 * model can be reasoned about (and tested) on its own.
 *
 * Station positions are mutable: the sandbox moves them, and line geometry,
 * span lengths and trip times all follow from wherever the stations are.
 */
import { distanceMeters, pathLengthMeters } from './geo.js';

/** Operating assumptions behind every time estimate shown in the UI. */
export const OPERATIONS = Object.freeze({
  lineSpeedMps: 6.0,
  peakHeadwaySeconds: 30,
  cabinCapacity: 10,
  /** Fare tap, elevator call and doors at each end of the trip. */
  stationEntrySeconds: 45,
  /** Elevator travel between street and rooftop platform. */
  elevatorSpeedMps: 2.0,
  /** Used for the elevator ride where a platform height is not surveyed. */
  defaultPlatformHeightM: 25,
  /** Cabins detach and creep through intermediate stations. */
  throughStationSeconds: 40,
  /** Platform-to-platform walk and re-boarding when changing lines. */
  transferSeconds: 75,
  walkSpeedMps: 1.3,
  /** Campus paths are not straight lines; scales crow-fly distance. */
  walkDetourFactor: 1.3,
  /** Naismith-style penalty for each metre of ground climbed on foot. */
  walkAscentSecondsPerMeter: 6,
  passingPeriodSeconds: 15 * 60,
  /** Average rider with bag, for potential-energy estimates. */
  riderMassKg: 80,
  /** Share of a descending load's potential energy that reaches the batteries. */
  regenEfficiency: 0.6,
  /** Drive-train efficiency when lifting a load. */
  driveEfficiency: 0.85,
});

/**
 * Height of a station's rooftop platform above sea level in metres, or null
 * when the survey data for that station is incomplete.
 */
export function platformElevation(station) {
  const { ground_elevation_m: ground, platform_height_m: height } = station;
  return Number.isFinite(ground) && Number.isFinite(height) ? ground + height : null;
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
        coordinates: [...feature.geometry.coordinates],
        surveyedCoordinates: Object.freeze([...feature.geometry.coordinates]),
        ...properties,
      });
    } else if (featureType === 'alignment') {
      lines.push({ id: feature.id, ...properties });
    }
  }

  for (const line of lines) {
    for (const stationId of line.stations) {
      if (!stations.has(stationId)) {
        throw new Error(`Line "${line.id}" references unknown station "${stationId}"`);
      }
    }
  }

  const network = { stations, lines, edges: new Map(), transit: null };
  refreshGeometry(network);
  return network;
}

/**
 * Rebuilds everything derived from station positions: each line's path and
 * length, and the span graph the route search runs on. Lines run straight
 * from station to station, so their geometry is fully determined by them.
 */
function refreshGeometry(network) {
  const { stations, lines } = network;
  const edges = new Map([...stations.keys()].map((id) => [id, []]));

  for (const line of lines) {
    line.coordinates = line.stations.map((id) => stations.get(id).coordinates);
    line.lengthMeters = pathLengthMeters(line.coordinates);

    // One bidirectional edge per span between consecutive stations.
    for (let i = 1; i < line.stations.length; i += 1) {
      const from = line.stations[i - 1];
      const to = line.stations[i];
      const meters = distanceMeters(stations.get(from).coordinates, stations.get(to).coordinates);
      edges.get(from).push({ to, lineId: line.id, meters });
      edges.get(to).push({ to: from, lineId: line.id, meters });
    }
  }

  network.edges = edges;
}

/** Moves a station and updates every line and span that touches it. */
export function moveStation(network, stationId, coordinates) {
  const station = network.stations.get(stationId);
  if (!station) return;
  station.coordinates = [coordinates[0], coordinates[1]];
  refreshGeometry(network);
}

/** Puts every station back on its surveyed position. */
export function resetLayout(network) {
  for (const station of network.stations.values()) {
    station.coordinates = [...station.surveyedCoordinates];
  }
  refreshGeometry(network);
}

export function isLayoutModified(network) {
  return [...network.stations.values()].some(
    ({ coordinates, surveyedCoordinates }) =>
      coordinates[0] !== surveyedCoordinates[0] || coordinates[1] !== surveyedCoordinates[1],
  );
}

/**
 * Attaches the precalculated campus bus matrix (see
 * tools/build-transit-matrix.mjs) so trips can be compared against it.
 */
export function attachTransitMatrix(network, matrix) {
  network.transit = matrix;
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
  const skylink = skylinkBreakdown(origin, destination, rideMeters, arrival.seconds);
  const walk = walkBreakdown(origin, destination);
  const bus = network.transit?.pairs[`${originId}|${destinationId}`] ?? null;

  return {
    origin,
    destination,
    legs,
    transfers: legs.length - 1,
    rideMeters,
    skylink,
    walk,
    bus,
    coordinates: [
      origin.coordinates,
      ...spans.map((span) => network.stations.get(span.to).coordinates),
    ],
    profile: buildProfile(network, origin, spans),
  };
}

const elevatorSeconds = (station) =>
  (station.platform_height_m ?? OPERATIONS.defaultPlatformHeightM) / OPERATIONS.elevatorSpeedMps;

/** Door-to-door SkyLink time, split into the parts a rider experiences. */
function skylinkBreakdown(origin, destination, rideMeters, inSystemSeconds) {
  const cruiseSeconds = rideMeters / OPERATIONS.lineSpeedMps;
  const parts = {
    waitSeconds: OPERATIONS.peakHeadwaySeconds / 2,
    accessSeconds:
      2 * OPERATIONS.stationEntrySeconds + elevatorSeconds(origin) + elevatorSeconds(destination),
    cruiseSeconds,
    // Whatever the route search added beyond cruising: creeping through
    // intermediate stations and changing lines.
    dwellSeconds: inSystemSeconds - cruiseSeconds,
  };
  return {
    ...parts,
    meters: rideMeters,
    totalSeconds: Object.values(parts).reduce((sum, seconds) => sum + seconds, 0),
  };
}

function walkBreakdown(origin, destination) {
  const meters =
    distanceMeters(origin.coordinates, destination.coordinates) * OPERATIONS.walkDetourFactor;
  const ascentMeters = Math.max(
    0,
    (destination.ground_elevation_m ?? 0) - (origin.ground_elevation_m ?? 0),
  );
  const flatSeconds = meters / OPERATIONS.walkSpeedMps;
  const ascentSeconds = ascentMeters * OPERATIONS.walkAscentSecondsPerMeter;
  return { meters, ascentMeters, flatSeconds, ascentSeconds, totalSeconds: flatSeconds + ascentSeconds };
}

/** Stations along the trip with their distance from the origin. */
function buildProfile(network, origin, spans) {
  const profile = [{ station: origin, meters: 0 }];
  let meters = 0;
  for (const span of spans) {
    meters += span.meters;
    profile.push({ station: network.stations.get(span.to), meters });
  }
  return profile;
}

/** Theoretical one-direction throughput of a line at peak headway. */
export function peakCapacityPerHour() {
  return (3600 / OPERATIONS.peakHeadwaySeconds) * OPERATIONS.cabinCapacity;
}
