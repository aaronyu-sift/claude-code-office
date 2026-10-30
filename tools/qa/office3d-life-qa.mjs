// QA of the life in the 3D rooms (public/js/ofis-styles.js: the room styles and where things go, ofis-light.js: the light rules, ofis-decor.js: what is drawn):
// headless Chrome with software WebGL in a throw-away profile, the server against a fake ~/.claude, one `CHECK 3d-room-life PASS|FAIL <detail>` line and a
// final `QA PASS` or `QA FAIL`.
//   node tools/qa/office3d-life-qa.mjs [--scenes night,day,reduced,folder] [--mutations [--mutation <words>[,<words>]]] [--shots <dir>]
//
//   3d-room-life  four scenes: 22:00 with 6 chats (5 offices with a chat, one asleep), 13:00 with 3 chats, 22:00 with 3 chats and prefers-reduced-motion, and
//     22:00 with 4 chats that all work in one folder (their rooms must still differ: the style is the chat's, not the project's)
//     - every office with a chat has a window and a lamp; so has every vacant office (it is the same room), but its lamps are dark and its windows the night sky at 22:00; the plan the scene was given is the style the office was drawn in
//     - two offices differ in style, and the pictures differ (the mean colour of the middle of the office), also when their chats share one folder (scene 4: the look is the slot's, not the chat's or the folder's)
//     - the lamps glow at 22:00 and not at 13:00: the colour that went to the GPU, and the pixels around the lamp with and without the living part
//     - the windows show the sky by day and a warm light at night
//     - the living part is 3 draw calls, the building is inside the typical budget of 3d-vacant (office3d-qa.mjs), nothing leaves 127.0.0.1
//     - the flicker stays inside 8 percent, moves in the 22:00 scene and does not move with prefers-reduced-motion
//
// --mutations breaks the code in a copy of the repo, one line at a time, and runs the check: every one must FAIL (a check that cannot fail guards nothing).
// A mutation names the scenes it needs (`scenes`), so it does not pay for the others. Timing is not part of this check; a failing run on a busy machine
// is worth a second look alone before concluding anything.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scenario3d, lookAt, lookAtRoom, o3, sleep, ROOT } from './harness3d.mjs';

const args = process.argv.slice(2);
const val = f => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : undefined; };
const shotsDir = val('shots');

// the budget of the building as it is used (3 chats in the 11 offices of the X): the same numbers as TYPICAL in office3d-qa.mjs
const TYPICAL = { calls: 76, tris: 161000 };
const LIFE = {
  addedCalls: 3,          // panes, bulbs and flames, glows and pools: one instanced mesh each
  glowNight: 0.6,         // the colour of a lamp's glow at 22:00 (1 is full) and the most it may have at 13:00
  glowDay: 0.02,
  gainNight: 0.02,        // the share of the light the pixels around a lamp gain with the living part, at 22:00 and at 13:00 (a lamp's bulb is under its shade by day)
  gainDay: 0.0008,
  flicker: 0.15,          // the most a source's light may change from its mean (docs/motion.md: ambient scenery stays under 8 percent each way)
  moves: 0.004,           // and at least one source must move at all
  styleGap: 7,            // the mean colours of two offices of different style differ by this much (of 255) at the least
};

const make = (name, ok, detail) => ({ name, ok, detail });
const NIGHT = 'time=22:00', DAY = 'time=13:00';

