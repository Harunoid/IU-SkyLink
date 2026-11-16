/**
 * Application entry point: loads the network data and starts the map.
 */
import { createTransitMap } from './map.js';
import { loadNetwork, peakCapacityPerHour } from './network.js';

const NETWORK_DATA_URL = 'public/data/skylink-data.geojson';

async function start() {
  const status = document.querySelector('[data-app-status]');

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

  const transitMap = createTransitMap(document.getElementById('map'), network, {
    getLeftInset,
  });

  for (const toggle of document.querySelectorAll('input[data-line]')) {
    toggle.addEventListener('change', () => {
      transitMap.setLineVisible(toggle.dataset.line, toggle.checked);
    });
  }

  document
    .querySelector('[data-action="reset-view"]')
    .addEventListener('click', () => transitMap.fitNetwork());
}

start();
