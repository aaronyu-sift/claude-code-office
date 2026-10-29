// QA of the 3D scene's models and polish (public/js/ofis*.js): headless Chrome with software WebGL in a throw-away profile, the server against a fake
// ~/.claude, one `CHECK <name> PASS|FAIL <detail>` line per check and a final `QA PASS` or `QA FAIL`.
//   node tools/qa/office3d-qa.mjs [--only boot|budget|agents|fallback] [--shots <dir>] [--mutations]
//
//   3d-boot      the canvas is not blank, no console error, every model file the scene asks for came back 200, nothing leaves 127.0.0.1
//   3d-fallback  models blocked, corrupt, missing or empty: the scene still draws, every piece that fell back says so once; ?assets=procedural asks for nothing
//   3d-budget    at 10 agents: draw calls, triangles, the size of the models and the time a rebuild takes stay inside the budget
//   3d-agents    every agent has a figure, and its colour shows on screen (the figure's own pixels, found by drawing with and without it)
//
// --mutations breaks the code in a copy of the repo, one line at a time, and runs the check that guards that line: every one must FAIL there
// (a check that cannot fail guards nothing). Timing is the one thing a busy machine can bend: the rebuild time is the best of three, and a failing
// check is worth running again on its own (--only budget) before concluding anything.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scenario3d, lookAt, o3, sleep, ROOT } from './harness3d.mjs';
import { MANIFEST } from '../../public/js/ofis-rig.js';
import { writeGlb } from '../models/strip-glb.mjs';

const args = process.argv.slice(2);
const val = f => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : undefined; };
const only = val('only'), shotsDir = val('shots');

// ---- budgets: what the previous agent measured for 10 agents (225 draw calls, 137k triangles, with the packs and the polish) plus 10 percent;
// the models may weigh 1.3 MB (they weigh 1.15 MB). Since the stable layout (public/js/ofis-layout.js) every office is built with 6 desks and a
// lounge from the start: 10 rooms take 218k triangles (was 137k with 3 desks) and a rebuild takes about 150 ms (up to 190 on a busy machine; was 75),
// so the budgets are those plus 10 percent for the triangles and a wide margin for the time. Draw calls did not change (they stayed at 185).
const BUDGET = { calls: 253, tris: 240000, rebuildMs: 250, modelBytes: 1.3e6 };
const COLOUR_MIN_PX = 40;                               // pixels of the agent's colour on a figure's own pixels at zoom 150
const NOISE = /\/local\/ofis-extras\.js/;               // the old scene probes an optional file that is absent (a 404 by design)

const make = (name, ok, detail) => ({ name, ok, detail });
const KEYS = Object.keys(MANIFEST);

// ---- helpers run inside the page
const BLANK = `(async () => {
  o.draw();
  const c = v.querySelector('.of-stage canvas'), img = new Image();
  img.src = c.toDataURL();
  await img.decode();
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, cv.width, cv.height).data, seen = new Set();
  let opaque = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { opaque++; seen.add(((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)); }
  return { w: cv.width, h: cv.height, opaque: +(opaque / (cv.width * cv.height)).toFixed(3), colours: seen.size };
})()`;
const blank = async page => {
  const b = await page.evaluate(o3(BLANK));
  return { ...b, ok: b.opaque >= 0.6 && b.colours >= 60 };
};
// the model files the page fetched, one row per file (every character asks for the shared colour atlas again; the browser answers from its cache)
const models = async page => {
  const rows = await page.evaluate(`performance.getEntriesByType('resource').filter(e => /\\/models\\//.test(e.name)).map(e => ({ url: new URL(e.name).pathname.slice(1), status: e.responseStatus, bytes: e.encodedBodySize }))`);
  const by = new Map();
  for (const r of rows) { const o = by.get(r.url); if (!o || r.status !== 200 || r.bytes > o.bytes) by.set(r.url, { ...r, status: o && o.status !== 200 ? o.status : r.status }); }
  return [...by.values()];
};
const errorsOf = page => page.errors.filter(e => !NOISE.test(e));

