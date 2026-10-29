// QA of the 3D scene's models and polish (public/js/ofis*.js): headless Chrome with software WebGL in a throw-away profile, the server against a fake
// ~/.claude, one `CHECK <name> PASS|FAIL <detail>` line per check and a final `QA PASS` or `QA FAIL`.
//   node tools/qa/office3d-qa.mjs [--only boot|budget|agents|fallback|stable-layout|expand] [--shots <dir>] [--mutations [--group main|fallback|stable]]
//
//   3d-boot      the canvas is not blank, no console error, every model file the scene asks for came back 200, nothing leaves 127.0.0.1
//   3d-fallback  models blocked, corrupt, missing or empty: the scene still draws, every piece that fell back says so once; ?assets=procedural asks for nothing
//   3d-budget    at 10 agents: draw calls, triangles, the size of the models and the time a rebuild takes stay inside the budget
//   3d-agents    every agent has a figure, and its colour shows on screen (the figure's own pixels, found by drawing with and without it)
//   3d-stable-layout  3, 7 and 10 chats open, 4 close, others come, one sleeps and wakes: no office changes its rectangle, no chat its slot, no seated
//                figure its place, a new chat takes the lowest free slot, and the camera is not refitted while the building stays the same
//   3d-expand    a chat whose sub-agents outgrow its 6 desks grows its room inside its cell and nothing else changes; the 11th chat appends a row
//                (the first ten offices, their chats and the sub-agents still walking stay as they are)
//
// --mutations breaks the code in a copy of the repo, one line at a time, and runs the check that guards that line: every one must FAIL there
// (a check that cannot fail guards nothing). Timing is the one thing a busy machine can bend: the rebuild time is the best of three, and a failing
// check is worth running again on its own (--only budget) before concluding anything.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, renameSync, utimesSync } from 'node:fs';
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
const BUDGET = { calls: 253, tris: 240000, rebuildMs: 280, modelBytes: 1.3e6 };
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
    const mains = agents.filter(a => a.kind === 'main' && a.status !== 'dormant');           // an asleep chat is on the shelf: it has no room
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
      `10 agents (${S.expect} figures) at fit zoom: ${info.calls} draw calls (budget ${BUDGET.calls}), ${info.tris} triangles (${BUDGET.tris}), rebuild of the 10 offices (${mains.length} with a chat) ${rebuilds.map(r => r.toFixed(0)).join(', ')} ms, best ${best.toFixed(0)} (${BUDGET.rebuildMs}), `
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
  // the stable layout: each of these breaks one rule of public/js/ofis-layout.js or of the way ofis.js draws it
  { name: 'slots are not sticky: every chat is handed a slot again on every update', file: 'public/js/ofis-layout.js', from: 'const fresh = chats.filter(c => !slotOf.has(c.id))', to: 'const fresh = chats.filter(() => true)', group: 'stable', fails: ['3d-stable-layout', '3d-expand'] },
  { name: 'an expansion repacks the rows: the row size follows the number of chats', file: 'public/js/ofis.js', from: 'const P = buildingPlan(plan.rows, slots.perRow, leads);', to: 'const P = buildingPlan(plan.rows, Math.max(slots.perRow, Math.ceil(list.length / 2)), leads);', group: 'stable', fails: '3d-expand' },
  { name: 'the camera refits at every rebuild, not only when the building changed', file: 'public/js/ofis.js', from: 'const changed = key !== fitKey;', to: 'const changed = true;', group: 'stable', fails: ['3d-stable-layout', '3d-expand'] },
  { name: 'a rebuild seats the sub-agents that are still walking', file: 'public/js/ofis.js', from: "if (c.mode === 'walk' && c.path && (c.slot < 0", to: "if (false && c.mode === 'walk' && c.path && (c.slot < 0", group: 'stable', fails: '3d-expand' },
];

