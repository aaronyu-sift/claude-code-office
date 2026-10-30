// QA of the depth ties in the 3D scene (public/js/ofis*.js): headless Chrome with software WebGL in a throw-away profile, the server against a fake ~/.claude, one
// `CHECK <name> PASS|FAIL <detail>` line per check and a final `QA PASS` or `QA FAIL`.
//   node tools/qa/office3d-coplanar-qa.mjs [--only 10|3] [--list] [--root <copy>] [--mutations [--mutation <words>]] [--verify-mutations]
//
//   3d-coplanar-10 / 3d-coplanar-3   the built scene of 10 chats (a full building) and of 3 chats (the building as it is used, 8 of 11 offices vacant) has no two visible faces
//                in one plane (same facing, offset under 9.5 mm, overlap over 0.01 m2, a colour or texture that differs, and not covered by something nearer) outside the allow-list below
//   3d-coplanar-scan-10 / -3   the scan saw the scene (it reads the faces the camera sees of every static mesh; an empty read would pass everything)
//
// Why: two faces in one plane are a depth tie. The depth buffer cannot say which is in front, the winner changes with every sub-pixel step of the camera, and the stone ground, a
// floor or a wall blinks between two colours while the user zooms or pans. Nothing else catches it: the tie is not an error, and a picture taken once shows one winner. The rule for
// the builders (the comment above class Batch in public/js/ofis.js): two visible layers are at least 10 mm apart, or they share no plane. docs/floors.md has the rest.
//
// The scene comes through the page's read-only getter `o.scene` (public/js/ofis.js); the scan is tools/qa/coplanar-scan.mjs (it has unit tests: test/coplanar-scan.test.mjs). It is
// geometry only: no GPU, no frame time. `--list` prints every pair (also the allowed ones). To find the builder line of a pair, make an instrumented copy
// (`node tools/qa/coplanar-trace.mjs <dir>`) and run with `--root <dir> --list`: every pair then names the lines that made its two faces.
//
// --mutations breaks the code in a copy of the repo, one line at a time, and runs the check that guards that line: every one must FAIL there (a check that cannot fail guards nothing).
// --verify-mutations only checks that every line to break is in the source exactly once.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scenario3d, sleep, ROOT } from './harness3d.mjs';
import { scanCoplanar, DD, MIN_AREA } from './coplanar-scan.mjs';
import { readScene } from './coplanar-read.mjs';

const args = process.argv.slice(2);
const val = f => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : undefined; };
const only = val('only'), listAll = args.includes('--list'), rootArg = val('root');
const DDX = val('dd') ? +val('dd') / 1000 : DD;                // --dd <mm>: look at another band than the check's 9.5 mm (to see the layers that are close but not tied)
const make = (name, ok, detail) => ({ name, ok, detail });

// ---- the allow-list: pairs the scan finds that nobody can see, or that no tie can change. Each entry is { why, test: pair => boolean } over a pair { n (the normal), d (its offset),
// gap, area, lo and hi (the two triangles: col, tex, mesh, a, b, c), box (the overlap's corners), at (its middle) }, and `why` says in a sentence why the pair is harmless. It is EMPTY
// today: the scan drops the pairs that something nearer covers (the plinth under the slab, the corners of walls), and every other pair of the two scenes was moved by 10 mm or more
// (public/js/ofis*.js, lounge-plan.js, docs/floors.md). An entry is for a pair that cannot be moved and cannot be seen; never for one that merely has not been looked at.
const ALLOW = [];

const hex = c => '#' + (c >>> 0).toString(16).padStart(6, '0');
const axis = n => { const k = [0, 1, 2].find(i => Math.abs(n[i]) > 0.999); return k === undefined ? `(${n.map(v => v.toFixed(2))})` : (n[k] > 0 ? '+' : '-') + 'xyz'[k]; };
const line = (S, t) => { const s = S.src[t.mesh]; return s && t.si >= 0 && s[t.si] ? s[t.si][1] : null; };    // the builder lines of a triangle (an instrumented copy only)
const piece = (S, t) => line(S, t) || `mesh${t.mesh}[${S.meshes[t.mesh].type}${S.meshes[t.mesh].map ? ' textured' : ''}]`;     // what made a triangle: its builder line on an instrumented copy, else its mesh
const fmt = (S, g) => `${axis(g.n)} plane ${g.d.toFixed(3)} gap ${(g.gap * 1000).toFixed(1)} mm, ${g.area.toFixed(2)} m2 at (${g.at.map(v => v.toFixed(2))}) ${hex(g.lo.col)} under ${hex(g.hi.col)}  [${piece(S, g.lo)}  <  ${piece(S, g.hi)}]`;

