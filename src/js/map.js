/**
 * MapLibre transit map: tilted 3D basemap, line alignments, station markers
 * with popups, the highlighted trip overlay and the cabin simulation.
 *
 * MapLibre GL JS is loaded from the CDN as a classic script and read off
 * `window.maplibregl`.
 */
import { BUILDING_LAYER_ID, basemapStyle } from './basemap.js';
import { corridorAround, pathLengthMeters, positionAlong } from './geo.js';
import { OPERATIONS, platformElevation } from './network.js';

const CAMPUS_CENTER = [-86.5175, 39.1712];
const TILTED_VIEW = { pitch: 55, bearing: -18 };
const FLAT_VIEW = { pitch: 0, bearing: 0 };

/** Simulated cabins move faster than real time so motion reads at campus zoom. */
const SIMULATION_SPEEDUP = 8;
const SIMULATION_FRAME_MS = 1000 / 30;

/** Stations whose label would collide with a neighbour's on the default side. */
const LABEL_SIDE = { gisb: 'below', imu: 'left' };

const CABIN_COLOR = { crimson: '#ff8a8a' };
const HOST_BUILDING_COLOR = '#cfc8b8';
const DEFAULT_HOST_HEIGHT_M = 20;

/** Half-width of the clearance corridor drawn either side of each cable. */
const CORRIDOR_HALF_WIDTH_M = 15;
const CORRIDOR_COLOR = '#990000';

const emptyCollection = () => ({ type: 'FeatureCollection', features: [] });
const lineFeature = (line) => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: line.coordinates },
});

/**
 * @param {HTMLElement} container
 * @param {{stations: Map, lines: Array}} network
 * @param {object} [options]
 * @param {(action: 'origin'|'destination'|'survey', stationId: string) => void} [options.onStationAction]
 * @param {(stationId: string, coordinates: [number, number]) => void} [options.onStationMove]
 *   Called continuously while a station is dragged in edit mode.
 * @param {() => number} [options.getLeftInset] Width in px of any panel
 *   overlapping the map's left edge, so fitted views stay clear of it.
 */
