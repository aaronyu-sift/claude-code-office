// Settings of the pixel Office view (what the popover in the header edits): time of day, season, weather and hemisphere. They are kept in
// localStorage as one JSON object; a URL parameter (?time=HH:MM, ?season=, ?weather=, ?hemisphere=, ?shelf=, ?project=) overrides what is stored and is not
// stored itself. Pure functions over an injectable storage, so the rules can be tested without a browser.
//   time:       'auto' (the browser's local clock) or 'HH:MM' (fixed)
//   season:     'auto' (from the date and the hemisphere) or spring | summer | autumn | winter
//   weather:    'off' (default) | 'auto' (seeded by date and season) | clear | cloudy | rain | snow | fog
//   hemisphere: north (default) | south
//   shelf:      how many asleep and closed chats the shelf shows at first, a whole number from 3 to 200 (default 10; the visitor can ask for more)
//   project:    'off' (default) | 'on': whether a room's board also shows the project folder, small in its bottom-right corner (the chat name is the big text)
// The camera view (isometric or front) has its own, older key and is handled by the view itself.
import { parseClock, fmtClock } from './time.js';
import { parseSeason, parseHemisphere } from './season.js';
import { parseWeather } from './weather.js';
import { DEFAULT_CAP, MIN_CAP, MAX_CAP } from './shelf.js';

export const KEY = 'ajan-ofisi.settings';
export const DEFAULTS = Object.freeze({ time: 'auto', season: 'auto', weather: 'off', hemisphere: 'north', shelf: DEFAULT_CAP, project: 'off' });
export const KEYS = Object.keys(DEFAULTS);

// a valid value for a key, or null
const CLEAN = {
  time: v => (v === 'auto' ? 'auto' : parseClock(v) == null ? null : fmtClock(parseClock(v))),
  season: v => (v === 'auto' ? 'auto' : parseSeason(v)),
  weather: v => parseWeather(v),
  hemisphere: v => parseHemisphere(v),
  shelf: v => { const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? +v : NaN; return Number.isInteger(n) && n >= MIN_CAP && n <= MAX_CAP ? n : null; },
  project: v => { const t = typeof v === 'string' ? v.trim().toLowerCase() : ''; return t === 'on' || t === 'off' ? t : null; },
};
export const clean = (key, value) => (CLEAN[key] ? CLEAN[key](value) : null);

// the valid part of an object (anything else is dropped, so a hand-edited or old store cannot break the view)
export function sanitize(obj) {
  const out = {};
  if (obj && typeof obj === 'object') for (const k of KEYS) { const v = clean(k, obj[k]); if (v != null) out[k] = v; }
  return out;
}
// overrides from a URL query string ("?season=winter&time=22:00")
export function fromQuery(search) {
  const q = new URLSearchParams(search || ''), out = {};
  for (const k of KEYS) if (q.has(k)) { const v = clean(k, q.get(k)); if (v != null) out[k] = v; }
  return out;
}
// the settings in force: defaults < stored < URL; `from` says where each value came from ('default', 'stored' or 'url')
export function merge(stored, overrides) {
  const values = { ...DEFAULTS }, from = {};
  for (const k of KEYS) from[k] = 'default';
  for (const [src, obj] of [['stored', sanitize(stored)], ['url', sanitize(overrides)]]) for (const [k, v] of Object.entries(obj)) { values[k] = v; from[k] = src; }
  return { values, from };
}

export function load(storage) {
  try { return sanitize(JSON.parse(storage.getItem(KEY) || '{}')); } catch { return {}; }
}
// store a change (a URL override is never stored by loading, only by the user changing a setting)
export function save(storage, patch) {
  const next = { ...load(storage), ...sanitize(patch) };
  try { storage.setItem(KEY, JSON.stringify(next)); } catch { /* storage disabled */ }
  return next;
}
// minutes after midnight for a time setting, or null for 'auto'
export const timeMinutes = value => (value === 'auto' ? null : parseClock(value));
