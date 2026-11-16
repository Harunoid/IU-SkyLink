/**
 * 3D cabin inspection dialog built on <model-viewer>.
 *
 * The web component (~1 MB) is imported on first open rather than at page
 * load, so the map stays fast for visitors who never open the viewer.
 */

const MODEL_VIEWER_MODULE =
  'https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js';

const DEFAULT_VIEW = { orbit: '35deg 72deg 9m', target: '0m 1.7m 0m' };

const CAMERA_PRESETS = {
  exterior: DEFAULT_VIEW,
  door: { orbit: '90deg 82deg 6.5m', target: '0m 1.1m 0m' },
  grip: { orbit: '20deg 60deg 4.5m', target: '0m 3.1m 0m' },
  roof: { orbit: '0deg 12deg 8m', target: '0m 2m 0m' },
};

/**
 * Annotation anchors in model space (metres, +Y up, door on +X).
 * Kept in step with the part layout in tools/build-cabin-model.mjs.
 */
const HOTSPOTS = [
  {
    id: 'shell',
    label: 'Shell and livery',
    position: '-1.01 0.55 0.4',
    normal: '-1 0 0',
    view: { orbit: '-70deg 78deg 7m', target: '0m 1.1m 0m' },
    body:
      'Bolted aluminium extrusion frame with removable lower panels in IU Crimson ' +
      '(#990000) and a Cream (#EEEDEB) roof band. Panels unbolt individually, so a ' +
      'damaged section is swapped rather than the cabin retired.',
    specs: [
      ['Capacity', '10 passengers'],
      ['Footprint', '2.00 m × 2.20 m'],
      ['Cabin height', '2.16 m'],
    ],
  },
  {
    id: 'door',
    label: 'Level-boarding doors',
    position: '1.03 1.0 0.24',
    normal: '1 0 0',
    view: CAMERA_PRESETS.door,
    body:
      'Bi-parting doors open onto a platform flush with the cabin floor. The clear ' +
      'opening exceeds the 815 mm ADA minimum, so a wheelchair rolls straight in ' +
      'while the cabin creeps through the station.',
    specs: [
      ['Clear opening', '0.90 m'],
      ['Floor-to-platform gap', 'Flush, level boarding'],
      ['Station speed', 'approx. 0.3 m/s'],
    ],
  },
  {
    id: 'glazing',
    label: 'Polycarbonate glazing',
    position: '0 1.45 1.08',
    normal: '0 0 1',
    view: { orbit: '0deg 80deg 6.5m', target: '0m 1.4m 0m' },
    body:
      'Wraparound UV-stabilised polycarbonate keeps the ride enclosed and ' +
      'weather-proof. Each pane is gasket-mounted for like-for-like replacement at ' +
      'scheduled overhaul.',
    specs: [
      ['Material', 'Polycarbonate, hard-coated'],
      ['Glazed band', '0.95 m tall, all four sides'],
    ],
  },
  {
    id: 'grip',
    label: 'Detachable grip',
    position: '0 3.47 0.29',
    normal: '0 0 1',
    view: CAMERA_PRESETS.grip,
    body:
      'A spring-loaded grip clamps the haul rope on the line and releases in ' +
      'stations, letting cabins slow for boarding while the rope keeps moving at ' +
      'full speed.',
    specs: [
      ['Line speed', '6.0 m/s (about 13.4 mph)'],
      ['Peak headway', '30 s'],
      ['System', 'Continuous-loop monocable'],
    ],
  },
  {
    id: 'hanger',
    label: 'Hanger and damper',
    position: '0.07 2.8 0',
    normal: '1 0 0',
    view: { orbit: '60deg 70deg 5.5m', target: '0m 2.7m 0m' },
    body:
      'The steel hanger carries the cabin below the rope through a damped pivot ' +
      'that settles sway in crosswinds and during station entry.',
    specs: [
      ['Rope-to-roof drop', '1.3 m'],
      ['Material', 'Galvanised structural steel'],
    ],
  },
  {
    id: 'roof',
    label: 'Roof services module',
    position: '0 2.2 -0.45',
    normal: '0 1 0',
    view: CAMERA_PRESETS.roof,
    body:
      'A serviceable roof tray holds ventilation, lighting and the passenger ' +
      'intercom, trickle-charged in stations from the battery banks that store ' +
      'regenerative braking energy.',
    specs: [
      ['Power', 'In-station charging contact'],
      ['Service access', 'Lift-off roof tray'],
    ],
  },
];

