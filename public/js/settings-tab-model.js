// What the Settings tab (settings-tab.js) knows besides the controls: the choices of each row, the words about where a value comes from, the camera's own storage, and what
// the server says about the agent message board. Pure functions, so the rules are tested in Node (test/settings-tab.test.mjs).
//
//   OPTIONS                      the choices of the rows that offer a list: [value, language key]; the same values the popover offers (a test compares them with index.html)
//   sourceParam(key, search)     the address's own spelling of a setting that it names ('?season=winter', '?hour=21' for the time), else ''
//   cameraSource(search, store)  where the pixel scene's camera comes from: 'url' (?proj=), 'stored' (its own older key) or 'default'
//   boardState(config)           the agent message board from /api/config: 'on' (connected), 'off' (not enabled), 'unsupported', or null (the field is absent or not understood)
import { officeQuery } from './office-settings.js';
import { fromQuery } from './pixel/settings.js';

export const OPTIONS = Object.freeze({
  scene: [['3d', 'st.scene.3d'], ['pixel', 'st.scene.pixel']],
  camera: [['iso', 'proj.iso'], ['front', 'proj.front']],
  season: [['auto', 'set.seasonAuto'], ['spring', 'season.spring'], ['summer', 'season.summer'], ['autumn', 'season.autumn'], ['winter', 'season.winter']],
  hemisphere: [['north', 'hemi.north'], ['south', 'hemi.south']],
  weather: [['off', 'weather.off'], ['auto', 'weather.auto'], ['clear', 'weather.clear'], ['cloudy', 'weather.cloudy'], ['rain', 'weather.rain'], ['snow', 'weather.snow'], ['fog', 'weather.fog']],
});

export function sourceParam(key, search = '') {
  const q = new URLSearchParams(search || ''), named = officeQuery(search);
  if (!Object.prototype.hasOwnProperty.call(named, key)) return '';
  const name = key === 'time' && fromQuery(search).time == null ? 'hour' : key;           // ?hour= is the older spelling of ?time=, used when no good ?time= is given
  return `?${name}=${q.get(name)}`;
}

// the camera (isometric or front) is kept by the pixel scene under a key of its own, older than the settings object (pixel/index.js PROJ_KEY)
export const CAMERA_KEY = 'ajan-ofisi.proj';
const isCamera = v => v === 'iso' || v === 'front';
export function cameraSource(search = '', storage = null) {
  if (isCamera(new URLSearchParams(search || '').get('proj'))) return 'url';
  try { if (storage && isCamera(storage.getItem(CAMERA_KEY))) return 'stored'; } catch { /* storage disabled */ }
  return 'default';
}

const BOARD = { on: 'on', connected: 'on', off: 'off', unsupported: 'unsupported' };
export function boardState(config) {
  const s = config && config.chat && typeof config.chat.state === 'string' ? config.chat.state.trim().toLowerCase() : '';
  return Object.prototype.hasOwnProperty.call(BOARD, s) ? BOARD[s] : null;
}
