// The Settings tab: every Office setting on one calm page, in the same glass style as the rest. It is a second view of the store that the popover in the header edits
// (office-settings.js): both talk to the settings hub, so a change made here shows at once in the popover and in the scene, and the other way round; nothing reloads, with one
// exception that the page says out loud: the scene itself (3D or pixel) is chosen when the page loads, because the two scenes are separate engines, so a new choice is kept and
// takes effect at the next load (a button reloads now).
//
// Each row says what it does in a line and where its value comes from (the default, a choice kept in this browser, or the address, which wins and is not stored). The rows follow
// the scene in force (the camera exists only in the pixel scene). A last row, read-only, says what the server reports about the agent message board (/api/config `chat.state`:
// connected, not enabled or unsupported); a server that says nothing about it shows nothing. The page fades in like a surface (docs/motion.md, kind "Page").
//
//   createSettingsTab(root, { hub, running, loadConfig, search, storage })    show(), hide(), update(), refresh()
//     hub          the settings hub (office-settings.js)
//     running()    the scene this page runs: 'pixel' or '3d'
//     loadConfig() the server's /api/config as an object (or null); the default fetches it
//     search()     the address's query string, storage the localStorage (both injectable for tests)
import { t as msg } from './i18n.js';
import { esc } from './util.js';
import { fmtClock } from './pixel/time.js';
import { fillShelf } from './settings-panel.js';
import { fixedNow, minutesOf, sourceOf } from './office-settings.js';
import { OPTIONS, sourceParam, cameraSource, boardState } from './settings-tab-model.js';
import { DUR, EASE, reduced } from './motion.js';

const defaultConfig = async () => { try { return await (await fetch('api/config', { cache: 'no-store' })).json(); } catch { return null; } };
const defaultStorage = () => { try { return window.localStorage; } catch { return null; } };
const SOURCED = ['scene', 'time', 'season', 'hemisphere', 'weather', 'shelf', 'project'];

// the page's markup; the text is the language's (msg), the values are set by refresh()
function build() {
  const select = (key, list) => `<select id="st-${key}" data-key="${key}" aria-describedby="st-h-${key}">${list.map(([v, k]) => `<option value="${v}">${esc(msg(k))}</option>`).join('')}</select>`;
  const buttons = (list, attr) => list.map(([v, k]) => `<button type="button" ${attr}="${v}" aria-pressed="false">${esc(msg(k))}</button>`).join('');
  // a row: its words on the left (label, what it does, where the value comes from), its control on the right, anything wider below
  const row = (key, { label, help, control, labelFor, extra = '', hidden = false }) =>
    `<div class="st-row" data-row="${key}"${hidden ? ' hidden' : ''}>` +
      `<div class="st-text"><span class="st-top">${labelFor ? `<label class="st-l" for="${labelFor}">${esc(label)}</label>` : `<span class="st-l" id="st-l-${key}">${esc(label)}</span>`}` +
      `${SOURCED.includes(key) || key === 'camera' ? `<span class="st-src" data-src="${key}"></span>` : ''}</span>` +
      `<span class="st-help" id="st-h-${key}">${esc(help)}</span></div>` +
      `<div class="st-ctl">${control}</div>${extra}</div>`;
  const group = (id, rows) => `<section class="st-card" aria-labelledby="st-g-${id}"><h3 class="st-gh" id="st-g-${id}">${esc(msg('st.g.' + id))}</h3>${rows}</section>`;
  const seg = (id, key, inner, extraClass = '') => `<div class="seg small st-seg${extraClass}" id="${id}" role="group" aria-labelledby="st-l-${key}" aria-describedby="st-h-${key}">${inner}</div>`;
  return `<div class="st">` +
    `<header class="st-head"><h2 class="st-title">${esc(msg('st.title'))}</h2><p class="st-intro">${esc(msg('st.intro'))}</p></header>` +
    `<p class="st-none" hidden>${esc(msg('st.none'))}</p>` +
    group('scene',
      row('scene', {
        label: msg('st.scene'), help: msg('st.scene.help'), control: seg('st-scene', 'scene', buttons(OPTIONS.scene, 'data-v')),
        extra: `<p class="st-pending" role="status" hidden><span class="st-pending-text">${esc(msg('st.scene.pending'))}</span><button type="button" class="ghost-btn" id="st-reload">${esc(msg('st.scene.reload'))}</button></p>`,
      }) +
      row('camera', { label: msg('set.camera'), help: msg('st.camera.help'), control: seg('st-camera', 'camera', buttons(OPTIONS.camera, 'data-proj'), ' proj-seg') })) +
    group('sky',
      row('time', {
        label: msg('set.time'), help: msg('st.time.help'),
        control: seg('st-time-mode', 'time', `<button type="button" data-v="auto" aria-pressed="true">${esc(msg('set.timeAuto'))}</button><button type="button" data-v="fixed" aria-pressed="false">${esc(msg('set.timeFixed'))}</button>`),
        extra: `<div class="st-time" hidden><input type="range" id="st-time" min="0" max="1435" step="5" value="720" aria-valuetext="12:00" aria-label="${esc(msg('set.time'))}"><output id="st-time-out" for="st-time">12:00</output></div>`,
      }) +
      row('season', { label: msg('set.season'), help: msg('st.season.help'), labelFor: 'st-season', control: select('season', OPTIONS.season) }) +
      row('hemisphere', { label: msg('set.hemisphere'), help: msg('st.hemisphere.help'), labelFor: 'st-hemisphere', control: select('hemisphere', OPTIONS.hemisphere) }) +
      row('weather', {
        label: msg('set.weather'), help: msg('st.weather.help'), labelFor: 'st-weather', control: select('weather', OPTIONS.weather),
        extra: `<p class="st-note" data-note="reduced" hidden>${esc(msg('set.note.reduced'))}</p>`,
      })) +
    group('office',
      row('shelf', { label: msg('set.shelf'), help: msg('st.shelf.help'), labelFor: 'st-shelf', control: `<select id="st-shelf" data-key="shelf" aria-describedby="st-h-shelf"></select>` }) +
      row('project', {
        label: msg('st.project'), help: msg('st.project.help'), labelFor: 'st-project',
        control: `<label class="toggle st-toggle"><input type="checkbox" role="switch" id="st-project" aria-describedby="st-h-project"><span></span></label>`,
        extra: `<div class="st-sample" aria-hidden="true" data-on="false"><span class="st-sample-name">${esc(msg('st.sample.name'))}</span><span class="st-sample-proj">${esc(msg('st.sample.project'))}</span></div>`,
      })) +
    group('system',
      row('board', {
        label: msg('st.board'), help: msg('st.board.help'), hidden: true,
        control: `<span class="st-state" data-state=""><i class="dot"></i><span></span></span>`,
      })) +
    `</div>`;
}

