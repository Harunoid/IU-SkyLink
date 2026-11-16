/**
 * Live wind status for the header. Aerial ropeways slow down and then stop
 * as gusts rise, so the current reading is shown as an operating state.
 *
 * Data: Open-Meteo forecast API (no key, CORS-enabled, CC BY 4.0).
 */

const CAMPUS = { latitude: 39.1712, longitude: -86.5175 };
const REFRESH_MS = 10 * 60 * 1000;

/** Planning-level gust limits for a monocable gondola, in m/s. */
const GUST_LIMITS = { reducedSpeed: 15, hold: 20 };

const ENDPOINT =
  'https://api.open-meteo.com/v1/forecast' +
  `?latitude=${CAMPUS.latitude}&longitude=${CAMPUS.longitude}` +
  '&current=wind_speed_10m,wind_gusts_10m&wind_speed_unit=ms';

export function operatingState(gustMps) {
  if (gustMps >= GUST_LIMITS.hold) return { level: 'hold', label: 'Wind hold' };
  if (gustMps >= GUST_LIMITS.reducedSpeed) return { level: 'reduced', label: 'Reduced speed' };
  return { level: 'normal', label: 'Operating normally' };
}

/**
 * Fills the status element and keeps it fresh. The element stays hidden if
 * the weather service cannot be reached; the rest of the page is unaffected.
 *
 * @param {HTMLElement} element
 */
export function startWindStatus(element) {
  const label = element.querySelector('[data-wind-label]');
  const detail = element.querySelector('[data-wind-detail]');

  async function refresh() {
    try {
      const response = await fetch(ENDPOINT);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { current } = await response.json();
      const state = operatingState(current.wind_gusts_10m);
      element.dataset.level = state.level;
      label.textContent = state.label;
      detail.textContent =
        `Wind ${current.wind_speed_10m.toFixed(1)} m/s, ` +
        `gusts ${current.wind_gusts_10m.toFixed(1)} m/s`;
      element.hidden = false;
    } catch (error) {
      console.warn('Wind status unavailable:', error);
      element.hidden = true;
    }
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
}
