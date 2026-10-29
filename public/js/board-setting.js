// The setting `project` (off by default) for the scenes that have no settings channel of their own: whether a room's board also shows the project folder.
// It is read the way every Office setting is (pixel/settings.js): the stored value, overridden by ?project=on or ?project=off in the address, which is not stored.
// The pixel scene keeps all its settings itself and does not use this module; the 3D scene asks `projectOn()` when it draws a board and subscribes with
// `onProjectChange` to draw it again. When the 3D scene gets a settings channel (office-settings.js), that channel replaces this module: `projectOn` becomes a
// read of the channel and `setProject` its setter; the callers do not change.
import { KEY, load, save, fromQuery, merge } from './pixel/settings.js';

const storage = (() => { try { return window.localStorage; } catch { return null; } })();
const subs = new Set();
let on = null;

function read() {
  let search = '';
  try { search = window.location.search; } catch { /* no address */ }
  return merge(load(storage), fromQuery(search)).values.project === 'on';
}
function set(next) {
  if (next === on) return;
  on = next;
  for (const fn of subs) { try { fn(on); } catch { /* a listener must not break the others */ } }
}

export const projectOn = () => { if (on == null) on = read(); return on; };
// the user changes the setting: kept for the next visit (an address override still wins at the next load)
export function setProject(value) {
  const v = value === true || value === 'on' ? 'on' : 'off';
  save(storage, { project: v });
  set(v === 'on');
}
export function onProjectChange(fn) { subs.add(fn); return () => subs.delete(fn); }

// another tab changed the stored settings
try {
  window.addEventListener('storage', e => { if (e.key === KEY || e.key === null) set(read()); });
} catch { /* no window */ }
