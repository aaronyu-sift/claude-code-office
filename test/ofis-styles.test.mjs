import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  STYLE_IDS, STYLES, MODEL_SIZE, SCALE, SIGN_X, WIN_Y, DOOR_BACK_W, assignStyles, neighbourSlots, neighbourMap, planRoom, zonesOf, loungeOf, footprint, rectOf, hit, wallBoxes,
  floorBlocksWindow, paletteSpec, wallColour, floorColour, mixHex, styleAt, lightsOf, CHIEF_LAMP,
} from '../public/js/ofis-styles.js';
import { CELL_W, COLS, CHEF_W, COL_W, MAX_CLS, BASE_CLS, ROOM_D, perRowFor, MIN_ROOMS } from '../public/js/ofis-layout.js';
import { PROPS, PALETTES } from '../public/js/ofis-rig.js';
import { hash } from '../public/js/util.js';
import { readGlb } from '../tools/models/strip-glb.mjs';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const FLOOR_KINDS = ['m', 'lamp', 'rug', 'shelf', 'plantwall', 'rack', 'printer'];
const projects = n => Array.from({ length: n }, (_, i) => `/work/project-${i}`);

// ---------------------------------------------------------------- the table

test('styles: six, each with a floor, a wall tint, the pack colours and furniture of its own', () => {
  assert.deepEqual(STYLE_IDS, ['study', 'lab', 'garden', 'library', 'studio', 'cafe']);
  for (const id of STYLE_IDS) {
    const st = STYLES[id];
    assert.equal(st.id, id);
    assert.match(st.floor.hex, /^#[0-9a-f]{6}$/);
    assert.ok(['planks', 'tile', 'grass', 'parquet', 'checker'].includes(st.floor.pattern), `${id}: floor pattern`);
    assert.match(st.wall.tint, /^#[0-9a-f]{6}$/);
    assert.ok(st.wall.mix > 0 && st.wall.mix < 1);
    for (const k of ['wood', 'fabric', 'fabric2', 'shade', 'metal']) assert.match(st.pack[k], /^#[0-9a-f]{6}$/, `${id}: pack ${k}`);
  }
  assert.equal(new Set(STYLE_IDS.map(id => STYLES[id].floor.pattern)).size, 5, 'five floor patterns for six styles: no two look alike by their floor and colour');
  assert.equal(new Set(STYLE_IDS.map(id => STYLES[id].floor.hex)).size, 6);
  assert.equal(new Set(STYLE_IDS.map(id => STYLES[id].wall.tint)).size, 6);
  const sig = id => JSON.stringify(STYLES[id].items.map(it => [it.k, it.m]).sort());
  assert.equal(new Set(STYLE_IDS.map(sig)).size, 6, 'every style has its own furniture mix');
});

test('styles: every model a style names is a file of the manifest, and its size is what the file says', () => {
  const used = new Set([...Object.values(STYLES).flatMap(st => st.items.map(it => it.m).filter(Boolean)), 'lampRoundTable', 'lampSquareTable']);
  for (const k of used) {
    assert.ok(PROPS[k], `${k} is not in the manifest (ofis-rig.js DECOR_FILES)`);
    assert.ok(MODEL_SIZE[k], `${k} has no size in MODEL_SIZE`);
  }
  for (const k of Object.keys(MODEL_SIZE)) {
    const { json } = readGlb(readFileSync(join(PUBLIC, PROPS[k])));
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    for (const mesh of json.meshes) for (const p of mesh.primitives) {
      const a = json.accessors[p.attributes.POSITION];
      for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], a.min[i]); mx[i] = Math.max(mx[i], a.max[i]); }
    }
    [0, 1, 2].forEach(i => assert.ok(Math.abs(mx[i] - mn[i] - MODEL_SIZE[k][i]) < 0.011, `${k}: axis ${i} is ${(mx[i] - mn[i]).toFixed(2)} in the file, ${MODEL_SIZE[k][i]} in MODEL_SIZE`));
  }
});

