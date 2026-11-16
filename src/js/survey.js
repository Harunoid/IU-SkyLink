/**
 * Station survey dialog: site photos and concept images for a station, with
 * its elevations and clearance notes. A station without photos gets a
 * schematic section drawn from its survey data instead.
 */
import { platformElevation } from './network.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Photo urls in stations.json are relative to this folder. */
const ASSET_ROOT = 'public/';

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const svgElement = (name, attributes = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
};

/**
 * @param {HTMLDialogElement} dialog
 * @param {{stations: Map}} network
 * @param {object} surveys Contents of stations.json, keyed by station id.
 */
export function createStationSurvey(dialog, network, surveys = {}) {
  const title = dialog.querySelector('[data-survey-title]');
  const subtitle = dialog.querySelector('[data-survey-subtitle]');
  const media = dialog.querySelector('[data-survey-media]');
  const facts = dialog.querySelector('[data-survey-facts]');
  const notes = dialog.querySelector('[data-survey-notes]');

  dialog.querySelector('[data-action="close"]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  return {
    open(stationId) {
      const station = network.stations.get(stationId);
      if (!station) return;
      const survey = surveys[stationId] ?? {};
      const photos = (survey.photos ?? []).filter((photo) => photo?.url);

      title.textContent = station.name;
      subtitle.textContent = station.role;
      media.replaceChildren(
        photos.length > 0 ? photoGallery(photos, station) : sectionCard(station),
      );
      facts.replaceChildren(...factRows(station, survey));
      notes.replaceChildren(...noteItems(survey));
      notes.closest('[data-survey-notes-section]').hidden = notes.childElementCount === 0;

      if (!dialog.open) dialog.showModal();
    },
  };
}

function photoGallery(photos, station) {
  const figure = element('figure', 'gallery');
  const image = element('img', 'gallery__image');
  const caption = element('figcaption', 'gallery__caption');
  const counter = element('span', 'gallery__counter');
  let index = 0;

  const show = (nextIndex) => {
    index = (nextIndex + photos.length) % photos.length;
    const photo = photos[index];
    image.src = ASSET_ROOT + photo.url;
    image.alt = photo.caption ?? `${station.name} survey photo ${index + 1}`;
    caption.textContent = [photo.caption, photo.credit && `Photo: ${photo.credit}`]
      .filter(Boolean)
      .join(' · ');
    counter.textContent = `${index + 1} / ${photos.length}`;
  };

  // A missing or misnamed file should not leave a broken-image icon.
  image.addEventListener('error', () => {
    image.alt = '';
    caption.textContent = `This photo could not be loaded (${photos[index].url}).`;
  });

  figure.append(image);
  if (photos.length > 1) {
    const controls = element('div', 'gallery__controls');
    const previous = element('button', 'button button--small', 'Previous');
    const next = element('button', 'button button--small', 'Next');
    previous.type = 'button';
    next.type = 'button';
    previous.addEventListener('click', () => show(index - 1));
    next.addEventListener('click', () => show(index + 1));
    controls.append(previous, counter, next);
    figure.append(controls);
  }
  figure.append(caption);
  show(0);
  return figure;
}

/** Schematic section through the host building, drawn to its surveyed heights. */
function sectionCard(station) {
  const card = element('div', 'section-card');
  const ground = station.ground_elevation_m;
  const height = station.platform_height_m;

  if (!Number.isFinite(ground) || !Number.isFinite(height)) {
    card.append(element('p', 'section-card__empty', 'No survey data recorded for this station yet.'));
    return card;
  }

  const VIEW = { width: 360, height: 240, groundY: 200, maxBuilding: 150, maxHeightM: 50 };
  const buildingPx = Math.min(VIEW.maxBuilding, (height / VIEW.maxHeightM) * VIEW.maxBuilding);
  const roofY = VIEW.groundY - buildingPx;
  const platformY = roofY - 10;
  const cableY = platformY - 26;

  const svg = svgElement('svg', {
    viewBox: `0 0 ${VIEW.width} ${VIEW.height}`,
    role: 'img',
    'aria-label':
      `Section through ${station.host_building}: ground at ${ground.toFixed(0)} m, ` +
      `platform ${height.toFixed(0)} m above it`,
  });

  const text = (x, y, content, anchor = 'start', className = 'section-card__label') => {
    const label = svgElement('text', { x, y, class: className });
    label.setAttribute('text-anchor', anchor);
    label.textContent = content;
    svg.append(label);
  };

  svg.append(
    svgElement('rect', { x: 0, y: VIEW.groundY, width: VIEW.width, height: 40, class: 'section-card__ground' }),
    svgElement('rect', { x: 110, y: roofY, width: 140, height: buildingPx, class: 'section-card__building' }),
    svgElement('rect', { x: 100, y: platformY, width: 160, height: 10, class: 'section-card__platform' }),
    svgElement('line', { x1: 0, y1: cableY - 8, x2: VIEW.width, y2: cableY + 8, class: 'section-card__cable' }),
    svgElement('rect', { x: 166, y: cableY + 4, width: 28, height: 22, rx: 3, class: 'section-card__cabin' }),
    svgElement('line', { x1: 180, y1: cableY, x2: 180, y2: cableY + 4, class: 'section-card__cable' }),
    // Height dimension beside the building
    svgElement('line', { x1: 282, y1: platformY, x2: 282, y2: VIEW.groundY, class: 'section-card__dimension' }),
    svgElement('line', { x1: 276, y1: platformY, x2: 288, y2: platformY, class: 'section-card__dimension' }),
    svgElement('line', { x1: 276, y1: VIEW.groundY, x2: 288, y2: VIEW.groundY, class: 'section-card__dimension' }),
  );
  text(294, (platformY + VIEW.groundY) / 2 + 4, `${height.toFixed(0)} m`);
  text(10, platformY + 9, `Platform ${platformElevation(station).toFixed(0)} m`);
  text(10, VIEW.groundY + 16, `Ground ${ground.toFixed(0)} m`);
  text(180, VIEW.groundY - buildingPx / 2 + 4, station.short_name, 'middle', 'section-card__name');

  card.append(
    svg,
    element('p', 'section-card__caption', 'Schematic section. No survey photos added for this station yet.'),
  );
  return card;
}

function factRows(station, survey) {
  const rows = [
    ['Host building', station.host_building],
    ['Station type', survey.station_type],
    ['Roof platform', formatElevation(platformElevation(station))],
    ['Platform above ground', formatMeters(station.platform_height_m)],
    ['Ground level', formatElevation(station.ground_elevation_m)],
    ['Ground data', station.ground_elevation_source],
    ['Height basis', station.platform_height_source],
    ['Access', `${station.elevators} elevators, level boarding`],
  ];
  return rows
    .filter(([, value]) => value)
    .flatMap(([term, value]) => [element('dt', '', term), element('dd', '', value)]);
}

const noteItems = (survey) =>
  (survey.clearance_notes ?? []).map((note) => element('li', '', note));

const formatMeters = (value) => (Number.isFinite(value) ? `${value.toFixed(0)} m` : null);
const formatElevation = (value) =>
  Number.isFinite(value) ? `${value.toFixed(0)} m above sea level` : null;