// ---- what a scene says about its offices
const PROBE = `(() => {
  const c = v.querySelector('.of-stage canvas'), gl = c.getContext('webgl2') || c.getContext('webgl'), W = c.width, H = c.height, Z = s.zoom;
  const half = Math.round(0.6 * Z), w = 2 * half, h = 2 * half, x0 = Math.max(0, Math.round(W / 2) - half), y0 = Math.max(0, Math.round(H / 2) - half);
  const grab = () => { o.draw(); const b = new Uint8Array(w * h * 4); gl.readPixels(x0, H - (y0 + h), w, h, gl.RGBA, gl.UNSIGNED_BYTE, b); return b; };
  const withIt = grab(); o.lifeVisible(false, 'lights'); const without = grab(); o.lifeVisible(true, 'lights');
  let gain = 0, lit = 0;
  for (let i = 0; i < w * h * 4; i += 4) {
    const d = (withIt[i] + withIt[i + 1] + withIt[i + 2]) - (without[i] + without[i + 1] + without[i + 2]);
    if (d > 0) gain += d;
    if (d > 45) lit++;
  }
  return { gain: gain / (w * h * 3 * 255), lit };
})()`;
// the mean colour of the middle of the office on screen (every third pixel of a box around the point the camera looks at)
const MEAN = `(() => {
  const c = v.querySelector('.of-stage canvas'), gl = c.getContext('webgl2') || c.getContext('webgl'), W = c.width, H = c.height, Z = s.zoom;
  const hw = Math.round(3.2 * Z), hh = Math.round(1.6 * Z), x0 = Math.max(0, Math.round(W / 2) - hw), y0 = Math.max(0, Math.round(H / 2) - hh), w = Math.min(W - x0, 2 * hw), h = Math.min(H - y0, 2 * hh);
  o.draw();
  const b = new Uint8Array(w * h * 4); gl.readPixels(x0, H - (y0 + h), w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
  let r = 0, g = 0, bl = 0, n = 0;
  for (let i = 0; i < b.length; i += 12) { r += b[i]; g += b[i + 1]; bl += b[i + 2]; n++; }
  return [r / n, g / n, bl / n];
})()`;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

