/**
 * Leaflet transit map: basemap, line alignments, station markers with
 * popups, the highlighted trip overlay and the cabin position simulation.
 *
 * Leaflet is loaded from the CDN as a classic script and read off `window.L`.
 */
import { OPERATIONS } from './network.js';

const CAMPUS_CENTER = [39.1712, -86.5175];
const BASEMAP_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const BASEMAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors ' +
  '&copy; <a href="https://carto.com/attributions">CARTO</a>';

/** Simulated cabins move faster than real time so motion reads at campus zoom. */
const SIMULATION_SPEEDUP = 8;

// GeoJSON stores [lng, lat]; Leaflet wants [lat, lng].
const toLatLng = ([lng, lat]) => [lat, lng];

/** Stations whose label would collide with a neighbour's on the default side. */
const LABEL_SIDE = { gisb: 'below', imu: 'left' };

const LINE_STYLE = {
  main: { weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' },
  spur: { weight: 4, opacity: 0.9, dashArray: '2 10', lineCap: 'round' },
};

/**
 * @param {HTMLElement} container
 * @param {{stations: Map, lines: Array}} network
 * @param {object} [options]
 * @param {(action: 'origin'|'destination', stationId: string) => void} [options.onStationAction]
 * @param {() => number} [options.getLeftInset] Width in px of any panel
 *   overlapping the map's left edge, so fitted views stay clear of it.
 */
export function createTransitMap(
  container,
  network,
  { onStationAction, getLeftInset = () => 0 } = {},
) {
  const L = window.L;
  if (!L) throw new Error('Leaflet failed to load');

  const map = L.map(container, {
    center: CAMPUS_CENTER,
    zoom: 15,
    minZoom: 13,
    maxZoom: 18,
    zoomControl: false,
  });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ position: 'bottomright', imperial: true }).addTo(map);
  L.tileLayer(BASEMAP_URL, {
    attribution: BASEMAP_ATTRIBUTION,
    subdomains: 'abcd',
    maxZoom: 20,
  }).addTo(map);

  // Panes keep draw order stable regardless of when layers are toggled.
  map.createPane('alignments').style.zIndex = 410;
  map.createPane('trip').style.zIndex = 420;
  map.createPane('cabins').style.zIndex = 430;
  map.createPane('stations').style.zIndex = 440;

  const lineLayers = new Map();
  const cabinFleets = [];

  for (const line of network.lines) {
    const group = L.layerGroup().addTo(map);
    const latLngs = line.coordinates.map(toLatLng);

    // A translucent halo lifts the brand crimson off the dark basemap.
    L.polyline(latLngs, {
      pane: 'alignments',
      color: line.color,
      weight: 14,
      opacity: 0.18,
      interactive: false,
    }).addTo(group);
    L.polyline(latLngs, {
      pane: 'alignments',
      color: line.color,
      ...LINE_STYLE[line.service],
    })
      .bindTooltip(`${line.name} · ${formatDistance(line.lengthMeters)}`, { sticky: true })
      .addTo(group);

    cabinFleets.push(createCabinFleet(L, line, group));
    lineLayers.set(line.id, group);
  }

  const stationMarkers = new Map();
  for (const station of network.stations.values()) {
    const marker = L.marker(toLatLng(station.coordinates), {
      pane: 'stations',
      icon: stationIcon(L, station),
      title: station.name,
      alt: `${station.name} station`,
      keyboard: true,
    })
      .bindPopup(() => stationPopup(station, network, onStationAction), {
        className: 'station-popup',
        maxWidth: 280,
      })
      .addTo(map);
    stationMarkers.set(station.id, marker);
  }

  const networkBounds = L.latLngBounds(
    [...network.stations.values()].map((station) => toLatLng(station.coordinates)),
  );
  const fitTo = (bounds, margin, extra = {}) =>
    map.fitBounds(bounds, {
      paddingTopLeft: [getLeftInset() + margin, margin],
      paddingBottomRight: [margin, margin],
      ...extra,
    });
  const fitNetwork = () => fitTo(networkBounds, 56);
  fitNetwork();

  let tripLayer = null;
  const clearTrip = () => {
    if (tripLayer) {
      tripLayer.remove();
      tripLayer = null;
    }
  };

  startSimulation(cabinFleets);

  return {
    setLineVisible(lineId, isVisible) {
      const group = lineLayers.get(lineId);
      if (!group) return;
      if (isVisible) group.addTo(map);
      else group.remove();
    },

    showTrip(trip) {
      clearTrip();
      if (!trip) return;
      map.closePopup();
      const latLngs = trip.coordinates.map(toLatLng);
      tripLayer = L.polyline(latLngs, {
        pane: 'trip',
        className: 'trip-highlight',
        color: '#ffffff',
        weight: 3,
        opacity: 0.95,
        dashArray: '10 8',
        interactive: false,
      }).addTo(map);
      fitTo(L.latLngBounds(latLngs), 72, { maxZoom: 16 });
    },

    clearTrip,
    fitNetwork,

    focusStation(stationId) {
      const marker = stationMarkers.get(stationId);
      if (!marker) return;
      map.setView(marker.getLatLng(), Math.max(map.getZoom(), 16));
      marker.openPopup();
    },

    /** Leaflet caches its container size; call after layout changes. */
    refreshSize: () => map.invalidateSize(),
  };
}

