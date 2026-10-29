// The scene settings popover in the header (Office view, either scene): time of day, season, hemisphere, weather and how many chats the shelf shows. The camera buttons
// inside it belong to the same handler as the toggle in the header (main.js). Every change is applied to the scene at once, without a reload, and remembered by the scene
// (settings.js, office-settings.js); `afterChange(key, value)` lets the page keep an explicit URL parameter in step. The rows follow the scene: a scene lists the rows it
// supports (`settingRows`, see rowsOf in office-settings.js) and the others are hidden, so the 3D scene shows no camera row.
import { t as msg } from './i18n.js';
import { rowsOf } from './office-settings.js';

const pad = n => String(n).padStart(2, '0');
const clock = min => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const minutesOf = text => { const m = /^(\d{2}):(\d{2})$/.exec(text || ''); return m ? +m[1] * 60 + +m[2] : 720; };

export function createSettingsPanel({ wrap, getOffice, afterChange = () => {} }) {
  const btn = wrap.querySelector('#set-btn'), pop = wrap.querySelector('#set-pop');
  const timeMode = wrap.querySelector('#set-time-mode'), timeRow = wrap.querySelector('.set-time'), slider = wrap.querySelector('#set-time'), out = wrap.querySelector('#set-time-out');
  const season = wrap.querySelector('#set-season'), hemi = wrap.querySelector('#set-hemisphere'), weather = wrap.querySelector('#set-weather'), shelf = wrap.querySelector('#set-shelf'), note = wrap.querySelector('#set-note');

  const set = (key, value) => {
    const o = getOffice();
    if (!o || !o.setSetting(key, value)) return false;
    afterChange(key, value);
    return true;
  };
  // the select offers 5, 10, 20 and 50; a value from the address (?shelf=7) or an older store gets an option of its own while it is the current one
  function showShelf(n) {
    const v = String(n);
    for (const o of [...shelf.options]) if (o.dataset.extra && o.value !== v) o.remove();
    if (![...shelf.options].some(o => o.value === v)) {
      const o = new Option(v, v);
      o.dataset.extra = '1';
      shelf.add(o, [...shelf.options].find(x => +x.value > n) || null);
    }
    shelf.value = v;
  }
  function refresh() {
    const o = getOffice();
    if (!o) return;
    const s = o.settings, from = o.settingsFrom, fixed = s.time !== 'auto', rows = rowsOf(o);
    for (const row of wrap.querySelectorAll('.set-row[data-row]')) row.hidden = !rows.includes(row.dataset.row);
    for (const b of timeMode.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === (fixed ? 'fixed' : 'auto')));
    timeRow.hidden = !fixed || !rows.includes('time');
    if (fixed) { slider.value = String(minutesOf(s.time)); out.textContent = s.time; }
    season.value = s.season; hemi.value = s.hemisphere; weather.value = s.weather; showShelf(s.shelf);
    const notes = [];
    if (s.weather !== 'off' && matchMedia('(prefers-reduced-motion: reduce)').matches) notes.push(msg('set.note.reduced'));
    const urlSet = Object.keys(s).filter(k => from[k] === 'url');
    if (urlSet.length) notes.push(msg('set.note.url') + urlSet.map(k => `?\u2060${k}=${s[k]}`).join(' '));   // a word joiner: a long note may wrap between parameters, not after the "?"
    note.hidden = !notes.length;
    note.textContent = notes.join(' ');
  }
  const isOpen = () => !pop.hidden;
  function open() { refresh(); pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
  function close() { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); }

  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  document.addEventListener('pointerdown', e => { if (isOpen() && !wrap.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) { close(); btn.focus(); } });
  timeMode.addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    if (b.dataset.v === 'auto') set('time', 'auto');
    else { const d = new Date(); set('time', clock(Math.floor((d.getHours() * 60 + d.getMinutes()) / 5) * 5)); }
    refresh();
  });
  slider.addEventListener('input', () => { out.textContent = clock(+slider.value); set('time', clock(+slider.value)); });
  season.addEventListener('change', () => { set('season', season.value); refresh(); });
  hemi.addEventListener('change', () => { set('hemisphere', hemi.value); refresh(); });
  weather.addEventListener('change', () => { set('weather', weather.value); refresh(); });
  shelf.addEventListener('change', () => { set('shelf', +shelf.value); refresh(); });
  return { open, close, refresh, get isOpen() { return isOpen(); } };
}