export function createTransitMap(
  container,
  network,
  { onStationAction, onStationMove, getLeftInset = () => 0 } = {},
) {
  const { maplibregl } = window;
  if (!maplibregl) throw new Error('MapLibre GL JS failed to load');

  const map = new maplibregl.Map({
    container,
    style: basemapStyle(),
    center: CAMPUS_CENTER,
    zoom: 14.5,
    minZoom: 12,
    maxZoom: 19,
    maxPitch: 70,
    ...TILTED_VIEW,
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

  // Sources and layers can only be added once the style has been parsed, but
  // callers may ask for a trip or footprints before then. Everything that
  // touches the style waits on this.
  const styleReady = new Promise((resolve) => {
    if (map.isStyleLoaded()) resolve();
    else map.once('load', resolve);
  });

  let fleets = network.lines.map((line) => createCabinFleet(line));
  const simulation = createSimulation(map, () => fleets);
  const hiddenLines = new Set();
  let isCorridorVisible = false;

  const setLayerVisible = (layerId, isVisible) => {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', isVisible ? 'visible' : 'none');
    }
  };
  const applyLineVisibility = (lineId) => {
    const isVisible = !hiddenLines.has(lineId);
    for (const suffix of ['halo', 'line', 'cabins']) {
      setLayerVisible(`${lineId}-${suffix}`, isVisible);
    }
    setLayerVisible(`${lineId}-corridor`, isVisible && isCorridorVisible);
  };

  styleReady.then(() => {
    map.addSource('host-buildings', { type: 'geojson', data: emptyCollection() });
    map.addLayer({
      id: 'host-buildings',
      type: 'fill-extrusion',
      source: 'host-buildings',
      paint: {
        'fill-extrusion-color': HOST_BUILDING_COLOR,
        'fill-extrusion-height': ['get', 'height_m'],
        'fill-extrusion-opacity': 0.85,
      },
    });

    for (const line of network.lines) {
      map.addSource(`${line.id}-corridor`, {
        type: 'geojson',
        data: corridorAround(line.coordinates, CORRIDOR_HALF_WIDTH_M),
      });
      map.addLayer({
        id: `${line.id}-corridor`,
        type: 'fill',
        source: `${line.id}-corridor`,
        layout: { visibility: 'none' },
        paint: {
          'fill-color': CORRIDOR_COLOR,
          'fill-opacity': 0.22,
          'fill-outline-color': '#ff8a8a',
        },
      });
    }

    for (const line of network.lines) {
      map.addSource(line.id, { type: 'geojson', data: lineFeature(line) });
      // A translucent halo lifts the brand crimson off the dark basemap.
      map.addLayer({
        id: `${line.id}-halo`,
        type: 'line',
        source: line.id,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': line.color, 'line-width': 14, 'line-opacity': 0.18 },
      });
      map.addLayer({
        id: `${line.id}-line`,
        type: 'line',
        source: line.id,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': line.color,
          'line-width': line.service === 'spur' ? 4 : 5,
          ...(line.service === 'spur' ? { 'line-dasharray': [0.4, 2.2] } : {}),
        },
      });
    }

    map.addSource('trip', { type: 'geojson', data: emptyCollection() });
    map.addLayer({
      id: 'trip',
      type: 'line',
      source: 'trip',
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 3, 'line-dasharray': [3, 2.5] },
    });

    for (const fleet of fleets) {
      map.addSource(`${fleet.lineId}-cabins`, { type: 'geojson', data: fleet.positions(0) });
      map.addLayer({
        id: `${fleet.lineId}-cabins`,
        type: 'circle',
        source: `${fleet.lineId}-cabins`,
        paint: {
          'circle-radius': 3.2,
          'circle-color': CABIN_COLOR[fleet.lineId] ?? '#ffffff',
          'circle-stroke-color': '#0f1419',
          'circle-stroke-width': 1,
          'circle-pitch-alignment': 'map',
        },
      });
    }

    for (const line of network.lines) applyLineVisibility(line.id);
    simulation.start();
  });

  const stationMarkers = new Map();
  for (const station of network.stations.values()) {
    const popup = new maplibregl.Popup({
      className: 'station-popup',
      offset: 16,
      maxWidth: '300px',
    }).setDOMContent(stationPopup(station, network, onStationAction));

    const marker = new maplibregl.Marker({ element: stationPin(station) })
      .setLngLat(station.coordinates)
      .setPopup(popup)
      .addTo(map);
    marker.getElement().setAttribute('aria-label', `${station.name} station`);
    marker.on('drag', () => onStationMove?.(station.id, marker.getLngLat().toArray()));
    stationMarkers.set(station.id, marker);
  }

  const closePopups = () => {
    for (const marker of stationMarkers.values()) {
      if (marker.getPopup().isOpen()) marker.togglePopup();
    }
  };

  let isTilted = true;
  const currentView = () => (isTilted ? TILTED_VIEW : FLAT_VIEW);

  const fitTo = (coordinates, margin, extra = {}) => {
    const bounds = coordinates.reduce(
      (box, coordinate) => box.extend(coordinate),
      new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
    );
    map.fitBounds(bounds, {
      padding: { top: margin, bottom: margin, right: margin, left: getLeftInset() + margin },
      ...currentView(),
      ...extra,
    });
  };
  const stationCoordinates = [...network.stations.values()].map((station) => station.coordinates);
  const fitNetwork = () => fitTo(stationCoordinates, 56);
  fitNetwork();

  return {
    setLineVisible(lineId, isVisible) {
      if (isVisible) hiddenLines.delete(lineId);
      else hiddenLines.add(lineId);
      styleReady.then(() => applyLineVisibility(lineId));
    },

    /** Shows the clearance band either side of every visible cable. */
    setCorridorVisible(isVisible) {
      isCorridorVisible = isVisible;
      styleReady.then(() => {
        for (const line of network.lines) applyLineVisibility(line.id);
      });
    },

    /**
     * Highlights a planned trip. Pass `fit: false` to leave the camera where
     * it is, as when the trip is redrawn under a station being dragged.
     */
    showTrip(trip, { fit = true } = {}) {
      styleReady.then(() => {
        map.getSource('trip').setData(
          trip
            ? { type: 'Feature', geometry: { type: 'LineString', coordinates: trip.coordinates } }
            : emptyCollection(),
        );
      });
      if (!fit) return;
      closePopups();
      if (trip) fitTo(trip.coordinates, 72, { maxZoom: 16 });
    },

    /** Lets stations be dragged to try alternative layouts. */
    setEditable(isEditable) {
      container.classList.toggle('map--editing', isEditable);
      if (isEditable) closePopups();
      for (const marker of stationMarkers.values()) marker.setDraggable(isEditable);
    },

    /**
     * Redraws everything that follows station positions: markers, cables,
     * corridors and the cabin fleets. Call after the network model changes.
     */
    syncNetwork() {
      for (const [stationId, marker] of stationMarkers) {
        const [lng, lat] = network.stations.get(stationId).coordinates;
        const current = marker.getLngLat();
        if (current.lng !== lng || current.lat !== lat) marker.setLngLat([lng, lat]);
      }
      fleets = network.lines.map((line) => createCabinFleet(line));
      styleReady.then(() => {
        for (const line of network.lines) {
          map.getSource(line.id)?.setData(lineFeature(line));
          map
            .getSource(`${line.id}-corridor`)
            ?.setData(corridorAround(line.coordinates, CORRIDOR_HALF_WIDTH_M));
        }
        // Put the cabins on the new cables now instead of waiting for the next
        // frame, which never comes when motion is reduced or the tab is hidden.
        simulation.redraw();
      });
    },

    /** Restarts the cabin animation loop, for use after a layout reset. */
    restartSimulation() {
      styleReady.then(() => simulation.start());
    },

    fitNetwork,

    /** Switches between the tilted 3D view and a flat plan view. */
    setTilted(shouldTilt) {
      isTilted = shouldTilt;
      map.easeTo({ ...currentView(), duration: 800 });
    },

    /**
     * Extrudes the footprints of the buildings that carry stations, each to
     * its station's platform height.
     */
    showHostBuildings(featureCollection) {
      const features = featureCollection.features.map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          height_m:
            network.stations.get(feature.properties.station)?.platform_height_m ??
            DEFAULT_HOST_HEIGHT_M,
        },
      }));
      styleReady.then(() => {
        map.getSource('host-buildings').setData({ type: 'FeatureCollection', features });
        // The generic building under each station would poke through otherwise.
        if (map.getLayer(BUILDING_LAYER_ID)) map.moveLayer('host-buildings');
        for (const line of network.lines) map.moveLayer(`${line.id}-corridor`);
        for (const line of network.lines) {
          map.moveLayer(`${line.id}-halo`);
          map.moveLayer(`${line.id}-line`);
        }
        map.moveLayer('trip');
        for (const fleet of fleets) map.moveLayer(`${fleet.lineId}-cabins`);
      });
    },

    focusStation(stationId) {
      const marker = stationMarkers.get(stationId);
      if (!marker) return;
      map.easeTo({ center: marker.getLngLat(), zoom: Math.max(map.getZoom(), 16) });
      if (!marker.getPopup().isOpen()) marker.togglePopup();
    },

    /** MapLibre caches its container size; call after layout changes. */
    refreshSize: () => map.resize(),
  };
}