test('colours: a style tints the project\'s wall and floor, never hides them, and its palette names the colours the pack models need', () => {
  const theme = { wall: '#d8654f', floor: '#4ea394' };
  const walls = new Set(STYLE_IDS.map(id => wallColour(theme, STYLES[id])));
  assert.equal(walls.size, 6, 'six styles give six wall colours from one theme');
  assert.notEqual(wallColour({ wall: '#86b4cc', floor: '#c9a978' }, STYLES.study), wallColour(theme, STYLES.study), 'the project\'s own wall colour still shows');
  for (const id of STYLE_IDS) assert.match(floorColour(theme, STYLES[id]), /^#[0-9a-f]{6}$/);
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
  for (const id of STYLE_IDS) for (const role of ['fabric', 'fabric2']) {
    const spec = paletteSpec(STYLES[id], role);
    assert.deepEqual(Object.keys(spec.byName).sort(), Object.keys(PALETTES.decor.byName).sort(), 'the same material names as the static palette');
    assert.equal(spec.byName.carpet, role === 'fabric' ? STYLES[id].pack.fabric : STYLES[id].pack.fabric2);
    assert.equal(spec.byName.wood, STYLES[id].pack.wood);
  }
});

// ---------------------------------------------------------------- which style a project gets

test('assign: the same projects give the same styles, whatever order they arrive in or how many times it is asked', () => {
  const ps = projects(6);
  const a = assignStyles(ps), b = assignStyles([...ps].reverse()), c = assignStyles([...ps, ...ps]);
  for (const p of ps) { assert.equal(a.get(p), b.get(p)); assert.equal(a.get(p), c.get(p)); }
  assert.deepEqual([...assignStyles(['a']).entries()], [...assignStyles(['a']).entries()]);
  const solo = assignStyles(['nebula-web']).get('nebula-web');
  assert.ok(Number.isInteger(solo) && solo >= 0 && solo < STYLE_IDS.length);
  assert.equal(solo, hash('nebula-web') % STYLE_IDS.length, 'a project alone gets the style its hash points at, on every load and for every viewer');
});

test('assign: with six projects or fewer no two share a style', () => {
  for (let n = 1; n <= STYLE_IDS.length; n++) {
    for (let seed = 0; seed < 40; seed++) {
      const ps = Array.from({ length: n }, (_, i) => `proj-${seed}-${i}`);
      const got = assignStyles(ps);
      assert.equal(new Set(got.values()).size, n, `${n} projects, set ${seed}: ${[...got.values()]}`);
    }
  }
});

test('assign: a project that has a style keeps it when others come and go; a newcomer takes a free one', () => {
  const ps = projects(4), first = assignStyles(ps);
  const more = assignStyles([...ps, '/work/new-one'], first);
  for (const p of ps) assert.equal(more.get(p), first.get(p), 'the first four keep their style');
  assert.ok(![...first.values()].includes(more.get('/work/new-one')), 'the newcomer takes a style that is free');
  const fewer = assignStyles(ps.slice(1), first);
  for (const p of ps.slice(1)) assert.equal(fewer.get(p), first.get(p), 'one closing changes nobody else');
});

test('assign: the styles are spread out; ten projects use every style', () => {
  const got = assignStyles(projects(10));
  assert.equal(new Set(got.values()).size, STYLE_IDS.length);
  const counts = STYLE_IDS.map((_, i) => [...got.values()].filter(v => v === i).length);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `the least used style is reused: ${counts}`);
});

test('assign: offices next to each other never share a style, however many chats there are', () => {
  const perRow = perRowFor(MIN_ROOMS);
  for (const n of [7, 8, 9, 10, 15, 20, 30]) {
    for (let seed = 0; seed < 10; seed++) {
      const list = Array.from({ length: n }, (_, i) => ({ project: `p${seed}-${i}`, slot: i }));
      const got = assignStyles(list.map(l => l.project), new Map(), neighbourMap(list, perRow));
      for (const l of list) for (const s of neighbourSlots(l.slot, perRow)) {
        const o = list.find(x => x.slot === s);
        if (o) assert.notEqual(got.get(l.project), got.get(o.project), `${n} chats, set ${seed}: slots ${l.slot} and ${s} share a style`);
      }
    }
  }
});

