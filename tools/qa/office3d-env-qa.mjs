// QA of the 3D scene's settings and atmosphere (public/js/office-settings.js, ofis-env.js, ofis-weather.js): headless Chrome with software WebGL in a throw-away profile (harness3d.mjs),
// the server against a fake ~/.claude, one `CHECK <name> PASS|FAIL <detail>` line per check and a final `QA PASS` or `QA FAIL`.
//   node tools/qa/office3d-env-qa.mjs [--only settings|time|weather|season] [--mutations]
//
//   3d-settings  the popover shows for the 3D scene with the rows it supports (no camera row), a choice is applied and remembered across a reload and by the pixel scene,
//                the address (?time ?hour ?season ?weather ?hemisphere ?shelf) wins over what is stored and is not stored, and follows a change made with the controls
//
// --mutations breaks the code in a copy of the repo, one line at a time, and runs the check that guards that line: every one must FAIL there (a check that cannot fail guards
// nothing). A failing check is worth running again on its own (--only) before concluding anything: the machine may be busy, and software WebGL is slow.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scenario3d, o3, sleep, ROOT } from './harness3d.mjs';

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

// ---- mutations: break one line in a copy of the repo and expect the check that guards it to fail
const MUTATIONS = [
  { name: 'the popover is hidden again for the 3D scene', file: 'public/js/main.js', from: 'const on = current === \'ofis\' && !!sceneSettings;', to: 'const on = current === \'ofis\' && !!pixelOffice;', fails: '3d-settings' },
  { name: 'the 3D scene lists every row, camera included', file: 'public/js/main.js', from: 'settingRows: OFFICE3D_ROWS,', to: '', fails: '3d-settings' },
  { name: 'a choice is not remembered', file: 'public/js/office-settings.js', from: 'if (storage) saveSettings(storage, { [key]: v });', to: '', fails: '3d-settings' },
  { name: 'the address does not reach the 3D scene', file: 'public/js/main.js', from: 'createOfficeSettings({ overrides: officeQuery(location.search) })', to: 'createOfficeSettings({ overrides: {} })', fails: '3d-settings' },
];

async function runMutations() {
  const rows = [];
  for (const m of MUTATIONS) {
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
const CHECKS = { '3d-settings': runSettings };
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
