// QA of the Settings tab (public/js/settings-tab.js, tabs.js, office-settings.js, settings-panel.js, main.js): headless Chrome in a throw-away profile, the server against a fake
// ~/.claude, one `CHECK <name> PASS|FAIL <detail>` line per check and a final `QA PASS` or `QA FAIL`.
//   node tools/qa/office-settings-tab-qa.mjs [--only settings-tab|open|store|scene|project|lounge|keys|narrow] [--shots <dir>] [--mutations [--mutation N]]
//   npm run qa:settings-tab
//
//   settings-tab-open     the tab is the fifth of the header's tablist and opens from a click and from #settings, the rows follow the 3D scene (no camera row), each row says where its value
//                         comes from, the page fades in (only opacity; 150 ms under reduced motion), the message board line follows /api/config (absent: nothing), and the server's own answer follows its chat database (on when it reads one, off when it cannot)
//   settings-tab-store    one store behind two controls: every row changed in the tab shows in the popover, in the 3D scene and in storage without a reload, and the other way round; an
//                         address that names a setting follows the control and is not stored
//   settings-tab-scene    the scene choice is kept, `?scene=` wins and is not stored, the new scene arrives at the next load (a button reloads now), the camera row exists in the pixel scene only
//   settings-tab-project  the project folder: the tab's switch and the popover's switch show it on a 3D plaque (pixels) and on a pixel board, the sample on the tab follows
//   settings-tab-lounge   the agent lounge row (3D scene only): the tab's Text / Names only / Off and the popover's select are one store, and a choice made with either reaches the lounge live, with no
//                         reload (the demo conversation of ?lounge=demo on the wall: names only draws no text, off draws nothing and has no people, text brings it back, also when the choice was made
//                         while the Office view was hidden); the source tag (default, saved, the address's own words ?lounge=demo,names), the note under the row when the address plays the demo,
//                         ?lounge=demo kept in the address when a control changes the mode, and a kept choice is still there after a reload; the lounge's own subscription to the setting is read in the
//                         task that makes the change (an open card closes and the poll timer is cleared on Off, the timer is armed on Text), because its frame loop and its one-second view would
//                         make up for a lounge that never heard of the change
//   settings-tab-keys     the tablist by keyboard (one stop of the Tab key, arrows, Home, End, wrapping), every control reachable and operable with the keyboard, a visible focus ring, the
//                         number shortcuts do not fire inside a select
//   settings-tab-narrow   375 px wide in English and Turkish: no horizontal overflow, all five tabs inside the bar, controls inside the cards; 360 and 320 px keep the five tabs inside the bar, 280 px
//                         scrolls the strip to the chosen tab; nothing leaves localhost in any check
//
// --mutations breaks the code in a copy of the repo, one line at a time, and runs the check that guards that line: every one must FAIL there (a check that cannot fail guards nothing).
// Timing is the one thing a busy machine bends; a failing check is worth running again on its own (--only) before concluding anything.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, sleep, startServer } from './harness.mjs';
import { scenario3d, o3 } from './harness3d.mjs';
import { DEMO_SCRIPT } from '../../public/js/lounge-source.js';
import { clipChars, splitLines, LIMITS } from '../../public/js/lounge-model.js';
import { BOARD } from '../../public/js/lounge-plan.js';

const args = process.argv.slice(2);
const val = f => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : undefined; };
const only = val('only'), shotsDir = val('shots');
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const want = name => !args.includes('--mutations') && (!only || only === 'settings-tab' || only === name);       // a mutation run only runs the checks inside its copies
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`CHECK settings-tab-${name} ${ok ? 'PASS' : 'FAIL'} ${detail}`);
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stored = text => { try { return JSON.parse(text) || {}; } catch { return {}; } };       // nothing stored reads as an empty object, so a missing key is a failed part, not a crash

