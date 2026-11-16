/**
 * Basemap style for MapLibre: a dark slate rendering of OpenStreetMap data
 * with extruded buildings, tuned so the Crimson and Limestone lines carry
 * the colour.
 *
 * Tiles come from OpenFreeMap, which needs no API key or account. The layers
 * below use the OpenMapTiles schema those tiles follow. The style is defined
 * here rather than fetched so the network still draws if the tile service is
 * unreachable.
 */

const TILE_SOURCE_URL = 'https://tiles.openfreemap.org/planet';
const GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const LABEL_FONT = ['Noto Sans Regular'];

const COLOR = {
  land: '#0f1419',
  campus: '#131a23',
  green: '#12201b',
  water: '#0a1a28',
  roadMinor: '#1f2731',
  roadMajor: '#2b3440',
  path: '#28303b',
  building: '#2c3542',
  label: '#7d8896',
  labelHalo: '#0b0f14',
};

const widthByZoom = (atZoom12, atZoom18) => [
  'interpolate',
  ['exponential', 1.6],
  ['zoom'],
  12,
  atZoom12,
  18,
  atZoom18,
];

const roadClass = (...classes) => ['in', ['get', 'class'], ['literal', classes]];

/** Id of the extruded building layer; network layers are inserted above it. */
export const BUILDING_LAYER_ID = 'buildings-3d';

export function basemapStyle() {
  return {
    version: 8,
    name: 'IU SkyLink dark',
    glyphs: GLYPHS_URL,
    sources: {
      openmaptiles: { type: 'vector', url: TILE_SOURCE_URL },
    },
    light: { anchor: 'viewport', color: '#ffffff', intensity: 0.35 },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': COLOR.land } },
      {
        id: 'campus',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landuse',
        filter: ['in', ['get', 'class'], ['literal', ['university', 'college', 'school']]],
        paint: { 'fill-color': COLOR.campus },
      },
      {
        id: 'green',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'landcover',
        filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass']]],
        paint: { 'fill-color': COLOR.green },
      },
      {
        id: 'parks',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'park',
        paint: { 'fill-color': COLOR.green },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'openmaptiles',
        'source-layer': 'water',
        paint: { 'fill-color': COLOR.water },
      },
      {
        id: 'paths',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 15,
        filter: roadClass('path', 'track'),
        paint: { 'line-color': COLOR.path, 'line-width': 1, 'line-dasharray': [2, 2] },
      },
      {
        id: 'roads-minor',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: roadClass('minor', 'service'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': COLOR.roadMinor, 'line-width': widthByZoom(0.5, 7) },
      },
      {
        id: 'roads-major',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        filter: roadClass('motorway', 'trunk', 'primary', 'secondary', 'tertiary'),
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': COLOR.roadMajor, 'line-width': widthByZoom(1, 13) },
      },
      {
        id: BUILDING_LAYER_ID,
        type: 'fill-extrusion',
        source: 'openmaptiles',
        'source-layer': 'building',
        minzoom: 13,
        filter: ['!', ['has', 'hide_3d']],
        paint: {
          'fill-extrusion-color': COLOR.building,
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.9,
        },
      },
      {
        id: 'road-labels',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
        minzoom: 14,
        layout: {
          'symbol-placement': 'line',
          'text-field': ['get', 'name'],
          'text-font': LABEL_FONT,
          'text-size': 10,
          'text-letter-spacing': 0.05,
        },
        paint: {
          'text-color': COLOR.label,
          'text-halo-color': COLOR.labelHalo,
          'text-halo-width': 1.2,
        },
      },
    ],
  };
}
