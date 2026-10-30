// The settings of an Office scene as one stateful object: time of day, season, hemisphere, weather, the shelf size, the project folder on the boards, the lounge on the plaza
// and the scene that the page opens (what the popover in the header and the Settings tab edit). It sits on top of pixel/settings.js (the rules: defaults < stored < address,
// validation, the storage key), so a choice made in one scene is the choice in the other: both read and write the same localStorage object. The pixel scene keeps its
// own copy of these few lines (pixel/index.js); this module is used by the 3D scene, which reads every setting from it (`project` too, live), and by the controls,
// which ask it which rows a scene supports.
//
//   createOfficeSettings({ storage, overrides, watch })   get(key) | get(), set(key, value), from(), on(key, fn); another tab's change arrives through `watch`'s storage event
//   createSettingsHub({ getOffice, afterChange })          what the popover and the tab both talk to: set(key, value) applies a change to whichever scene is in force and
//                                                         tells both controls (on(fn)), so a change in one shows at once in the other; settings(), from(), rows()
//   officeQuery(search)                            the overrides of an address: ?time ?season ?weather ?hemisphere ?shelf ?project ?scene ?lounge, and ?hour= as an older name of ?time=
//   urlAfterChange(search, key, value)             the address after a change made with the controls, when the address named that setting (else null); ?lounge=demo stays named
//   rowsOf(office), tabRowsOf(office)              the rows of the popover and of the Settings tab that a scene supports (`lounge` only where there is a lounge: the 3D scene)
//   sceneChoice({ storage, search })               the scene the page opens: the address, else the stored choice, else '3d'
//   sourceOf(key, from, search)                    where a value comes from, for the note under a row: 'default', 'stored', 'visit' (changed, but not kept by the browser) or 'url' (the address names it)
import { merge, load as loadSettings, keep as keepSettings, clean, fromQuery, sanitize, KEY, KEYS } from './pixel/settings.js';
import { fmtClock, parseClock } from './pixel/time.js';

// the rows of the popover, in the order they are shown; a scene lists the ones it supports (`settingRows`), a scene that lists none supports all of them. Each scene lists its own:
// the camera exists in the pixel scene only, the lounge in the 3D scene only (the pixel scene has no plaza pavilion)
export const ROWS = ['camera', 'time', 'season', 'hemisphere', 'weather', 'shelf', 'project', 'lounge'];
export const OFFICE3D_ROWS = ['time', 'shelf', 'weather', 'season', 'hemisphere', 'project', 'lounge'];
export const PIXEL_ROWS = ROWS.filter(r => r !== 'lounge');
export const rowsOf = office => (office && Array.isArray(office.settingRows) ? ROWS.filter(r => office.settingRows.includes(r)) : [...ROWS]);
// the Settings tab lists the rows of the popover and, first, the scene itself (no scene supports or not: the page decides it when it loads)
export const TAB_ROWS = ['scene', ...ROWS];
export const tabRowsOf = office => ['scene', ...rowsOf(office)];

// the shelf sizes on offer; a size from the address (?shelf=7) or an older store is offered too while it is the current one
export const SHELF_CHOICES = [5, 10, 20, 50];
export const shelfChoices = n => (SHELF_CHOICES.includes(n) || !Number.isInteger(n) ? [...SHELF_CHOICES] : [...SHELF_CHOICES, n].sort((a, b) => a - b));
// the time the "Fixed" button starts from: now, to the five minutes before
export const fixedNow = (d = new Date()) => fmtClock(Math.floor((d.getHours() * 60 + d.getMinutes()) / 5) * 5);
// minutes after midnight of a fixed time; noon for a value that is not one (the slider needs a place to stand)
export const minutesOf = text => { const m = parseClock(text); return m == null ? 720 : m; };

export const defaultStorage = () => { try { return window.localStorage; } catch { return null; } };
const defaultWatch = () => { try { return window; } catch { return null; } };

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