function stationPin(station) {
  const pin = document.createElement('div');
  pin.className = 'station-pin';

  const dot = document.createElement('span');
  dot.className = station.is_transfer
    ? 'station-marker station-marker--transfer'
    : 'station-marker';

  const label = document.createElement('span');
  label.className = `station-label station-label--${LABEL_SIDE[station.id] ?? 'right'}`;
  label.textContent = station.short_name;

  pin.append(dot, label);
  return pin;
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
  addFact('Access', accessSummary(station));
  addFact('Fare', station.fare_media.join(' · '));
  addFact('Peak headway', `${OPERATIONS.peakHeadwaySeconds} s`);
  const elevation = platformElevation(station);
  if (elevation !== null) {
    addFact(
      'Platform',
      `${Math.round(elevation)} m above sea level, ` +
        `${Math.round(station.platform_height_m)} m above the ground`,
    );
  }

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

  const surveyButton = document.createElement('button');
  surveyButton.type = 'button';
  surveyButton.className = 'button button--small station-card__survey';
  surveyButton.textContent = 'View station survey & concepts';
  surveyButton.addEventListener('click', () => onStationAction?.('survey', station.id));

  root.append(heading, role, lineList, facts, actions, surveyButton);
  return root;
}

function accessSummary(station) {
  const elevators =
    station.elevators === 2
      ? 'Dual redundant elevators'
      : `${station.elevators} elevators`;
  return station.level_boarding ? `${elevators} · level boarding` : elevators;
}

