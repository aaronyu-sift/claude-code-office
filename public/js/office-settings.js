// The settings of an Office scene as one stateful object: time of day, season, hemisphere, weather and the shelf size (what the popover in the header edits).
// It sits on top of pixel/settings.js (the rules: defaults < stored < address, validation, the storage key), so a choice made in one scene is the choice in the
// other: both read and write the same localStorage object. The pixel scene keeps its own copy of these few lines (pixel/index.js); this module is used by the 3D scene
// and by the popover, which asks it which rows a scene supports.
//
//   createOfficeSettings({ storage, overrides })   get(key) | get(), set(key, value), from(), on(key, fn)
//   officeQuery(search)                            the overrides of an address: ?time ?season ?weather ?hemisphere ?shelf, and ?hour= as an older name of ?time=
//   urlAfterChange(search, key, value)             the address after a change made with the controls, when the address named that setting (else null); ?lounge=demo stays named
//   rowsOf(office)                                 the rows of the popover a scene supports
import { merge, load as loadSettings, save as saveSettings, clean, fromQuery, KEYS } from './pixel/settings.js';
import { fmtClock } from './pixel/time.js';

// the rows of the popover, in the order they are shown; a scene lists the ones it supports (`settingRows`), a scene that lists none supports all of them
export const ROWS = ['camera', 'time', 'season', 'hemisphere', 'weather', 'shelf'];
export const OFFICE3D_ROWS = ['time', 'shelf', 'weather', 'season', 'hemisphere'];
export const rowsOf = office => (office && Array.isArray(office.settingRows) ? ROWS.filter(r => office.settingRows.includes(r)) : [...ROWS]);

export const defaultStorage = () => { try { return window.localStorage; } catch { return null; } };

// `?hour=21` or `?hour=21.5` (the 3D scene's first way to pin the time of day) is `?time=21:00` or `?time=21:30`; `?time=` wins when both are given
export function officeQuery(search) {
  const out = fromQuery(search);
  const raw = new URLSearchParams(search || '').get('hour');
  if (out.time == null && raw != null && raw.trim() !== '' && Number.isFinite(+raw)) out.time = fmtClock(Math.round((((+raw % 24) + 24) % 24) * 60));
  return out;
}

// A setting that the address names keeps following the controls: the address is what a reload reads, and it wins over what is stored. `?hour=` becomes `?time=`.
export function urlAfterChange(search, key, value) {
  const q = new URLSearchParams(search || '');
  if (key === 'time' && q.has('hour') && !q.has('time')) { q.delete('hour'); q.set('time', value); return '?' + q; }
  if (!q.has(key)) return null;
  if (key === 'lounge' && /(^|[\s,+])demo($|[\s,+])/i.test(q.get(key))) value = 'demo,' + value;       // the demo source is not part of the setting: it stays
  q.set(key, value);
  return '?' + q;
}

// opts: { storage (localStorage by default; null keeps nothing), overrides (settings from the address, see officeQuery) }
export function createOfficeSettings({ storage = defaultStorage(), overrides = {} } = {}) {
  const m = merge(storage ? loadSettings(storage) : {}, overrides);
  let values = m.values;
  const origin = { ...m.from };                                         // where each value came from: 'default', 'stored', 'url' or 'user'
  const listeners = new Map();                                          // key (or '*') -> Set of fn(value, key)
  const notify = (key, value) => { for (const k of [key, '*']) for (const fn of [...(listeners.get(k) || [])]) fn(value, key); };
  return {
    get: key => (key === undefined ? { ...values } : values[key]),
    // a change by the visitor: kept for the next visit and told to every listener of that key; false for a value that is not valid
    set(key, value) {
      const v = clean(key, value);
      if (v == null || !KEYS.includes(key)) return false;
      const changed = values[key] !== v;
      values = { ...values, [key]: v };
      origin[key] = 'user';
      if (storage) saveSettings(storage, { [key]: v });
      if (changed) notify(key, v);
      return true;
    },
    from: () => ({ ...origin }),
    // fn(value, key) after the setting `key` changed ('*' for any key); returns a function that stops listening
    on(key, fn) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(fn);
      return () => listeners.get(key).delete(fn);
    },
  };
}