test('neighbours: left and right in the row, and across the hall (rows are paired)', () => {
  assert.deepEqual(neighbourSlots(0, 5).sort((a, b) => a - b), [1, 5]);
  assert.deepEqual(neighbourSlots(7, 5).sort((a, b) => a - b), [2, 6, 8]);
  assert.deepEqual(neighbourSlots(14, 5).sort((a, b) => a - b), [13, 19], 'the last office of a row has no one on its right');
  assert.deepEqual(neighbourSlots(10, 5).sort((a, b) => a - b), [11, 15], 'row 2 is paired with row 3');
  const m = neighbourMap([{ project: 'a', slot: 0 }, { project: 'b', slot: 1 }, { project: 'c', slot: 5 }, { project: 'd', slot: 3 }], 5);
  assert.deepEqual(m.get('a').sort(), ['b', 'c']);
  assert.deepEqual(m.get('d'), [], 'an office whose neighbours are vacant has none');
});

// ---------------------------------------------------------------- the plan of a room

const CASES = [];
for (const id of STYLE_IDS) for (const cls of [BASE_CLS, MAX_CLS]) for (const door of ['front', 'back']) CASES.push({ id, cls, door, W: CELL_W });
const label = c => `${c.id} class ${c.cls} ${c.door} door`;

test('plan: every office has a window and a light of its own, in every style, class and door', () => {
  for (const c of CASES) {
    const P = planRoom(c.id, c);
    assert.ok(P.windows.length >= 1, `${label(c)}: no window`);
    assert.ok(P.lights.length >= 1, `${label(c)}: no light`);
    const lamps = P.lights.filter(l => l.kind === 'lamp' || l.kind === 'sconce');
    assert.ok(lamps.length >= 1, `${label(c)}: no lamp`);
    assert.ok(P.items[0].chief && P.items[0].k === 'lamp', `${label(c)}: the chief's desk has its lamp first`);
    assert.equal(P.items[0].x, CHIEF_LAMP.x);
  }
  for (const id of STYLE_IDS) assert.ok(planRoom(id, { cls: BASE_CLS, door: 'front' }).windows.length >= STYLES[id].items.filter(it => it.k === 'win').length - 0, `${id} keeps its windows`);
  assert.ok(STYLE_IDS.filter(id => planRoom(id, { cls: 1, door: 'front' }).lights.length >= 5).length >= 3, 'several styles have a second source: candles, a string of lights, a screen or more lamps');
});

test('plan: a cell too narrow for the style still gets a window and a lamp', () => {
  for (const id of STYLE_IDS) {
    const P = planRoom(id, { cls: BASE_CLS, door: 'back', W: 8.4 });
    assert.ok(P.windows.length >= 1 && P.lights.length >= 1, id);
    assert.ok(P.items.every(it => !it.lounge), 'no lounge in a cell that has no room for it');
  }
});

test('plan: nothing stands on a desk, a chair, an aisle or the strip the newcomers walk on, and nothing leaves the room', () => {
  for (const c of CASES) {
    const P = planRoom(c.id, c), floor = P.items.filter(it => FLOOR_KINDS.includes(it.k) && !it.on);
    for (const it of floor) {
      const r = rectOf(it);
      assert.ok(r[0] >= 0 && r[1] <= P.W && r[2] >= 0 && r[3] <= P.D, `${label(c)}: ${it.m || it.k} leaves the room ${r}`);
      for (const z of P.zones) assert.ok(!hit(r, z.r, 0.02), `${label(c)}: ${it.m || it.k} (${r.map(v => v.toFixed(2))}) is on the ${z.id} (${z.r})`);
    }
  }
});