async function observe({ tag, n, query, reducedMotion = false, root, pictures = false, sampleFlicker = true, fixture }) {
  const S = await scenario3d(n, { tag, query, reducedMotion, root, fixture });
  try {
    const { page, fx } = S;
    const out = { tag, problems: [], notes: [] };
    const bad = m => out.problems.push(`${tag}: ${m}`);
    if (!S.ready.ok) { bad(`the scene did not become ready (${JSON.stringify(S.ready.last)})`); return out; }
    const rooms = fx.agents.filter(a => a.status !== 'dormant');                       // an asleep chat is on the shelf: it has no room
    out.rooms = rooms.length;
    const err = page.errors.filter(e => !/\/local\/ofis-extras\.js/.test(e));
    if (err.length) bad(`console error: ${err[0].slice(0, 140)}`);
    out.foreign = page.requests.filter(u => !/^(data|blob|about):/.test(u) && new URL(u).hostname !== '127.0.0.1');
    if (out.foreign.length) bad(`a request leaves 127.0.0.1: ${out.foreign[0].slice(0, 100)}`);

    const life = await page.evaluate(o3('o.life')), styles = await page.evaluate(o3('o.styles()'));
    if (!life) { bad('the scene has no living part (o.life is empty)'); return out; }
    Object.assign(out, { life, styles });
    const ids = new Set(rooms.map(r => r.id));
    out.reduced = life.reduced;

    // every office with a chat: a window, a lamp, and the style it was drawn in is the style the scene says it has
    const noWindow = rooms.filter(r => !(life.windowsByRoom[r.id] >= 1)), noLamp = rooms.filter(r => !(life.byRoom[r.id] || []).includes('lamp'));
    if (noWindow.length) bad(`${noWindow.length} of ${rooms.length} offices have no window (${noWindow.map(r => r.project).join(', ')})`);
    if (noLamp.length) bad(`${noLamp.length} of ${rooms.length} offices have no lamp (${noLamp.map(r => r.project).join(', ')})`);
    const wrongStyle = rooms.filter(r => !life.rooms[r.id] || life.rooms[r.id].style !== styles[r.id]);
    if (wrongStyle.length) bad(`${wrongStyle.length} offices were drawn in another style than the scene says (${wrongStyle.map(r => `${r.project}: ${(life.rooms[r.id] || {}).style} / ${styles[r.id]}`).join(', ')})`);
    // a vacant office is the slot's own room with the lights off: it has its windows and lamps like an office with a chat (the same furniture), and at night its lamps are dark and its windows are the night sky
    const vacantIds = Object.keys(life.byRoom).filter(id => id !== 'lounge' && !ids.has(id));          // the lounge on the plaza has lamps and candles of its own (office3d-lounge-qa.mjs checks them)
    out.vacant = { offices: vacantIds.length };
    const vacantNoLamp = vacantIds.filter(id => !(life.byRoom[id] || []).includes('lamp'));
    if (vacantNoLamp.length) bad(`${vacantNoLamp.length} vacant offices have no lamp (a vacant office is furnished like the room a chat gets)`);

    // the colour that went to the GPU: the lamps and the windows
    const glows = rooms.map(r => life.lampGlow[r.id]);
    out.glows = glows;
    if (/22:00/.test(query)) { const dim = rooms.filter((r, i) => !(glows[i] >= LIFE.glowNight)); if (dim.length) bad(`${dim.length} lamps are not lit at 22:00 (glow ${glows.map(g => g).join(' ')}, need ${LIFE.glowNight})`); }
    else { const lit = rooms.filter((r, i) => !(glows[i] <= LIFE.glowDay)); if (lit.length) bad(`${lit.length} lamps glow at 13:00 (glow ${glows.join(' ')}, at most ${LIFE.glowDay})`); }
    out.panes = rooms.map(r => life.paneRGB[r.id]);
    const night = /22:00/.test(query);
    const skyBad = rooms.filter((r, i) => { const p = out.panes[i]; return !p || (night ? !(p[0] > p[2] + 0.4) : !(p[2] > p[0] + 0.2)); });
    if (skyBad.length) bad(`${skyBad.length} windows show the wrong thing for ${night ? '22:00 (want a warm light)' : '13:00 (want the sky)'}: ${out.panes.map(p => p && p.join('/')).join(' ')}`);
    // the vacant offices: dark lamps (the colour that went to the GPU) and dark windows at night; by day the same sky as every window
    out.vacant.glows = vacantIds.map(id => life.lampGlow[id]);
    out.vacant.panes = vacantIds.map(id => life.paneRGB[id]);
    if (night) {
      const lit = vacantIds.filter((id, i) => !(out.vacant.glows[i] <= 0.001)), warm = vacantIds.filter((id, i) => { const p = out.vacant.panes[i]; return !p || p[0] > p[2]; });
      if (lit.length) bad(`${lit.length} vacant offices have a lit lamp at 22:00 (glow ${out.vacant.glows.join(' ')}, want 0)`);
      if (warm.length) bad(`${warm.length} vacant offices have a warm window at 22:00 (${out.vacant.panes.map(p => p && p.join('/')).join(' ')}, want the night sky)`);
    } else {
      const dark = vacantIds.filter((id, i) => { const p = out.vacant.panes[i]; return !p || !(p[2] > p[0] + 0.2); });
      if (dark.length) bad(`${dark.length} vacant offices do not show the sky at 13:00 (${out.vacant.panes.map(p => p && p.join('/')).join(' ')})`);
    }

    // the budget, with the camera where the scene put it (the whole building): the living part is three draw calls, the whole building is inside the budget of the building as it is used (3 chats)
    const withLife = await page.evaluate(o3('o.draw()'));
    await page.evaluate(o3('o.lifeVisible(false)'));
    const without = await page.evaluate(o3('o.draw()'));
    await page.evaluate(o3('o.lifeVisible(true)'));
    out.calls = { with: withLife.calls, without: without.calls, tris: withLife.tris, trisWithout: without.tris };
    if (withLife.calls - without.calls > LIFE.addedCalls) bad(`the living part is ${withLife.calls - without.calls} draw calls (at most ${LIFE.addedCalls})`);
    if (n === 3) {
      if (withLife.calls > TYPICAL.calls) bad(`${withLife.calls} draw calls (budget ${TYPICAL.calls})`);
      if (withLife.tris > TYPICAL.tris) bad(`${withLife.tris} triangles (budget ${TYPICAL.tris})`);
    }

    // the pixels around each lamp, with the living part and without it
    out.gain = [];
    for (const r of rooms) {
      const lamp = life.lampAt[r.id];
      if (!lamp) continue;
      await lookAt(page, lamp.x, lamp.y, lamp.z, 110);
      await sleep(120);
      out.gain.push(await page.evaluate(o3(PROBE)));
    }
    const gains = out.gain.map(g => g.gain);
    if (night) { const weak = gains.filter(g => !(g >= LIFE.gainNight)); if (weak.length) bad(`${weak.length} lamps add no light to the picture at 22:00 (${gains.map(g => g.toFixed(4)).join(' ')}, need ${LIFE.gainNight})`); }
    else { const strong = gains.filter(g => !(g <= LIFE.gainDay)); if (strong.length) bad(`${strong.length} lamps add light to the picture at 13:00 (${gains.map(g => g.toFixed(4)).join(' ')}, at most ${LIFE.gainDay})`); }

    // the flicker: every source's light over a second and a half
    if (sampleFlicker && life.glowNow.length) {
      const rows = [];
      for (let i = 0; i < 12; i++) { rows.push(await page.evaluate(o3('o.life.glowNow'))); await sleep(130); }
      let widest = 0, moving = 0, moved = 0;
      const lit = life.glowNow.map((_, j) => rows.map(r => r[j]));
      for (const col of lit) {
        const mx = Math.max(...col), mn = Math.min(...col), mean = col.reduce((a, b) => a + b, 0) / col.length;
        if (mean < 0.05) continue;
        moving++;
        const rel = (mx - mn) / mean;
        widest = Math.max(widest, rel);
        if (rel > LIFE.moves) moved++;
      }
      out.flicker = { sources: moving, moved, widest: +widest.toFixed(3) };
      if (widest > LIFE.flicker) bad(`a source's light changes by ${(widest * 100).toFixed(1)} percent (at most ${LIFE.flicker * 100})`);
      if (reducedMotion) { if (widest !== 0) bad(`prefers-reduced-motion is on and ${moved} sources still flicker (widest ${(widest * 100).toFixed(2)} percent)`); if (!life.reduced) bad('prefers-reduced-motion is on and the scene does not know it'); }
      else if (night && moved === 0) bad(`no source flickers at 22:00 (${moving} sources lit)`);
    }

    // two offices of different project differ in style (the name) and in the picture (the middle of the office)
    if (pictures) {
      const means = [];
      for (const r of rooms) {
        const R = await page.evaluate(o3(`o.room(${JSON.stringify(r.id)})`));
        await lookAt(page, R.X + R.W / 2, 0.6, R.Z + R.D / 2, 34);
        await sleep(100);
        means.push(await page.evaluate(o3(MEAN)));
      }
      out.means = means.map(m => m.map(Math.round));
      let pairs = 0, same = [], styleSame = [], gap = Infinity;
      for (let i = 0; i < rooms.length; i++) for (let j = i + 1; j < rooms.length; j++) {
        pairs++;
        if (styles[rooms[i].id] === styles[rooms[j].id]) styleSame.push(`${rooms[i].project}/${rooms[j].project}`);
        const d = dist(means[i], means[j]);
        gap = Math.min(gap, d);
        if (d < LIFE.styleGap) same.push(`${rooms[i].project}/${rooms[j].project} ${d.toFixed(1)}`);
      }
      out.styleGap = { pairs, gap: +gap.toFixed(1), styles: [...new Set(rooms.map(r => styles[r.id]))].length };
      if (styleSame.length) bad(`offices share a style: ${styleSame.join(', ')}`);
      if (same.length) bad(`offices of different style look alike (mean colour gap under ${LIFE.styleGap}): ${same.join(', ')}`);
    }
    if (shotsDir && pictures) {
      mkdirSync(shotsDir, { recursive: true });
      await lookAtRoom(page, rooms[0].id, 90);
      await sleep(900);
      await page.screenshot(join(shotsDir, `3d-room-life-${tag}.png`));
    }
    return out;
  } finally { await S.done(); }
}