export function createSettingsTab(root, { hub, running = () => '3d', loadConfig = defaultConfig, search = () => location.search, storage = defaultStorage() } = {}) {
  root.innerHTML = build();
  const page = root.querySelector('.st'), q = sel => root.querySelector(sel);
  const time = q('#st-time'), timeOut = q('#st-time-out'), timeRow = q('.st-time');
  // the clock time is what a screen reader says for the slider, not the minutes after midnight that its value counts
  const showTime = text => { timeOut.textContent = text; time.setAttribute('aria-valuetext', text); };

  function source(key, kind, param) {
    const el = q(`[data-src="${key}"]`);
    if (!el) return;
    const text = kind === 'url' ? msg('st.src.url', { param }) : msg(kind === 'stored' ? 'st.src.stored' : kind === 'visit' ? 'st.src.visit' : 'st.src.default');
    el.dataset.from = kind;
    if (el.textContent !== text) el.textContent = text;
  }
  function refresh() {
    const s = hub.settings();
    q('.st-none').hidden = !!s;
    if (!s) return;
    const from = hub.from(), addr = search(), rows = hub.rows(), fixed = s.time !== 'auto';
    for (const r of root.querySelectorAll('.st-row[data-row]')) if (r.dataset.row !== 'board') r.hidden = !rows.includes(r.dataset.row);
    for (const b of q('#st-scene').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === s.scene));
    // a scene that is chosen but not running waits for the next load, when the browser kept the choice (or the address names it); a browser that does not keep settings says so
    // instead, and has nothing to reload into
    const waiting = s.scene !== running(), unkept = waiting && sourceOf('scene', from, addr) === 'visit';
    q('.st-pending').hidden = !waiting;
    q('.st-pending-text').textContent = msg(unkept ? 'st.scene.unkept' : 'st.scene.pending');
    q('#st-reload').hidden = unkept;
    for (const b of q('#st-time-mode').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.v === (fixed ? 'fixed' : 'auto')));
    timeRow.hidden = !fixed || !rows.includes('time');
    if (fixed) { time.value = String(minutesOf(s.time)); showTime(s.time); }
    q('#st-season').value = s.season; q('#st-hemisphere').value = s.hemisphere; q('#st-weather').value = s.weather;
    fillShelf(q('#st-shelf'), s.shelf);
    q('#st-project').checked = s.project === 'on';
    q('.st-sample').dataset.on = String(s.project === 'on');
    q('[data-note="reduced"]').hidden = !(s.weather !== 'off' && reduced());
    for (const k of SOURCED) { const kind = sourceOf(k, from, addr); source(k, kind, kind === 'url' ? sourceParam(k, addr) : ''); }
    const cam = cameraSource(addr, storage);
    source('camera', cam, cam === 'url' ? `?proj=${new URLSearchParams(addr).get('proj')}` : '');
  }

  // what the server says about the agent message board; nothing odd when it says nothing
  async function loadBoard() {
    let state = null;
    try { state = boardState(await loadConfig()); } catch { /* no answer: nothing to show */ }
    const r = q('[data-row="board"]'), el = q('.st-state');
    r.hidden = !state;
    if (!state) return;
    el.dataset.state = state;
    el.querySelector('span').textContent = msg('st.board.' + state);
  }

  // the controls
  q('#st-scene').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b) hub.set('scene', b.dataset.v); });
  q('#st-reload').addEventListener('click', () => location.reload());
  q('#st-time-mode').addEventListener('click', e => {
    const b = e.target.closest('button[data-v]');
    if (b) hub.set('time', b.dataset.v === 'auto' ? 'auto' : fixedNow());
  });
  time.addEventListener('input', () => { const t = fmtClock(+time.value); showTime(t); hub.set('time', t); });
  for (const key of ['season', 'hemisphere', 'weather']) q('#st-' + key).addEventListener('change', e => hub.set(key, e.target.value));
  q('#st-shelf').addEventListener('change', e => hub.set('shelf', +e.target.value));
  q('#st-project').addEventListener('change', e => hub.set('project', e.target.checked ? 'on' : 'off'));
  hub.on(refresh);                                                     // a change made in the popover, or in another tab, shows here at once

  refresh();
  return {
    show() {
      refresh();
      loadBoard();
      if (typeof page.animate === 'function') page.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced() ? DUR.hover : DUR.fast, easing: EASE.out });     // a surface: an eased fade, nothing moves
    },
    hide() {},
    update() {},
    refresh,
  };
}