test('plan: no two solid pieces overlap, and a piece that stands on another is on top of it', () => {
  for (const c of CASES) {
    const P = planRoom(c.id, c), solid = P.items.filter(it => FLOOR_KINDS.includes(it.k) && !it.on && it.k !== 'rug');
    for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
      assert.ok(!hit(rectOf(solid[i]), rectOf(solid[j]), 0.02), `${label(c)}: ${solid[i].m || solid[i].k} and ${solid[j].m || solid[j].k} overlap`);
    }
    for (const rug of P.items.filter(it => it.k === 'rug')) for (const o of P.items.filter(it => it.k === 'rug' && it !== rug)) assert.ok(!hit(rectOf(rug), rectOf(o), 0.02), `${label(c)}: two rugs overlap`);
    for (const up of P.items.filter(it => it.on && !it.chief)) {
      const r = rectOf(up), under = P.items.filter(it => !it.on && it.k !== 'rug' && FLOOR_KINDS.includes(it.k)).find(it => { const q = rectOf(it); return r[0] >= q[0] - 0.3 && r[1] <= q[1] + 0.3 && r[2] >= q[2] - 0.3 && r[3] <= q[3] + 0.3; });
      assert.ok(under, `${label(c)}: ${up.m || up.k} stands on nothing`);
      assert.ok(up.y > 0.2, `${label(c)}: ${up.m || up.k} is on the floor but flagged as standing on something`);
    }
  }
});

test('plan: windows and wall pieces keep clear of each other, the sign, the door and tall furniture, and sit between the wainscot and the top of the wall', () => {
  for (const c of CASES) {
    const P = planRoom(c.id, c), wb = wallBoxes(P.items);
    for (let i = 0; i < wb.length; i++) for (let j = i + 1; j < wb.length; j++) {
      const a = wb[i], b = wb[j];
      assert.ok(!(a.wall === b.wall && a.a0 < b.a1 && a.a1 > b.a0 && a.y0 < b.y1 && a.y1 > b.y0), `${label(c)}: ${a.it.k} and ${b.it.k} overlap on the ${a.wall} wall`);
    }
    for (const w of wb) {
      if (w.wall === 'n') {
        assert.ok(w.a0 >= SIGN_X[1] - (w.it.k === 'screen' ? 0.05 : 0), `${label(c)}: ${w.it.k} at x ${w.a0.toFixed(2)} hangs over the sign (to x ${SIGN_X[1]})`);
        if (c.door === 'back') assert.ok(w.a1 <= c.W - 1 - DOOR_BACK_W / 2 - 0.05, `${label(c)}: ${w.it.k} over the door`);
      }
      assert.ok(w.a0 >= 0.1 && w.a1 <= (w.wall === 'n' ? P.W : P.D) - 0.1, `${label(c)}: ${w.it.k} off its wall`);
    }
    for (const w of P.windows) {
      assert.ok(w.y0 >= WIN_Y[0] - 1e-9 && w.y0 + w.h <= WIN_Y[1] + 1e-9, `${label(c)}: a window at ${w.y0} to ${w.y0 + w.h}`);
      const box = wb.find(b => b.it === w);
      for (const f of P.items.filter(it => FLOOR_KINDS.includes(it.k) && !it.on)) assert.ok(!floorBlocksWindow(f, box), `${label(c)}: ${f.m || f.k} stands in front of a window`);
    }
  }
});

test('plan: the lounge pieces are only there when the room has its lounge corner (the 12-desk room has desks in its place)', () => {
  assert.ok(loungeOf(CELL_W, BASE_CLS), 'the 6-desk room has a lounge');
  assert.equal(loungeOf(CELL_W, MAX_CLS), null, 'the 12-desk room has none');
  for (const id of STYLE_IDS) {
    const small = planRoom(id, { cls: BASE_CLS, door: 'front' }), big = planRoom(id, { cls: MAX_CLS, door: 'front' });
    assert.ok(small.items.some(it => it.lounge), `${id}: no lounge piece in the small room`);
    assert.ok(big.items.every(it => !it.lounge), `${id}: a lounge piece in the room that has desks there`);
    assert.ok(big.windows.length >= 1 && big.lights.length >= 1, `${id}: the big room still has a window and a light`);
    for (const it of small.items.filter(x => x.lounge && FLOOR_KINDS.includes(x.k) && !x.on)) assert.ok(rectOf(it)[0] >= small.lounge.x0 - 0.35, `${id}: a lounge piece at x ${rectOf(it)[0].toFixed(2)} is outside the lounge from ${small.lounge.x0}`);
  }
});