const want = new Set((val('scenes') || 'night,day,reduced,folder').split(','));

// the three scenes
export async function runLife({ root, scenes = want } = {}) {
  const runs = [];
  if (scenes.has('night')) runs.push(await observe({ tag: 'night', n: 6, query: NIGHT, root, pictures: true }));
  if (scenes.has('day')) runs.push(await observe({ tag: 'day', n: 3, query: DAY, root, fixture: { subs: () => [] } }));
  if (scenes.has('reduced')) runs.push(await observe({ tag: 'reduced', n: 3, query: NIGHT, reducedMotion: true, root, fixture: { subs: () => [] } }));
  if (scenes.has('folder')) runs.push(await observe({ tag: 'folder', n: 4, query: NIGHT, root, pictures: true, fixture: { sameProject: 'home', subs: () => [] } }));
  const problems = runs.flatMap(r => r.problems);
  const by = tag => runs.find(r => r.tag === tag);
  const nt = by('night'), dy = by('day'), rd = by('reduced'), fd = by('folder');
  const parts = [];
  if (nt && nt.life) {
    parts.push(`22:00, 6 chats: ${nt.rooms} offices with a chat, each with a window (${Object.values(nt.life.windowsByRoom).join(',')}) and a lamp (${Object.values(nt.life.byRoom).map(k => k.length + ' sources').join(', ')}), ${nt.life.lights} sources in all, `
      + `styles ${Object.values(nt.styles).slice(0, nt.rooms).join(', ')}${nt.styleGap ? ` (${nt.styleGap.styles} different, offices of different style are at least ${nt.styleGap.gap} apart in mean colour, need ${LIFE.styleGap})` : ''}, lamp glow ${nt.glows.join(' ')}, `
      + `light gained around a lamp ${nt.gain.map(g => g.gain.toFixed(3)).join(' ')} (need ${LIFE.gainNight}), calls ${nt.calls.with} (the living part ${nt.calls.with - nt.calls.without}), flicker ${nt.flicker ? `${nt.flicker.moved} of ${nt.flicker.sources} sources move, widest ${(nt.flicker.widest * 100).toFixed(1)} percent` : 'not sampled'}`);
  }
  if (dy && dy.life) parts.push(`13:00, 3 chats: lamp glow ${dy.glows.join(' ')} (at most ${LIFE.glowDay}), light gained ${dy.gain.map(g => g.gain.toFixed(4)).join(' ')} (at most ${LIFE.gainDay}), window ${dy.panes.map(p => p && p.join('/')).join(' ')}, ${dy.calls.with} draw calls (${TYPICAL.calls}) and ${dy.calls.tris} triangles (${TYPICAL.tris})`);
  if (rd && rd.life) parts.push(`22:00 with prefers-reduced-motion, 3 chats: ${rd.flicker ? `${rd.flicker.sources} lit sources, widest change ${(rd.flicker.widest * 100).toFixed(2)} percent` : 'not sampled'}, the scene knows it: ${rd.reduced}`);
  if (fd && fd.styleGap) parts.push(`22:00, 4 chats in one folder: ${fd.styleGap.styles} different styles (${Object.values(fd.styles).slice(0, fd.rooms).join(', ')}), offices of different style at least ${fd.styleGap.gap} apart in mean colour`);
  const foreign = runs.reduce((s, r) => s + (r.foreign ? r.foreign.length : 0), 0);
  parts.push(`requests that leave 127.0.0.1: ${foreign}`);
  return [make('3d-room-life', problems.length === 0 && runs.length > 0, parts.join('; ') + (problems.length ? '; PROBLEMS: ' + problems.slice(0, 5).join(' | ') + (problems.length > 5 ? ` (and ${problems.length - 5} more)` : '') : ''))];
}