// ---- helpers run in the page --------------------------------------------------------------------------------------------------------------------------------
const waitFor = async (fn, ms = 20000, step = 150) => { const t0 = Date.now(); let r; while (Date.now() - t0 < ms) { r = await fn(); if (r) return r; await sleep(step); } return r; };
// a click with the real mouse, after checking that the element is the one under the pointer
async function click(page, css) {
  const r = await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(css)}); if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { x: b.left + b.width / 2, y: b.top + b.height / 2, ok: !!hit && (hit === e || e.contains(hit) || hit.contains(e)) }; })()`);
  if (!r) return false;
  await page.mouse.click(r.x, r.y);
  return r.ok;
}
const sel = (page, css, v) => page.evaluate(`(() => { const s = document.querySelector(${JSON.stringify(css)}); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
const range = (page, css, v) => page.evaluate(`(() => { const s = document.querySelector(${JSON.stringify(css)}); s.value = ${JSON.stringify(String(v))}; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const KEYS = { 2: [50, 'Digit2', '2'], Tab: [9, 'Tab'], ArrowRight: [39, 'ArrowRight'], ArrowLeft: [37, 'ArrowLeft'], Home: [36, 'Home'], End: [35, 'End'], Enter: [13, 'Enter', '\r'], ' ': [32, 'Space', ' '], 5: [53, 'Digit5', '5'] };
async function press(page, k, modifiers = 0) {
  const [vk, code, text] = KEYS[k];
  const base = { key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  await page.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, ...(text ? { text } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
}

// what the page says now: the tabs, the Settings page, both controls, the scene's own store, what was stored
const SNAP = `(() => {
  const q = s => document.querySelector(s), all = s => [...document.querySelectorAll(s)];
  const shown = e => !!e && !e.closest('[hidden]') && e.getClientRects().length > 0;
  const pressedOf = s => { const b = all(s + ' button').find(x => x.getAttribute('aria-pressed') === 'true'); return b ? (b.dataset.v || b.dataset.proj) : null; };
  const src = k => { const e = q('#view-settings [data-src="' + k + '"]'); return e && shown(e) ? { from: e.dataset.from, text: e.textContent } : null; };
  const v = q('#view-ofis'), off = v && v.__office, px = v && v.__pixel;
  const board = q('#view-settings [data-row="board"]'), state = q('#view-settings .st-state');
  const pop = q('#set-wrap');
  return JSON.stringify({
    page: document.body.dataset.page, hash: location.hash, search: location.search, mark: window.__qaMark || null,
    shown: { settings: shown(q('#view-settings')), ofis: shown(q('#view-ofis')), pano: shown(q('#view-pano')), maliyet: shown(q('#view-maliyet')), akis: shown(q('#view-akis')) },
    tabs: all('.top [role=tab]').map(b => ({ view: b.dataset.view, text: b.textContent.trim(), sel: b.getAttribute('aria-selected'), idx: b.tabIndex, controls: b.getAttribute('aria-controls'), id: b.id })),
    rows: all('#view-settings .st-row[data-row]').filter(r => shown(r)).map(r => r.dataset.row),
    helps: all('#view-settings .st-row[data-row]').filter(r => shown(r)).every(r => (r.querySelector('.st-help') || {}).textContent),
    src: Object.fromEntries(['scene', 'time', 'season', 'hemisphere', 'weather', 'shelf', 'project', 'lounge', 'camera'].map(k => [k, src(k)])),
    tab: { scene: pressedOf('#st-scene'), timeMode: pressedOf('#st-time-mode'), slider: q('#st-time').value, sliderOut: q('#st-time-out').textContent, sliderText: q('#st-time').getAttribute('aria-valuetext'), sliderShown: shown(q('.st-time')), season: q('#st-season').value, hemi: q('#st-hemisphere').value,
      weather: q('#st-weather').value, shelf: q('#st-shelf').value, shelfOpts: [...q('#st-shelf').options].map(o => o.value).join(), project: q('#st-project').checked, sample: q('.st-sample').dataset.on,
      camera: pressedOf('#st-camera'), pending: shown(q('.st-pending')), noteReduced: shown(q('[data-note="reduced"]')),
      lounge: pressedOf('#st-lounge'), loungeNote: shown(q('#view-settings [data-note="lounge-demo"]')) ? q('#view-settings [data-note="lounge-demo"]').textContent : null, loungeHelp: (q('#st-h-lounge') || {}).textContent || '', loungeLabels: all('#st-lounge button').map(b => b.dataset.v + ':' + b.textContent.trim()).join() },
    pop: { wrapShown: !!pop && !pop.hidden, open: !q('#set-pop').hidden, season: q('#set-season').value, hemi: q('#set-hemisphere').value, weather: q('#set-weather').value, shelf: q('#set-shelf').value,
      project: q('#set-project').checked, lounge: q('#set-lounge').value, loungeOpts: [...q('#set-lounge').options].map(o => o.value + ':' + o.textContent.trim()).join(), note: q('#set-note').hidden ? '' : q('#set-note').textContent.replace(/\u2060/g, ''), timeMode: pressedOf('#set-time-mode'), sliderOut: q('#set-time-out').textContent, sliderText: q('#set-time').getAttribute('aria-valuetext'), rows: all('#set-pop .set-row[data-row]').filter(r => shown(r)).map(r => r.dataset.row) },
    store: off ? off.settings.get() : px ? px.settings : null, from: off ? off.settings.from() : px ? px.settingsFrom : null, engine: off ? '3d' : px ? 'pixel' : null,
    dataScene: v && v.dataset.scene || null,
    stored: (() => { try { return localStorage.getItem('ajan-ofisi.settings'); } catch { return 'THROWS'; } })(),
    board: { shown: shown(board), state: state ? state.dataset.state : null, text: state ? state.textContent.trim() : null },
    lang: document.documentElement.lang,
  });
})()`;
const snap = page => page.evaluate(SNAP).then(JSON.parse);
const MARK = `window.__qaMark = 'm' + Math.random().toString(36).slice(2)`;

// the page for a part: the server and a Chrome of their own, every request kept (nothing may leave localhost), the console errors kept across loads
async function part(name, opts, body) {
  const S = await scenario3d(opts.n ?? 3, { tag: 'st' + name, width: opts.width, height: opts.height, root: opts.root });
  S.requests = [];
  S.errors = [];
  S.page.on(d => { if (d.method === 'Network.requestWillBeSent') S.requests.push(d.params.request.url); });
  S.base = `http://127.0.0.1:${S.srv.port}/`;
  S.load = async (query, hash, wait = 'tab') => {
    S.errors.push(...S.page.errors.filter(e => !/ofis-extras/.test(e)));
    await S.page.goto(S.base + query + hash, 600);
    const ok = await waitFor(() => S.page.evaluate(`(() => { const v = document.querySelector('#view-ofis'); return !!(v && v.__office || v && v.__pixel) && !!document.querySelector('#view-settings .st') ${wait === 'pixel' ? "&& !!v.__pixel" : ''}; })()`).catch(() => false), 60000);
    await sleep(400);
    return ok;
  };
  S.problems = () => { S.errors.push(...S.page.errors.filter(e => !/ofis-extras/.test(e))); S.page.errors.length = 0; return S.errors; };
  S.shot = async file => { if (shotsDir) await S.page.screenshot(join(shotsDir, file)); };
  try {
    if (!S.ready.ok) throw new Error('3D scene did not become ready: ' + JSON.stringify(S.ready.last));
    await body(S);
  } catch (e) {
    check(name === 'projectpx' ? 'project-pixel' : name, false, `the check crashed: ${String(e && e.message || e).slice(0, 300)}`);       // a page that lacks what the check needs is a failure, not a missing result
  } finally { await S.done(); }
}
const offsite = reqs => reqs.filter(u => !/^(http:\/\/127\.0\.0\.1:\d+\/|data:|blob:|about:)/.test(u));

// ============================================================================ open
if (want('open')) {
  await part('open', {}, async S => {
    const { page } = S, bad = [], notes = [];
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const f = window.fetch; window.fetch = (u, o) => (/api\\/config/.test(String(u)) && window.__cfg !== undefined ? Promise.resolve(new Response(JSON.stringify(window.__cfg), { headers: { 'content-type': 'application/json' } })) : f.call(window, u, o)); })()` });
    await page.evaluate(`localStorage.clear()`);
    await S.load('', '#ofis');
    await page.evaluate(MARK);
    const s0 = await snap(page);
    const tabsOk = s0.tabs.length === 5 && same(s0.tabs.map(t => t.view), ['pano', 'ofis', 'akis', 'maliyet', 'settings']) && s0.tabs[4].text === 'Settings'
      && s0.tabs.every(t => t.id === 'tab-' + t.view && t.controls === 'view-' + t.view) && s0.tabs.filter(t => t.idx === 0).length === 1 && s0.tabs.find(t => t.idx === 0).view === 'ofis' && s0.tabs.find(t => t.sel === 'true').view === 'ofis';
    if (!tabsOk) bad.push(`tablist: ${JSON.stringify(s0.tabs)}`);
    // a click on the tab
    const anim = await page.evaluate(`(() => { document.querySelector('#tab-settings').click(); const a = document.querySelector('#view-settings .st').getAnimations().map(x => ({ d: x.effect.getTiming().duration, props: [...new Set(x.effect.getKeyframes().flatMap(k => Object.keys(k)))].filter(p => !['offset', 'easing', 'composite', 'computedOffset'].includes(p)) })); return JSON.stringify(a); })()`).then(JSON.parse);
    await sleep(500);
    const s1 = await snap(page);
    if (!(s1.shown.settings && !s1.shown.ofis && s1.page === 'settings' && s1.hash === '#settings' && s1.tabs.find(t => t.sel === 'true').view === 'settings' && s1.tabs.find(t => t.idx === 0).view === 'settings' && !s1.pop.wrapShown && s1.mark === s0.mark))
      bad.push(`click on the tab: ${JSON.stringify({ shown: s1.shown, page: s1.page, hash: s1.hash, pop: s1.pop.wrapShown })}`);
    if (!(anim.length === 1 && same(anim[0].props, ['opacity']) && Math.abs(anim[0].d - 200) < 1)) bad.push(`the page's fade: ${JSON.stringify(anim)}`);
    notes.push(`tabs ${s1.tabs.map(t => t.text).join('/')}, click opens the page (hash ${s1.hash}), fade ${JSON.stringify(anim)}`);
    // the hash, both ways, and a direct load
    await page.evaluate(`location.hash = '#ofis'`); await sleep(400);
    const s2 = await snap(page);
    await page.evaluate(`location.hash = '#settings'`); await sleep(400);
    const s3 = await snap(page);
    await S.load('', '#settings');
    const s4 = await snap(page);
    if (!(s2.shown.ofis && !s2.shown.settings && s3.shown.settings && !s3.shown.ofis && s4.shown.settings && s4.page === 'settings' && s4.tabs.find(t => t.sel === 'true').view === 'settings' && s3.mark === s0.mark))
      bad.push(`the hash: ${JSON.stringify({ s2: s2.shown, s3: s3.shown, s4: s4.shown })}`);
    notes.push(`#ofis then #settings switch the views without a reload, a direct load of #settings opens it`);
    // the rows of the 3D scene, each with its source; a fresh profile and no ?scene= says default everywhere
    const wantRows = ['scene', 'time', 'season', 'hemisphere', 'weather', 'shelf', 'project', 'lounge', 'board'];
    const allDefault = ['scene', 'time', 'season', 'hemisphere', 'weather', 'shelf', 'project', 'lounge'].every(k => s4.src[k] && s4.src[k].from === 'default' && s4.src[k].text === 'Default');
    if (!(same(s4.rows, wantRows) && s4.helps && allDefault && s4.src.camera === null)) bad.push(`rows ${s4.rows.join('/')} (want ${wantRows.join('/')}), every row has a line ${s4.helps}, sources ${JSON.stringify(s4.src)}`);
    if (!(s4.tab.scene === '3d' && s4.tab.timeMode === 'auto' && !s4.tab.sliderShown && s4.tab.season === 'auto' && s4.tab.hemi === 'north' && s4.tab.weather === 'off' && s4.tab.shelf === '10' && s4.tab.project === false && s4.tab.sample === 'false' && !s4.tab.pending && s4.tab.lounge === 'text' && s4.tab.loungeNote === null))
      bad.push(`the defaults on the page: ${JSON.stringify(s4.tab)}`);
    // the lounge row says what each mode shows on the wall, in the words of the tab and of the popover
    if (!(s4.tab.loungeLabels === 'text:Text,names:Names only,off:Off' && /posts/.test(s4.tab.loungeHelp) && /who talks to whom/.test(s4.tab.loungeHelp) && /without the text/.test(s4.tab.loungeHelp) && /plain pavilion/.test(s4.tab.loungeHelp)))
      bad.push(`the lounge row's words: ${JSON.stringify({ labels: s4.tab.loungeLabels, help: s4.tab.loungeHelp })}`);
    if (!(s4.pop.lounge === 'text' && s4.pop.loungeOpts === 'text:Text,names:Names only,off:Off' && s4.pop.note === '')) bad.push(`the popover's lounge select: ${JSON.stringify({ value: s4.pop.lounge, opts: s4.pop.loungeOpts, note: s4.pop.note })}`);
    notes.push(`rows ${s4.rows.join('/')}, camera row hidden in 3D, every source "Default" on a fresh profile, lounge ${s4.tab.lounge} (${s4.tab.loungeLabels})`);
    // the message board line follows /api/config
    const boardOf = async cfg => {
      await page.evaluate(cfg === undefined ? `delete window.__cfg` : `window.__cfg = ${JSON.stringify(cfg)}`);
      await page.evaluate(`location.hash = '#ofis'`); await sleep(250);
      await page.evaluate(`location.hash = '#settings'`); await sleep(600);
      return (await snap(page)).board;
    };
    const server = await (await fetch(S.base + 'api/config')).json();
    const b0 = await boardOf(undefined), b1 = await boardOf({ version: '1' }), b2 = await boardOf({ chat: { state: 'on' } }), b3 = await boardOf({ chat: { state: 'unsupported' } }), b4 = await boardOf({ chat: { state: 'weird' } }), b5 = await boardOf(null), b6 = await boardOf({ chat: { state: 'off' } });
    if (!(server.chat && server.chat.state === 'off')) bad.push(`/api/config has no chat.state "off": ${JSON.stringify(server.chat)}`);
    if (!(b0.shown && b0.state === 'off' && b0.text === 'Not enabled')) bad.push(`the board line from the real server: ${JSON.stringify(b0)}`);
    if (!(!b1.shown && !b4.shown && !b5.shown)) bad.push(`a server that says nothing shows a board line: ${JSON.stringify([b1, b4, b5])}`);
    if (!(b2.shown && b2.text === 'Connected' && b3.shown && b3.text === 'Unsupported' && b6.text === 'Not enabled')) bad.push(`board states: ${JSON.stringify([b2, b3, b6])}`);
    notes.push(`board line: server says ${JSON.stringify(server.chat)} -> "${b0.text}"; absent, null, unknown -> hidden; on -> "${b2.text}"; unsupported -> "${b3.text}"`);
    // a server started with a chat database says "on" (the line must not claim the board is off while it is being read), one pointed at a file it cannot read says "off"
    const sq = await import('node:sqlite').catch(() => null);
    if (!sq) notes.push('no node:sqlite in this Node: the bridge answer was not checked');
    else {
      const cdir = mkdtempSync(join(tmpdir(), 'cco-st-chat-'));
      let a = null, b = null, c = null;
      try {
        // a board with every table and column of the chat source's contract (docs/chat-source.md), and one that lacks most of it
        const dbFile = join(cdir, 'chat.db'), db = new sq.DatabaseSync(dbFile);
        db.exec('CREATE TABLE messages (seq INTEGER PRIMARY KEY, ts_ms INTEGER, channel TEXT, author TEXT, to_list TEXT, body TEXT, human INTEGER); CREATE TABLE agents (name TEXT, kind TEXT, last_seen_ms INTEGER); CREATE TABLE agent_keys (key TEXT, agent TEXT); CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT); INSERT INTO meta VALUES (\'schema_version\', \'2\')');
        db.close();
        const thin = join(cdir, 'thin.db'), db2 = new sq.DatabaseSync(thin);
        db2.exec('CREATE TABLE messages (seq INTEGER PRIMARY KEY, ts_ms INTEGER, channel TEXT, author TEXT, to_list TEXT, body TEXT); CREATE TABLE agent_keys (key TEXT, agent TEXT)');
        db2.close();
        a = await startServer(cdir, { CCO_CHAT_DB: dbFile });
        b = await startServer(cdir, { CCO_CHAT_DB: join(cdir, 'missing', 'chat.db') });
        c = await startServer(cdir, { CCO_CHAT_DB: thin });
        const get = async s => (await (await fetch(`http://127.0.0.1:${s.port}/api/config`)).json()).chat;
        const on = { chat: await get(a) }, off = { chat: await get(b) }, thinCfg = { chat: await get(c) };
        if (!(on.chat && on.chat.state === 'ok')) bad.push(`a server reading a chat database says ${JSON.stringify(on.chat)}, not ok`);
        if (!(off.chat && off.chat.state === 'off')) bad.push(`a server whose chat database cannot be read says ${JSON.stringify(off.chat)}, not off`);
        if (!(thinCfg.chat && thinCfg.chat.state === 'unsupported')) bad.push(`a server whose chat database lacks columns says ${JSON.stringify(thinCfg.chat)}, not unsupported`);
        notes.push(`/api/config with a chat database: ${JSON.stringify(on.chat)}; with a missing one: ${JSON.stringify(off.chat)}; with one lacking columns: ${JSON.stringify(thinCfg.chat)}`);
      } finally { if (a) a.stop(); if (b) b.stop(); if (c) c.stop(); rmSync(cdir, { recursive: true, force: true }); }
    }
    await S.shot('settings-open.png');
    // reduced motion: the page fades in 150 ms and nothing else moves
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await page.evaluate(`location.hash = '#ofis'`); await sleep(300);
    const red = await page.evaluate(`(() => { location.hash = '#settings'; return new Promise(r => setTimeout(() => r(JSON.stringify(document.querySelector('#view-settings .st').getAnimations().map(x => ({ d: x.effect.getTiming().duration, props: [...new Set(x.effect.getKeyframes().flatMap(k => Object.keys(k)))].filter(p => !['offset', 'easing', 'composite', 'computedOffset'].includes(p)) })))), 30)); })()`).then(JSON.parse);
    if (!(red.length === 1 && same(red[0].props, ['opacity']) && Math.abs(red[0].d - 150) < 1)) bad.push(`the fade under reduced motion: ${JSON.stringify(red)}`);
    notes.push(`reduced motion: ${JSON.stringify(red)}`);
    await page.send('Emulation.setEmulatedMedia', { features: [] });
    const errs = S.problems();
    check('open', bad.length === 0 && errs.length === 0, `${bad.length ? 'PROBLEMS ' + bad.join('; ') + ' | ' : ''}${notes.join(' | ')}; console errors ${errs.length}${errs.length ? ' ' + errs.slice(0, 2).join(' / ') : ''}`);
  });
}