/**
 * Cabins for one line, spaced by the peak headway and shuttling end to end.
 * Positions are a pure function of elapsed time, so hiding a line and
 * showing it again never leaves the fleet out of step.
 */
function createCabinFleet(line) {
  const path = line.coordinates;
  const length = pathLengthMeters(path);
  const loopLength = 2 * length;
  const spacing = OPERATIONS.lineSpeedMps * OPERATIONS.peakHeadwaySeconds;
  // A line squashed to nothing mid-drag carries no cabins until it has length again.
  const isRunnable = Number.isFinite(length) && length > 0;
  const cabinCount = isRunnable ? Math.max(2, Math.floor(loopLength / spacing)) : 0;

  // Out along the path, then back the same way.
  const positionAt = (loopMeters) =>
    positionAlong(path, loopMeters <= length ? loopMeters : loopLength - loopMeters);

  return {
    lineId: line.id,
    /** GeoJSON MultiPoint of every cabin after `elapsedSeconds` of service. */
    positions(elapsedSeconds) {
      const travelled = elapsedSeconds * OPERATIONS.lineSpeedMps * SIMULATION_SPEEDUP;
      const coordinates = Array.from({ length: cabinCount }, (_, index) =>
        positionAt(((index * loopLength) / cabinCount + travelled) % loopLength),
      ).filter(Boolean);
      return { type: 'Feature', geometry: { type: 'MultiPoint', coordinates } };
    },
  };
}

/**
 * Cabin animation loop. A frame that fails (a line with no usable geometry
 * in the middle of a drag, say) is skipped rather than allowed to stop the
 * loop: the next frame is always scheduled before any drawing happens.
 *
 * @param {() => Array} getFleets Read each frame, since a layout edit replaces them.
 */
function createSimulation(map, getFleets) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const startedAt = performance.now();
  let lastFrame = 0;
  let frameRequest = null;

  const draw = (now) => {
    const elapsedSeconds = (now - startedAt) / 1000;
    for (const fleet of getFleets()) {
      try {
        map.getSource(`${fleet.lineId}-cabins`)?.setData(fleet.positions(elapsedSeconds));
      } catch (error) {
        console.warn(`Skipped a cabin frame for "${fleet.lineId}"`, error);
      }
    }
  };

  const tick = (now) => {
    frameRequest = requestAnimationFrame(tick);
    const due = now - lastFrame >= SIMULATION_FRAME_MS;
    if (due && !reducedMotion.matches && !document.hidden) {
      lastFrame = now;
      draw(now);
    }
  };

  return {
    /** Starts the loop, or restarts it if it is already running. */
    start() {
      if (frameRequest !== null) cancelAnimationFrame(frameRequest);
      frameRequest = requestAnimationFrame(tick);
    },
    /** Draws the cabins once, right now, whatever the motion settings. */
    redraw: () => draw(performance.now()),
  };
}