// ---- mutations: break one line in a copy of the repo and expect the check to fail
const D = 'public/js/ofis-decor.js', L = 'public/js/ofis-light.js', ST = 'public/js/ofis-styles.js', O = 'public/js/ofis.js';
const MUTATIONS = [
  { name: 'no window is drawn: the pane of a window is never made', file: D, from: "      const pane = (wall, a, y, w, h, extra = {}) => build.panes.push(", to: "      const pane = (wall, a, y, w, h, extra = {}) => extra.kind === 'window' ? 0 : build.panes.push(", scenes: ['night'] },
  { name: 'no lamp: the light sources of a plan are not collected', file: D, from: "      for (const l of plan.lights) build.lights.push(", to: "      for (const l of plan.lights.filter(l => l.kind !== 'lamp')) build.lights.push(", scenes: ['night'] },
  { name: 'the look is the project\'s again: chats in one folder share a style', file: O, from: 'const look = world.looks.get(it.slot);', to: 'const look = world.looks.get(it.vacant ? it.slot : hash(a.project) % world.looks.size);', scenes: ['folder'] },
  { name: 'every office gets the same style', file: ST, from: 'export const styleAt = i => STYLES[STYLE_IDS[((i % N) + N) % N]];', to: 'export const styleAt = i => STYLES[STYLE_IDS[0]];', scenes: ['night'] },
  { name: 'the lamps glow in the daytime', file: L, from: '  const L = LEVEL[kind] || LEVEL.lamp;\n', to: "  if (kind === 'lamp') return { bulb: 1, glow: 1, pool: 1 };\n  const L = LEVEL[kind] || LEVEL.lamp;\n", scenes: ['day'] },
  { name: 'the lamps never light: the light follows a night that never comes', file: D, from: "const v = follower.v, k = v[0], reduced = follower.reduced;", to: "const v = follower.v, k = 0, reduced = follower.reduced;", scenes: ['night'] },
  { name: 'the windows are the sky at night', file: L, from: '  const [k, , skyDim, wmix, wr, wg, wb, amix, ar, ag, ab] = v;\n', to: '  return DAY_SKY.slice();\n  const [k, , skyDim, wmix, wr, wg, wb, amix, ar, ag, ab] = v;\n', scenes: ['night'] },
  { name: 'a request leaves the machine: the glow texture is fetched from a CDN', file: D, from: 'export function createDecor({ atmosphere, aniso = 4 } = {}) {', to: "export function createDecor({ atmosphere, aniso = 4 } = {}) {\n  try { new Image().src = 'https://cdn.example.com/glow.png'; } catch { /* no image */ }", scenes: ['night'] },
  { name: 'the flicker keeps going with prefers-reduced-motion', file: L, from: 'if (reduced) return 1;', to: 'if (false) return 1;', scenes: ['reduced'] },
  { name: 'the flicker is three times as strong', file: L, from: 'candle: 0.07', to: 'candle: 0.3', scenes: ['night'] },
  { name: 'the flicker never moves', file: L, from: 'if (reduced) return 1;', to: 'if (true) return 1;', scenes: ['night'] },
  { name: 'every lamp is its own mesh: 40 more draw calls', file: D, from: "      out.lights = lights;\n", to: "      out.lights = lights;\n      for (let i = 0; i < 40; i++) g.add(new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshBasicMaterial()));\n", scenes: ['day'] },
  { name: 'a vacant office has its lamps and windows lit at night', file: O, from: 'for (const it of items) decor.setLit(it.slot, !it.vacant, instant);', to: 'for (const it of items) decor.setLit(it.slot, true, instant);', scenes: ['night'] },
  { name: 'a vacant office has no lamp: it is furnished without its lights', file: D, from: "      for (const l of plan.lights) build.lights.push(", to: "      for (const l of plan.lights.filter(l => roomId.startsWith('vacant') ? l.kind === 'screen' : true)) build.lights.push(", scenes: ['night'] },
];