// ============================================================================ store
if (want('store')) {
  await part('store', {}, async S => {
    const { page } = S, bad = [], notes = [];
    await page.evaluate(`localStorage.clear()`);
    await S.load('?scene=3d', '#settings');
    await page.evaluate(MARK);
    const mark = (await snap(page)).mark;
    const envOf = () => page.evaluate(o3('({ atm: v.__office.atmosphere.state, env: s.env })')).then(r => r);
    // 1. every row changed in the tab: the popover (open or not), the 3D scene's store and atmosphere, storage
    await click(page, '#st-time-mode button[data-v="fixed"]'); await sleep(250);
    await range(page, '#st-time', 1320); await sleep(300);
    await sel(page, '#st-season', 'winter'); await sel(page, '#st-hemisphere', 'south'); await sel(page, '#st-weather', 'rain'); await sel(page, '#st-shelf', '20');
    await click(page, '#st-lounge button[data-v="names"]'); await sleep(200);
    await click(page, '.st-toggle span'); await sleep(500);
    const a = await snap(page);
    const E = { time: '22:00', season: 'winter', hemisphere: 'south', weather: 'rain', shelf: 20, project: 'on', lounge: 'names' };
    const inStore = k => a.store[k] === E[k];
    if (!(Object.keys(E).every(inStore) && a.engine === '3d')) bad.push(`3D store after the tab's changes: ${JSON.stringify(a.store)}`);
    if (!(a.pop.season === 'winter' && a.pop.hemi === 'south' && a.pop.weather === 'rain' && a.pop.shelf === '20' && a.pop.lounge === 'names' && a.pop.project === true && a.pop.timeMode === 'fixed' && a.pop.sliderOut === '22:00')) bad.push(`the popover did not follow the tab at once: ${JSON.stringify(a.pop)}`);
    // a screen reader says the clock time for the slider (aria-valuetext), not the minutes after midnight that the slider's value counts, in the tab and in the popover
    if (!(a.tab.sliderText === '22:00' && a.tab.sliderText === a.tab.sliderOut && a.pop.sliderText === '22:00' && a.pop.sliderText === a.pop.sliderOut)) bad.push(`the time slider says ${JSON.stringify({ tab: a.tab.sliderText, tabOut: a.tab.sliderOut, pop: a.pop.sliderText, popOut: a.pop.sliderOut })} to a screen reader, not 22:00`);
    const st = stored(a.stored);
    if (!(st && Object.keys(E).every(k => st[k] === E[k]) && !('scene' in st))) bad.push(`stored: ${a.stored}`);
    if (!(a.tab.sample === 'true' && a.tab.project === true && a.src.season.from === 'stored' && a.src.project.text === 'Saved in this browser' && a.mark === mark)) bad.push(`the tab itself: ${JSON.stringify({ tab: a.tab, src: a.src.season, mark: a.mark })}`);
    // (the scene is not drawing while the Settings page is up, so what it can show now is what its atmosphere and its environment have been told)
    const sc = await waitFor(async () => { const r = await envOf(); return r.atm.season === 'winter' && r.atm.weather === 'rain' && r.atm.minute === 1320 && r.atm.hemisphere === 'south' && r.env.season === 'winter' && r.env.weather === 'rain' && r.env.minute === 1320 ? r : null; }, 20000);
    if (!sc) bad.push(`the 3D scene did not follow: ${JSON.stringify(await envOf())}`);
    notes.push(`tab -> store ${JSON.stringify(a.store)}, popover ${a.pop.season}/${a.pop.hemi}/${a.pop.weather}/${a.pop.shelf}/project ${a.pop.project}/lounge ${a.pop.lounge}/${a.pop.timeMode} ${a.pop.sliderOut}, stored ${a.stored}, scene atmosphere ${sc ? sc.atm.season + ' ' + sc.atm.weather + ' ' + sc.atm.minute : 'not followed'}`);
    // 2. the popover shows the same when it is opened, and a change there reaches the tab at once (before the tab is looked at)
    await click(page, '#tab-ofis'); await sleep(500);
    const openedPop = await click(page, '#set-btn'); await sleep(300);
    const b = await snap(page);
    if (!(openedPop && b.pop.open && b.pop.wrapShown && b.pop.season === 'winter' && b.pop.project === true && same(b.pop.rows, ['time', 'season', 'hemisphere', 'weather', 'shelf', 'project', 'lounge']))) bad.push(`the popover on the Office view: ${JSON.stringify(b.pop)}`);
    await sel(page, '#set-season', 'autumn'); await sel(page, '#set-weather', 'snow'); await sel(page, '#set-hemisphere', 'north'); await sel(page, '#set-shelf', '5'); await sel(page, '#set-lounge', 'off');
    await click(page, '#set-pop .toggle span'); await sleep(400);                       // the project switch of the popover: off again
    const built = await waitFor(async () => { const r = await envOf(); return r.env.builtSeason === 'autumn' && r.atm.season === 'autumn' && r.atm.weather === 'snow' ? r : null; }, 40000);     // the scene is drawing now: it rebuilds for the new season
    if (!built) bad.push(`the visible 3D scene did not follow the popover: ${JSON.stringify(await envOf())}`);
    await range(page, '#set-time', 435); await sleep(300);                                // the popover's own slider: 07:15, which the tab's slider and both clock texts must say too
    const c = await snap(page);                                                           // still on the Office view: the tab is hidden, its controls are not stale
    if (!(c.pop.sliderText === '07:15' && c.pop.sliderOut === '07:15' && c.tab.sliderText === '07:15' && c.tab.slider === '435' && c.store.time === '07:15')) bad.push(`the popover's slider: ${JSON.stringify({ pop: c.pop.sliderText, popOut: c.pop.sliderOut, tab: c.tab.sliderText, tabSlider: c.tab.slider, store: c.store.time })}`);
    if (!(c.tab.season === 'autumn' && c.tab.weather === 'snow' && c.tab.hemi === 'north' && c.tab.lounge === 'off' && c.tab.shelf === '5' && c.tab.project === false && c.tab.sample === 'false')) bad.push(`the tab did not follow the popover at once: ${JSON.stringify(c.tab)}`);
    await click(page, '#tab-settings'); await sleep(500);
    const d = await snap(page);
    if (!(d.shown.settings && d.tab.season === 'autumn' && d.tab.project === false && d.tab.lounge === 'off' && d.store.lounge === 'off' && stored(d.stored).lounge === 'off' && d.src.lounge.from === 'stored' && d.src.lounge.text === 'Saved in this browser' && d.src.season.from === 'stored' && d.store.season === 'autumn' && d.store.project === 'off' && d.mark === mark && stored(d.stored).season === 'autumn' && stored(d.stored).project === 'off')) bad.push(`after the popover's changes, on the tab: ${JSON.stringify({ tab: d.tab, store: d.store })}`);
    notes.push(`popover -> tab at once: ${c.tab.season}/${c.tab.weather}/${c.tab.hemi}/shelf ${c.tab.shelf}/project ${c.tab.project}; the page was never reloaded (mark kept ${d.mark === mark})`);
    // 3. a size from the address is offered while it is current; the address follows the control and is not stored by loading
    await S.load('?scene=3d&season=spring&shelf=7', '#settings');
    const e = await snap(page);
    if (!(e.tab.season === 'spring' && e.src.season.from === 'url' && e.src.season.text === 'From the address: ?season=spring' && e.src.shelf.text === 'From the address: ?shelf=7' && e.tab.shelfOpts === '5,7,10,20,50' && e.tab.shelf === '7' && e.src.weather.from === 'stored' && stored(e.stored).season === 'autumn'))
      bad.push(`an address that names settings: ${JSON.stringify({ tab: e.tab, src: e.src })} stored ${e.stored}`);
    await sel(page, '#st-season', 'summer'); await sleep(300);
    const f = await snap(page);
    if (!(/season=summer/.test(f.search) && /scene=3d/.test(f.search) && stored(f.stored).season === 'summer' && f.src.season.from === 'url' && f.store.season === 'summer')) bad.push(`the address did not follow the control: ${f.search} stored ${f.stored}`);
    await S.load('?scene=3d', '#settings');
    const g = await snap(page);
    if (!(g.tab.season === 'summer' && g.src.season.from === 'stored' && g.tab.shelf === '5' && g.tab.shelfOpts === '5,10,20,50')) bad.push(`a plain address again: ${JSON.stringify(g.tab)} ${JSON.stringify(g.src.season)}`);
    notes.push(`?season=spring&shelf=7 -> tab ${e.tab.season}/${e.tab.shelf} "${e.src.season.text}", choosing summer -> ${f.search}, plain address -> ${g.tab.season} (${g.src.season.text})`);
    const errs = S.problems();
    check('store', bad.length === 0 && errs.length === 0 && offsite(S.requests).length === 0, `${bad.length ? 'PROBLEMS ' + bad.join('; ') + ' | ' : ''}${notes.join(' | ')}; console errors ${errs.length}${errs.length ? ' ' + errs.slice(0, 2).join(' / ') : ''}; requests off localhost ${offsite(S.requests).length}`);
  });
}