async function runMutations() {
  const rows = [];
  for (const m of MUTATIONS.filter(x => !val('group') || x.group === val('group'))) {
    const dir = mkdtempSync(join(tmpdir(), 'cco-mut-'));
    try {
      for (const f of ['server.js', 'cost-worker.js', 'demo.js', 'procident.js', 'recent.js', 'chatbridge.js', 'package.json']) cpSync(join(ROOT, f), join(dir, f));
      cpSync(join(ROOT, 'public'), join(dir, 'public'), { recursive: true });
      const file = join(dir, m.file), text = readFileSync(file, 'utf8');
      if (!text.includes(m.from)) { rows.push({ m, caught: false, detail: 'the line to break was not found' }); continue; }
      writeFileSync(file, text.replace(m.from, m.to));
      const res = await ({ fallback: runFallback, stable: runStable }[m.group] || runMain)({ root: dir });
      const want = [].concat(m.fails), got = want.map(n => res.find(x => x.name === n));
      rows.push({ m, caught: got.every(r => r && !r.ok), detail: got.map((r, i) => (r ? `${want[i]} ${r.ok ? 'PASSED' : 'FAILED'}: ${r.detail.slice(r.ok ? 0 : r.detail.indexOf('PROBLEMS'), (r.ok ? 0 : r.detail.indexOf('PROBLEMS')) + 230)}` : `${want[i]} did not run`)).join(' || ') });
    } finally { rmSync(dir, { recursive: true, force: true }); }
    const last = rows[rows.length - 1];
    console.log(`MUTATION ${last.caught ? 'CAUGHT' : 'MISSED'} ${m.fails}: ${m.name} -> ${last.detail}`);
  }
  return rows;
}

// ---- 3d-stable-layout, 3d-expand: chats come and go while one building is watched (public/js/ofis-layout.js decides, ofis.js draws)
// 16 sessions are on disk; the ones that are not open yet are put away before the server starts and come back one by one, so the page really sees
// them appear. After every step the building is read again (`o.office()`: every office with its rectangle, vacant ones included) and compared
// with the step before: no office may change its rectangle, no chat may change its slot, no seated figure may move, and a building that did not
// change must not refit the camera (`o.fits` counts the refits a changed building caused, `s.zoom` is the view).
const CHAT_STATUS = ['working', 'working', 'waiting', 'working', 'working', 'ask', 'working', 'waiting', 'working', 'waiting', 'working', 'dormant', 'working', 'waiting', 'working', 'working'];
const WALK_SPEED = 2.2;                                  // units per second (WALK in ofis.js)
const MANY = 3;                                          // the chat with nine working sub-agents: five from the start, four come later (the room has 6 desks)
const rectKey = s => [...[s.X, s.Z, s.W, s.D].map(v => +v.toFixed(3)), s.door, s.hall].join(',');            // to the millimetre