function stationIcon(L, station) {
  const modifier = station.is_transfer ? ' station-marker--transfer' : '';
  const labelSide = LABEL_SIDE[station.id] ?? 'right';
  return L.divIcon({
    className: '',
    html: `<span class="station-marker${modifier}"></span>
           <span class="station-label station-label--${labelSide}">${escapeHtml(station.short_name)}</span>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -10],
  });
}

function stationPopup(station, network, onStationAction) {
  const root = document.createElement('article');
  root.className = 'station-card';

  const heading = document.createElement('h3');
  heading.textContent = station.name;
  const role = document.createElement('p');
  role.className = 'station-card__role';
  role.textContent = station.role;

  const lineList = document.createElement('ul');
  lineList.className = 'station-card__lines';
  for (const lineId of station.lines) {
    const line = network.lines.find((candidate) => candidate.id === lineId);
    const item = document.createElement('li');
    item.className = `line-chip line-chip--${line.id}`;
    item.textContent = line.name;
    lineList.append(item);
  }

  const facts = document.createElement('dl');
  facts.className = 'station-card__facts';
  const addFact = (term, detail) => {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = detail;
    facts.append(dt, dd);
  };
  addFact('Address', station.address);
  addFact('Access', `${station.elevators} redundant elevators · level boarding`);
  addFact('Peak headway', `${OPERATIONS.peakHeadwaySeconds} s`);

  const actions = document.createElement('div');
  actions.className = 'station-card__actions';
  for (const [action, label] of [
    ['origin', 'Start here'],
    ['destination', 'End here'],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button button--small';
    button.textContent = label;
    button.addEventListener('click', () => onStationAction?.(action, station.id));
    actions.append(button);
  }

  root.append(heading, role, lineList, facts, actions);
  return root;
}

/**
 * Cabins for one line, spaced by the peak headway and shuttling end to end.
 * Positions are a pure function of elapsed time, so toggling a line off and
 * on never leaves the fleet out of step.
 */
function createCabinFleet(L, line, group) {
  const path = line.coordinates;
  const cumulative = [0];
  for (let i = 1; i < path.length; i += 1) {
    cumulative.push(cumulative[i - 1] + distanceMeters(path[i - 1], path[i]));
  }
  const length = cumulative[cumulative.length - 1];
  const loopLength = 2 * length;
  const spacing = OPERATIONS.lineSpeedMps * OPERATIONS.peakHeadwaySeconds;
  const cabinCount = Math.max(2, Math.floor(loopLength / spacing));

  const positionAt = (loopMeters) => {
    const outbound = loopMeters <= length ? loopMeters : loopLength - loopMeters;
    let segment = 1;
    while (segment < cumulative.length - 1 && cumulative[segment] < outbound) segment += 1;
    const segmentStart = cumulative[segment - 1];
    const t = (outbound - segmentStart) / (cumulative[segment] - segmentStart);
    const [lngA, latA] = path[segment - 1];
    const [lngB, latB] = path[segment];
    return [latA + (latB - latA) * t, lngA + (lngB - lngA) * t];
  };

  const markers = Array.from({ length: cabinCount }, (_, index) =>
    L.circleMarker(positionAt((index * loopLength) / cabinCount), {
      pane: 'cabins',
      radius: 3,
      weight: 1,
      color: '#0f1419',
      fillColor: line.id === 'crimson' ? '#ff8a8a' : '#ffffff',
      fillOpacity: 1,
      interactive: false,
    }).addTo(group),
  );

  return {
    update(elapsedSeconds) {
      const travelled = elapsedSeconds * OPERATIONS.lineSpeedMps * SIMULATION_SPEEDUP;
      markers.forEach((marker, index) => {
        const offset = (index * loopLength) / cabinCount;
        marker.setLatLng(positionAt((offset + travelled) % loopLength));
      });
    },
  };
}

function startSimulation(fleets) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const start = performance.now();
  const tick = (now) => {
    if (!reducedMotion.matches && !document.hidden) {
      const elapsedSeconds = (now - start) / 1000;
      for (const fleet of fleets) fleet.update(elapsedSeconds);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Equirectangular approximation: plenty for interpolating along sub-2 km spans.
function distanceMeters([lngA, latA], [lngB, latB]) {
  const metersPerDegree = 111320;
  const x = (lngB - lngA) * metersPerDegree * Math.cos(((latA + latB) / 2) * (Math.PI / 180));
  const y = (latB - latA) * metersPerDegree;
  return Math.hypot(x, y);
}

function formatDistance(meters) {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

function escapeHtml(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span.innerHTML;
}