// ============================================================================ scene
if (want('scene')) {
  await part('scene', {}, async S => {
    const { page } = S, bad = [], notes = [];
    await page.evaluate(`localStorage.clear()`);
    await S.load('', '#settings');                                                      // no ?scene=: the stored choice, else 3d
    await page.evaluate(MARK);
    const mark = (await snap(page)).mark;
    const a = await snap(page);
    if (!(a.engine === '3d' && a.dataScene === '3d' && a.tab.scene === '3d' && a.src.scene.from === 'default' && !a.tab.pending && a.src.camera === null && !a.rows.includes('camera') && a.rows.includes('lounge') && a.src.lounge && a.src.lounge.from === 'default')) bad.push(`fresh: ${JSON.stringify({ engine: a.engine, tab: a.tab, src: a.src.scene, rows: a.rows })}`);
    // choose Pixel: kept, the 3D scene keeps running, the page says it takes effect at the next load
    await click(page, '#st-scene button[data-v="pixel"]'); await sleep(400);
    const b = await snap(page);
    if (!(stored(b.stored) && stored(b.stored).scene === 'pixel' && b.tab.scene === 'pixel' && b.tab.pending && b.engine === '3d' && b.dataScene === '3d' && b.mark === mark && b.src.scene.from === 'stored' && b.search === ''))
      bad.push(`after Pixel was chosen: ${JSON.stringify({ stored: b.stored, tab: b.tab, engine: b.engine, mark: b.mark === mark, src: b.src.scene, search: b.search })}`);
    const pendingText = await page.evaluate(`document.querySelector('.st-pending').textContent.replace(/\\s+/g, ' ').trim()`);
    if (!/switches when the page loads again/.test(pendingText) || !/Reload now/.test(pendingText)) bad.push(`the pending note: ${pendingText}`);
    await S.shot('settings-scene-pending.png');
    // Reload now: the pixel scene starts, the tab says Pixel, the camera row exists
    await click(page, '#st-reload');
    const up = await waitFor(() => page.evaluate(`!!document.querySelector('#view-ofis') && !!document.querySelector('#view-ofis').__pixel && !!document.querySelector('#view-settings .st') && window.__qaMark === undefined`).catch(() => false), 60000);
    await sleep(500);
    const c = await snap(page);
    if (!(up && c.engine === 'pixel' && c.dataScene === 'pixel' && c.tab.scene === 'pixel' && !c.tab.pending && c.src.scene.from === 'stored' && c.rows.includes('camera') && c.src.camera && c.src.camera.from === 'default' && same(c.tab.camera, 'iso') && c.hash === '#settings'))
      bad.push(`after Reload now: ${JSON.stringify({ up, engine: c.engine, tab: c.tab, rows: c.rows, camera: c.src.camera, hash: c.hash })}`);
    // the pixel scene has no lounge: no row on the page, none in the popover, and the camera that the 3D scene lacks is there
    await click(page, '#tab-ofis'); await sleep(600); await click(page, '#set-btn'); await sleep(300);
    const cp = await snap(page);
    const pixelRows = ['camera', 'time', 'season', 'hemisphere', 'weather', 'shelf', 'project'];
    if (!(!c.rows.includes('lounge') && c.src.lounge === null && cp.pop.open && same(cp.pop.rows, pixelRows))) bad.push(`the pixel scene has a lounge row: page ${c.rows.join('/')}, popover ${cp.pop.rows.join('/')} (want ${pixelRows.join('/')})`);
    notes.push(`pixel scene rows: page ${c.rows.join('/')}, popover ${cp.pop.rows.join('/')} (no lounge)`);
    await click(page, '#set-btn'); await sleep(200); await click(page, '#tab-settings'); await sleep(500);
    // the camera row works and says where it comes from; the scene store is the pixel scene's
    await click(page, '#st-camera button[data-proj="front"]'); await sleep(900);
    const d = await snap(page);
    if (!(d.tab.camera === 'front' && d.src.camera.from === 'stored' && await page.evaluate(`document.querySelector('#view-ofis').__pixel.proj`) === 'front')) bad.push(`the camera row: ${JSON.stringify({ camera: d.tab.camera, src: d.src.camera })}`);
    await click(page, '#st-camera button[data-proj="iso"]'); await sleep(600);
    // the address wins over the stored choice and is not stored
    await S.load('?scene=3d', '#settings');
    const e = await snap(page);
    if (!(e.engine === '3d' && e.tab.scene === '3d' && e.src.scene.from === 'url' && e.src.scene.text === 'From the address: ?scene=3d' && stored(e.stored).scene === 'pixel' && !e.rows.includes('camera') && !e.tab.pending))
      bad.push(`?scene=3d over a stored pixel: ${JSON.stringify({ engine: e.engine, tab: e.tab, src: e.src.scene, stored: e.stored })}`);
    // choosing the other scene with the address naming one: the address follows, the choice is kept, the page waits for the next load
    await click(page, '#st-scene button[data-v="pixel"]'); await sleep(300);
    const f = await snap(page);
    if (!(/scene=pixel/.test(f.search) && f.tab.scene === 'pixel' && f.tab.pending && f.engine === '3d' && stored(f.stored).scene === 'pixel')) bad.push(`pixel chosen with ?scene=3d in the address: ${JSON.stringify({ search: f.search, tab: f.tab, stored: f.stored })}`);
    // ?scene=pixel on a stored 3d: the address wins, and a choice of 3D is kept and waits
    await page.evaluate(`localStorage.setItem('ajan-ofisi.settings', JSON.stringify({ scene: '3d' })); localStorage.removeItem('ajan-ofisi.proj')`);
    await S.load('?scene=pixel', '#settings', 'pixel');
    const g = await snap(page);
    if (!(g.engine === 'pixel' && g.tab.scene === 'pixel' && g.src.scene.from === 'url' && stored(g.stored).scene === '3d' && g.rows.includes('camera') && g.src.camera.from === 'default')) bad.push(`?scene=pixel over a stored 3d: ${JSON.stringify({ engine: g.engine, tab: g.tab, src: g.src.scene, stored: g.stored })}`);
    await click(page, '#st-scene button[data-v="3d"]'); await sleep(300);
    const h = await snap(page);
    if (!(/scene=3d/.test(h.search) && h.tab.scene === '3d' && h.tab.pending && h.engine === 'pixel' && stored(h.stored).scene === '3d')) bad.push(`3D chosen in the pixel scene: ${JSON.stringify({ search: h.search, tab: h.tab })}`);
    await S.shot('settings-pixel.png');
    await click(page, '#st-reload');
    const back = await waitFor(() => page.evaluate(`!!document.querySelector('#view-ofis') && !!document.querySelector('#view-ofis').__office && !!document.querySelector('#view-settings .st')`).catch(() => false), 60000);
    const i = await snap(page);
    if (!(back && i.engine === '3d' && i.tab.scene === '3d' && !i.tab.pending)) bad.push(`3D again after a reload: ${JSON.stringify({ engine: i.engine, tab: i.tab })}`);
    // a browser that does not keep settings (writes throw, or window.localStorage itself throws): nothing is called saved, the change holds for this visit, and the page does not
    // promise a scene switch at the next load that cannot happen (window.name carries the flag across the reloads of this tab, the script runs before the page's own)
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      if (window.name === 'qa-nowrite') Storage.prototype.setItem = function () { throw new DOMException('full', 'QuotaExceededError'); };
      if (window.name === 'qa-nostorage') Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError'); } });
    })()` });
    const refused = [];
    for (const mode of ['qa-nowrite', 'qa-nostorage']) {
      await page.evaluate(`localStorage.clear(); window.name = ${JSON.stringify(mode)}`);
      await S.load('', '#settings');
      await click(page, '#st-scene button[data-v="pixel"]');
      await sel(page, '#st-season', 'winter');
      const u = await waitFor(async () => { const r = await snap(page); return r.src.season && r.src.season.from !== 'default' && r.src.scene && r.src.scene.from !== 'default' ? r : null; }, 15000) || await snap(page);       // a busy machine: wait for the page to answer, not a fixed time
      const text = await page.evaluate(`(() => { const p = document.querySelector('.st-pending'); const r = document.querySelector('#st-reload'); return { text: p.textContent.replace(/\\s+/g, ' ').trim(), reloadShown: r.getClientRects().length > 0 }; })()`);
      refused.push(`${mode}: scene tag "${u.src.scene && u.src.scene.text}", season tag "${u.src.season && u.src.season.text}", note "${text.text}"`);
      if (!(u.src.scene && u.src.scene.from === 'visit' && u.src.scene.text === 'This visit only' && u.tab.pending && /^Not kept/.test(text.text) && !/Saved/.test(text.text) && !text.reloadShown && u.engine === '3d')) bad.push(`${mode}: the scene row ${JSON.stringify({ src: u.src.scene, pending: u.tab.pending, text, engine: u.engine })}`);
      if (!(u.src.season && u.src.season.from === 'visit' && u.src.season.text === 'This visit only' && u.tab.season === 'winter' && u.store.season === 'winter' && (mode === 'qa-nowrite' ? u.stored === null : u.stored === 'THROWS'))) bad.push(`${mode}: the season row ${JSON.stringify({ src: u.src.season, season: u.tab.season, store: u.store && u.store.season, stored: u.stored })}`);
    }
    await page.evaluate(`window.name = ''`);
    notes.push(`a browser that keeps nothing: ${refused.join(' | ')}`);
    notes.push(`fresh ${a.engine}/${a.src.scene.text}; Pixel chosen -> stored ${stored(b.stored).scene}, still ${b.engine}, note "${pendingText}"; reload -> ${c.engine}, camera row ${c.rows.includes('camera')} (${c.src.camera && c.src.camera.text}); front -> ${d.tab.camera} (${d.src.camera.text}); ?scene=3d over stored pixel -> ${e.engine} "${e.src.scene.text}", store kept ${stored(e.stored).scene}; ?scene=pixel over stored 3d -> ${g.engine}, store kept ${stored(g.stored).scene}; 3D chosen there -> ${h.search}, reload -> ${i.engine}`);
    const errs = S.problems();
    check('scene', bad.length === 0 && errs.length === 0 && offsite(S.requests).length === 0, `${bad.length ? 'PROBLEMS ' + bad.join('; ') + ' | ' : ''}${notes.join(' | ')}; console errors ${errs.length}${errs.length ? ' ' + errs.slice(0, 2).join(' / ') : ''}; requests off localhost ${offsite(S.requests).length}`);
  });
}

// ============================================================================ project
// The corner of a 3D plaque, read from its canvas: white pixels in the strip where the small project line goes (the same region as office-board-qa.mjs)
const CORNER = id => `(() => {
  const cv = document.querySelector('#view-ofis').__ofisSigns.get(${JSON.stringify(id)});
  const w = cv.width, h = cv.height, d = cv.getContext('2d').getImageData(0, 0, w, h).data, right = w - h * 0.14;
  let n = 0, total = 0;
  for (let y = Math.floor(h * 0.8); y < Math.floor(h * 0.95); y++) for (let x = Math.floor(w * 0.45); x < Math.min(w, Math.floor(right + 4)); x++) { total++; const i = (y * w + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2]; if (0.2126 * r + 0.7152 * g + 0.0722 * b > 165 && Math.max(r, g, b) - Math.min(r, g, b) < 45) n++; }
  return { n, painted: total > 0 };
})()`;
if (want('project')) {
  await part('project', {}, async S => {
    const { page } = S, bad = [], notes = [];
    await page.evaluate(`localStorage.clear()`);
    await S.load('?scene=3d', '#ofis');                                                  // the rooms and their plaques are built while the Office is on screen; the tab is used after that
    const room = await waitFor(() => page.evaluate(o3('s && s.rooms.length ? s.rooms[0].id : null')).catch(() => null), 40000);
    await sleep(900);
    await click(page, '#tab-settings'); await sleep(500);
    await page.evaluate(MARK);
    const corner = async () => { for (let i = 0; i < 40; i++) { const r = await page.evaluate(CORNER(room)).catch(() => null); if (r && r.painted) { await sleep(300); return (await page.evaluate(CORNER(room))).n; } await sleep(300); } return -1; };
    const sample = () => page.evaluate(`(() => { const p = document.querySelector('.st-sample-proj'), s = document.querySelector('.st-sample'); return JSON.stringify({ op: +getComputedStyle(p).opacity, h: Math.round(s.getBoundingClientRect().height * 10) / 10, y: s.offsetTop, on: s.dataset.on, text: p.textContent }); })()`).then(JSON.parse);
    const html = () => page.evaluate(`(() => [...document.querySelectorAll('#view-ofis .of-signl')].map(e => !!e.querySelector('.of-sp')))()`);
    const c0 = await corner(), s0 = await sample(), h0 = await html();
    await click(page, '.st-toggle span'); await sleep(700);                          // the switch on the tab
    const c1 = await corner(), s1 = await sample(), h1 = await html(), a = await snap(page);
    await S.shot('settings-project-on.png');
    await click(page, '.st-toggle span'); await sleep(700);                          // off again
    const c2 = await corner(), s2 = await sample();
    // live, in one turn of the page: the store changes and the plaque is painted again before anything else runs (no frame, no tick of the server needed)
    const live = await page.evaluate(`(() => { const st = document.querySelector('#view-ofis').__office.settings; st.set('project', 'on'); const on = ${CORNER(room)}.n; st.set('project', 'off'); const off = ${CORNER(room)}.n; return { on, off }; })()`);
    if (!(live.on >= 30 && live.off === 0)) bad.push(`3D: the plaque is not painted again as the setting changes (on ${live.on}, off ${live.off})`);
    await click(page, '#tab-ofis'); await sleep(500); await click(page, '#set-btn'); await sleep(250);
    await click(page, '#set-pop .toggle span'); await sleep(700);                    // the switch of the popover
    const c3 = await corner(), b = await snap(page);
    if (!(c0 === 0)) bad.push(`3D: project pixels by default (${c0})`);
    if (!(c1 >= 30)) bad.push(`3D: the tab's switch shows no project on the plaque (${c1})`);
    if (!(c2 === 0)) bad.push(`3D: off again still shows it (${c2})`);
    if (!(c3 >= 30 && b.pop.project === true && b.tab.project === true && b.store.project === 'on')) bad.push(`3D: the popover's switch (${c3}) ${JSON.stringify({ pop: b.pop.project, tab: b.tab.project, store: b.store.project })}`);
    if (!(h0.every(x => !x) && h1.some(x => x) )) bad.push(`3D: the HTML signs below the zoom limit: default ${JSON.stringify(h0)}, on ${JSON.stringify(h1)}`);
    if (!(s0.on === 'false' && s0.op === 0 && s1.on === 'true' && s1.op === 1 && s2.on === 'false' && s2.op === 0 && s0.h === s1.h && s0.y === s1.y)) bad.push(`the sample: ${JSON.stringify([s0, s1, s2])}`);
    if (!(a.mark === b.mark && b.mark !== null)) bad.push('the page reloaded');
    notes.push(`3D plaque corner ink: default ${c0}, tab switch on ${c1}, off ${c2}, popover switch on ${c3}, painted in the same turn as the store changes on ${live.on} off ${live.off}; HTML signs with the project line: default ${h0.filter(Boolean).length}, on ${h1.filter(Boolean).length} of ${h1.length}; sample opacity ${s0.op} -> ${s1.op} -> ${s2.op}, its box unchanged (${s0.h} px high at ${s0.y})`);
    const errs = S.problems();
    check('project', bad.length === 0 && errs.length === 0, `${bad.length ? 'PROBLEMS ' + bad.join('; ') + ' | ' : ''}${notes.join(' | ')}; console errors ${errs.length}${errs.length ? ' ' + errs.slice(0, 2).join(' / ') : ''}`);
  });
  // the pixel scene: the tab's switch draws the project folder on every board
  await part('projectpx', {}, async S => {
    const { page } = S, bad = [], notes = [];
    await page.evaluate(`localStorage.clear()`);
    await S.load('?scene=pixel&proj=iso', '#settings', 'pixel');
    const figures = await waitFor(() => page.evaluate(`(() => { const p = document.querySelector('#view-ofis').__pixel; return p && p.figures ? p.figures().length : 0; })()`), 40000);
    const lines = () => page.evaluate(`document.querySelectorAll('.px-board .pb-proj').length`);
    const boards = () => page.evaluate(`document.querySelectorAll('.px-board').length`);
    await click(page, '#tab-ofis'); await sleep(900);
    const l0 = await lines(), n0 = await boards();
    await click(page, '#tab-settings'); await sleep(400);
    await click(page, '.st-toggle span'); await sleep(500);
    await click(page, '#tab-ofis'); await sleep(900);
    const l1 = await lines(), a = await snap(page);
    await click(page, '#set-btn'); await sleep(250);
    const b = await snap(page);
    await click(page, '#set-pop .toggle span'); await sleep(600);
    const l2 = await lines();
    await click(page, '#tab-settings'); await sleep(400);
    const c = await snap(page);
    if (!(n0 > 0 && l0 === 0)) bad.push(`pixel: project lines by default (${l0} of ${n0} boards)`);
    if (!(l1 === n0 && a.store.project === 'on' && a.engine === 'pixel')) bad.push(`pixel: the tab's switch gave ${l1} project lines for ${n0} boards (store ${a.store.project})`);
    if (!(b.pop.project === true)) bad.push(`pixel: the popover's switch does not show the tab's choice: ${b.pop.project}`);
    if (!(l2 === 0 && c.tab.project === false && c.store.project === 'off')) bad.push(`pixel: the popover's switch gave ${l2} lines, the tab shows ${c.tab.project}`);
    notes.push(`pixel boards ${n0}: project lines default ${l0}, after the tab's switch ${l1}, after the popover's switch ${l2}; popover switch ${b.pop.project} after the tab's`);
    const errs = S.problems();
    check('project-pixel', bad.length === 0 && errs.length === 0, `${bad.length ? 'PROBLEMS ' + bad.join('; ') + ' | ' : ''}${notes.join(' | ')}; console errors ${errs.length}${errs.length ? ' ' + errs.slice(0, 2).join(' / ') : ''}`);
  });
}