// the pairs, grouped the way a person reads the list: the same plane direction, the same level (to a millimetre) and the same two sources (the builder lines on an instrumented
// copy, else the two meshes) are one problem; every group keeps its biggest pair to say where it is
function summarize(S, pairs) {
  const by = new Map();
  for (const g of pairs) {
    const key = [axis(g.n), piece(S, g.lo), piece(S, g.hi), Math.round(g.d * 1000)].join('|');
    const o = by.get(key) || by.set(key, { g, n: 0, area: 0 }).get(key);
    o.n++; o.area += g.area;
    if (g.area > o.g.area) o.g = g;
  }
  return [...by.values()].sort((a, b) => b.area - a.area);
}

async function scan(chats, ctx) {
  const S = await scenario3d(chats, { tag: 'cop' + chats, root: ctx.root });
  try {
    if (!S.ready.ok) throw new Error('the scene was not ready: ' + JSON.stringify(S.ready.last));
    const sc = await readScene(S.page);
    const errs = S.page.errors.filter(e => !/\/local\/ofis-extras\.js/.test(e));
    const pairs = scanCoplanar(sc.tris, { dd: DDX });
    const bad = pairs.filter(g => !ALLOW.some(a => a.test(g)));
    return { sc, pairs, bad, errs };
  } finally { await S.done(); }
}

const RUN = {};
async function runChats(ctx, chats) {
  const key = '3d-coplanar-' + chats;
  const r = await scan(chats, ctx);
  const rows = summarize(r.sc, r.bad);
  if (listAll) {
    for (const g of summarize(r.sc, r.pairs)) console.log(`  PAIR x${g.n} ${g.area.toFixed(2)} m2 total, the biggest ${fmt(r.sc, g.g)}${ALLOW.some(a => a.test(g.g)) ? '  (allowed)' : ''}`);
  }
  const front = r.sc.tris.length;
  const res = [];
  res.push(make('3d-coplanar-scan-' + chats, front > 20000 && r.sc.meshes.length > 5 && r.errs.length === 0, `${chats} chats: ${front} faces the camera sees in ${r.sc.meshes.length} meshes, ${r.pairs.length} coplanar pairs seen from the camera (${r.pairs.hidden} more are covered by something nearer), console errors ${r.errs.length}${r.errs[0] ? ' first: ' + r.errs[0].slice(0, 140) : ''}`));
  res.push(make(key, r.bad.length === 0,
    `${chats} chats: ${r.pairs.length} coplanar pairs (offset under ${DDX * 1000} mm, overlap over ${MIN_AREA} m2, colour or texture differs), ${r.pairs.length - r.bad.length} on the allow-list, ${r.bad.length} not` +
    (r.bad.length ? `. PROBLEMS: ${rows.length} kinds, the biggest: ${rows.slice(0, 6).map(g => `x${g.n} ${fmt(r.sc, g.g)}`).join('; ')}` : '')));
  return res;
}
RUN['10'] = ctx => runChats(ctx, 10);
RUN['3'] = ctx => runChats(ctx, 3);
const NAME = { 10: '3d-coplanar-10', 3: '3d-coplanar-3' };

