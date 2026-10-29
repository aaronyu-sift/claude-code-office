// QA of the 3D scene's settings and atmosphere (public/js/office-settings.js, ofis-env.js, ofis-weather.js): headless Chrome with software WebGL in a throw-away profile (harness3d.mjs),
// the server against a fake ~/.claude, one `CHECK <name> PASS|FAIL <detail>` line per check and a final `QA PASS` or `QA FAIL`.
//   node tools/qa/office3d-env-qa.mjs [--only settings|time|weather|season] [--mutations]      (--only also narrows the mutations to the ones that guard that check)
//
//   3d-settings  the popover shows for the 3D scene with the rows it supports (no camera row), a choice is applied and remembered across a reload and by the pixel scene,
//                the address (?time ?hour ?season ?weather ?hemisphere ?shelf) wins over what is stored and is not stored, and follows a change made with the controls
//   3d-time      a fixed 03:00 and 13:00 give clearly different lit windows and sun intensity; the change is eased (sampled frame by frame at a constant rate, never a step); dawn
//                and dusk follow the month and the hemisphere; the popover slider, ?time= and ?hour= reach the light; ?env=0 still leaves the surroundings out
//   3d-weather   off by default and then nothing runs at all; every weather draws at most 120 particles, at most 10 times a second, through the one scheduler; nothing while the page
//                or the Office view is hidden, nothing with reduced motion; the sun is dimmer in rain; the WebGL draw calls and the frame time do not change; a rainbow follows rain; no request leaves
//
// --mutations breaks the code in a copy of the repo, one line at a time, and runs the check that guards that line: every one must FAIL there (a check that cannot fail guards
// nothing). A failing check is worth running again on its own (--only) before concluding anything: the machine may be busy, and software WebGL is slow.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scenario3d, o3, sleep, lookAt, ROOT } from './harness3d.mjs';
import { CYCLE } from '../../public/js/motion.js';
import { weatherFor, rainbowFor } from '../../public/js/pixel/weather.js';
import { addDays } from '../../public/js/pixel/season.js';

const args = process.argv.slice(2);
const val = f => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : undefined; };
const only = val('only');
const make = (name, ok, detail) => ({ name, ok, detail });
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---- helpers run on the page
const popRows = `(() => [...document.querySelectorAll('#set-pop .set-row')].filter(r => getComputedStyle(r).display !== 'none').map(r => r.dataset.row || (r.classList.contains('set-time') ? 'time-slider' : '?')))()`;
const state = `(() => { const n = document.querySelector('#set-note'), q = id => document.querySelector('#' + id), w = q('set-wrap');
  return JSON.stringify({ wrapShown: !w.hidden, headerCamera: !q('proj-seg').hidden, open: !q('set-pop').hidden, rows: ${popRows}, stored: localStorage.getItem('ajan-ofisi.settings'), url: location.search,
    season: q('set-season').value, hemi: q('set-hemisphere').value, weather: q('set-weather').value, shelf: q('set-shelf').value,
    timeMode: [...document.querySelectorAll('#set-time-mode button')].find(b => b.getAttribute('aria-pressed') === 'true')?.dataset.v, slider: q('set-time').value, sliderOut: q('set-time-out').textContent,
    note: n.hidden ? '' : n.textContent, scene: document.querySelector('#view-ofis').dataset.scene }); })()`;

// the env's state, and the lit windows: a pane that is bluish by day turns bright warm cream at night. GRAB keeps the picture of the 3D canvas under a name; FLIP counts
// the pixels that were bluish in the picture kept as `day` (a pane by day) and are bright and warm now (the same camera, so the pixels are the same places)
const ENV = o3('s.env');
const GRAB = name => o3(`(() => { const c = v.querySelector('.of-stage canvas'), gl = c.getContext('webgl2') || c.getContext('webgl'), W = c.width, H = c.height; o.draw();
  const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); (window.__qa = window.__qa || {})[${JSON.stringify(name)}] = b; return W * H; })()`);
const FLIP = name => o3(`(() => { const c = v.querySelector('.of-stage canvas'), gl = c.getContext('webgl2') || c.getContext('webgl'), W = c.width, H = c.height; o.draw();
  const n = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, n); const d = window.__qa[${JSON.stringify(name)}]; let count = 0;
  for (let i = 0; i < n.length; i += 4) if (d[i + 3] > 200 && n[i + 3] > 200 && d[i + 2] - d[i] >= 15 && n[i] > 200 && n[i + 1] > 170 && n[i] - n[i + 2] > 30) count++;
  return count; })()`);
// poll the page until the env says it has seen the minute we asked for (the light follows on the next frame)
const waitEnv = async (page, test, ms = 20000) => { const t0 = Date.now(); let e = null; while (Date.now() - t0 < ms) { e = await page.evaluate(ENV); if (test(e)) return e; await sleep(100); } return e; };
// samples of the env every 80 ms until the light has settled on `minute` (or `ms` have passed): the night value and the sun, with the time of each sample
const sampleLight = (minute, ms) => `new Promise(res => { const out = [], t0 = performance.now(); const tick = () => { const e = document.querySelector('#view-ofis').__ofis.env;
  out.push({ t: Math.round(performance.now() - t0), night: e.night, sun: e.sun, minute: e.minute, settled: e.settled });
  if ((e.minute === ${minute} && e.settled && out.length > 3) || performance.now() - t0 > ${ms}) return res(out); setTimeout(tick, 80); }; tick(); })`;