// ============================================================================ lounge
// What the lounge shows, from the scene's own state (`o.lounge`, the snapshot of ofis-lounge.js). The demo conversation of ?lounge=demo gives the wall something to show without a server.
const LOUNGE_LINES = DEMO_SCRIPT.flatMap(e => splitLines(clipChars(e[4], LIMITS.wallText)));          // every line of text that the demo script can put on the wall
const hasText = x => x.wall.some(r => r.lines.length > 0);
if (want('lounge')) {
  await part('lounge', {}, async S => {
    const { page } = S, bad = [], notes = [];
    const lsnap = () => page.evaluate(o3('o.lounge'));
    const until = async (test, ms = 30000) => { const t0 = Date.now(); let r = null; while (Date.now() - t0 < ms) { r = await lsnap().catch(() => null); if (r && test(r)) return r; await sleep(250); } return null; };
    const shows = x => x.mode === 'text' && x.state === 'ok' && hasText(x) && x.paint.texts.some(t => LOUNGE_LINES.includes(t)) && x.people.length >= 2;
    await page.evaluate(`localStorage.clear()`);
    await S.load('?scene=3d&lounge=demo', '#ofis');
    await page.evaluate(MARK);
    const mark = (await snap(page)).mark;
    const built = await waitFor(() => page.evaluate(o3('!!(o && s && s.rooms.length && o.office().lounge)')).catch(() => false), 60000);
    if (!built) bad.push('the 3D scene did not build a lounge');
    const cell = await page.evaluate(o3('o.office().lounge'));
    await page.evaluate(o3(`o.view(${cell.X + cell.W / 2}, 0.5, ${cell.Z + cell.D / 2}, 60)`));          // the plaza on the screen: the lounge is read and polled only while it is
    const t0 = await until(shows, 60000);
    if (!t0) bad.push(`the demo lounge shows nothing to start from: ${JSON.stringify(await lsnap().then(x => ({ mode: x.mode, state: x.state, rows: x.wall.length, people: x.people.length, onScreen: x.onScreen })).catch(() => null))}`);
    // 1. the popover (Office view): the row is there, the demo address says so, and Names only reaches the wall at once, with no reload
    await click(page, '#set-btn'); await sleep(300);
    const p0 = await snap(page);
    if (!(p0.pop.open && p0.pop.rows.includes('lounge') && p0.pop.lounge === 'text' && p0.pop.note === 'The address shows the demo conversation.')) bad.push(`the popover with ?lounge=demo: ${JSON.stringify({ open: p0.pop.open, rows: p0.pop.rows, lounge: p0.pop.lounge, note: p0.pop.note })}`);
    await sel(page, '#set-lounge', 'names');
    const nm = await until(x => x.mode === 'names' && x.state === 'ok' && x.wall.length > 0 && !hasText(x) && x.paint.texts.length > 0 && !x.paint.texts.some(t => LOUNGE_LINES.includes(t)));
    if (!nm) bad.push(`Names only from the popover did not reach the wall: ${JSON.stringify(await lsnap().then(x => ({ mode: x.mode, rows: x.wall.length, text: hasText(x), texts: x.paint.texts.slice(0, 4) })))}`);
    const a1 = await snap(page);
    if (!(a1.store.lounge === 'names' && stored(a1.stored).lounge === 'names' && a1.tab.lounge === 'names' && a1.pop.lounge === 'names' && /lounge=demo%2Cnames/.test(a1.search) && a1.mark === mark)) bad.push(`after Names only in the popover: ${JSON.stringify({ store: a1.store.lounge, stored: a1.stored, tab: a1.tab.lounge, pop: a1.pop.lounge, search: a1.search, kept: a1.mark === mark })}`);
    await S.shot('settings-lounge-names.png');
    // 2. the Settings tab: it shows the choice, says where it comes from and that the demo plays; Off here reaches the lounge while the Office view is hidden, and shows when it comes back
    await click(page, '#tab-settings'); await sleep(600);
    const t1 = await snap(page);
    if (!(t1.shown.settings && t1.tab.lounge === 'names' && t1.src.lounge && t1.src.lounge.from === 'url' && t1.src.lounge.text === 'From the address: ?lounge=demo,names' && t1.tab.loungeNote === 'The address shows the demo conversation.')) bad.push(`the tab with ?lounge=demo,names: ${JSON.stringify({ lounge: t1.tab.lounge, src: t1.src.lounge, note: t1.tab.loungeNote })}`);
    await page.evaluate(`document.querySelector('#view-settings [data-row="lounge"]').scrollIntoView({ block: 'center' })`); await sleep(200);
    await S.shot('settings-lounge-demo.png');
    await click(page, '#st-lounge button[data-v="off"]'); await sleep(400);
    const t2 = await snap(page);
    if (!(t2.tab.lounge === 'off' && t2.pop.lounge === 'off' && t2.store.lounge === 'off' && stored(t2.stored).lounge === 'off' && /lounge=demo%2Coff/.test(t2.search) && t2.src.lounge.text === 'From the address: ?lounge=demo,off' && t2.mark === mark)) bad.push(`after Off in the tab: ${JSON.stringify({ tab: t2.tab.lounge, pop: t2.pop.lounge, store: t2.store.lounge, stored: t2.stored, search: t2.search, src: t2.src.lounge, kept: t2.mark === mark })}`);
    await click(page, '#tab-ofis'); await sleep(500);
    const off = await until(x => x.mode === 'off' && x.people.length === 0 && x.paint.texts.length === 0 && !(x.signLabel && x.signLabel.want));
    if (!off) bad.push(`Off from the tab did not reach the lounge: ${JSON.stringify(await lsnap().then(x => ({ mode: x.mode, people: x.people.length, texts: x.paint.texts.length, sign: x.signLabel && x.signLabel.want })))}`);
    // 3. the popover again, from Off to Text: the wall, the people and the poll come back
    await click(page, '#set-btn'); await sleep(300);
    const p2 = await snap(page);
    if (!(p2.pop.open && p2.pop.lounge === 'off' && p2.pop.note === 'The address shows the demo conversation.')) bad.push(`the popover after Off in the tab: ${JSON.stringify({ lounge: p2.pop.lounge, note: p2.pop.note })}`);
    await sel(page, '#set-lounge', 'text');
    const back = await until(shows);
    if (!back) bad.push(`Text from the popover did not bring the lounge back: ${JSON.stringify(await lsnap().then(x => ({ mode: x.mode, state: x.state, rows: x.wall.length, people: x.people.length })))}`);
    const p3 = await snap(page);
    if (!(p3.tab.lounge === 'text' && p3.store.lounge === 'text' && stored(p3.stored).lounge === 'text' && /lounge=demo%2Ctext/.test(p3.search) && p3.mark === mark)) bad.push(`after Text in the popover: ${JSON.stringify({ tab: p3.tab.lounge, store: p3.store.lounge, stored: p3.stored, search: p3.search, kept: p3.mark === mark })}`);
    notes.push(`demo wall ${t0 ? t0.wall.length : 0} rows and ${t0 ? t0.people.length : 0} people -> popover Names only: ${nm ? nm.wall.length + ' rows without text' : 'not reached'} (address ${a1.search}) -> tab Off while the Office was hidden: ${off ? 'no people, no text' : 'not reached'} -> popover Text: ${back ? back.wall.length + ' rows with text, ' + back.people.length + ' people' : 'not reached'}; the page was never reloaded (mark kept ${p3.mark === mark})`);
    // 3b. the lounge's own subscription to the setting (ofis-lounge.js `settings.on('lounge', ...)`). The waits above cannot prove it: the lounge's frame loop notices a mode that changed within a
    // frame, and its view is made again every second, whether or not it heard of the change. So this reads the lounge in the very task that makes the change, with no frame and no timer in between:
    // Off closes an open card and clears the poll timer at once (the poll is not merely idle), and Text arms the timer at once; then a request starts within one cadence of Text, and none does after Off.
    const flip = to => page.evaluate(o3(`(() => {
      const read = () => { const l = o.lounge; return { mode: l.mode, card: l.card.open, armed: l.poll.armed, inflight: l.poll.inflight, can: l.poll.canPoll, requests: l.poll.requests, pollMs: l.poll.pollMs }; };
      const before = read(), pick = document.querySelector('#set-lounge');
      pick.value = ${JSON.stringify(to)}; pick.dispatchEvent(new Event('change', { bubbles: true }));
      return { before, after: read() };
    })()`));
    const at = c => page.evaluate(o3(`(() => { const a = v.querySelector('.of-area').getBoundingClientRect(), p = s.project(${c.X + BOARD.cu}, ${BOARD.y0 + BOARD.h / 2}, ${c.Z + BOARD.cv}); return [a.left + p[0], a.top + p[1]]; })()`));
    const [wx, wy] = await at(cell);
    if ((await snap(page)).pop.open) { await click(page, '#set-btn'); await sleep(300); }          // the popover covers the wall: close it for the click, open it again for the choice
    await page.mouse.move(2, 2); await sleep(150); await page.mouse.move(wx, wy); await sleep(250);
    await page.mouse.click(wx, wy);
    const opened = await until(x => x.card.open && x.poll.canPoll && (x.poll.armed || x.poll.inflight), 6000);
    if (!opened) bad.push(`the card did not open from a click on the wall, or the poll was not running: ${JSON.stringify(await lsnap().then(x => ({ card: x.card.open, poll: x.poll })))} (clicked at ${Math.round(wx)},${Math.round(wy)}, under the pointer: ${await page.evaluate(`(() => { const e = document.elementFromPoint(${wx}, ${wy}); return e ? e.tagName + '.' + String(e.className).slice(0, 40) + '#' + e.id : null; })()`)})`);
    else {
      await click(page, '#set-btn'); await sleep(300);
      const pp = await snap(page);
      if (!(pp.pop.open && pp.pop.lounge === 'text')) bad.push(`the popover did not open beside the open card: ${JSON.stringify({ open: pp.pop.open, lounge: pp.pop.lounge })}`);
      const f1 = await flip('off');
      if (!(f1.before.card && f1.before.armed && f1.after.mode === 'off' && !f1.after.card && !f1.after.armed && !f1.after.inflight && !f1.after.can)) bad.push(`Off in the same task (the card was open, the poll timer armed): ${JSON.stringify(f1)}`);
      await sleep(f1.after.pollMs + 1200);
      const quiet = await lsnap();
      if (!(quiet.poll.requests === f1.after.requests && !quiet.card.open && quiet.mode === 'off')) bad.push(`a request started or the card came back while the lounge was Off: ${JSON.stringify({ requests: [f1.after.requests, quiet.poll.requests], card: quiet.card.open, mode: quiet.mode })}`);
      const f2 = await flip('text');
      if (!(f2.before.mode === 'off' && !f2.before.armed && f2.after.mode === 'text' && f2.after.can && (f2.after.armed || f2.after.inflight) && !f2.after.card)) bad.push(`Text in the same task (the poll timer must be armed): ${JSON.stringify(f2)}`);
      const again = await until(x => x.mode === 'text' && x.poll.requests > f2.after.requests, f2.after.pollMs + 2000);
      if (!again) bad.push(`no request started within one poll cadence of Text: ${JSON.stringify(await lsnap().then(x => ({ requests: x.poll.requests, from: f2.after.requests, poll: x.poll })))}`);
      notes.push(`subscription: Off closed the open card and cleared the poll timer in the same task (armed ${f1.before.armed} -> ${f1.after.armed}, card ${f1.before.card} -> ${f1.after.card}), no request in ${f1.after.pollMs + 1200} ms; Text armed the timer in the same task (${f2.before.armed} -> ${f2.after.armed}) and a request started ${again ? 'within one cadence (' + (again.poll.requests - f2.after.requests) + ' since)' : 'never'}`);
    }
    // 4. without the demo: ?lounge=demo alone names no mode (a note, the tag stays Default, nothing stored); ?lounge=names is the address's word; a control changes the address and keeps the choice
    await page.evaluate(`localStorage.clear()`);
    await S.load('?scene=3d', '#settings');
    const d0 = await snap(page);
    if (!(d0.tab.lounge === 'text' && d0.src.lounge && d0.src.lounge.from === 'default' && d0.src.lounge.text === 'Default' && d0.tab.loungeNote === null && d0.pop.note === '' && d0.stored === null)) bad.push(`a plain address: ${JSON.stringify({ lounge: d0.tab.lounge, src: d0.src.lounge, note: d0.tab.loungeNote, stored: d0.stored })}`);
    await S.load('?scene=3d&lounge=demo', '#settings');
    const d1 = await snap(page);
    if (!(d1.tab.lounge === 'text' && d1.src.lounge.from === 'default' && d1.tab.loungeNote === 'The address shows the demo conversation.' && d1.stored === null)) bad.push(`?lounge=demo alone: ${JSON.stringify({ lounge: d1.tab.lounge, src: d1.src.lounge, note: d1.tab.loungeNote, stored: d1.stored })}`);
    await S.load('?scene=3d&lounge=names', '#settings');
    const n0 = await snap(page);
    if (!(n0.tab.lounge === 'names' && n0.src.lounge.from === 'url' && n0.src.lounge.text === 'From the address: ?lounge=names' && n0.tab.loungeNote === null && n0.stored === null && n0.store.lounge === 'names')) bad.push(`?lounge=names: ${JSON.stringify({ lounge: n0.tab.lounge, src: n0.src.lounge, note: n0.tab.loungeNote, stored: n0.stored })}`);
    await click(page, '#st-lounge button[data-v="off"]'); await sleep(400);
    const n1 = await snap(page);
    if (!(n1.tab.lounge === 'off' && /lounge=off/.test(n1.search) && !/demo/.test(n1.search) && stored(n1.stored).lounge === 'off' && n1.src.lounge.text === 'From the address: ?lounge=off')) bad.push(`Off with ?lounge=names in the address: ${JSON.stringify({ lounge: n1.tab.lounge, search: n1.search, stored: n1.stored, src: n1.src.lounge })}`);
    await S.load('?scene=3d', '#settings');
    const n2 = await snap(page);
    const live = await waitFor(() => page.evaluate(o3('o && o.lounge ? o.lounge.mode : null')).catch(() => null), 60000);
    if (!(n2.tab.lounge === 'off' && n2.src.lounge.from === 'stored' && n2.src.lounge.text === 'Saved in this browser' && n2.store.lounge === 'off' && n2.tab.loungeNote === null && live === 'off')) bad.push(`a plain address after Off was kept: ${JSON.stringify({ lounge: n2.tab.lounge, src: n2.src.lounge, store: n2.store.lounge, scene: live })}`);
    notes.push(`plain address: Default; ?lounge=demo alone: Default with the demo note, nothing stored; ?lounge=names: "${n0.src.lounge.text}", Off chosen -> ${n1.search} stored ${n1.stored}; plain address again: "${n2.src.lounge.text}", the lounge reads ${live}`);
    const errs = S.problems();
    check('lounge', bad.length === 0 && errs.length === 0 && offsite(S.requests).length === 0, `${bad.length ? 'PROBLEMS ' + bad.join('; ') + ' | ' : ''}${notes.join(' | ')}; console errors ${errs.length}${errs.length ? ' ' + errs.slice(0, 2).join(' / ') : ''}; requests off localhost ${offsite(S.requests).length}`);
  });
}

