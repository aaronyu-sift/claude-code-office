// The scene settings popover in the header (pixel Office view): time of day, season, hemisphere and weather. The camera buttons inside it
// belong to the same handler as the toggle in the header (main.js). Every change is applied to the scene at once, without a reload, and
// remembered by the scene (settings.js); `afterChange(key, value)` lets the page keep an explicit URL parameter in step.
import { t as msg } from './i18n.js';

const pad = n => String(n).padStart(2, '0');
const clock = min => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const minutesOf = text => { const m = /^(\d{2}):(\d{2})$/.exec(text || ''); return m ? +m[1] * 60 + +m[2] : 720; };

export function createSettingsPanel({ wrap, getOffice, afterChange = () => {} }) {
  const btn = wrap.querySelector('#set-btn'), pop = wrap.querySelector('#set-pop');
  const timeMode = wrap.querySelector('#set-time-mode'), timeRow = wrap.querySelector('.set-time'), slider = wrap.querySelector('#set-time'), out = wrap.querySelector('#set-time-out');
  const season = wrap.querySelector('#set-season'), hemi = wrap.querySelector('#set-hemisphere'), weather = wrap.querySelector('#set-weather'), note = wrap.querySelector('#set-note');

  const set = (key, value) => {
    const o = getOffice();
    if (!o || !o.setSetting(key, value)) return false;
    afterChange(key, value);
    return true;
  };
  function refresh() {
    const o = getOffice();
    if (!o) return;
    const s = o.settings, from = o.settingsFrom, fixed = s.time !== 'auto';
    for (const b of timeMode.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === (fixed ? 'fixed' : 'auto')));
    timeRow.hidden = !fixed;
    if (fixed) { slider.value = String(minutesOf(s.time)); out.textContent = s.time; }
    season.value = s.season; hemi.value = s.hemisphere; weather.value = s.weather;
    const notes = [];
    if (s.weather !== 'off' && matchMedia('(prefers-reduced-motion: reduce)').matches) notes.push(msg('set.note.reduced'));
    const urlSet = Object.keys(s).filter(k => from[k] === 'url');
    if (urlSet.length) notes.push(msg('set.note.url') + urlSet.map(k => `?${k}=${s[k]}`).join(' '));
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
  return { open, close, refresh, get isOpen() { return isOpen(); } };
}