test('plan: zones follow the desks of the class, and the door decides which strip is a walking lane', () => {
  const z1 = zonesOf({ cls: 1, door: 'front' }), z2 = zonesOf({ cls: 2, door: 'back' });
  assert.equal(z1.filter(z => z.id.startsWith('desks')).length, COLS[1]);
  assert.equal(z2.filter(z => z.id.startsWith('desks')).length, COLS[2]);
  assert.ok(z1.some(z => z.id === 'lane south') && !z1.some(z => z.id === 'lane north'));
  assert.ok(z2.some(z => z.id === 'lane north') && !z2.some(z => z.id === 'lane south'));
  const d0 = z1.find(z => z.id === 'desks 0').r;
  assert.equal(d0[0] < CHEF_W + 0.1 && d0[1] > CHEF_W + 1.5, true);
  assert.ok(Math.abs(z1.find(z => z.id === 'aisle 1').r[0] - (CHEF_W + COL_W + 1.68)) < 1e-9);
  assert.equal(ROOM_D, 6.8);
});

test('plan: footprints turn with the model and scale with it', () => {
  assert.deepEqual(footprint({ k: 'm', m: 'loungeSofa', ry: 0 }).map(v => +v.toFixed(3)), [+(0.98 * SCALE).toFixed(3), +(0.41 * SCALE).toFixed(3)]);
  const t = footprint({ k: 'm', m: 'loungeSofa', ry: Math.PI / 2 });
  assert.ok(Math.abs(t[0] - 0.41 * SCALE) < 1e-9 && Math.abs(t[1] - 0.98 * SCALE) < 1e-9, 'a quarter turn swaps the sides');
  assert.deepEqual(footprint({ k: 'm', m: 'loungeSofa', ry: 0, s: 1 }), [0.98, 0.41]);
  assert.deepEqual(footprint({ k: 'm', m: 'books', fp: [2, 3] }), [2, 3], 'an explicit footprint wins');
});

test('plan: the lights of a plan come with a place, a tone and a phase of their own', () => {
  for (const c of CASES) {
    const P = planRoom(c.id, c);
    const phases = new Set(P.lights.map(l => l.phase.toFixed(3)));
    assert.ok(phases.size >= Math.min(P.lights.length, 3) && phases.size > P.lights.length * 0.6, `${label(c)}: lights share phases (${phases.size} of ${P.lights.length})`);
    for (const l of P.lights) {
      assert.ok(l.x >= 0 && l.x <= P.W && l.z >= 0 && l.z <= P.D && l.y > 0 && l.y < 2.2, `${label(c)}: a ${l.kind} at ${l.x}, ${l.y}, ${l.z} is outside the room`);
      assert.ok(['lamp', 'candle', 'bulb', 'screen', 'sconce', 'led'].includes(l.kind));
      assert.ok(l.r > 0 && l.pool >= 0);
    }
  }
  assert.equal(lightsOf([]).length, 0);
  const ring = lightsOf([{ k: 'candle', x: 1, z: 1, y: 0.5, n: 3, spread: 0.3 }]);
  assert.deepEqual(ring.map(l => +l.z.toFixed(2)), [0.85, 1, 1.15]);
  assert.ok(styleAt(7) === styleAt(1) && styleAt(-1) === styleAt(5));
});

test('plan: a plan is made once per room kind and the style of two rooms of one kind shares it (the scene builds many rooms)', () => {
  const a = planRoom('study', { cls: 1, door: 'front' }), b = planRoom('study', { cls: 1, door: 'front' });
  assert.equal(a, b);
  assert.notEqual(planRoom('study', { cls: 1, door: 'back' }), a);
  assert.throws(() => planRoom('nope', { cls: 1, door: 'front' }), /no such style/);
});