const setting = (key, value) => `document.querySelector('#view-ofis').__office.settings.set(${JSON.stringify(key)}, ${JSON.stringify(value)})`;
const atmosphere = expr => `(() => { const a = document.querySelector('#view-ofis').__office.atmosphere; return ${expr}; })()`;

// the page for one check: a click that lands on the element (not under another), a select and a slider changed the way a visitor does
function driver(page) {
  const ev = e => page.evaluate(e);
  const click = async css => {
    const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(css)}); const b = e.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { x: b.left + b.width / 2, y: b.top + b.height / 2, ok: !!hit && (hit === e || e.contains(hit)) }; })()`);
    await page.mouse.click(r.x, r.y);
    return r.ok;
  };
  const sel = (id, v) => ev(`(() => { const s = document.querySelector('#${id}'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
  const range = v => ev(`(() => { const s = document.querySelector('#set-time'); s.value = '${v}'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const st = () => ev(state).then(JSON.parse);
  return { ev, click, sel, range, st };
}

// ---- 3d-settings
async function runSettings(ctx) {
  const S = await scenario3d(2, { tag: 'envset', root: ctx.root });
  try {
    const { page } = S, d = driver(page), base = `http://127.0.0.1:${S.srv.port}/`;
    const load = async (q, ready = true) => { await page.goto(base + q + '#ofis', 800); if (ready) { for (let i = 0; i < 60 && !(await d.ev(`!!document.querySelector('#view-ofis').__ofis3d`)); i++) await sleep(250); } await sleep(300); return d.st(); };
    const s0 = await d.st();
    const opened = await d.click('#set-btn'); await sleep(250);
    const s1 = await d.st();
    const fixedBtn = await d.click('#set-time-mode button[data-v="fixed"]'); await sleep(200);
    const s1b = await d.st();
    await d.sel('set-season', 'winter'); await d.sel('set-weather', 'rain'); await d.sel('set-hemisphere', 'south'); await d.sel('set-shelf', '20'); await d.range(1320); await sleep(400);
    const s2 = await d.st();
    const E = { time: '22:00', season: 'winter', weather: 'rain', hemisphere: 'south', shelf: 20 };
    const s3 = await load('?scene=3d');                                                      // reload, no parameters: what was chosen is still there
    await d.click('#set-btn'); await sleep(250);
    const s3o = await d.st();
    const px = await load('', false);                                                         // the pixel scene is the default scene: it reads the same choices
    await d.ev(`new Promise(r => { const t0 = Date.now(); const w = () => (document.querySelector('#view-ofis').__pixel || Date.now() - t0 > 20000 ? r() : setTimeout(w, 200)); w(); })`);
    const pixel = await d.ev(`(() => { const p = document.querySelector('#view-ofis').__pixel; return p ? JSON.stringify({ settings: p.settings, from: p.settingsFrom }) : 'null'; })()`).then(JSON.parse);
    const s4 = await load('?scene=3d&season=spring&weather=fog&time=03:00&hemisphere=north&shelf=7');   // the address wins over what is stored, and is not stored itself
    await d.click('#set-btn'); await sleep(250);
    const s4o = await d.st();
    const s5 = await load('?scene=3d&hour=21.5');                                              // ?hour= is the older name of ?time=
    await d.click('#set-btn'); await sleep(250);
    const s5o = await d.st();
    await d.range(1380); await sleep(300);                                                     // a change made with the controls takes ?hour= over as ?time=
    const s5c = await d.st();
    await load('?scene=3d&season=spring');
    await d.click('#set-btn'); await sleep(250);
    await d.sel('set-season', 'autumn'); await sleep(300);
    const s6 = await d.st();                                                                    // ... and an explicit ?season= follows the control

    const C = {
      shown: s0.scene === '3d' && s0.wrapShown && !s0.headerCamera && opened && s1.open,
      rows: same(s1.rows, ['time', 'season', 'hemisphere', 'weather', 'shelf']) && !s1.rows.includes('camera'),
      slider: fixedBtn && same(s1b.rows, ['time', 'time-slider', 'season', 'hemisphere', 'weather', 'shelf']) && s1b.timeMode === 'fixed',
      applied: s2.season === 'winter' && s2.weather === 'rain' && s2.hemi === 'south' && s2.shelf === '20' && s2.sliderOut === '22:00' && same(JSON.parse(s2.stored), E) && s2.url === '?scene=3d',
      reload: s3.wrapShown && same(JSON.parse(s3.stored), E) && s3o.season === 'winter' && s3o.weather === 'rain' && s3o.hemi === 'south' && s3o.shelf === '20' && s3o.timeMode === 'fixed' && s3o.sliderOut === '22:00' && same(s3o.rows, s1b.rows),
      pixel: pixel && same(pixel.settings, E) && Object.values(pixel.from).every(v => v === 'stored'),
      url: same(JSON.parse(s4.stored), E) && s4o.season === 'spring' && s4o.weather === 'fog' && s4o.hemi === 'north' && s4o.shelf === '7' && s4o.timeMode === 'fixed' && s4o.sliderOut === '03:00'
        && /season=spring/.test(s4o.note) && /time=03:00/.test(s4o.note.replace(/\u2060/g, '')) && /shelf=7/.test(s4o.note.replace(/\u2060/g, '')),
      hour: s5o.timeMode === 'fixed' && s5o.sliderOut === '21:30' && /time=21:30/.test(s5o.note.replace(/\u2060/g, '')) && same(JSON.parse(s5.stored), E),
      keepHour: /time=23%3A00/.test(s5c.url) && !/hour=/.test(s5c.url),
      keepSeason: /season=autumn/.test(s6.url) && JSON.parse(s6.stored).season === 'autumn',
      noErrors: page.errors.filter(e => !/\/local\/ofis-extras\.js/.test(e)).length === 0,
    };
    const bad = Object.keys(C).filter(k => !C[k]), ok = bad.length === 0;
    return [make('3d-settings', ok,
      `${ok ? '' : 'FAILED PARTS: ' + bad.join(', ') + '; '}3D scene: popover button shown ${s0.wrapShown}, header camera toggle shown ${s0.headerCamera}, rows ${s1.rows.join('/')} (camera row hidden), after Fixed: ${s1b.rows.join('/')}; `
      + `chosen winter, rain, south, shelf 20, 22:00 -> stored ${s2.stored}, address unchanged ${s2.url}; after a reload the popover reads ${s3o.season}, ${s3o.weather}, ${s3o.hemi}, shelf ${s3o.shelf}, ${s3o.timeMode} ${s3o.sliderOut}; `
      + `the pixel scene (default scene) starts with ${pixel ? JSON.stringify(pixel.settings) : 'no scene'}; address ?season=spring&weather=fog&time=03:00&hemisphere=north&shelf=7 -> popover ${s4o.season}, ${s4o.weather}, ${s4o.hemi}, shelf ${s4o.shelf}, ${s4o.timeMode} ${s4o.sliderOut}, store unchanged ${same(JSON.parse(s4.stored), E)}, note "${s4o.note.replace(/\u2060/g, '').slice(0, 90)}"; `
      + `?hour=21.5 -> ${s5o.timeMode} ${s5o.sliderOut}, then a change of the slider gives address ${s5c.url}; ?season=spring then autumn chosen -> ${s6.url}`)];
  } finally { await S.done(); }
}

// ---- 3d-time
async function runTime(ctx) {
  const S = await scenario3d(4, { tag: 'envtime', root: ctx.root, query: 'time=13:00' });
  try {
    const { page } = S, d = driver(page), base = `http://127.0.0.1:${S.srv.port}/`;
    const E0 = await waitEnv(page, e => e && e.minute === 780 && e.settled);
    const house = E0.firstHouse;
    await lookAt(page, house[0], 1, house[1], 40);
    await sleep(600);
    const day = { env: await waitEnv(page, e => e.settled) };
    await page.evaluate(GRAB('day'));
    await sleep(400);
    day.lit = await page.evaluate(FLIP('day'));                                                   // by day nothing flips: the same pictures, apart from a car that has moved
    // the change by hand: the popover slider to 03:00; the light must move at a constant rate and arrive, not jump
    await d.click('#set-btn'); await sleep(250);
    await d.range(180);
    const series = await page.evaluate(sampleLight(180, 30000));
    const nightEnv = await waitEnv(page, e => e.minute === 180 && e.settled);
    await sleep(300);
    const night = { env: nightEnv, lit: await page.evaluate(FLIP('day')) };
    const mid = series.filter(x => x.night > 0.02 && x.night < 0.98), nights = series.map(x => x.night);
    const monotone = nights.every((v, i) => i === 0 || v >= nights[i - 1] - 1e-9);
    let steepest = 0;
    for (let i = 1; i < series.length; i++) if (series[i].t > series[i - 1].t) steepest = Math.max(steepest, (nights[i] - nights[i - 1]) / ((series[i].t - series[i - 1].t) / 1000));
    const full = (CYCLE.turn / 1000);                                                          // seconds for a full change at the intended rate
    const t0 = series.find(x => x.night > 0.02), t1 = series.find(x => x.night >= 0.98);
    const takes = t0 && t1 ? (t1.t - t0.t) / 1000 : 0;
    const eased = mid.length >= 4 && monotone && steepest <= 2 / full && takes >= 0.4 * full && nights[nights.length - 1] === 1;

    // dawn and dusk follow the month and the hemisphere: the light the scene asks for at the same clock time
    const askAt = async (time, date, hemi) => {
      await page.evaluate(setting('hemisphere', hemi)); await page.evaluate(setting('time', time)); await page.evaluate(atmosphere(`a.setDate(${JSON.stringify(date)})`));
      const m = +date.slice(5, 7), want = hemi === 'south' ? ((m + 5) % 12) + 1 : m;
      const e = await waitEnv(page, x => x.minute === +time.slice(0, 2) * 60 + +time.slice(3) && x.month === want && x.settled !== undefined && x.wantNight !== null);
      await sleep(250);
      return page.evaluate(ENV);
    };
    const dawn = {
      northJan: await askAt('06:00', '2026-01-15', 'north'), northJul: await askAt('06:00', '2026-07-15', 'north'),
      southJan: await askAt('06:00', '2026-01-15', 'south'), southJul: await askAt('06:00', '2026-07-15', 'south'),
    };
    const dusk = { northDec: await askAt('17:30', '2026-12-15', 'north'), northJun: await askAt('17:30', '2026-06-15', 'north') };
    // the colour of the sun at the golden hour is warmer than at noon (settled), and at night it is cool
    await askAt('13:00', '2026-06-15', 'north'); const noon = await waitEnv(page, e => e.minute === 780 && e.settled);
    await askAt('18:55', '2026-06-15', 'north'); const golden = await waitEnv(page, e => e.minute === 1135 && e.settled);
    const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const [nr, , nb] = hex(noon.sunColor), [gr, , gb] = hex(golden.sunColor);
    const phases = { dawn: dawn.northJan.phase, noon: noon.phase, golden: golden.phase };

    // ?hour=21 (the older name of ?time=) and ?env=0
    await page.goto(base + '?scene=3d&hour=21#ofis', 800);
    for (let i = 0; i < 80 && !(await page.evaluate(`!!document.querySelector('#view-ofis').__ofis`).catch(() => false)); i++) await sleep(250);
    const hourEnv = await waitEnv(page, e => e && e.minute === 1260 && e.settled);
    await page.goto(base + '?scene=3d&env=0&time=03:00#ofis', 800);
    for (let i = 0; i < 80 && !(await page.evaluate(`!!document.querySelector('#view-ofis').__ofis`).catch(() => false)); i++) await sleep(250);
    await sleep(1500);
    const noEnv = await page.evaluate(ENV);
    const errs = page.errors.filter(e => !/\/local\/ofis-extras\.js/.test(e));

    const C = {
      litDiffers: night.lit > 300 && night.lit > 10 * day.lit,
      sunDiffers: day.env.sun === 2.2 && night.env.sun < 0.65 * day.env.sun && night.env.hemi < 0.85 * day.env.hemi && night.env.night === 1 && day.env.night === 0,
      eased,
      dawnByMonth: dawn.northJan.wantNight > 0.85 && dawn.northJul.wantNight < 0.05 && dawn.northJan.phase !== dawn.northJul.phase,
      dawnByHemisphere: dawn.southJul.wantNight > 0.85 && dawn.southJan.wantNight < 0.05 && Math.abs(dawn.southJul.wantNight - dawn.northJan.wantNight) < 0.01,
      duskByMonth: dusk.northDec.wantNight > 0.7 && dusk.northJun.wantNight < 0.05,
      tint: gb < nb - 20 && gr > gb + 40 && golden.sunColor !== noon.sunColor && golden.phase === 'golden' && noon.phase === 'day',
      hour: hourEnv.fixed === true && hourEnv.minute === 1260 && hourEnv.wantNight > 0.8,
      envOff: noEnv.draws === 0 && !noEnv.meshes && !errs.length,
      noErrors: errs.length === 0,
    };
    const bad = Object.keys(C).filter(k => !C[k]), ok = bad.length === 0;
    const f = x => (typeof x === 'number' ? +x.toFixed(2) : x);
    return [make('3d-time', ok,
      `${ok ? '' : 'FAILED PARTS: ' + bad.join(', ') + '; '}fixed 13:00 vs 03:00 (house view, zoom 40): lit-window pixels (bluish by day, bright and warm now) ${day.lit} vs ${night.lit}, sun ${day.env.sun} vs ${night.env.sun}, sky ${day.env.hemi} vs ${night.env.hemi}, night ${day.env.night} vs ${night.env.night}; `
      + `the change by the popover slider: ${series.length} samples over ${((series[series.length - 1] || {}).t / 1000).toFixed(1)} s, ${mid.length} between 0.02 and 0.98, never going back ${monotone}, steepest ${f(steepest)} per second (a full change at the intended rate is ${f(1 / full)}, a step would be 5 or more), from 0.02 to 0.98 in ${f(takes)} s (the token CYCLE.turn is ${full} s); `
      + `06:00 asks for night ${dawn.northJan.wantNight} in January and ${dawn.northJul.wantNight} in July in the north, ${dawn.southJan.wantNight} and ${dawn.southJul.wantNight} in the south; 17:30 asks for ${dusk.northDec.wantNight} in December and ${dusk.northJun.wantNight} in June; `
      + `sun colour ${noon.sunColor} at noon, ${golden.sunColor} at 18:55 in June (${golden.phase}); ?hour=21 -> minute ${hourEnv.minute} fixed ${hourEnv.fixed}; ?env=0: ${noEnv.draws} surrounding draw calls, console errors ${errs.length}${errs[0] ? ' ' + errs[0].slice(0, 100) : ''}; phases ${JSON.stringify(phases)}`)];
  } finally { await S.done(); }
}

// ---- 3d-weather
const WX = expr => o3(`(() => { const w = v.__office.weather; return ${expr}; })()`);
// the page's frame cadence over `ms`: the 3D loop's own time per frame (the scene's moving average, sampled), and the gaps between the browser's animation frames
const cadence = ms => o3(`new Promise(res => { const t0 = performance.now(), gaps = [], ms3 = []; let prev = 0;
  const f = t => { if (prev) gaps.push(t - prev); prev = t; if (t - t0 < ${ms}) requestAnimationFrame(f); else res({ gap: gaps.reduce((a, b) => a + b, 0) / gaps.length, frames: gaps.length, ms3: ms3.reduce((a, b) => a + b, 0) / ms3.length }); };
  const timer = setInterval(() => { ms3.push(s.frameMs); if (performance.now() - t0 > ${ms}) clearInterval(timer); }, 200); requestAnimationFrame(f); })`);
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function runWeather(ctx) {
  const S = await scenario3d(4, { tag: 'envwx', root: ctx.root, query: 'time=12:00&season=summer' });
  let rm = null;
  try {
    const { page } = S, ev = e => page.evaluate(e);
    await waitEnv(page, e => e && e.settled);
    await lookAt(page, 20, 0.5, 6, 18);                                                        // a fixed camera for every measurement below
    await sleep(500);
    const calls = async () => (await ev(o3('o.draw()'))).calls;
    const sample = async secs => { await ev(WX('w.resetStats()')); await sleep(secs * 1000); return ev(WX('({ ...w.stats, pixels: w.pixels() })')); };
    // 1. off by default: the overlay does nothing at all
    page.requests.length = 0;                                                                  // from here on: what was asked for while the weather ran (the app's own files are loaded)
    const off = await sample(3);
    const callsOff = await calls();
    const envOff = await ev(ENV);
    // 2. every weather: at most 120 particles, at most 10 frames a second, the scene's own light a little dimmer in rain
    const cases = [['rain', 'summer', '12:00', 'rain'], ['snow', 'summer', '12:00', 'snow'], ['fog', 'summer', '12:00', 'fog'], ['cloudy', 'summer', '12:00', 'cloud'],
      ['clear', 'spring', '12:00', 'petal'], ['clear', 'autumn', '12:00', 'leaf'], ['clear', 'winter', '12:00', 'flake'], ['clear', 'summer', '22:00', 'firefly']];
    const table = [];
    for (const [w, sea, time, kind] of cases) {
      await ev(setting('season', sea)); await ev(setting('time', time)); await ev(setting('weather', w));
      await sleep(400);
      const r = await sample(4), env = await waitEnv(page, e => e.settled, 15000);
      table.push({ label: `${w}${w === 'clear' ? ' ' + sea + (time === '22:00' ? ' night' : '') : ''}`, kind, ...r, fps: r.frames / 4, calls: await calls(), sun: env.sun, night: time === '22:00' });
    }
    await ev(setting('weather', 'off')); await sleep(300); await waitEnv(page, e => e.settled, 15000);
    const callsNight = await calls();
    // 3. hidden page and hidden Office view: nothing is scheduled, nothing is drawn
    await ev(setting('season', 'summer')); await ev(setting('time', '12:00')); await ev(setting('weather', 'rain')); await sleep(600);
    await ev(`Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); document.dispatchEvent(new Event('visibilitychange'))`);
    await sleep(600);
    const hid = await sample(2.5);
    await ev(`delete document.hidden; document.dispatchEvent(new Event('visibilitychange'))`);
    await sleep(800);
    await ev(`document.querySelector('.top .seg button[data-view="pano"]').click()`); await sleep(600);
    const away = await sample(2.5);
    await ev(`document.querySelector('.top .seg button[data-view="ofis"]').click()`); await sleep(500);
    const back = await sample(2.5);
    // 4. the frame time with and without the overlay: three rounds each, the median of each (the 3D loop's time per frame, and the gap between browser animation frames)
    const rounds = [];
    for (let i = 0; i < 3; i++) {
      await ev(setting('weather', 'off')); await sleep(800); const a = await ev(cadence(4000));
      await ev(setting('weather', 'rain')); await sleep(800); const b = await ev(cadence(4000));
      rounds.push({ off: a, rain: b });
    }
    const ft = { off3d: median(rounds.map(r => r.off.ms3)), rain3d: median(rounds.map(r => r.rain.ms3)), offGap: median(rounds.map(r => r.off.gap)), rainGap: median(rounds.map(r => r.rain.gap)) };
    // 5. a rainbow follows rain (automatic weather, spring), and not every clear day has one
    let bow = null, plain = null;
    for (let k = 0; k < 120 && (!bow || !plain); k++) { const day = addDays('2026-03-01', k); if (rainbowFor(day, 'spring')) bow ||= day; else if (weatherFor(day, 'spring') === 'clear') plain ||= day; }
    await ev(setting('season', 'spring')); await ev(setting('weather', 'auto')); await ev(setting('time', '12:00'));
    await ev(atmosphere(`a.setDate(${JSON.stringify(bow)})`)); await sleep(700);
    const withBow = await ev(WX('({ ...w.stats, pixels: w.pixels() })'));
    await ev(atmosphere(`a.setDate(${JSON.stringify(plain)})`)); await sleep(700);
    const noBow = await ev(WX('w.stats'));
    // nothing was asked for from anywhere
    const reqs = page.requests.filter(u => !u.startsWith(`http://127.0.0.1:${S.srv.port}/`) || /weather|forecast|openweather|meteo/i.test(u));
    const errs = page.errors.filter(e => !/\/local\/ofis-extras\.js/.test(e));

    // 6. reduced motion: the weather is off whatever is set
    const R = await scenario3d(4, { tag: 'envwxrm', root: ctx.root, query: 'time=12:00&season=summer&weather=rain', intercept: async p => { await p.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); } });
    try {
      await waitEnv(R.page, e => e && e.settled);
      await sleep(1500);
      await R.page.evaluate(WX('w.resetStats()')); await sleep(3000);
      const r = await R.page.evaluate(WX('({ ...w.stats, pixels: w.pixels(), setting: v.__office.settings.get("weather") })'));
      await R.page.evaluate(`document.querySelector('#set-btn').click()`); await sleep(250);
      const note = await R.page.evaluate(`(() => { const n = document.querySelector('#set-note'); return n.hidden ? '' : n.textContent; })()`);
      rm = { ...r, env: await R.page.evaluate(ENV), note };
    } finally { await R.done(); }

    const rowOk = t => t.count > 0 && t.count <= 120 && t.cap === 120 && t.frames >= 3 && t.p95 <= 4 && t.pixels > 0 && t.fps <= 10.1 && t.active.includes('weather');
    const callsOk = table.filter(t => !t.night).every(t => t.calls === callsOff) && table.find(t => t.night).calls === callsNight;
    const C = {
      off: off.frames === 0 && off.count === 0 && off.kind === null && off.weather === null && !off.active.includes('weather') && off.pixels === 0 && envOff.sun === 2.2,
      weathers: table.length === 8 && table.every(rowOk) && table.every((t, i) => t.kind === cases[i][3]),
      light: table[0].sun < 0.7 * 2.2 && table[2].sun < 0.7 * 2.2 && table[3].sun < 0.85 * 2.2 && table[0].sun < table[3].sun,
      draws: callsOk,
      hidden: hid.frames === 0 && hid.callbacks === 0 && away.frames === 0 && back.frames >= 3,
      frameTime: ft.rain3d <= ft.off3d * 1.3 + 2 && ft.rainGap <= ft.offGap * 1.3 + 8,
      rainbow: withBow.rainbow === true && withBow.pixels > 0 && noBow.rainbow === false,
      reduced: !!rm && rm.weather === null && rm.count === 0 && rm.frames === 0 && rm.pixels === 0 && !rm.active.includes('weather') && rm.setting === 'rain' && rm.env.sun === 2.2 && /Reduced motion/.test(rm.note),
      network: reqs.length === 0,
      noErrors: errs.length === 0,
    };
    const bad = Object.keys(C).filter(k => !C[k]), ok = bad.length === 0, f = x => (typeof x === 'number' ? +x.toFixed(2) : x);
    return [make('3d-weather', ok,
      `${ok ? '' : 'FAILED PARTS: ' + bad.join(', ') + '; '}weather off (3 s): ${off.frames} overlay frames, ${off.count} particles, overlay pixels ${off.pixels}, 'weather' among the scheduler's sources ${off.active.includes('weather')}, sun ${envOff.sun}; `
      + `with weather on (4 s each, cap ${table[0].cap}): ${table.map(t => `${t.label}: ${t.count} particles, ${t.frames} frames (${f(t.fps)} fps), overlay p95 ${t.p95} ms, ${t.pixels} pixels, ${t.calls} draw calls, sun ${t.sun}`).join('; ')} (draw calls with the weather off: ${callsOff} by day, ${callsNight} at night); `
      + `hidden page (2.5 s, rain on): ${hid.frames} frames, ${hid.callbacks} scheduler callbacks; Office view hidden: ${away.frames} frames; back: ${back.frames}; `
      + `frame time, median of 3 rounds of 4 s, weather off vs rain: the 3D loop ${f(ft.off3d)} vs ${f(ft.rain3d)} ms per frame, browser frame gap ${f(ft.offGap)} vs ${f(ft.rainGap)} ms (rounds: ${rounds.map(r => `${f(r.off.ms3)}/${f(r.rain.ms3)}`).join(', ')} ms); `
      + `rainbow on ${bow} (clear after rain, spring, automatic): ${withBow.rainbow} with ${withBow.pixels} overlay pixels, none on ${plain}: ${!noBow.rainbow}; `
      + `reduced motion with ?weather=rain: weather ${rm && rm.weather}, ${rm && rm.count} particles, ${rm && rm.frames} frames, ${rm && rm.pixels} pixels, setting kept as ${rm && rm.setting}, sun ${rm && rm.env.sun}, note "${rm && rm.note.slice(0, 50)}"; `
      + `requests that are not to 127.0.0.1 or name the weather: ${reqs.length}${reqs[0] ? ' (' + reqs[0] + ')' : ''}; console errors ${errs.length}${errs[0] ? ' ' + errs[0].slice(0, 100) : ''}`)];
  } finally { await S.done(); }
}

// ---- 3d-season
// the mean colour of the 3D canvas (the pixels that are drawn), as it is on screen
const MEAN_PX = o3(`(() => { const c = v.querySelector('.of-stage canvas'), gl = c.getContext('webgl2') || c.getContext('webgl'), W = c.width, H = c.height; o.draw();
  const b = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, b); let r = 0, g = 0, bl = 0, n = 0;
  for (let i = 0; i < b.length; i += 4) if (b[i + 3] > 200) { r += b[i]; g += b[i + 1]; bl += b[i + 2]; n++; }
  return [Math.round(r / n), Math.round(g / n), Math.round(bl / n)]; })()`);
const colourDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

async function runSeason(ctx) {
  const S = await scenario3d(4, { tag: 'envsea', root: ctx.root, query: 'time=12:00&season=winter' });
  try {
    const { page } = S, ev = e => page.evaluate(e);
    const first = await waitEnv(page, e => e && e.builtSeason, 20000);               // ?season=winter reaches the first build: no summer island that is recoloured a moment later
    await waitEnv(page, e => e.settled);
    const rooms0 = JSON.stringify(await ev(o3('s.rooms')));
    const zoom0 = await ev(o3('s.zoom'));
    const seen = {};
    for (const season of ['summer', 'autumn', 'winter', 'spring']) {
      await ev(setting('season', season));
      const e = await waitEnv(page, x => x.builtSeason === season && x.season === season, 30000);
      await sleep(500);
      seen[season] = { env: e, mean: await ev(MEAN_PX), calls: (await ev(o3('o.draw()'))).calls, rooms: JSON.stringify(await ev(o3('s.rooms'))), zoom: await ev(o3('s.zoom')) };
    }
    const names = Object.keys(seen);
    const distinct = key => new Set(names.map(n => seen[n].env.colours[key])).size === 4;
    let minMean = Infinity;
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) minMean = Math.min(minMean, colourDist(seen[names[i]].mean, seen[names[j]].mean));
    const sameAll = key => new Set(names.map(n => JSON.stringify(seen[n].env[key]))).size === 1;
    // the season that "auto" picks follows the date and the hemisphere
    await ev(setting('season', 'auto'));
    const auto = {};
    for (const [date, hemi] of [['2026-01-15', 'north'], ['2026-01-15', 'south'], ['2026-04-15', 'north'], ['2026-04-15', 'south'], ['2026-07-15', 'north'], ['2026-10-15', 'north']]) {
      await ev(setting('hemisphere', hemi)); await ev(atmosphere(`a.setDate(${JSON.stringify(date)})`));
      auto[date + ' ' + hemi] = (await waitEnv(page, x => x.builtSeason === x.season && x.settled !== undefined, 30000)).season;
      await waitEnv(page, x => x.builtSeason === x.season, 30000);
    }
    // a season that is chosen stays when the date moves on
    await ev(setting('season', 'autumn')); await ev(atmosphere(`a.setDate('2026-01-15')`)); await waitEnv(page, x => x.builtSeason === 'autumn', 30000); await sleep(1500);
    const kept = await ev(ENV);
    const errs = page.errors.filter(e => !/\/local\/ofis-extras\.js/.test(e));
    const C = {
      address: first.builtSeason === 'winter' && first.colours.grass === seen.winter.env.colours.grass,
      grass: distinct('grass'), round: distinct('round'), pine: distinct('pine'),
      visible: minMean >= 6,
      positions: sameAll('treeSig') && sameAll('trees') && sameAll('tris') && sameAll('meshes') && sameAll('island') && names.every(n => seen[n].rooms === rooms0 && seen[n].zoom === zoom0),
      draws: new Set(names.map(n => seen[n].calls)).size === 1,
      auto: auto['2026-01-15 north'] === 'winter' && auto['2026-01-15 south'] === 'summer' && auto['2026-04-15 north'] === 'spring' && auto['2026-04-15 south'] === 'autumn' && auto['2026-07-15 north'] === 'summer' && auto['2026-10-15 north'] === 'autumn',
      kept: kept.season === 'autumn' && kept.builtSeason === 'autumn',
      noErrors: errs.length === 0,
    };
    const bad = Object.keys(C).filter(k => !C[k]), ok = bad.length === 0;
    return [make('3d-season', ok,
      `${ok ? '' : 'FAILED PARTS: ' + bad.join(', ') + '; '}?season=winter: the first build is ${first.builtSeason}; the grass, the round trees and the pines as built, by season: ${names.map(n => `${n} ${seen[n].env.colours.grass} ${seen[n].env.colours.round} ${seen[n].env.colours.pine}`).join('; ')}; `
      + `mean colour of the canvas: ${names.map(n => `${n} ${seen[n].mean.join(',')}`).join('; ')} (the least apart: ${minMean.toFixed(1)}, need 6); `
      + `trees ${seen.summer.env.trees} at places with signature ${names.map(n => seen[n].env.treeSig).join('/')}, triangles ${names.map(n => seen[n].env.tris).join('/')}, meshes ${names.map(n => seen[n].env.meshes).join('/')}, draw calls ${names.map(n => seen[n].calls).join('/')}, rooms and zoom unchanged ${names.every(n => seen[n].rooms === rooms0 && seen[n].zoom === zoom0)}; `
      + `automatic season: ${Object.entries(auto).map(([k, v]) => `${k} ${v}`).join(', ')}; a chosen season on 2026-01-15: ${kept.season}; console errors ${errs.length}${errs[0] ? ' ' + errs[0].slice(0, 100) : ''}`)];
  } finally { await S.done(); }
}