// ---- mutations: break one line in a copy of the repo and expect the check that guards it to fail
const MUTATIONS = [
  { name: 'the plinth reaches the height of the slab again (a tie over the whole ground)', file: 'public/js/ofis.js', from: "B.box(cx, -0.254, cz, w, 0.46, d, '#4a5163');", to: "B.box(cx, -0.23, cz, w, 0.46, d, '#4a5163');", fails: ['10', '3'] },
  { name: 'the plinth\'s rim is 2 mm under the slab again', file: 'public/js/ofis.js', from: "B.box(cx, -0.046, cz, w + 0.06, 0.02, d + 0.06, '#b9b1a1');", to: "B.box(cx, -0.012, cz, w + 0.06, 0.02, d + 0.06, '#b9b1a1');", fails: '10' },
  { name: 'a dark base box lies 4 mm under every office floor again', file: 'public/js/ofis.js', from: "    // (no dark base box under the floor any more: its top was 4 mm under the floor mesh, a depth tie that showed as dark speckles in the pattern, and its 2 cm ring lay inside the walls)\n", to: "    b(W / 2, 0.004, D / 2, W + 0.04, 0.008, D + 0.04, shade(th.floor, -0.3));\n", fails: ['10', '3'] },
  { name: 'a second wall, another colour, is built on the wall of every office (a new pair on one plane)', file: 'public/js/ofis.js', from: "    b(-T / 2, H / 2, (D - T) / 2, T, H, D + T, wall);\n", to: "    b(-T / 2, H / 2, (D - T) / 2, T, H, D + T, wall);\n    b(-T / 2, H / 2, (D - T) / 2, T, H, D + T, '#ff00ff');\n", fails: '10' },
  { name: 'the planks of the lounge deck are 4 mm over the plaza again, on a base 1.5 mm over it', file: 'public/js/ofis-lounge.js', edits: [["B.box(dcx, 0.012, dcz, dw, 0.024, dd, '#7a5535');", "B.box(dcx, 0.00675, dcz, dw, 0.0135, dd, '#7a5535');"], ["B.box(dcx, deck.h / 2, Z + deck.v0 + pw * (k + 0.5), dw, deck.h, pw - 0.014,", "B.box(dcx, 0.008, Z + deck.v0 + pw * (k + 0.5), dw, 0.016, pw - 0.014,"]], fails: '10' },
  { name: 'the road paint is 4 mm over the asphalt again', file: 'public/js/ofis-env.js', from: 'S.slab(x0, x1, za, zc, ROAD_Y + 0.012, ROAD_Y - 0.004, color);', to: 'S.slab(x0, x1, za, zc, ROAD_Y + 0.004, ROAD_Y - 0.004, color);', fails: '10' },
  { name: 'the curb stands 5 mm over its sidewalk and ends in the sidewalk\'s end face again', file: 'public/js/ofis-env.js', from: 'S.slab(X.road0 - 0.18, X.road0 + 0.01, a, b2, WALK_Y + 0.015, WALK_Y - 0.02, PAL.curb);', to: 'S.slab(X.road0 - 0.18, X.road0, a, b2, WALK_Y + 0.005, WALK_Y - 0.02, PAL.curb);', fails: '10' },
  { name: 'the door trim ends where the low wall ends again', file: 'public/js/ofis.js', from: "for (const s of [-1, 1]) b(s < 0 ? dl - 0.035 : dr + 0.035, 0.3, D + T / 2, 0.13, 0.6, T + 0.08, trim);", to: "for (const px of [dl - 0.05, dr + 0.05]) b(px, 0.3, D + T / 2, 0.1, 0.6, T + 0.08, trim);", fails: '10' },
  { name: 'the blank face of a vacant sign is 1.5 mm in front of its plate again', file: 'public/js/ofis.js', from: 'z: Z + 0.097, w: sw });', to: 'z: Z + 0.0865, w: sw });', fails: ['10', '3'] },
  { name: 'the laptop screens are 6 mm in front of their lids again', file: 'public/js/ofis-decor.js', from: 'x: X + it.x - 0.075 * s * fx + nx * 0.012, y: it.y + 0.0875 * s, z: Z + it.z - 0.075 * s * fz + nz * 0.012,', to: 'x: X + it.x - 0.075 * s * fx + nx * 0.006, y: it.y + 0.0875 * s, z: Z + it.z - 0.075 * s * fz + nz * 0.006,', fails: '10' },
  { name: 'the hall\'s two rugs are 4 mm apart again', file: 'public/js/ofis.js', from: "B.box((rx0 + rx1) / 2, 0.028, h.lane, rx1 - rx0 - 0.08, 0.012, 0.94, '#4f7f93');", to: "B.box((rx0 + rx1) / 2, 0.02, h.lane, rx1 - rx0 - 0.08, 0.012, 0.94, '#4f7f93');", fails: '10' },
];
const editsOf = m => m.edits || [[m.from, m.to]];