// ============================================================================ keys
if (want('keys')) {
  await part('keys', {}, async S => {
    const { page } = S, bad = [], notes = [];
    await page.evaluate(`localStorage.clear()`);
    await S.load('?scene=3d', '#settings');
    await page.evaluate(MARK);
    const active = () => page.evaluate(`(() => { const a = document.activeElement; return a ? { id: a.id || null, tag: a.tagName, view: a.dataset ? a.dataset.view || null : null, v: a.dataset ? a.dataset.v || a.dataset.proj || null : null } : null; })()`);
    const view = () => page.evaluate(`document.body.dataset.page`);
    // 1. one stop of the Tab key: the selected tab
    await page.evaluate(`document.activeElement && document.activeElement.blur()`);
    await press(page, 'Tab'); await sleep(150);
    const t1 = await active();
    if (t1.id !== 'tab-settings') bad.push(`the first Tab stop is ${JSON.stringify(t1)}, not the selected tab`);
    // 2. the arrows move between tabs and switch the view; Home and End; wrapping
    const seq = [];
    for (const k of ['ArrowLeft', 'ArrowLeft', 'Home', 'ArrowLeft', 'End', 'ArrowRight']) { await press(page, k); await sleep(200); seq.push([k, (await active()).view, await view()]); }
    const wantSeq = [['ArrowLeft', 'maliyet', 'maliyet'], ['ArrowLeft', 'akis', 'akis'], ['Home', 'pano', 'pano'], ['ArrowLeft', 'settings', 'settings'], ['End', 'settings', 'settings'], ['ArrowRight', 'pano', 'pano']];
    if (!same(seq, wantSeq)) bad.push(`arrow keys: ${JSON.stringify(seq)} (want ${JSON.stringify(wantSeq)})`);
    await press(page, 'End'); await sleep(250);
    const tabs = await page.evaluate(`[...document.querySelectorAll('.top [role=tab]')].map(b => [b.dataset.view, b.getAttribute('aria-selected'), b.tabIndex])`);
    if (!same(tabs.map(t => t[2]), [-1, -1, -1, -1, 0]) || tabs.filter(t => t[1] === 'true').length !== 1) bad.push(`roving tabindex: ${JSON.stringify(tabs)}`);
    // 3. Enter and Space on a focused tab (the button's own click); the number shortcuts, and none of them inside a select
    await press(page, 'ArrowLeft'); await sleep(200);
    await page.evaluate(`document.querySelector('#tab-ofis').focus()`); await press(page, 'Enter'); await sleep(300);
    const v1 = await view();
    await page.evaluate(`document.querySelector('#tab-maliyet').focus()`); await press(page, ' '); await sleep(300);
    const v2 = await view();
    await page.evaluate(`document.activeElement.blur()`); await press(page, '5'); await sleep(300);
    const v3 = await view();
    if (!(v1 === 'ofis' && v2 === 'maliyet' && v3 === 'settings')) bad.push(`Enter, Space, "5": ${v1} ${v2} ${v3}`);
    await page.evaluate(`document.querySelector('#st-shelf').focus()`); await press(page, '2'); await sleep(300);
    const v4 = await view(), shelfAfter = await page.evaluate(`document.querySelector('#st-shelf').value`);
    if (v4 !== 'settings') bad.push(`"2" typed in the shelf select left the page for ${v4}`);
    // 4. every control reachable with Tab, in page order, with a visible focus ring
    await page.evaluate(`document.activeElement.blur(); window.scrollTo(0, 0); document.querySelector('#tab-settings').focus()`);
    const order = [];
    for (let i = 0; i < 40; i++) {
      await press(page, 'Tab'); await sleep(40);
      const r = await page.evaluate(`(() => { const a = document.activeElement; const inPage = !!a && !!a.closest('#view-settings'); const cs = a ? getComputedStyle(a) : null; const target = a && a.type === 'checkbox' ? a.nextElementSibling : a, ts = target ? getComputedStyle(target) : null; const ring = a && a.matches(':focus-visible') ? ts.outlineStyle !== 'none' && parseFloat(ts.outlineWidth) > 0 : null; return { id: a && (a.id || a.dataset.v || a.dataset.proj || a.tagName), inPage, ring, fv: a ? a.matches(':focus-visible') : null }; })()`);
      if (r.inPage) order.push(r);
      if (order.length >= 12) break;
    }
    const ids = order.map(o => o.id);
    const wantIds = ['3d', 'pixel', 'auto', 'fixed', 'st-season', 'st-hemisphere', 'st-weather', 'st-shelf', 'st-project', 'text', 'names', 'off'];
    if (!wantIds.every((id, i) => ids[i] === id)) bad.push(`tab order on the page: ${ids.join(' > ')} (want ${wantIds.join(' > ')})`);
    if (!order.slice(0, wantIds.length).every(o => o.fv && o.ring)) bad.push(`a control without a visible focus ring: ${JSON.stringify(order.filter(o => !(o.fv && o.ring)))}`);
    // 5. operable by keyboard: Space on Pixel, on Fixed, on the project switch and on Names only of the lounge
    await page.evaluate(`localStorage.clear()`);
    const mark2 = (await snap(page)).mark;
    await page.evaluate(`document.querySelector('#st-scene button[data-v="pixel"]').focus()`); await press(page, ' '); await sleep(300);
    await page.evaluate(`document.querySelector('#st-time-mode button[data-v="fixed"]').focus()`); await press(page, ' '); await sleep(300);
    await page.evaluate(`document.querySelector('#st-project').focus()`); await press(page, ' '); await sleep(500);
    await page.evaluate(`document.querySelector('#st-lounge button[data-v="names"]').focus()`); await press(page, ' '); await sleep(400);
    const k = await snap(page);
    if (!(stored(k.stored) && stored(k.stored).scene === 'pixel' && stored(k.stored).project === 'on' && /^\d\d:\d\d$/.test(stored(k.stored).time) && k.tab.pending && k.tab.sample === 'true' && k.tab.timeMode === 'fixed' && stored(k.stored).lounge === 'names' && k.tab.lounge === 'names' && k.pop.lounge === 'names' && k.mark === mark2 && mark2)) bad.push(`operating with the keyboard: ${k.stored} ${JSON.stringify(k.tab)}`);
    notes.push(`first Tab stop ${t1.id}; arrows ${seq.map(s => s[0] + '>' + s[1]).join(' ')}; Enter on Office -> ${v1}, Space on Cost -> ${v2}, "5" -> ${v3}, "2" in the shelf select -> ${v4} (value ${shelfAfter}); page order ${ids.join(' > ')}; keyboard operation stored ${k.stored}`);
    const errs = S.problems();
    check('keys', bad.length === 0 && errs.length === 0, `${bad.length ? 'PROBLEMS ' + bad.join('; ') + ' | ' : ''}${notes.join(' | ')}; console errors ${errs.length}${errs.length ? ' ' + errs.slice(0, 2).join(' / ') : ''}`);
  });
}