// ---- mutations: break one line in a copy of the repo and expect the check that guards it to fail
const MUTATIONS = [
  { name: 'the popover is hidden again for the 3D scene', file: 'public/js/main.js', from: 'const on = current === \'ofis\' && !!sceneSettings;', to: 'const on = current === \'ofis\' && !!pixelOffice;', fails: '3d-settings' },
  { name: 'the 3D scene lists every row, camera included', file: 'public/js/main.js', from: 'settingRows: OFFICE3D_ROWS,', to: '', fails: '3d-settings' },
  { name: 'a choice is not remembered', file: 'public/js/office-settings.js', from: 'if (storage) saveSettings(storage, { [key]: v });', to: '', fails: '3d-settings' },
  { name: 'the address does not reach the 3D scene', file: 'public/js/main.js', from: 'createOfficeSettings({ overrides: officeQuery(location.search) })', to: 'createOfficeSettings({ overrides: {} })', fails: '3d-settings' },
  { name: 'the light jumps to the new time instead of moving at the cycle\'s pace', file: 'public/js/ofis-env.js', from: 'approach(shown, want, (dt * 1000) / CYCLE.turn)', to: 'approach(shown, want, 1)', fails: '3d-time' },
  { name: 'the month does not move sunrise and sunset, the hemisphere does not turn the months', file: 'public/js/office-atmosphere.js', from: 'const month = lightMonth(date.getMonth() + 1, settings.hemisphere);', to: 'const month = 10;', fails: '3d-time' },
  { name: 'the fixed time of the popover is ignored: the real clock rules', file: 'public/js/office-atmosphere.js', from: 'const minute = fixed == null ? date.getHours() * 60 + date.getMinutes() : fixed;', to: 'const minute = date.getHours() * 60 + date.getMinutes();', fails: '3d-time' },
  { name: 'dawn and dusk do not tint the sun', file: 'public/js/office-atmosphere.js', from: 'amix: Math.min(0.7, a[3] * 4) * (1 - k)', to: 'amix: 0', fails: '3d-time' },
  { name: 'the weather ignores prefers-reduced-motion', file: 'public/js/office-atmosphere.js', from: 'const weather = reducedMotion ? null : resolveWeather(settings.weather, day, season);', to: 'const weather = resolveWeather(settings.weather, day, season);', fails: '3d-weather' },
  { name: 'the overlay keeps drawing while the page is hidden', file: 'public/js/ofis-weather.js', from: 'isHidden: () => document.hidden || !shown', to: 'isHidden: () => false', fails: '3d-weather' },
  { name: 'the overlay keeps drawing while the Office view is hidden', file: 'public/js/ofis-weather.js', from: 'setVisible(on) { shown = !!on; sched.wake(); }', to: 'setVisible(on) { sched.wake(); }', fails: '3d-weather' },
  { name: 'rain takes no light from the sun', file: 'public/js/office-atmosphere.js', from: 'k, sunDim: w.sun, skyDim: w.sky,', to: 'k, sunDim: 0, skyDim: 0,', fails: '3d-weather' },
  { name: 'the overlay is drawn at 60 frames a second instead of 10', file: 'public/js/ofis-weather.js', from: 'createScheduler({ draw: t => drawFrame(t),', to: 'createScheduler({ maxFps: 60, draw: t => drawFrame(t),', fails: '3d-weather' },
  { name: 'the trees are baked in the colours of summer in every season', file: 'public/js/ofis-env.js', from: 'makePalette(SEASON_PALETTES.tree[season] || SEASON_PALETTES.tree.summer)', to: 'makePalette(SEASON_PALETTES.tree.summer)', fails: '3d-season' },
  { name: 'the grass keeps the colours of summer in every season', file: 'public/js/ofis-env.js', from: 'Object.assign(PAL, { grassA: g.grassA,', to: 'Object.assign({}, { grassA: g.grassA,', fails: '3d-season' },
  { name: 'the automatic season ignores the hemisphere', file: 'public/js/office-atmosphere.js', from: 'seasonOfDate(date, settings.hemisphere)', to: "seasonOfDate(date, 'north')", fails: '3d-season' },
  { name: 'a new season is never built (the island keeps its first colours)', file: 'public/js/ofis-env.js', from: 'atm.state.season !== builtSeason', to: 'false', fails: '3d-season' },
  { name: '?hour= is no longer an alias of ?time=', file: 'public/js/office-settings.js', from: "if (out.time == null && raw != null", to: "if (false && raw != null", fails: '3d-time' },
];

