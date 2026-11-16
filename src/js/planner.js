/**
 * Trip planner panel: origin/destination pickers and the door-to-door
 * comparison of SkyLink, walking and the campus bus. Emits the planned trip
 * so the map can draw it.
 */
import { OPERATIONS, planTrip } from './network.js';
import { renderElevationProfile } from './profile.js';

const formatMinutes = (seconds) => {
  const minutes = seconds / 60;
  // One decimal below ten minutes; 9.96 rounds up to a plain "10".
  return minutes < 9.95 ? minutes.toFixed(1) : String(Math.round(minutes));
};

const formatDistance = (meters) =>
  meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters / 10) * 10} m`;

/**
 * @param {HTMLFormElement} form
 * @param {{stations: Map, lines: Array}} network
 * @param {{onTripChange?: (trip: object|null, context: {layoutChanged: boolean}) => void}} [options]
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

  /** @param {boolean} layoutChanged True when stations moved under an unchanged selection. */
  function update(layoutChanged = false) {
    const trip = planTrip(network, originSelect.value, destinationSelect.value);
    renderResults(results, trip, lineById, network);
    onTripChange?.(trip, { layoutChanged });
  }

  form.addEventListener('change', () => update());
  form.addEventListener('submit', (event) => event.preventDefault());
  swapButton.addEventListener('click', () => {
    [originSelect.value, destinationSelect.value] = [
      destinationSelect.value,
      originSelect.value,
    ];
    update();
  });

  return {
    /** Re-plans the current trip, for when station positions have changed. */
    refresh: () => update(true),
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

  const modes = tripModes(trip, network);
  container.append(modeCards(modes), verdict(modes), breakdownTable(modes));
  container.append(itinerary(trip, lineById, network));

  const profile = renderElevationProfile(trip);
  if (profile) container.append(profile);
}

/**
 * The same trip by each mode, as rows of [label, seconds] that add up to the
 * door-to-door total. The bus column is absent if its matrix did not load.
 */
function tripModes(trip, network) {
  const { skylink, walk, bus } = trip;
  const modes = [
    {
      id: 'skylink',
      label: 'SkyLink',
      meters: skylink.meters,
      totalSeconds: skylink.totalSeconds,
      parts: [
        ['Wait', skylink.waitSeconds],
        ['Elevators and fare tap', skylink.accessSeconds],
        ['Cruise at 6.0 m/s', skylink.cruiseSeconds],
        ['Station dwell', skylink.dwellSeconds],
      ],
    },
    {
      id: 'walk',
      label: 'Walking',
      meters: walk.meters,
      totalSeconds: walk.totalSeconds,
      parts: [
        ['On foot at 1.3 m/s', walk.flatSeconds],
        [`Climbing ${Math.round(walk.ascentMeters)} m`, walk.ascentSeconds],
      ],
    },
  ];
  if (bus) {
    modes.push({
      id: 'bus',
      label: network.transit.service.label,
      meters: bus.meters,
      totalSeconds: bus.totalSeconds,
      parts: [
        ['Wait', bus.waitSeconds],
        ['Walk to and from stops', bus.accessSeconds],
        ['Driving', bus.runSeconds],
        ['Stop dwell', bus.dwellSeconds],
        ['Traffic delay', bus.delaySeconds],
      ],
    });
  }
  return modes;
}

function modeCards(modes) {
  const list = document.createElement('ul');
  list.className = 'modes';
  const slowest = Math.max(...modes.map((mode) => mode.totalSeconds));
  const fastest = Math.min(...modes.map((mode) => mode.totalSeconds));

  for (const mode of modes) {
    const card = document.createElement('li');
    card.className = `mode mode--${mode.id}`;
    if (mode.totalSeconds === fastest) card.dataset.fastest = 'true';

    const name = document.createElement('span');
    name.className = 'mode__label';
    name.textContent = mode.label;

    const time = document.createElement('span');
    time.className = 'mode__time';
    const unit = document.createElement('small');
    unit.textContent = ' min';
    time.append(formatMinutes(mode.totalSeconds), unit);

    const track = document.createElement('span');
    track.className = 'mode__track';
    const bar = document.createElement('span');
    bar.className = 'mode__bar';
    bar.style.inlineSize = `${Math.max(6, (mode.totalSeconds / slowest) * 100).toFixed(1)}%`;
    track.append(bar);

    const distance = document.createElement('span');
    distance.className = 'mode__detail';
    distance.textContent = formatDistance(mode.meters);

    const fits = mode.totalSeconds <= OPERATIONS.passingPeriodSeconds;
    const period = document.createElement('span');
    period.className = 'mode__period';
    period.dataset.fits = String(fits);
    period.textContent = fits ? 'Makes 15 min' : 'Misses 15 min';

    card.append(name, time, track, distance, period);
    list.append(card);
  }
  return list;
}

/** "SkyLink saves X min vs. walking, Y min vs. campus bus." */
function verdict([skylink, ...others]) {
  const paragraph = document.createElement('p');
  paragraph.className = 'planner__verdict';

  const deltas = others.map((mode) => ({
    label: mode.label.toLowerCase(),
    saved: mode.totalSeconds - skylink.totalSeconds,
  }));
  const wins = deltas.filter(({ saved }) => saved >= 30);

  if (wins.length === 0) {
    const quickest = others.reduce((a, b) => (b.totalSeconds < a.totalSeconds ? b : a));
    paragraph.textContent = `${quickest.label} is quicker for this short hop.`;
    return paragraph;
  }

  paragraph.append('SkyLink saves ');
  wins.forEach(({ label, saved }, index) => {
    if (index > 0) paragraph.append(index === wins.length - 1 ? ' and ' : ', ');
    const strong = document.createElement('strong');
    strong.textContent = `${formatMinutes(saved)} min`;
    paragraph.append(strong, ` vs. ${label}`);
  });
  paragraph.append(' door to door.');

  const losses = deltas.filter(({ saved }) => saved < 30);
  if (losses.length > 0) {
    paragraph.append(` ${capitalize(losses[0].label)} is as quick or quicker.`);
  }
  return paragraph;
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

function breakdownTable(modes) {
  const details = document.createElement('details');
  details.className = 'breakdown';
  const summary = document.createElement('summary');
  summary.textContent = 'Where the time goes';
  details.append(summary);

  const grid = document.createElement('div');
  grid.className = 'breakdown__grid';
  for (const mode of modes) {
    const column = document.createElement('dl');
    column.className = `breakdown__mode breakdown__mode--${mode.id}`;
    for (const [label, seconds] of mode.parts) {
      if (seconds < 1) continue;
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = formatMinutes(seconds);
      column.append(dt, dd);
    }
    grid.append(column);
  }
  details.append(grid);
  return details;
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