async function runMutations() {
  const rows = [];
  for (const m of MUTATIONS.filter(x => !val('mutation') || val('mutation').split('|').some(w => x.name.includes(w)))) {
    const dir = mkdtempSync(join(tmpdir(), 'cco-mutc-'));
    try {
      for (const f of readdirSync(ROOT).filter(n => /\.(js|json)$/.test(n) && n !== 'package-lock.json')) cpSync(join(ROOT, f), join(dir, f));
      cpSync(join(ROOT, 'public'), join(dir, 'public'), { recursive: true });
      const file = join(dir, m.file);
      let text = readFileSync(file, 'utf8');
      if (editsOf(m).some(([from]) => !text.includes(from))) { rows.push({ m, caught: false, detail: 'the line to break was not found' }); console.log(`MUTATION MISSED ${m.fails}: ${m.name} -> the line to break was not found`); continue; }
      for (const [from, to] of editsOf(m)) text = text.replace(from, () => to);
      writeFileSync(file, text);
      const want = [].concat(m.fails), got = [];
      for (const k of want) {
        let r;
        try { r = await RUN[k]({ root: dir }); } catch (e) { await sleep(2000); r = await RUN[k]({ root: dir }); }
        got.push(r.find(x => x.name === NAME[k]));
      }
      rows.push({ m, caught: got.every(r => r && !r.ok), detail: got.map((r, i) => (r ? `${NAME[want[i]]} ${r.ok ? 'PASSED' : 'FAILED'}: ${r.detail.slice(r.ok ? 0 : Math.max(0, r.detail.indexOf('PROBLEMS')), (r.ok ? 0 : Math.max(0, r.detail.indexOf('PROBLEMS'))) + 220)}` : `${NAME[want[i]]} did not run`)).join(' || ') });
    } catch (e) {
      rows.push({ m, caught: false, detail: `the run threw twice, so nothing was read: ${String(e.message || e).slice(0, 160)}` });
    } finally { rmSync(dir, { recursive: true, force: true }); }
    const last = rows[rows.length - 1];
    console.log(`MUTATION ${last.caught ? 'CAUGHT' : 'MISSED'} ${m.fails}: ${m.name} -> ${last.detail}`);
  }
  return rows;
}

// ---- main
if (args.includes('--verify-mutations')) {
  let bad = 0;
  for (const m of MUTATIONS) {
    for (const [from] of editsOf(m)) {
      const n = readFileSync(join(ROOT, m.file), 'utf8').split(from).length - 1;
      if (n !== 1) { bad++; console.log(`MUTATION LINE ${n === 0 ? 'NOT FOUND' : 'FOUND ' + n + ' TIMES'}: ${m.name}`); }
    }
  }
  console.log(bad ? `MUTATION LINES BAD ${bad} of ${MUTATIONS.length}` : `MUTATION LINES OK (${MUTATIONS.length})`);
  process.exit(bad ? 1 : 0);
}
const report = [];
const show = r => { report.push(r); console.log(`CHECK ${r.name} ${r.ok ? 'PASS' : 'FAIL'} ${r.detail}`); };
if (args.includes('--mutations')) {
  const rows = await runMutations();
  const missed = rows.filter(r => !r.caught);
  console.log(missed.length ? `MUTATIONS MISSED ${missed.length} of ${rows.length}` : `MUTATIONS ALL CAUGHT (${rows.length})`);
  process.exit(missed.length ? 1 : 0);
}
for (const k of Object.keys(RUN)) if (!only || only === k) for (const r of await RUN[k]({ root: rootArg })) show(r);
const bad = report.filter(r => !r.ok);
console.log(bad.length ? `QA FAIL (${bad.length} of ${report.length} checks)` : `QA PASS (${report.length} checks)`);
process.exit(bad.length ? 1 : 0);
