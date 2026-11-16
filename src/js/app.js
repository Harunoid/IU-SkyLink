/**
 * Application entry point: loads the network data and wires the map, the
 * trip planner and the cabin viewer together. The modules never import each
 * other; all cross-talk goes through the callbacks set up here.
 */
import { loadHostBuildings } from './buildings.js';
import { createTransitMap } from './map.js';
import { loadNetwork, peakCapacityPerHour } from './network.js';
import { createTripPlanner } from './planner.js';
import { createCabinViewer } from './viewer.js';
import { startWindStatus } from './weather.js';

const NETWORK_DATA_URL = 'public/data/skylink-data.geojson';


/** Opening scenario: the commuter lot to the south end of campus. */
const DEFAULT_TRIP = { origin: 'stadium', destination: 'ballantine' };

async function start() {
  const status = document.querySelector('[data-app-status]');

  startWindStatus(document.querySelector('[data-wind-status]'));

  let network;
  try {
    network = await loadNetwork(NETWORK_DATA_URL);
  } catch (error) {
    console.error(error);
    status.textContent = 'The network data could not be loaded. Refresh the page to try again.';
    return;
  }

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
        else planner.setDestination(stationId);
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
    onTripChange: (trip) => transitMap.showTrip(trip),
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