// opts: { storage (localStorage by default; null keeps nothing), overrides (settings from the address, see officeQuery), watch (where the storage event comes from: the
// window by default; another tab's change of the stored settings is taken over here, and an address override that is still in force keeps winning) }
export function createOfficeSettings({ storage = defaultStorage(), overrides = {}, watch = defaultWatch() } = {}) {
  const held = sanitize(overrides);                                     // the address's overrides still in force (a setting the visitor changes is let go: the address follows the control)
  const m = merge(storage ? loadSettings(storage) : {}, held);
  let values = m.values;
  const origin = { ...m.from };                                         // where each value came from: 'default', 'stored', 'url', 'user' (changed and kept) or 'visit' (changed, but the browser did not keep it)
  const listeners = new Map();                                          // key (or '*') -> Set of fn(value, key)
  const notify = (key, value) => { for (const k of [key, '*']) for (const fn of [...(listeners.get(k) || [])]) fn(value, key); };
  // another tab changed what is stored: take it over and tell the listeners of every setting that changed
  function reread() {
    if (!storage) return;
    const next = merge(loadSettings(storage), held), changed = [];
    for (const k of KEYS) { if (next.values[k] !== values[k]) changed.push(k); origin[k] = next.from[k]; }
    values = next.values;
    for (const k of changed) notify(k, values[k]);
  }
  if (watch && typeof watch.addEventListener === 'function') watch.addEventListener('storage', e => { if (e && (e.key === KEY || e.key == null)) reread(); });
  return {
    get: key => (key === undefined ? { ...values } : values[key]),
    // a change by the visitor: kept for the next visit (when the browser lets it: otherwise the origin says 'visit') and told to every listener of that key; false for a value that is not valid
    set(key, value) {
      const v = clean(key, value);
      if (v == null || !KEYS.includes(key)) return false;
      const changed = values[key] !== v;
      values = { ...values, [key]: v };
      origin[key] = keepSettings(storage, { [key]: v }) ? 'user' : 'visit';
      delete held[key];
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

// ---- the scene that the page opens, and where a value comes from ------------------------------------------------------------------------------------------
export function sceneChoice({ storage = defaultStorage(), search = '' } = {}) {
  return merge(storage ? loadSettings(storage) : {}, officeQuery(search)).values.scene;
}

// 'url' when the address names the setting (it wins at the next load, and a change made with the controls keeps it in step), else 'stored' when a choice was kept, else 'visit'
// when the visitor changed it but the browser did not keep it (it holds for this visit only), else 'default'. `from` is what the scene's settings say ('default', 'stored',
// 'url', 'user' or 'visit').
export function sourceOf(key, from, search = '') {
  if (Object.prototype.hasOwnProperty.call(officeQuery(search), key)) return 'url';
  if (from && from[key] === 'visit') return 'visit';
  return from && (from[key] === 'stored' || from[key] === 'user' || from[key] === 'url') ? 'stored' : 'default';
}

// ---- one place for the controls -------------------------------------------------------------------------------------------------------------------------
// opts: { getOffice (the scene in force: { settings, settingsFrom, setSetting(key, value), settingRows? }, or null while there is none), afterChange (key, value) }
// A change made with a control goes through `set`: the scene applies and remembers it, the page keeps an address parameter in step (afterChange), and every listener
// (the popover, the Settings tab) is told once, so both controls always show the same thing. `heard(key, value)` is for a change that the scene's own store reports
// without a control (another tab): it is passed on unless a `set` is in progress.
export function createSettingsHub({ getOffice = () => null, afterChange = () => {} } = {}) {
  const subs = new Set();
  let busy = false;
  const tell = (key, value) => { for (const fn of [...subs]) { try { fn(key, value); } catch (e) { if (typeof console !== 'undefined') console.error('[settings]', e); } } };
  return {
    office: () => getOffice() || null,
    settings() { const o = getOffice(); return o ? { ...o.settings } : null; },
    from() { const o = getOffice(); return o ? { ...o.settingsFrom } : {}; },
    rows() { return tabRowsOf(getOffice()); },
    set(key, value) {
      const o = getOffice();
      if (!o) return false;
      busy = true;
      let ok = false;
      try { ok = !!o.setSetting(key, value); } finally { busy = false; }
      if (!ok) return false;
      afterChange(key, value);
      tell(key, value);
      return true;
    },
    heard(key, value) { if (!busy) tell(key, value); },
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
  };
}