// ---- 3d-boot, 3d-budget, 3d-agents: one scene with 10 agents
async function runMain(ctx) {
  const res = [];
  const S = await scenario3d(10, { tag: 'main', root: ctx.root });
  try {
    const { page, agents } = S;
    const mains = agents.filter(a => a.kind === 'main');
    const bl = await blank(page);
    const files = await models(page);
    const byUrl = new Map(files.map(f => [f.url, f]));
    const missing = [...Object.values(MANIFEST), 'models/kenney-mini/Textures/colormap.png'].filter(u => !byUrl.has(u)), bad = files.filter(f => f.status !== 200);
    const errs = errorsOf(page);
    const foreign = page.requests.filter(u => !/^(data|blob|about):/.test(u) && new URL(u).hostname !== '127.0.0.1');
    const st = await page.evaluate(o3('({ rooms: s.rooms.length, models: o.models, look: o.look, err: v.dataset.hata || null })'));
    res.push(make('3d-boot', S.ready.ok && bl.ok && st.rooms === mains.length && !st.err && errs.length === 0 && missing.length === 0 && bad.length === 0 && foreign.length === 0 && st.models.failed.length === 0,
      `scene ready ${S.ready.ok} (${st.rooms}/${mains.length} rooms, error ${st.err}), canvas ${bl.opaque * 100 | 0} percent drawn in ${bl.colours} colours (blank = under 60 percent or 60 colours), console errors ${errs.length}${errs[0] ? ' first: ' + errs[0].slice(0, 140) : ''}, `
      + `${files.length} model files requested, not 200: ${bad.length ? bad.map(f => f.url + ' ' + f.status).join(', ') : 'none'}, never asked for: ${missing.length ? missing.join(', ') : 'none'}, models not used: ${st.models.failed.join(',') || 'none'}, `
      + `requests that leave 127.0.0.1: ${foreign.length ? foreign[0] : 'none'} (of ${page.requests.length})`));

    // budget
    const info = await page.evaluate(o3('o.draw()'));
    let rebuilds = [];
    for (let i = 0; i < 3; i++) rebuilds.push(await page.evaluate(o3('o.rebuildNow()')));
    const first = await page.evaluate(o3('o.rebuildMs')), best = Math.min(...rebuilds);
    const bytes = files.reduce((s, f) => s + f.bytes, 0);
    res.push(make('3d-budget', info.calls <= BUDGET.calls && info.tris <= BUDGET.tris && best <= BUDGET.rebuildMs && bytes <= BUDGET.modelBytes && files.length === KEYS.length + 1,
      `10 agents (${S.expect} figures) at fit zoom: ${info.calls} draw calls (budget ${BUDGET.calls}), ${info.tris} triangles (${BUDGET.tris}), rebuild at ${mains.length} rooms ${rebuilds.map(r => r.toFixed(0)).join(', ')} ms, best ${best.toFixed(0)} (${BUDGET.rebuildMs}), `
      + `${files.length} model files ${(bytes / 1e6).toFixed(2)} MB (${BUDGET.modelBytes / 1e6} MB), ${info.geos} geometries, ${info.tex} textures`));
    ctx.info = { info, rebuilds, bytes, files: files.length, first };

    // agents: every agent has a figure; its colour shows on the figure's own pixels
    const figs = await page.evaluate(o3('o.figures()'));
    const byId = new Map(figs.map(f => [f.id, f]));
    const lost = mains.filter(m => !byId.has(m.id) || !byId.get(m.id).main);
    const subsWorking = agents.filter(a => a.kind === 'sub' && a.status === 'working');
    const subFigs = figs.filter(f => !f.main), packOk = figs.every(f => f.pack);
    const rows = [];
    for (const f of figs) {
      const a = agents.find(x => x.id === f.id);
      await lookAt(page, f.x, 0.6, f.z, 150);
      await sleep(150);
      rows.push({ id: f.id, main: f.main, ...(await page.evaluate(o3(colourProbe(f.id, a.color)))) });
    }
    // the colour as the scene was given it: the agent's own for a chief, a shade of it for a subagent (same hue); and the vertices that carry it
    const hueOf = hex => { const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; return (mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6; };
    const given = figs.filter(f => { const a = agents.find(x => x.id === f.id); let dh = Math.abs(hueOf(f.shirt) - hueOf(a.color)); dh = Math.min(dh, 1 - dh); return f.pack && f.tinted >= 60 && dh < 0.03 && (!f.main || f.shirt.toLowerCase() === a.color.toLowerCase()); });
    const weak = rows.filter(r => r.figure < 300 || r.match < COLOUR_MIN_PX);
    res.push(make('3d-agents', S.ready.ok && lost.length === 0 && subFigs.length > 0 && subFigs.length <= subsWorking.length && packOk && weak.length === 0 && given.length === figs.length,
      `${mains.length} main agents, ${lost.length} without a figure; ${subFigs.length} subagent figures for ${subsWorking.length} working subagents; ${figs.filter(f => f.pack).length}/${figs.length} are pack people; ${given.length}/${figs.length} carry the agent's hue on at least 60 outfit vertices (${Math.min(...figs.map(f => f.tinted))} fewest); `
      + `the agent's colour on the figure's own pixels (zoom 150): ${rows.map(r => r.match).join(' ')} px (least ${Math.min(...rows.map(r => r.match))}, need ${COLOUR_MIN_PX}); figure sizes ${Math.min(...rows.map(r => r.figure))} px at least${weak.length ? '; weak: ' + weak.map(r => `${r.id.slice(0, 7)} ${r.match}/${r.figure}`).join(', ') : ''}`));
    if (shotsDir) await shots(S, ctx);
  } finally { await S.done(); }
  return res;
}

// Draw the scene with the figure and without it: the pixels that differ are the figure's own; count those whose hue is the agent's colour
function colourProbe(id, hex) {
  return `(() => {
    const c = v.querySelector('.of-stage canvas'), gl = c.getContext('webgl2') || c.getContext('webgl'), W = c.width, H = c.height;
    const [cx, cy] = s.charScreen(${JSON.stringify(id)}), Z = s.zoom;
    const x0 = Math.max(0, Math.floor(cx - 0.45 * Z)), x1 = Math.min(W, Math.ceil(cx + 0.45 * Z)), y0 = Math.max(0, Math.floor(cy - 1.0 * Z)), y1 = Math.min(H, Math.ceil(cy + 0.5 * Z));
    const w = x1 - x0, h = y1 - y0, grab = () => { o.draw(); const b = new Uint8Array(w * h * 4); gl.readPixels(x0, H - y1, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
    const withIt = grab(); o.figureVisible(${JSON.stringify(id)}, false); const without = grab(); o.figureVisible(${JSON.stringify(id)}, true);
    const hsl = (r, g, b) => { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; if (mx === mn) return [0, 0, l]; const d = mx - mn, sat = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); const hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; return [hh / 6, sat, l]; };
    const hex = ${JSON.stringify(hex)}, target = hsl(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16));
    let figure = 0, match = 0;
    for (let i = 0; i < w * h * 4; i += 4) {
      if (Math.abs(withIt[i] - without[i]) + Math.abs(withIt[i + 1] - without[i + 1]) + Math.abs(withIt[i + 2] - without[i + 2]) < 24) continue;
      figure++;
      const [hh, sat, l] = hsl(withIt[i], withIt[i + 1], withIt[i + 2]);
      let dh = Math.abs(hh - target[0]); dh = Math.min(dh, 1 - dh);
      if (dh < 0.06 && sat > 0.12 && l > 0.15 && l < 0.93) match++;
    }
    return { figure, match };
  })()`;
}

async function shots(S, ctx) {
  mkdirSync(shotsDir, { recursive: true });
  const main = S.agents.filter(a => a.kind === 'main');
  await S.page.evaluate(o3('s.zoom'));
  await sleep(300);
  await S.page.screenshot(join(shotsDir, '3d-qa-fit.png'));
  console.log('SHOT 3d-qa-fit.png', main.length);
}

// ---- 3d-fallback
function interceptModels(rules) {
  // rules: url path -> 'block' | '404' | 'garbage' | 'empty' ; other model files go through
  return async page => {
    await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/models/*' }] });
    const empty = writeGlb({ json: { asset: { version: '2.0' }, scenes: [{ nodes: [] }] }, bin: Buffer.alloc(0) });
    page.on(async d => {
      if (d.method !== 'Fetch.requestPaused') return;
      const { requestId, request } = d.params, path = new URL(request.url).pathname.slice(1), rule = rules(path);
      const reply = (code, body) => page.send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: [{ name: 'Content-Type', value: 'model/gltf-binary' }], body: Buffer.from(body).toString('base64') }).catch(() => {});
      if (rule === 'block') await page.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {});
      else if (rule === '404') await reply(404, 'not found');
      else if (rule === 'garbage') await reply(200, 'this is not a glTF binary, only text '.repeat(40));
      else if (rule === 'empty') await reply(200, empty);
      else await page.send('Fetch.continueRequest', { requestId }).catch(() => {});
    });
  };
}
const keyOf = path => KEYS.find(k => MANIFEST[k] === path);

async function fallbackCase(ctx, name, { rules, query = '', expectFailed, expectLoaded, noPeople, noRequests }) {
  const S = await scenario3d(4, { tag: 'fb' + name, root: ctx.root, query, intercept: rules ? interceptModels(rules) : null });
  try {
    const { page } = S;
    const bl = await blank(page);
    const st = await page.evaluate(o3('({ models: o.models, look: o.look, figs: o.figures(), rooms: s.rooms.length, err: v.dataset.hata || null })'));
    const mine = page.warnings.filter(w => /^\[office-3d\] model "/.test(w));
    const warned = mine.map(w => /model "([^"]+)"/.exec(w)[1]);
    const dup = warned.filter((k, i) => warned.indexOf(k) !== i);
    const errs = errorsOf(page).filter(e => !/\/models\/|Failed to load resource|net::ERR/.test(e));
    const failed = [...st.models.failed].sort().join(','), want = [...expectFailed].sort().join(',');
    const req = page.requests.filter(u => /\/models\//.test(u)).length;
    const ok = S.ready.ok && bl.ok && st.rooms === 4 && !st.err && errs.length === 0 && failed === want && [...new Set(warned)].sort().join(',') === want && dup.length === 0
      && (!expectLoaded || expectLoaded.every(k => st.models.loaded.includes(k))) && (!noPeople || st.figs.every(f => !f.pack)) && (!noRequests || req === 0);
    return { ok, text: `${name}: ready ${S.ready.ok}, canvas ${bl.opaque * 100 | 0} percent in ${bl.colours} colours, ${st.figs.length} figures (${st.figs.filter(f => f.pack).length} pack people), errors ${errs.length}${errs[0] ? ' ' + errs[0].slice(0, 100) : ''}, models not used ${st.models.failed.length} (${failed === want ? 'as expected' : 'expected ' + expectFailed.length + ': ' + (failed.length > 150 ? failed.slice(0, 150) + '...' : failed)}), `
      + `warnings ${mine.length} for ${new Set(warned).size} pieces${dup.length ? ', repeated: ' + dup.join(',') : ''}${noRequests ? `, model requests ${req}` : ''}` };
  } finally { await S.done(); }
}

async function runFallback(ctx) {
  const all = KEYS;
  const cases = [];
  cases.push(await fallbackCase(ctx, 'blocked', { rules: () => 'block', expectFailed: all, noPeople: true }));
  cases.push(await fallbackCase(ctx, 'corrupt', { rules: p => (/\.glb$/.test(p) ? 'garbage' : 'pass'), expectFailed: all, noPeople: true }));
  const partial = { 'models/kenney-furniture/desk.glb': '404', 'models/kenney-mini/character-female-e.glb': 'garbage', 'models/kenney-furniture/chairDesk.glb': 'empty', 'models/kenney-nature/tree_oak.glb': 'block' };
  cases.push(await fallbackCase(ctx, 'partial', { rules: p => partial[p] || 'pass', expectFailed: Object.keys(partial).map(keyOf), expectLoaded: ['screen', 'keyboard', 'p0', 'p9', 'treeA', 'rock1'] }));
  cases.push(await fallbackCase(ctx, 'procedural', { query: 'assets=procedural', expectFailed: [], noPeople: true, noRequests: true }));
  return [make('3d-fallback', cases.every(c => c.ok), cases.map(c => (c.ok ? 'ok ' : 'WRONG ') + c.text).join(' | '))];
}

// ---- mutations: break one line in a copy of the repo and expect the check that guards it to fail
const MUTATIONS = [
  { name: 'a missing piece throws instead of falling back', file: 'public/js/ofis.js', from: "    const src = PK[key];\n    if (!src) return null;", to: "    const src = PK[key];\n    if (!src) throw new Error('piece missing');", group: 'fallback', fails: '3d-fallback' },
  { name: 'a loaded file is never judged (an empty glTF counts as a model)', file: 'public/js/ofis-rig.js', from: "  return facts.meshes > 0 ? null : 'no mesh';", to: '  return null;', group: 'fallback', fails: '3d-fallback' },
  { name: 'a failed file is not reported', file: 'public/js/ofis-assets.js', from: "failed.set(key, why); warn(key, warnText(key, manifest[key], why));", to: 'failed.set(key, why);', group: 'fallback', fails: '3d-fallback' },
  { name: 'unbatched extras: 30 more meshes per figure', file: 'public/js/ofis.js', from: "      root.add(bl);\n", to: "      root.add(bl);\n      for (let i = 0; i < 30; i++) root.add(new THREE.Mesh(GEO.blobPlane, MAT.blob));\n", group: 'main', fails: '3d-budget' },
  { name: 'the occlusion pass takes ten times the rays', file: 'public/js/ofis-polish.js', from: 'const NDIR = 14;', to: 'const NDIR = 140;', group: 'main', fails: '3d-budget' },
  { name: 'the agent colour is not put on the outfit', file: 'public/js/ofis-assets.js', from: 'const tint = shirt ? new THREE.Color(shirt) : null;', to: 'const tint = null;', group: 'main', fails: '3d-agents' },
  { name: 'a model path is wrong', file: 'public/js/ofis-rig.js', from: "desk: F + 'desk.glb'", to: "desk: F + 'deskk.glb'", group: 'main', fails: '3d-boot' },
];

async function runMutations() {
  const rows = [];
  for (const m of MUTATIONS) {
    const dir = mkdtempSync(join(tmpdir(), 'cco-mut-'));
    try {
      for (const f of ['server.js', 'cost-worker.js', 'demo.js', 'procident.js', 'recent.js', 'chatbridge.js', 'package.json']) cpSync(join(ROOT, f), join(dir, f));
      cpSync(join(ROOT, 'public'), join(dir, 'public'), { recursive: true });
      const file = join(dir, m.file), text = readFileSync(file, 'utf8');
      if (!text.includes(m.from)) { rows.push({ m, caught: false, detail: 'the line to break was not found' }); continue; }
      writeFileSync(file, text.replace(m.from, m.to));
      const res = await (m.group === 'fallback' ? runFallback : runMain)({ root: dir });
      const r = res.find(x => x.name === m.fails);
      rows.push({ m, caught: !!r && !r.ok, detail: r ? r.detail.slice(0, 220) : 'check did not run' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
    const last = rows[rows.length - 1];
    console.log(`MUTATION ${last.caught ? 'CAUGHT' : 'MISSED'} ${m.fails}: ${m.name} -> ${last.detail}`);
  }
  return rows;
}

// ---- main
const ctx = { root: undefined };
const report = [];
const show = r => { report.push(r); console.log(`CHECK ${r.name} ${r.ok ? 'PASS' : 'FAIL'} ${r.detail}`); };
if (args.includes('--mutations')) {
  const rows = await runMutations();
  const missed = rows.filter(r => !r.caught);
  console.log(missed.length ? `MUTATIONS MISSED ${missed.length} of ${rows.length}` : `MUTATIONS ALL CAUGHT (${rows.length})`);
  process.exit(missed.length ? 1 : 0);
}
if (!only || ['boot', 'budget', 'agents'].includes(only)) for (const r of await runMain(ctx)) if (!only || r.name === '3d-' + only) show(r);
if (!only || only === 'fallback') for (const r of await runFallback(ctx)) show(r);
const bad = report.filter(r => !r.ok);
console.log(bad.length ? `QA FAIL (${bad.length} of ${report.length} checks)` : `QA PASS (${report.length} checks)`);
process.exit(bad.length ? 1 : 0);