async function runStable(ctx) {
  const dirs = {};
  const putAway = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);          // every session but the first three
  const lateSubs = [5, 6, 7, 8];
  const subFiles = (fx, i, k) => {
    const a = fx.agents[i], id = a.subs[k].id.split(':')[1];
    const d = join(dirs.dir, 'projects', `/qa/ws/${a.project}`.replace(/[^a-zA-Z0-9]/g, '-'), a.id, 'subagents');
    return [join(d, `agent-${id}.jsonl`), join(d, `agent-${id}.meta.json`)];
  };
  const S = await scenario3d(16, {
    tag: 'stable', root: ctx.root,
    fixture: { statuses: CHAT_STATUS, subs: i => (i === MANY ? Array(9).fill('working') : i % 3 === 0 && i < 12 ? ['working'] : []) },
    beforeServer: async (fx, dir) => {
      dirs.dir = dir;
      mkdirSync(join(dir, 'stash', 'subs'), { recursive: true });
      for (const i of putAway) renameSync(join(dir, 'sessions', fx.pids[i] + '.json'), join(dir, 'stash', fx.pids[i] + '.json'));
      for (const k of lateSubs) subFiles(fx, MANY, k).forEach((f, j) => renameSync(f, join(dir, 'stash', 'subs', `${k}.${j}`)));
    },
  });
  const res = [];
  try {
    const { page, fx } = S;
    const id = i => fx.agents[i].id;
    const open = i => renameSync(join(dirs.dir, 'stash', fx.pids[i] + '.json'), join(dirs.dir, 'sessions', fx.pids[i] + '.json'));
    const openSubs = () => lateSubs.forEach(k => subFiles(fx, MANY, k).forEach((f, j) => { renameSync(join(dirs.dir, 'stash', 'subs', `${k}.${j}`), f); utimesSync(f, Date.now() / 1000, Date.now() / 1000); }));
    const wake = i => {
      const f = join(dirs.dir, 'sessions', fx.pids[i] + '.json');
      writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, 'utf8')), status: 'busy', statusUpdatedAt: Date.now() }));
    };
    const read = () => page.evaluate(o3(`({ office: o.office(), figs: o.figures().map(f => ({ id: f.id, main: f.main, mode: f.mode, x: +f.x.toFixed(3), z: +f.z.toFixed(3) })),
      rooms: s.rooms.map(r => ({ id: r.id, slot: r.slot, cls: r.cls })), zoom: s.zoom, fits: o.fits, t: performance.now(), err: v.dataset.hata || null })`));
    // wait until the scene shows `n` chats with a room (and a chief each), then give a rebuild a moment to finish
    const settle = async (n, more = () => true) => {
      for (let t = 0; t < 100; t++) {
        const st = await read().catch(() => null);
        if (st && st.rooms.length === n && st.figs.filter(f => f.main).length === n && more(st)) { await sleep(500); return read(); }
        await sleep(300);
      }
      return read();
    };
    const slotOf = st => new Map(st.rooms.map(r => [r.id, r.slot]));
    const seated = st => new Map(st.figs.filter(f => f.mode === 'seated').map(f => [f.id, f]));
    const stats = { offices: 0, kept: 0, figs: 0 };
    // what must stay the same between two readings; `extra`: the slots allowed to change (a room that grew: its capacity, not its place)
    const compare = (a, b, label, { same = true, grow = [] } = {}) => {
      const bad = [];
      const n = Math.min(a.office.slots.length, b.office.slots.length);
      for (let i = 0; i < n; i++) {
        stats.offices++;
        if (rectKey(a.office.slots[i]) !== rectKey(b.office.slots[i])) bad.push(`${label}: office ${i} changed its rectangle ${rectKey(a.office.slots[i])} -> ${rectKey(b.office.slots[i])}`);
        if (!grow.includes(i) && a.office.slots[i].cap !== b.office.slots[i].cap) bad.push(`${label}: office ${i} changed its desks`);
      }
      if (JSON.stringify(a.office.halls[0]) !== JSON.stringify(b.office.halls[0])) bad.push(`${label}: the first hall (the reception) changed`);
      const sb = slotOf(b);
      for (const [cid, s] of slotOf(a)) if (sb.has(cid)) { stats.kept++; if (sb.get(cid) !== s) bad.push(`${label}: chat ${cid.slice(0, 6)} moved from slot ${s} to ${sb.get(cid)}`); }
      const fb = seated(b);
      for (const [fid, f] of seated(a)) { const g = fb.get(fid); if (g) { stats.figs++; if (g.x !== f.x || g.z !== f.z) bad.push(`${label}: figure ${fid.slice(0, 10)} moved (${f.x},${f.z}) -> (${g.x},${g.z})`); } }
      if (same && (a.zoom !== b.zoom || a.fits !== b.fits)) bad.push(`${label}: the camera was refitted (zoom ${a.zoom} -> ${b.zoom}, refits ${a.fits} -> ${b.fits}) but the building did not change`);
      if (b.err) bad.push(`${label}: scene error ${b.err}`);
      return bad;
    };
    const vacant = st => st.office.slots.filter(s => s.vacant).length;
    const problems = [], notes = [];

    // ---- 3 chats
    const s3 = await settle(3);
    const first = s3.office.slots.map(rectKey);
    if (s3.office.slots.length !== 10 || s3.office.rows !== 2 || vacant(s3) !== 7) problems.push(`3 chats: ${s3.office.slots.length} offices in ${s3.office.rows} rows, ${vacant(s3)} vacant (want 10 in 2, 7 vacant)`);
    if (![0, 1, 2].every(i => slotOf(s3).get(id(i)) === i)) problems.push(`3 chats: slots ${[0, 1, 2].map(i => slotOf(s3).get(id(i)))} (want 0,1,2)`);
    // ---- 7 chats
    [3, 4, 5, 6].forEach(open);
    const s7 = await settle(7);
    problems.push(...compare(s3, s7, '3 -> 7 chats'));
    if (![3, 4, 5, 6].every(i => slotOf(s7).get(id(i)) === i)) problems.push(`7 chats: new chats took slots ${[3, 4, 5, 6].map(i => slotOf(s7).get(id(i)))} (want the lowest free ones, 3,4,5,6)`);
    // ---- 10 chats
    [7, 8, 9].forEach(open);
    const s10 = await settle(10);
    problems.push(...compare(s7, s10, '7 -> 10 chats'));
    if (s10.office.slots.length !== 10 || vacant(s10) !== 0 || s10.office.rows !== 2) problems.push(`10 chats: ${s10.office.slots.length} offices, ${vacant(s10)} vacant, ${s10.office.rows} rows (want 10, 0, 2)`);
    // ---- four chats close: their offices turn vacant and nobody else moves
    const closing = [1, 4, 6, 8];
    closing.forEach(i => fx.closeSession(id(i)));
    const s6 = await settle(6);
    problems.push(...compare(s10, s6, '10 -> 6 chats (4 closed)'));
    const free = s6.office.slots.filter(s => s.vacant).map(s => s.slot).join();
    if (free !== closing.join()) problems.push(`4 closed: vacant slots ${free} (want ${closing.join()})`);
    // ---- the next chat takes the lowest free slot
    open(10);
    const s7b = await settle(7);
    problems.push(...compare(s6, s7b, '6 -> 7 chats (a new chat)'));
    if (slotOf(s7b).get(id(10)) !== 1) problems.push(`a new chat took slot ${slotOf(s7b).get(id(10))} (want the lowest free one, 1)`);
    // ---- an asleep chat has no room (it is on the shelf); when it wakes it takes the lowest free slot
    open(11);
    await sleep(2500);
    const sAsleep = await read();
    problems.push(...compare(s7b, sAsleep, 'a sleeping chat appears'));
    if (sAsleep.rooms.length !== 7 || slotOf(sAsleep).has(id(11))) problems.push(`a sleeping chat has a room (${sAsleep.rooms.length} rooms)`);
    wake(11);
    const s8 = await settle(8);
    problems.push(...compare(sAsleep, s8, 'a chat wakes'));
    if (slotOf(s8).get(id(11)) !== 4) problems.push(`the chat that woke took slot ${slotOf(s8).get(id(11))} (want the lowest free one, 4)`);
    // ---- back to ten chats: the two newcomers fill the last free offices, in the order they come
    [12, 13].forEach(open);
    const sTen = await settle(10);
    problems.push(...compare(s8, sTen, '8 -> 10 chats'));
    if (sTen.office.slots.length !== 10 || vacant(sTen) !== 0 || slotOf(sTen).get(id(12)) !== 6 || slotOf(sTen).get(id(13)) !== 8) {
      problems.push(`10 chats again: ${sTen.office.slots.length} offices, ${vacant(sTen)} vacant, slots ${slotOf(sTen).get(id(12))},${slotOf(sTen).get(id(13))} (want 10, 0, 6, 8)`);
    }
    res.push(make('3d-stable-layout', S.ready.ok && problems.length === 0,
      `3, 7 and 10 chats came, 4 closed, 1 came, 1 slept and woke, 2 came: ${stats.offices} office rectangles compared (all ${first.length} offices exist at 3 chats: ${vacant(s3)} vacant), ${stats.kept} chat slots kept, ${stats.figs} seated figures kept their place, `
      + `camera refits ${s3.fits} -> ${sTen.fits} at zoom ${s3.zoom.toFixed(2)} -> ${sTen.zoom.toFixed(2)}; new chats took the lowest free slots; a sleeping chat had no room and took slot ${slotOf(s8).get(id(11))} on waking`
      + (problems.length ? '; PROBLEMS: ' + problems.slice(0, 4).join(' | ') + (problems.length > 4 ? ` (and ${problems.length - 4} more)` : '') : '')));

    // ---- 3d-expand: a chat whose sub-agents outgrow its room, then the 11th chat
    const ex = [];
    const room3 = st => st.office.slots.find(s => s.id === id(MANY));
    const before = sTen, desks0 = room3(before).cap;
    openSubs();
    const sGrow = await settle(10, st => room3(st).cap > desks0);
    const subsOf3 = st => st.figs.filter(f => f.id.startsWith(id(MANY) + ':')).length;
    ex.push(...compare(before, sGrow, 'a chat with nine sub-agents', { grow: [room3(before).slot] }));
    if (room3(sGrow).cap !== 12 || room3(sGrow).cls !== 2) ex.push(`its room has ${room3(sGrow).cap} desks in class ${room3(sGrow).cls} (want 12 and 2)`);
    if (sGrow.office.rows !== 2) ex.push(`${sGrow.office.rows} rows (want 2: no chat was added)`);
    const growWait = await settle(10, st => subsOf3(st) >= 9);
    if (subsOf3(growWait) !== 9) ex.push(`${subsOf3(growWait)} figures for the nine sub-agents`);
    // the 11th chat: a row is appended, the first ten offices stay
    const tenSlots = slotOf(growWait);
    open(14);
    const s11 = await settle(11);
    ex.push(...compare(growWait, s11, '10 -> 11 chats', { same: false }));
    if (s11.office.rows !== 3 || s11.office.slots.length !== 15 || vacant(s11) !== 4) ex.push(`11 chats: ${s11.office.slots.length} offices in ${s11.office.rows} rows, ${vacant(s11)} vacant (want 15 in 3, 4 vacant)`);
    if (slotOf(s11).get(id(14)) !== 10) ex.push(`the 11th chat took slot ${slotOf(s11).get(id(14))} (want 10, the first office of the new row)`);
    for (const [cid, sl] of tenSlots) if (slotOf(s11).get(cid) !== sl) ex.push(`chat ${cid.slice(0, 6)} lost its slot ${sl}`);
    if (s11.fits !== growWait.fits + 1 || !(s11.zoom < growWait.zoom)) ex.push(`the view did not refit once to the bigger building (refits ${growWait.fits} -> ${s11.fits}, zoom ${growWait.zoom.toFixed(2)} -> ${s11.zoom.toFixed(2)})`);
    if (subsOf3(s11) !== 9) ex.push(`${subsOf3(s11)} figures of the nine sub-agents after the rebuild`);
    // the sub-agents still walking in when the building grew must go on walking from where they were (a rebuild that seated them would jump them to their desks)
    const walkers = growWait.figs.filter(f => f.mode === 'walk' && s11.figs.some(g => g.id === f.id));
    const maxStep = WALK_SPEED * (s11.t - growWait.t) / 1000 * 1.5 + 0.6;
    const jumped = walkers.filter(f => { const g = s11.figs.find(x => x.id === f.id); return Math.hypot(g.x - f.x, g.z - f.z) > maxStep; });
    if (!walkers.length) ex.push('no sub-agent was walking when the 11th chat came: the walkers check had nothing to look at');
    if (jumped.length) ex.push(`${jumped.length} of ${walkers.length} walking sub-agents jumped when the building grew`);
    await sleep(2500);
    const sLater = await read();
    ex.push(...compare(s11, sLater, 'a quiet moment after the expansion'));
    res.push(make('3d-expand', S.ready.ok && ex.length === 0,
      `a chat went from 5 to 9 working sub-agents (6 desks): its room grew ${desks0} -> ${room3(sGrow).cap} desks inside its cell (${rectKey(room3(sGrow))} unchanged), no other office, chat or seated figure changed and the view did not refit; `
      + `the 11th chat took slot ${slotOf(s11).get(id(14))}: ${s11.office.slots.length} offices in ${s11.office.rows} rows, the first ten offices and their ${tenSlots.size} chats unchanged, ${subsOf3(s11)} sub-agent figures kept, `
      + `${walkers.length} walkers went on walking, one refit (zoom ${growWait.zoom.toFixed(2)} -> ${s11.zoom.toFixed(2)})`
      + (ex.length ? '; PROBLEMS: ' + ex.slice(0, 4).join(' | ') + (ex.length > 4 ? ` (and ${ex.length - 4} more)` : '') : '')));
  } finally { await S.done(); }
  return res;
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
if (!only || only === 'stable-layout' || only === 'expand') for (const r of await runStable(ctx)) if (!only || r.name === '3d-' + only) show(r);
const bad = report.filter(r => !r.ok);
console.log(bad.length ? `QA FAIL (${bad.length} of ${report.length} checks)` : `QA PASS (${report.length} checks)`);
process.exit(bad.length ? 1 : 0);