/**
 * @param {HTMLDialogElement} dialog
 * @returns {{open: () => Promise<void>}}
 */
export function createCabinViewer(dialog) {
  const stage = dialog.querySelector('[data-viewer-stage]');
  const status = dialog.querySelector('[data-viewer-status]');
  const detail = dialog.querySelector('[data-viewer-detail]');
  const rotateToggle = dialog.querySelector('[data-action="toggle-rotate"]');
  const annotationToggle = dialog.querySelector('[data-action="toggle-annotations"]');
  const presetButtons = dialog.querySelectorAll('[data-preset]');

  let viewer = null;
  let loading = null;

  async function mountViewer() {
    status.textContent = 'Loading 3D model…';
    await import(MODEL_VIEWER_MODULE);

    viewer = document.createElement('model-viewer');
    viewer.setAttribute('src', stage.dataset.modelSrc);
    viewer.setAttribute('alt', stage.dataset.modelAlt);
    viewer.setAttribute('camera-controls', '');
    viewer.setAttribute('auto-rotate', '');
    viewer.setAttribute('rotation-per-second', '18deg');
    viewer.setAttribute('touch-action', 'pan-y');
    viewer.setAttribute('interaction-prompt', 'none');
    viewer.setAttribute('shadow-intensity', '0.9');
    viewer.setAttribute('shadow-softness', '0.8');
    viewer.setAttribute('exposure', '1.05');
    viewer.setAttribute('camera-orbit', DEFAULT_VIEW.orbit);
    viewer.setAttribute('camera-target', DEFAULT_VIEW.target);
    viewer.setAttribute('min-camera-orbit', 'auto auto 3m');
    viewer.setAttribute('max-camera-orbit', 'auto auto 16m');

    for (const [index, hotspot] of HOTSPOTS.entries()) {
      viewer.append(hotspotButton(hotspot, index + 1));
    }

    viewer.addEventListener('load', () => {
      status.textContent = '';
    });
    viewer.addEventListener('error', () => {
      status.textContent = 'The cabin model could not be displayed on this device.';
    });

    stage.append(viewer);
  }

  function hotspotButton(hotspot, number) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hotspot';
    button.slot = `hotspot-${hotspot.id}`;
    button.dataset.position = hotspot.position;
    button.dataset.normal = hotspot.normal;
    button.dataset.visibilityAttribute = 'visible';
    button.setAttribute('aria-label', hotspot.label);
    button.textContent = String(number);
    button.addEventListener('click', () => selectHotspot(hotspot, button));
    return button;
  }

  function selectHotspot(hotspot, button) {
    viewer.querySelectorAll('.hotspot').forEach((other) => {
      other.setAttribute('aria-pressed', String(other === button));
    });
    setAutoRotate(false);
    applyView(hotspot.view);
    renderDetail(detail, hotspot);
  }

  function applyView({ orbit, target }) {
    viewer.cameraOrbit = orbit;
    viewer.cameraTarget = target;
  }

  function setAutoRotate(isRotating) {
    viewer.autoRotate = isRotating;
    rotateToggle.setAttribute('aria-pressed', String(isRotating));
  }

  rotateToggle.addEventListener('click', () => {
    if (viewer) setAutoRotate(!viewer.autoRotate);
  });

  annotationToggle.addEventListener('click', () => {
    const isShown = annotationToggle.getAttribute('aria-pressed') !== 'true';
    annotationToggle.setAttribute('aria-pressed', String(isShown));
    stage.classList.toggle('viewer__stage--plain', !isShown);
  });

  presetButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (!viewer) return;
      setAutoRotate(false);
      applyView(CAMERA_PRESETS[button.dataset.preset]);
    });
  });

  dialog.querySelector('[data-action="close"]').addEventListener('click', () => dialog.close());
  // A click that lands on the dialog element itself is a click on the backdrop.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  return {
    async open() {
      dialog.showModal();
      if (viewer) return;
      loading ??= mountViewer().catch((error) => {
        console.error(error);
        loading = null;
        status.textContent =
          'The 3D viewer could not be loaded. Check your connection and reopen this panel.';
      });
      await loading;
    },
  };
}

function renderDetail(container, hotspot) {
  const heading = document.createElement('h3');
  heading.textContent = hotspot.label;

  const body = document.createElement('p');
  body.textContent = hotspot.body;

  const specs = document.createElement('dl');
  specs.className = 'spec-list';
  for (const [term, value] of hotspot.specs) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    specs.append(dt, dd);
  }

  container.replaceChildren(heading, body, specs);
}