async function runMutations() {
  const rows = [];
  const pick = val('mutation');
  for (const m of MUTATIONS.filter(x => !pick || pick.split(',').some(w => x.name.includes(w)))) {
    const dir = mkdtempSync(join(tmpdir(), 'cco-mut-'));
    try {
      for (const f of readdirSync(ROOT).filter(n => /\.(js|json)$/.test(n) && n !== 'package-lock.json')) cpSync(join(ROOT, f), join(dir, f));      // the server and every module it requires
      cpSync(join(ROOT, 'public'), join(dir, 'public'), { recursive: true });
      const file = join(dir, m.file), text = readFileSync(file, 'utf8');
      if (!text.includes(m.from)) { rows.push({ m, caught: false, detail: 'the line to break was not found' }); console.log(`MUTATION MISSED 3d-room-life: ${m.name} -> the line to break was not found`); continue; }
      writeFileSync(file, text.replace(m.from, m.to));
      const [res] = await runLife({ root: dir, scenes: new Set(m.scenes) });
      const at = res.detail.indexOf('PROBLEMS');
      rows.push({ m, caught: !res.ok, detail: res.ok ? 'PASSED: ' + res.detail.slice(0, 200) : 'FAILED: ' + res.detail.slice(at, at + 260) });
    } catch (e) {
      rows.push({ m, caught: false, detail: 'the run itself broke: ' + String(e.message || e).slice(0, 200) });
    } finally { rmSync(dir, { recursive: true, force: true }); }
    const last = rows[rows.length - 1];
    console.log(`MUTATION ${last.caught ? 'CAUGHT' : 'MISSED'} 3d-room-life: ${m.name} -> ${last.detail}`);
  }
  return rows;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  if (args.includes('--mutations')) {
    const rows = await runMutations();
    const missed = rows.filter(r => !r.caught);
    console.log(missed.length ? `MUTATIONS MISSED ${missed.length} of ${rows.length}` : `MUTATIONS ALL CAUGHT (${rows.length})`);
    process.exit(missed.length ? 1 : 0);
  }
  const report = [];
  for (const r of await runLife()) { report.push(r); console.log(`CHECK ${r.name} ${r.ok ? 'PASS' : 'FAIL'} ${r.detail}`); }
  const bad = report.filter(r => !r.ok);
  console.log(bad.length ? `QA FAIL (${bad.length} of ${report.length} checks)` : `QA PASS (${report.length} checks)`);
  process.exit(bad.length ? 1 : 0);
}