// ============================================================================ narrow
if (want('narrow')) {
  await part('narrow', { width: 375, height: 820 }, async S => {
    const { page } = S, bad = [], notes = [];
    await page.evaluate(`localStorage.clear()`);
    const measure = () => page.evaluate(`(() => {
      const vw = innerWidth, de = document.documentElement, v = document.querySelector('#view-settings'), nav = document.querySelector('.top nav'), top = document.querySelector('.top').getBoundingClientRect();
      const out = [];
      for (const e of v.querySelectorAll('.st *')) { const r = e.getBoundingClientRect(); if (r.width && e.getClientRects().length && (r.right > vw + 0.5 || r.left < -0.5)) out.push((e.id || e.className || e.tagName) + ':' + Math.round(r.left) + '..' + Math.round(r.right)); }
      const card = document.querySelector('.st-card').getBoundingClientRect(), inCard = [...document.querySelectorAll('.st-card')].every(c => [...c.querySelectorAll('.st-ctl, .st-ctl *, .st-help, .st-sample')].every(e => { const r = e.getBoundingClientRect(); const cr = c.getBoundingClientRect(); return !r.width || (r.left >= cr.left - 0.5 && r.right <= cr.right + 0.5); }));
      const tabs = [...nav.querySelectorAll('[role=tab]')].map(b => { const r = b.getBoundingClientRect(); return [b.textContent.trim(), Math.round(r.left), Math.round(r.right)]; });
      return JSON.stringify({ vw, docW: de.scrollWidth, bodyW: document.body.scrollWidth, viewW: v.scrollWidth, viewC: v.clientWidth, out, inCard, navFits: nav.scrollWidth <= nav.clientWidth + 0.5, navRight: Math.round(nav.getBoundingClientRect().right), topRight: Math.round(top.right), tabs,
        title: document.querySelector('.st-title').textContent, rows: [...v.querySelectorAll('.st-row[data-row]')].filter(r => r.getClientRects().length).length, lang: document.documentElement.lang });
    })()`).then(JSON.parse);
    for (const [label, lang] of [['English', 'en'], ['Turkish', 'tr']]) {
      await page.evaluate(`localStorage.setItem('cco.lang', '${lang}')`);
      await S.load('?scene=3d&lounge=demo,names', '#settings');       // the lounge row has its longest tag and its note
      // everything on: a fixed time (the slider row), a weather (the reduced-motion note is not shown), the project switch (the sample), a long address-named value
      await click(page, '#st-time-mode button[data-v="fixed"]'); await sleep(250);
      await click(page, '.st-toggle span'); await sleep(300);
      const m = await measure();
      if (!(m.vw === 375 && m.docW <= 375 && m.bodyW <= 375 && m.viewW <= m.viewC && m.out.length === 0 && m.inCard && m.navFits && m.navRight <= m.topRight)) bad.push(`${label}: overflow ${JSON.stringify({ docW: m.docW, viewW: m.viewW, viewC: m.viewC, out: m.out.slice(0, 4), inCard: m.inCard, navFits: m.navFits, nav: m.navRight, top: m.topRight })}`);
      if (!(m.tabs.length === 5 && m.tabs.every(t => t[1] >= 0 && t[2] <= 375))) bad.push(`${label}: tabs ${JSON.stringify(m.tabs)}`);
      const ln = await snap(page);
      if (!(ln.tab.loungeNote && ln.src.lounge && ln.src.lounge.from === 'url' && /\?lounge=demo,names/.test(ln.src.lounge.text) && ln.tab.lounge === 'names')) bad.push(`${label}: the lounge row with ?lounge=demo,names: ${JSON.stringify({ note: ln.tab.loungeNote, src: ln.src.lounge, lounge: ln.tab.lounge })}`);
      notes.push(`${label} (${m.lang}, "${m.title}"): page ${m.docW} px of ${m.vw}, ${m.rows} rows, tabs end at ${m.tabs[4][2]}, nav inside the bar ${m.navRight <= m.topRight}, lounge note "${ln.tab.loungeNote}" and tag "${ln.src.lounge && ln.src.lounge.text}"`);
      await S.shot(`settings-375-${lang}.png`);
      if (shotsDir) { await page.evaluate(`document.querySelector('#view-settings [data-row="lounge"]').scrollIntoView({ block: 'center' })`); await sleep(200); await S.shot(`settings-375-lounge-${lang}.png`); await page.evaluate(`window.scrollTo(0, 0)`); }
      // a smaller phone (the window is made narrower with the page open, as when a phone is turned round): 360 and 320 px keep all five tabs inside the bar (WCAG reflow is judged at 320);
      // 280 px, narrower than a phone sold today, cannot hold the English labels, so the strip scrolls and the chosen tab is brought into view
      const strip = () => page.evaluate(`(() => { const nav = document.querySelector('.top nav'), nb = nav.getBoundingClientRect(), sel = nav.querySelector('[aria-selected=true]'), s = sel.getBoundingClientRect();
        return JSON.stringify({ vw: innerWidth, fits: nav.scrollWidth <= nav.clientWidth + 0.5, selIn: s.left >= nb.left - 0.5 && s.right <= nb.right + 0.5, docW: document.documentElement.scrollWidth, sel: sel.textContent.trim(), scrolled: Math.round(nav.scrollLeft) }); })()`).then(JSON.parse);
      const small = [];
      for (const w of [360, 320, 280]) {
        await page.setViewport(w, 820); await sleep(350);
        const r = await strip();
        if (w !== 360) await S.shot(`settings-${w}-${lang}.png`);
        small.push(`${w}: ${r.fits ? 'fits' : 'scrolls ' + r.scrolled}`);
        if (!(r.vw === w && r.selIn && r.docW <= w && (w >= 320 ? r.fits : true))) bad.push(`${label} at ${w} px: ${JSON.stringify(r)}`);
      }
      await page.setViewport(375, 820); await sleep(250);
      notes.push(`${label} tabs at ${small.join(', ')}; the chosen tab is inside the strip each time`);
    }
    await page.evaluate(`localStorage.removeItem('cco.lang')`);
    // the address-named values make the longest source tags; the pixel scene adds the camera row
    await S.load('?scene=pixel&season=autumn&weather=rain&time=22:30&hemisphere=south&shelf=7&project=on&proj=front', '#settings', 'pixel');
    const w = await measure();
    if (!(w.docW <= 375 && w.out.length === 0 && w.inCard && w.navFits)) bad.push(`pixel with every parameter in the address: ${JSON.stringify({ docW: w.docW, out: w.out.slice(0, 4), inCard: w.inCard })}`);
    notes.push(`pixel with eight parameters in the address: page ${w.docW} px, ${w.rows} rows`);
    await S.shot('settings-375-pixel-address.png');
    const errs = S.problems();
    check('narrow', bad.length === 0 && errs.length === 0 && offsite(S.requests).length === 0, `${bad.length ? 'PROBLEMS ' + bad.join('; ') + ' | ' : ''}${notes.join(' | ')}; console errors ${errs.length}${errs.length ? ' ' + errs.slice(0, 2).join(' / ') : ''}; requests off localhost ${offsite(S.requests).length}`);
  });
}

