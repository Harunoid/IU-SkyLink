/**
 * Elevation profile for a planned trip: ground level and rooftop platform at
 * each station, the cable between platforms, and what the height difference
 * means for regenerative braking.
 */
import { OPERATIONS, peakCapacityPerHour, platformElevation } from './network.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW = { width: 320, height: 132, left: 40, right: 12, top: 14, bottom: 26 };
const GRAVITY = 9.81;
const JOULES_PER_KWH = 3.6e6;

const svgElement = (name, attributes = {}) => {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
};

/**
 * Energy exchanged with the station battery banks over one peak hour if every
 * cabin on this trip's direction runs full. Positive when the trip descends.
 */
export function peakHourEnergyKwh(netDescentMeters) {
  const potentialJoules =
    peakCapacityPerHour() * OPERATIONS.riderMassKg * GRAVITY * Math.abs(netDescentMeters);
  const efficiency =
    netDescentMeters > 0 ? OPERATIONS.regenEfficiency : 1 / OPERATIONS.driveEfficiency;
  return (potentialJoules * efficiency) / JOULES_PER_KWH;
}

/** @returns {HTMLElement|null} null when the stations have no elevation data. */
export function renderElevationProfile(trip) {
  const points = trip.profile;
  if (points.some((point) => platformElevation(point.station) === null)) return null;

  const figure = document.createElement('figure');
  figure.className = 'profile';

  const totalMeters = points[points.length - 1].meters;
  const platforms = points.map((point) => platformElevation(point.station));
  const grounds = points.map((point) => point.station.ground_elevation_m);
  const low = Math.floor((Math.min(...grounds) - 4) / 5) * 5;
  const high = Math.ceil((Math.max(...platforms) + 4) / 5) * 5;

  const plotWidth = VIEW.width - VIEW.left - VIEW.right;
  const plotHeight = VIEW.height - VIEW.top - VIEW.bottom;
  const x = (meters) => VIEW.left + (meters / totalMeters) * plotWidth;
  const y = (elevation) => VIEW.top + (1 - (elevation - low) / (high - low)) * plotHeight;
  const baseline = VIEW.top + plotHeight;

  const svg = svgElement('svg', {
    viewBox: `0 0 ${VIEW.width} ${VIEW.height}`,
    role: 'img',
    'aria-label':
      `Elevation profile from ${trip.origin.short_name} to ${trip.destination.short_name}: ` +
      `platforms at ${platforms.map((value) => `${Math.round(value)} m`).join(', ')}`,
  });

  for (const elevation of [low, high]) {
    const label = svgElement('text', { x: VIEW.left - 5, y: y(elevation) + 3, class: 'profile__axis' });
    label.setAttribute('text-anchor', 'end');
    label.textContent = `${elevation} m`;
    svg.append(label);
  }

  const groundPath =
    `M${x(0)},${baseline} ` +
    points.map((point, i) => `L${x(point.meters).toFixed(1)},${y(grounds[i]).toFixed(1)}`).join(' ') +
    ` L${x(totalMeters)},${baseline} Z`;
  svg.append(svgElement('path', { d: groundPath, class: 'profile__ground' }));

  points.forEach((point, i) => {
    const px = x(point.meters).toFixed(1);
    svg.append(
      svgElement('line', {
        x1: px, x2: px, y1: y(grounds[i]).toFixed(1), y2: y(platforms[i]).toFixed(1),
        class: 'profile__building',
      }),
    );
  });

  svg.append(
    svgElement('polyline', {
      points: points
        .map((point, i) => `${x(point.meters).toFixed(1)},${y(platforms[i]).toFixed(1)}`)
        .join(' '),
      class: 'profile__cable',
    }),
  );

  points.forEach((point, i) => {
    const px = x(point.meters);
    svg.append(svgElement('circle', { cx: px.toFixed(1), cy: y(platforms[i]).toFixed(1), r: 3, class: 'profile__platform' }));
    // Intermediate stops can sit close together, so only the ends are named.
    const isFirst = i === 0;
    if (!isFirst && i !== points.length - 1) return;
    const label = svgElement('text', { x: px.toFixed(1), y: VIEW.height - 8, class: 'profile__label' });
    label.setAttribute('text-anchor', isFirst ? 'start' : 'end');
    label.textContent = point.station.short_name;
    svg.append(label);
  });

  const caption = document.createElement('figcaption');
  caption.className = 'profile__caption';
  caption.textContent = energySummary(platforms[0] - platforms[platforms.length - 1]);

  figure.append(svg, caption);
  return figure;
}

function energySummary(netDescentMeters) {
  const meters = Math.abs(netDescentMeters);
  if (meters < 1) return 'Platforms are level end to end, so this run is energy-neutral.';
  const kwh = peakHourEnergyKwh(netDescentMeters).toFixed(1);
  const riders = peakCapacityPerHour().toLocaleString('en-US');
  return netDescentMeters > 0
    ? `Platform to platform this run drops ${meters.toFixed(0)} m. With ${riders} riders an hour, ` +
        `regenerative braking returns about ${kwh} kWh per hour to the station batteries.`
    : `Platform to platform this run climbs ${meters.toFixed(0)} m. Lifting ${riders} riders an hour ` +
        `takes about ${kwh} kWh per hour, offset by cabins descending the other way.`;
}
