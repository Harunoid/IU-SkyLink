/**
 * Trip planner panel: origin/destination pickers and the Walking vs. SkyLink
 * comparison. Emits the planned trip so the map can draw it.
 */
import { OPERATIONS, planTrip } from './network.js';
import { renderElevationProfile } from './profile.js';

const formatMinutes = (seconds) => {
  const minutes = seconds / 60;
  return minutes < 10 ? minutes.toFixed(1) : String(Math.round(minutes));
};

const formatDistance = (meters) =>
  meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters / 10) * 10} m`;

/**
 * @param {HTMLFormElement} form
 * @param {{stations: Map, lines: Array}} network
 * @param {{onTripChange?: (trip: object|null) => void}} [options]
 */
export function createTripPlanner(form, network, { onTripChange } = {}) {
  const originSelect = form.elements.origin;
  const destinationSelect = form.elements.destination;
  const swapButton = form.querySelector('[data-action="swap"]');
  const results = document.getElementById(form.dataset.results);
  const lineById = new Map(network.lines.map((line) => [line.id, line]));

  for (const select of [originSelect, destinationSelect]) {
    for (const station of network.stations.values()) {
      select.add(new Option(station.name, station.id));
    }
  }

  function update() {
    const trip = planTrip(network, originSelect.value, destinationSelect.value);
    renderResults(results, trip, lineById, network);
    onTripChange?.(trip);
  }

  form.addEventListener('change', update);
  form.addEventListener('submit', (event) => event.preventDefault());
  swapButton.addEventListener('click', () => {
    [originSelect.value, destinationSelect.value] = [
      destinationSelect.value,
      originSelect.value,
    ];
    update();
  });

  return {
    setTrip(originId, destinationId) {
      originSelect.value = originId;
      destinationSelect.value = destinationId;
      update();
    },
    setOrigin(stationId) {
      originSelect.value = stationId;
      update();
    },
    setDestination(stationId) {
      destinationSelect.value = stationId;
      update();
    },
  };
}

function renderResults(container, trip, lineById, network) {
  container.replaceChildren();

  if (!trip) {
    const hint = document.createElement('p');
    hint.className = 'planner__hint';
    hint.textContent = 'Choose two different stations to compare the trip.';
    container.append(hint);
    return;
  }

  const slowest = Math.max(trip.walkSeconds, trip.skylinkSeconds);
  container.append(
    comparisonRow({
      label: 'SkyLink',
      seconds: trip.skylinkSeconds,
      share: trip.skylinkSeconds / slowest,
      modifier: 'skylink',
      detail: `${formatDistance(trip.rideMeters)} by cable`,
    }),
    comparisonRow({
      label: 'Walking',
      seconds: trip.walkSeconds,
      share: trip.walkSeconds / slowest,
      modifier: 'walk',
      detail: `about ${formatDistance(trip.walkMeters)} on foot`,
    }),
    verdict(trip),
    itinerary(trip, lineById, network),
  );

  const profile = renderElevationProfile(trip);
  if (profile) container.append(profile);
}

function comparisonRow({ label, seconds, share, modifier, detail }) {
  const row = document.createElement('div');
  row.className = `comparison comparison--${modifier}`;

  const name = document.createElement('span');
  name.className = 'comparison__label';
  name.textContent = label;

  const time = document.createElement('span');
  time.className = 'comparison__time';
  time.textContent = `${formatMinutes(seconds)} min`;

  const track = document.createElement('div');
  track.className = 'comparison__track';
  const bar = document.createElement('div');
  bar.className = 'comparison__bar';
  bar.style.inlineSize = `${Math.max(4, share * 100).toFixed(1)}%`;
  track.append(bar);

  const note = document.createElement('span');
  note.className = 'comparison__detail';
  const fitsPassingPeriod = seconds <= OPERATIONS.passingPeriodSeconds;
  note.textContent = `${detail} · ${
    fitsPassingPeriod ? 'fits a 15-min passing period' : 'misses a 15-min passing period'
  }`;
  note.dataset.fits = String(fitsPassingPeriod);

  row.append(name, time, track, note);
  return row;
}

function verdict(trip) {
  const paragraph = document.createElement('p');
  paragraph.className = 'planner__verdict';
  const saved = trip.savedSeconds;
  if (saved >= 30) {
    const strong = document.createElement('strong');
    strong.textContent = `${formatMinutes(saved)} min faster`;
    paragraph.append('SkyLink is ', strong, ' door to door.');
  } else if (saved > -30) {
    paragraph.textContent = 'About the same either way; SkyLink keeps you out of the weather.';
  } else {
    paragraph.textContent = 'Walking is quicker for this short hop.';
  }
  return paragraph;
}

function itinerary(trip, lineById, network) {
  const list = document.createElement('ol');
  list.className = 'itinerary';

  const addStep = (text, modifier) => {
    const item = document.createElement('li');
    item.className = `itinerary__step itinerary__step--${modifier}`;
    item.textContent = text;
    list.append(item);
  };

  const stationName = (id) => network.stations.get(id).short_name;

  addStep(`Elevator to the ${trip.origin.short_name} rooftop platform, tap to board`, 'access');
  trip.legs.forEach((leg, index) => {
    const line = lineById.get(leg.lineId);
    const stops = leg.stationIds.length - 1;
    const destination = stationName(leg.stationIds[leg.stationIds.length - 1]);
    const rideSeconds = leg.meters / OPERATIONS.lineSpeedMps;
    addStep(
      `${line.name} to ${destination} · ${stops} ${stops === 1 ? 'stop' : 'stops'}, ` +
        `${formatMinutes(rideSeconds)} min in the air`,
      leg.lineId,
    );
    if (index < trip.legs.length - 1) {
      addStep(`Change lines at ${destination}`, 'transfer');
    }
  });
  addStep(`Elevator down at ${trip.destination.short_name}`, 'access');

  return list;
}