// ============================================================================ mutations
// one line broken in a copy of the repo, the check that guards it must fail there
const MUTATIONS = [
  { name: 'the Settings tab is not in the header', file: 'public/index.html', from: '<button role="tab" id="tab-settings" aria-controls="view-settings" data-view="settings" title="Settings (5)" data-i18n="tab.settings" data-i18n-title="tab.settings.tip">Settings</button>', to: '', fails: ['open'] },
  { name: 'the page does not fade in', file: 'public/js/settings-tab.js', from: "if (typeof page.animate === 'function') page.animate(", to: "if (false) page.animate(", fails: ['open'] },
  { name: 'the fade is as long under reduced motion', file: 'public/js/settings-tab.js', from: 'duration: reduced() ? DUR.hover : DUR.fast', to: 'duration: DUR.fast', fails: ['open'] },
  { name: 'the board line shows when the server says nothing', file: 'public/js/settings-tab.js', from: '    r.hidden = !state;\n', to: '    r.hidden = false;\n', fails: ['open'] },
  { name: 'the server says nothing about the message board', file: 'server.js', from: ", chat: chatInfo() });", to: ' });', fails: ['open'] },
  { name: 'the server says the message board is off while it reads the chat database', file: 'server.js', from: 'return { state: s.state, schema: s.schema };', to: "return { state: 'off', schema: null };", fails: ['open'] },
  { name: 'the camera row shows in the 3D scene', file: 'public/js/office-settings.js', from: "export const tabRowsOf = office => ['scene', ...rowsOf(office)];", to: "export const tabRowsOf = office => TAB_ROWS;", fails: ['open'] },
  { name: 'a click on the lounge row of the tab changes nothing', file: 'public/js/settings-tab.js', from: "q('#st-lounge').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b) hub.set('lounge', b.dataset.v); });", to: "q('#st-lounge').addEventListener('click', () => refresh());", fails: ['lounge'] },
  { name: 'the popover\'s lounge select changes nothing', file: 'public/js/settings-panel.js', from: "lounge.addEventListener('change', () => { hub.set('lounge', lounge.value); refresh(); });", to: "lounge.addEventListener('change', () => refresh());", fails: ['lounge'] },
  { name: 'the lounge ignores its setting', file: 'public/js/ofis-lounge.js', from: "const m = settings && typeof settings.get === 'function' ? settings.get('lounge') : null;", to: "const m = 'text';", fails: ['lounge'] },
  { name: 'the lounge leaves its card open when the setting goes Off', file: 'public/js/ofis-lounge.js', from: "if (mode() === 'off') card.close(); });", to: '});', fails: ['lounge'] },
  { name: 'the lounge does not kick its poll when the setting changes', file: 'public/js/ofis-lounge.js', from: "dirty = true; poller.kick(); if (mode() === 'off')", to: "dirty = true; if (mode() === 'off')", fails: ['lounge'] },
  { name: 'the tab does not say that the address plays the demo', file: 'public/js/settings-tab.js', from: "q('[data-note=\"lounge-demo\"]').hidden = !(rows.includes('lounge') && loungeDemo(addr));", to: "q('[data-note=\"lounge-demo\"]').hidden = true;", fails: ['lounge'] },
  { name: 'the pixel scene shows the lounge row', file: 'public/js/pixel/index.js', from: '    settingRows: PIXEL_ROWS,', to: '', fails: ['scene'] },
  { name: 'the tab does not follow a change made in the popover', file: 'public/js/settings-tab.js', from: 'hub.on(refresh);', to: '', fails: ['store'] },
  { name: 'the popover does not follow a change made in the tab', file: 'public/js/settings-panel.js', from: 'hub.on(refresh);', to: '', fails: ['store'] },
  { name: 'the tab\'s time slider says minutes to a screen reader', file: 'public/js/settings-tab.js', from: "time.setAttribute('aria-valuetext', text);", to: '', fails: ['store'] },
  { name: 'the popover\'s time slider says minutes to a screen reader', file: 'public/js/settings-panel.js', from: "slider.setAttribute('aria-valuetext', text);", to: '', fails: ['store'] },
  { name: 'a change in the tab does not reach the scene', file: 'public/js/settings-tab.js', from: "for (const key of ['season', 'hemisphere', 'weather']) q('#st-' + key).addEventListener('change', e => hub.set(key, e.target.value));", to: "for (const key of ['season', 'hemisphere', 'weather']) q('#st-' + key).addEventListener('change', () => refresh());", fails: ['store'] },
  { name: 'an address that names a setting does not follow the control', file: 'public/js/main.js', from: "const search = urlAfterChange(location.search, key, value);\n  if (search != null)", to: "const search = null;\n  if (search != null)", fails: ['store'] },
  { name: 'the address is ignored by the scene choice', file: 'public/js/office-settings.js', from: 'return merge(storage ? loadSettings(storage) : {}, officeQuery(search)).values.scene;', to: 'return merge(storage ? loadSettings(storage) : {}, {}).values.scene;', fails: ['scene'] },
  { name: 'the scene choice is not kept', file: 'public/js/settings-tab.js', from: "if (b) hub.set('scene', b.dataset.v);", to: "if (b) refresh();", fails: ['scene'] },
  { name: 'the page does not say that the scene waits for the next load', file: 'public/js/settings-tab.js', from: "q('.st-pending').hidden = !waiting;", to: "q('.st-pending').hidden = true;", fails: ['scene'] },
  { name: 'the page calls a change saved when the browser kept nothing', file: 'public/js/office-settings.js', from: "origin[key] = keepSettings(storage, { [key]: v }) ? 'user' : 'visit';", to: "keepSettings(storage, { [key]: v }); origin[key] = 'user';", fails: ['scene'] },
  { name: 'a write the browser dropped is not noticed', file: 'public/js/pixel/settings.js', from: 'return Object.keys(want).every(k => load(storage)[k] === want[k]);', to: 'return true;', fails: ['scene'] },
  { name: 'the 3D scene ignores the stored scene choice at load', file: 'public/js/main.js', from: "if (sceneChoice({ search: location.search }) === 'pixel') return", to: "if (new URLSearchParams(location.search).get('scene') === 'pixel') return", fails: ['scene'] },
  { name: 'the 3D scene does not read the project setting', file: 'public/js/ofis.js', from: "opts.settings.get('project') === 'on';", to: "opts.settings.get('project') === 'never';", fails: ['project'] },
  { name: 'the sample does not follow the switch', file: 'public/js/settings-tab.js', from: "q('.st-sample').dataset.on = String(s.project === 'on');", to: '', fails: ['project'] },
  { name: 'the 3D scene does not redraw the boards when the setting changes', file: 'public/js/ofis.js', from: "opts.settings.on('project', () => { for (const r of world.rooms.values()) r.signKey = ''; refreshLabels(); })", to: "opts.settings.on('project', () => {})", fails: ['project'] },
  { name: 'every tab is a stop of the Tab key', file: 'public/js/tabs.js', from: 'b.tabIndex = on ? 0 : -1;', to: 'b.tabIndex = 0;', fails: ['keys'] },
  { name: 'the arrow keys do nothing', file: 'public/js/tabs.js', from: "if (key === 'ArrowRight') return (at + 1) % count;", to: "if (key === 'ArrowRight') return null;", fails: ['keys'] },
  { name: 'the number keys fire inside a select', file: 'public/js/main.js', from: "if (e.target.matches('input, textarea, select')) return;", to: "if (e.target.matches('input, textarea')) return;", fails: ['keys'] },
  { name: 'the switch has no focus ring', file: 'public/app.css', from: '.toggle input:focus-visible + span { outline: 2px solid rgba(144, 133, 233, .55); outline-offset: 2px; }', to: '.toggle input:focus-visible + span { outline: none; }', fails: ['keys'] },
  { name: 'the tabs are too wide for a small phone', file: 'public/app.css', from: '@media (max-width: 370px) { .top { padding-left: 8px; padding-right: 8px; } .top nav.seg { gap: 1px; } .top nav.seg button { padding: 6px 4px; font-size: 11.5px; } }', to: '', fails: ['narrow'] },
  { name: 'a chosen tab that the strip cuts off is not scrolled into view', file: 'public/js/tabs.js', from: 'if (d) nav.scrollLeft += d;', to: '', fails: ['narrow'] },
  { name: 'the tabs are too wide for a phone', file: 'public/app.css', from: '@media (max-width: 520px) { .top nav.seg { flex: 1 1 100%; } .top nav.seg button { padding: 6px 7px; font-size: 12px; } }', to: '', fails: ['narrow'] },
  { name: 'a row keeps two columns on a phone', file: 'public/app.css', from: '  .st-row { grid-template-columns: minmax(0, 1fr); gap: 10px; }\n  .st-ctl { justify-self: stretch; }\n  .st select { width: 100%; max-width: none; }', to: '  .st-row { grid-template-columns: minmax(0, 1fr) 420px; }', fails: ['narrow'] },
];
if (args.includes('--mutations')) {
  const which = val('mutation');
  const rows = [];
  for (const [k, m] of MUTATIONS.entries()) {
    if (which != null && String(k) !== which) continue;
    if (only && only !== 'settings-tab' && !m.fails.includes(only)) continue;
    const dir = mkdtempSync(join(tmpdir(), 'cco-settings-mut-'));
    try {
      for (const f of readdirSync(ROOT)) if (/\.(js|json)$/.test(f)) cpSync(join(ROOT, f), join(dir, f));
      cpSync(join(ROOT, 'public'), join(dir, 'public'), { recursive: true });
      mkdirSync(join(dir, 'tools'), { recursive: true });
      cpSync(join(ROOT, 'tools/qa'), join(dir, 'tools/qa'), { recursive: true });
      const file = join(dir, m.file), text = readFileSync(file, 'utf8');
      if (!text.includes(m.from)) { rows.push({ m, caught: [], detail: 'the line to break was not found' }); console.log(`MUTATION MISSED ${m.name}: the line to break was not found`); continue; }
      writeFileSync(file, text.replace(m.from, m.to));
      const caught = [], seen = {};
      for (const name of m.fails) {
        const r = spawnSync('node', ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(dir, 'tools/qa/office-settings-tab-qa.mjs'), '--only', name], { encoding: 'utf8', timeout: 900000 });
        const lines = (r.stdout || '').split('\n').filter(l => l.startsWith(`CHECK settings-tab-${name}`));
        const failLine = lines.find(l => l.includes(' FAIL ')), anyLine = failLine || lines[0] || '';
        seen[name] = failLine ? 'FAIL' : anyLine ? 'PASS' : 'no result';
        if (failLine) { caught.push(name); seen[name] += ': ' + failLine.replace(/^CHECK \S+ FAIL /, '').slice(0, 200); }
      }
      rows.push({ m, caught });
      console.log(`MUTATION ${caught.length === m.fails.length ? 'CAUGHT' : 'MISSED'} ${m.name}: ${m.fails.map(n => `${n} ${seen[n]}`).join(' | ')}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const missed = rows.filter(r => r.caught.length !== r.m.fails.length);
  console.log(missed.length ? `MUTATIONS MISSED ${missed.length} of ${rows.length}` : `MUTATIONS ALL CAUGHT (${rows.length})`);
  process.exit(missed.length ? 1 : 0);
}

const bad = results.filter(r => !r.ok);
console.log(bad.length ? `QA FAIL (${bad.length} of ${results.length} checks)` : `QA PASS (${results.length} checks)`);
process.exit(bad.length ? 1 : 0);
