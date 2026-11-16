/**
 * Application entry point: loads the data and wires the map, the trip
 * planner, the layout sandbox and the dialogs together. The modules never import each
 * other; all cross-talk goes through the callbacks set up here.
 */
import { loadHostBuildings } from './buildings.js';
import { createTransitMap } from './map.js';
import {
  attachTransitMatrix,
  isLayoutModified,
  loadNetwork,
  moveStation,
  peakCapacityPerHour,
  resetLayout,
} from './network.js';
import { createTripPlanner } from './planner.js';
import { createStationSurvey } from './survey.js';
import { createCabinViewer } from './viewer.js';
import { startWindStatus } from './weather.js';

const NETWORK_DATA_URL = 'public/data/skylink-data.geojson';
const TRANSIT_MATRIX_URL = 'public/data/transit-matrix.json';
const STATION_SURVEYS_URL = 'public/data/stations.json';

/** Supporting data: the page still works if one of these fails to load. */
async function loadOptionalJson(url) {
  try {
    const response = await fetch(url);
    return response.ok ? await response.json() : null;
  } catch (error) {
    console.warn(`Optional data unavailable: ${url}`, error);
    return null;
  }
}

/** Opening scenario: the commuter lot to the south end of campus. */
const DEFAULT_TRIP = { origin: 'stadium', destination: 'ballantine' };

async function start() {
  const status = document.querySelector('[data-app-status]');

  startWindStatus(document.querySelector('[data-wind-status]'));

  const transitMatrixRequest = loadOptionalJson(TRANSIT_MATRIX_URL);
  const surveysRequest = loadOptionalJson(STATION_SURVEYS_URL);

  let network;
  try {
    network = await loadNetwork(NETWORK_DATA_URL);
  } catch (error) {
    console.error(error);
    status.textContent = 'The network could not be loaded. Refresh the page to try again.';
    return;
  }

  const transitMatrix = await transitMatrixRequest;
  if (transitMatrix) attachTransitMatrix(network, transitMatrix);

  const stationSurvey = createStationSurvey(
    document.getElementById('station-survey'),
    network,
    (await surveysRequest) ?? {},
  );

  document.querySelector('[data-stat="capacity"]').textContent =
    peakCapacityPerHour().toLocaleString('en-US');

  // On wide screens the panel column floats over the map's left edge.
  const panels = document.querySelector('.hud__panels');
  const getLeftInset = () =>
    getComputedStyle(panels).position === 'absolute'
      ? panels.offsetLeft + panels.offsetWidth
      : 0;

  let planner;
  let transitMap;
  try {
    transitMap = createTransitMap(document.getElementById('map'), network, {
      getLeftInset,
      onStationAction(action, stationId) {
        if (action === 'origin') planner.setOrigin(stationId);
        else if (action === 'destination') planner.setDestination(stationId);
        else stationSurvey.open(stationId);
      },
      onStationMove(stationId, coordinates) {
        moveStation(network, stationId, coordinates);
        syncLayout();
      },
    });
  } catch (error) {
    console.error(error);
    status.textContent = 'The map library could not be loaded. Check your connection and refresh.';
    return;
  }

  // Footprints are context, not core data, so they load without blocking.
  loadHostBuildings(network.stations.values()).then((footprints) => {
    if (footprints) transitMap.showHostBuildings(footprints);
  });

  planner = createTripPlanner(document.getElementById('trip-planner'), network, {
    // Keep the camera still while a station is being dragged.
    onTripChange: (trip, { layoutChanged }) => transitMap.showTrip(trip, { fit: !layoutChanged }),
  });
  planner.setTrip(DEFAULT_TRIP.origin, DEFAULT_TRIP.destination);

  for (const toggle of document.querySelectorAll('input[data-line]')) {
    toggle.addEventListener('change', () => {
      transitMap.setLineVisible(toggle.dataset.line, toggle.checked);
    });
  }

  document
    .querySelector('[data-action="reset-view"]')
    .addEventListener('click', () => transitMap.fitNetwork());

  document.querySelector('[data-action="toggle-corridor"]').addEventListener('change', (event) => {
    transitMap.setCorridorVisible(event.target.checked);
  });

  // Sandbox: drag stations to try other layouts; nothing is saved.
  const editToggle = document.querySelector('[data-action="toggle-edit"]');
  const resetLayoutButton = document.querySelector('[data-action="reset-layout"]');
  const sandboxNote = document.querySelector('[data-sandbox-note]');

  /** Redraws the map and re-plans the trip after the network model changes. */
  function syncLayout() {
    transitMap.syncNetwork();
    planner.refresh();
    const isModified = isLayoutModified(network);
    resetLayoutButton.hidden = !isModified;
    sandboxNote.hidden = !isModified;
  }

  editToggle.addEventListener('click', () => {
    const isEditing = editToggle.getAttribute('aria-pressed') !== 'true';
    editToggle.setAttribute('aria-pressed', String(isEditing));
    editToggle.textContent = isEditing ? 'Lock network' : 'Edit network layout';
    transitMap.setEditable(isEditing);
  });

  resetLayoutButton.addEventListener('click', () => {
    resetLayout(network);
    syncLayout();
    transitMap.restartSimulation();
  });

  const tiltToggle = document.querySelector('[data-action="toggle-tilt"]');
  tiltToggle.addEventListener('click', () => {
    const shouldTilt = tiltToggle.getAttribute('aria-pressed') !== 'true';
    tiltToggle.setAttribute('aria-pressed', String(shouldTilt));
    transitMap.setTilted(shouldTilt);
  });

  const cabinViewer = createCabinViewer(document.getElementById('cabin-viewer'));
  document
    .querySelector('[data-action="open-viewer"]')
    .addEventListener('click', () => cabinViewer.open());
}

start();