async function runMutations() {
  const rows = [];
  for (const m of MUTATIONS.filter(x => !only || x.fails === '3d-' + only)) {
    const dir = mkdtempSync(join(tmpdir(), 'cco-mut-'));
    try {
      for (const f of ['server.js', 'cost-worker.js', 'demo.js', 'procident.js', 'recent.js', 'chatbridge.js', 'package.json']) cpSync(join(ROOT, f), join(dir, f));
      cpSync(join(ROOT, 'public'), join(dir, 'public'), { recursive: true });
      const file = join(dir, m.file), text = readFileSync(file, 'utf8');
      if (!text.includes(m.from)) { rows.push({ m, caught: false, detail: 'the line to break was not found' }); console.log(`MUTATION MISSED ${m.fails}: ${m.name} -> the line to break was not found`); continue; }
      writeFileSync(file, text.replace(m.from, m.to));
      const res = await CHECKS[m.fails]({ root: dir });
      const r = res.find(x => x.name === m.fails);
      rows.push({ m, caught: !!r && !r.ok, detail: r ? r.detail.slice(0, 220) : 'check did not run' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
    const last = rows[rows.length - 1];
    console.log(`MUTATION ${last.caught ? 'CAUGHT' : 'MISSED'} ${m.fails}: ${m.name} -> ${last.detail}`);
  }
  return rows;
}

// ---- main
const CHECKS = { '3d-settings': runSettings, '3d-time': runTime, '3d-weather': runWeather, '3d-season': runSeason };
const report = [];
const show = r => { report.push(r); console.log(`CHECK ${r.name} ${r.ok ? 'PASS' : 'FAIL'} ${r.detail}`); };
if (args.includes('--mutations')) {
  const rows = await runMutations();
  const missed = rows.filter(r => !r.caught);
  console.log(missed.length ? `MUTATIONS MISSED ${missed.length} of ${rows.length}` : `MUTATIONS ALL CAUGHT (${rows.length})`);
  process.exit(missed.length ? 1 : 0);
}
for (const [name, run] of Object.entries(CHECKS)) if (!only || name === '3d-' + only) for (const r of await run({ root: undefined })) show(r);
const bad = report.filter(r => !r.ok);
console.log(bad.length ? `QA FAIL (${bad.length} of ${report.length} checks)` : `QA PASS (${report.length} checks)`);
process.exit(bad.length ? 1 : 0);
