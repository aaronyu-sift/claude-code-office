// The scene settings popover in the header (Office view, either scene): time of day, season, hemisphere, weather, how many chats the shelf shows and whether a room's
// board shows the project folder. The camera buttons inside it belong to the same handler as the toggle in the header (main.js). Every change is applied to the scene at once,
// without a reload, and remembered by the scene (settings.js, office-settings.js). The popover talks to the settings hub (office-settings.js `createSettingsHub`), the same
// one the Settings tab uses: a change made in either control is told to the other, and the hub keeps an explicit URL parameter in step. The rows follow the scene: a scene lists
// the rows it supports (`settingRows`, see rowsOf in office-settings.js) and the others are hidden, so the 3D scene shows no camera row.
import { t as msg } from './i18n.js';
import { rowsOf, shelfChoices, fixedNow, minutesOf } from './office-settings.js';
import { fmtClock } from './pixel/time.js';

// the select offers 5, 10, 20 and 50; a value from the address (?shelf=7) or an older store gets an option of its own while it is the current one (the Settings tab uses it too)
export function fillShelf(select, n) {
  const want = shelfChoices(n).map(String), have = [...select.options].map(o => o.value);
  if (want.join() !== have.join()) select.replaceChildren(...want.map(v => new Option(v, v)));
  select.value = String(n);
}

export function createSettingsPanel({ wrap, hub }) {
  const btn = wrap.querySelector('#set-btn'), pop = wrap.querySelector('#set-pop');
  const timeMode = wrap.querySelector('#set-time-mode'), timeRow = wrap.querySelector('.set-time'), slider = wrap.querySelector('#set-time'), out = wrap.querySelector('#set-time-out');
  const season = wrap.querySelector('#set-season'), hemi = wrap.querySelector('#set-hemisphere'), weather = wrap.querySelector('#set-weather'), shelf = wrap.querySelector('#set-shelf');
  const project = wrap.querySelector('#set-project'), note = wrap.querySelector('#set-note');

  function refresh() {
    const o = hub.office(), s = hub.settings();
    if (!o || !s) return;
    const from = hub.from(), fixed = s.time !== 'auto', rows = rowsOf(o);
    for (const row of wrap.querySelectorAll('.set-row[data-row]')) row.hidden = !rows.includes(row.dataset.row);
    for (const b of timeMode.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === (fixed ? 'fixed' : 'auto')));
    timeRow.hidden = !fixed || !rows.includes('time');
    if (fixed) { slider.value = String(minutesOf(s.time)); out.textContent = s.time; }
    season.value = s.season; hemi.value = s.hemisphere; weather.value = s.weather; fillShelf(shelf, s.shelf); project.checked = s.project === 'on';
    const notes = [];
    if (s.weather !== 'off' && matchMedia('(prefers-reduced-motion: reduce)').matches) notes.push(msg('set.note.reduced'));
    const urlSet = Object.keys(s).filter(k => from[k] === 'url' && rows.includes(k));          // the rows that this popover has (the scene is a setting of the Settings tab)
    if (urlSet.length) notes.push(msg('set.note.url') + urlSet.map(k => `?\u2060${k}=${s[k]}`).join(' '));   // a word joiner: a long note may wrap between parameters, not after the "?"
    note.hidden = !notes.length;
    note.textContent = notes.join(' ');
  }
  const isOpen = () => !pop.hidden;
  function open() { refresh(); pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
  function close() { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); }

  hub.on(refresh);                                                     // a change made in the Settings tab shows here at once, open or not
  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  document.addEventListener('pointerdown', e => { if (isOpen() && !wrap.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) { close(); btn.focus(); } });
  timeMode.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    hub.set('time', b.dataset.v === 'auto' ? 'auto' : fixedNow());
    refresh();
  });
  slider.addEventListener('input', () => { out.textContent = fmtClock(+slider.value); hub.set('time', fmtClock(+slider.value)); });
  season.addEventListener('change', () => { hub.set('season', season.value); refresh(); });
  hemi.addEventListener('change', () => { hub.set('hemisphere', hemi.value); refresh(); });
  weather.addEventListener('change', () => { hub.set('weather', weather.value); refresh(); });
  shelf.addEventListener('change', () => { hub.set('shelf', +shelf.value); refresh(); });
  project.addEventListener('change', () => { hub.set('project', project.checked ? 'on' : 'off'); refresh(); });
  return { open, close, refresh, get isOpen() { return isOpen(); } };
}
