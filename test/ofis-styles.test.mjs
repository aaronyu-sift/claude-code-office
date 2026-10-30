import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import {
  STYLE_IDS, STYLES, MODEL_SIZE, SEAT_TOP, SCALE, neighbourSlots, footprint, heightOf, wallBoxes, paletteSpec, wallColour, floorColour, mixHex, styleAt, lightsOf,
} from '../public/js/ofis-styles.js';
import { planRoom, WORK_IDS, SOFT_IDS } from '../public/js/ofis-arrange.js';
import { buildingPlan } from '../public/js/ofis-layout.js';
import { PROPS, PALETTES } from '../public/js/ofis-rig.js';
import { readGlb } from '../tools/models/strip-glb.mjs';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// ---------------------------------------------------------------- the table

test('styles: six, each with a floor, a wall tint, the pack colours, wall pieces, props and accents of its own', () => {
  assert.deepEqual(STYLE_IDS, ['study', 'lab', 'garden', 'library', 'studio', 'cafe']);
  for (const id of STYLE_IDS) {
    const st = STYLES[id];
    assert.equal(st.id, id);
    assert.match(st.floor.hex, /^#[0-9a-f]{6}$/);
    assert.ok(['planks', 'tile', 'grass', 'parquet', 'checker'].includes(st.floor.pattern), `${id}: floor pattern`);
    assert.match(st.wall.tint, /^#[0-9a-f]{6}$/);
    assert.ok(st.wall.mix > 0 && st.wall.mix < 1);
    for (const k of ['wood', 'fabric', 'fabric2', 'shade', 'metal']) assert.match(st.pack[k], /^#[0-9a-f]{6}$/, `${id}: pack ${k}`);
    assert.ok(st.walls.some(w => w.k === 'win'), `${id}: a window on its walls`);
    assert.ok(st.props.length >= 4, `${id}: props`);
    assert.ok(!('items' in st), `${id}: the old floor furniture of the desks-in-rows layout is gone`);
  }
  assert.equal(new Set(STYLE_IDS.map(id => STYLES[id].floor.pattern)).size, 5, 'five floor patterns for six styles: no two look alike by their floor and colour');
  assert.equal(new Set(STYLE_IDS.map(id => STYLES[id].floor.hex)).size, 6);
  assert.equal(new Set(STYLE_IDS.map(id => STYLES[id].wall.tint)).size, 6);
  const sig = id => JSON.stringify([...STYLES[id].walls.map(it => [it.k, it.m]), ...STYLES[id].props.map(p => [p.k, p.m, p.at]), ...STYLES[id].accents.map(a => [a.k, a.m])].sort());
  assert.equal(new Set(STYLE_IDS.map(sig)).size, 6, 'every style has its own mix of wall pieces, props and accents');
});

test('styles: every model a style names is a file of the manifest, and its size is what the file says', () => {
  const named = st => [...st.props, ...st.accents].flatMap(p => [p.m, ...(p.with || []).map(w => w.m)]).filter(Boolean);
  const used = new Set([...Object.values(STYLES).flatMap(named), 'lampRoundTable', 'lampSquareTable', ...Object.keys(SEAT_TOP)]);
  for (const k of used) {
    assert.ok(PROPS[k], `${k} is not in the manifest (ofis-rig.js DECOR_FILES)`);
    assert.ok(MODEL_SIZE[k], `${k} has no size in MODEL_SIZE`);
  }
  for (const k of Object.keys(MODEL_SIZE)) {
    const { json } = readGlb(readFileSync(join(PUBLIC, PROPS[k])));
    const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
    // the scene graph as the page draws it: a node that carries a mesh moves it by its translation (the desk's drawer is a second node; the rest of the kit has none)
    for (const node of json.nodes) if (node.mesh != null) for (const p of json.meshes[node.mesh].primitives) {
      const a = json.accessors[p.attributes.POSITION], t = node.translation || [0, 0, 0];
      for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], a.min[i] + t[i]); mx[i] = Math.max(mx[i], a.max[i] + t[i]); }
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

// ---------------------------------------------------------------- the offices next to an office

test('neighbours: across the hall, along the hall and across the lawn between rows; symmetric, never more than five, in every size of the building', () => {
  for (let bays = 1; bays <= 40; bays++) {
    const cells = buildingPlan(bays).cells;
    for (const c of cells) {
      const ns = neighbourSlots(c.slot, cells);
      assert.ok(ns.length <= 5, `${bays} bays, slot ${c.slot}: ${ns.length} neighbours`);
      assert.ok(!ns.includes(c.slot), 'not its own neighbour');
      for (const s of ns) assert.ok(neighbourSlots(s, cells).includes(c.slot), `${bays} bays: ${c.slot} lists ${s} but not the other way round`);
      const partner = cells.find(o => o.bay === c.bay && o.slot !== c.slot);
      if (partner) assert.ok(ns.includes(partner.slot), `${bays} bays: the office across the hall is a neighbour`);
    }
  }
});

test('neighbours in the X: the bar\'s offices touch their bay mate, the next bay along the hall, and the arm offices that face them', () => {
  const cells = buildingPlan(6).cells, by = (bay, side) => cells.find(c => c.bay === bay && c.side === side);
  const n = c => new Set(neighbourSlots(c.slot, cells));
  const bar0 = by(0, 'back'), bar1 = by(1, 'back'), barFront0 = by(0, 'front'), northArm = by(2, 'front'), southArm = by(3, 'back');
  assert.ok(n(bar0).has(barFront0.slot), 'across the hall');
  assert.ok(n(bar0).has(bar1.slot), 'along the hall');
  assert.ok(n(bar1).has(northArm.slot), 'the north arm\'s front office faces the bar\'s back offices');
  assert.ok(n(barFront0).size >= 1);
  assert.ok(southArm && n(southArm).size >= 1, 'the south arm is next to the bar too');
  assert.deepEqual(neighbourSlots(99, cells), [], 'an office that is not in the plan has no neighbours');
});

// ---------------------------------------------------------------- the pieces of a room

test('footprints turn with the model and scale with it', () => {
  assert.deepEqual(footprint({ k: 'm', m: 'loungeSofa', ry: 0 }).map(v => +v.toFixed(3)), [+(0.98 * SCALE).toFixed(3), +(0.41 * SCALE).toFixed(3)]);
  const t = footprint({ k: 'm', m: 'loungeSofa', ry: Math.PI / 2 });
  assert.ok(Math.abs(t[0] - 0.41 * SCALE) < 1e-9 && Math.abs(t[1] - 0.98 * SCALE) < 1e-9, 'a quarter turn swaps the sides');
  assert.deepEqual(footprint({ k: 'm', m: 'loungeSofa', ry: 0, s: 1 }), [0.98, 0.41]);
  assert.deepEqual(footprint({ k: 'm', m: 'books', fp: [2, 3] }), [2, 3], 'an explicit footprint wins');
  assert.ok(heightOf({ k: 'm', m: 'loungeChair', s: 1.6 }) > 0.5 && heightOf({ k: 'shelf' }) > 1.5);
});

test('wall pieces: a window, a board, a clock, pictures, a sconce, a screen have a box on their wall', () => {
  const boxes = wallBoxes([{ k: 'win', wall: 'n', c: 5, w: 1, h: 1, y0: 1 }, { k: 'clock', wall: 'n', c: 2 }, { k: 'pics', wall: 'w', c: 3, n: 3 }, { k: 'm', m: 'books', x: 1, z: 1 }]);
  assert.equal(boxes.length, 3, 'a floor piece is not a wall piece');
  for (const b of boxes) assert.ok(b.a1 > b.a0 && b.y1 > b.y0);
});

test('the lights of a plan come with a place, a tone and a phase of their own, in every style', () => {
  let n = 0;
  for (const style of STYLE_IDS) for (const work of WORK_IDS.slice(0, 3)) for (const soft of SOFT_IDS) {
    const P = planRoom({ style, work, soft, seed: 40 + n++ }, { door: n % 2 ? 'front' : 'back' }), tag = `${style} ${work} ${soft}`;
    assert.ok(P.ok, tag);
    const phases = new Set(P.lights.map(l => l.phase.toFixed(3)));
    assert.ok(P.lights.length >= 2, `${tag}: a room has at least two lights`);
    assert.ok(phases.size >= Math.min(P.lights.length, 3) && phases.size > P.lights.length * 0.6, `${tag}: lights share phases (${phases.size} of ${P.lights.length})`);
    for (const l of P.lights) {
      assert.ok(l.x >= 0 && l.x <= P.W && l.z >= 0 && l.z <= P.D && l.y > 0 && l.y < 2.2, `${tag}: a ${l.kind} at ${l.x}, ${l.y}, ${l.z} is outside the room`);
      assert.ok(['lamp', 'candle', 'bulb', 'screen', 'sconce', 'led'].includes(l.kind));
      assert.ok(l.r > 0 && l.pool >= 0);
    }
  }
  assert.equal(lightsOf([]).length, 0);
  const ring = lightsOf([{ k: 'candle', x: 1, z: 1, y: 0.5, n: 3, spread: 0.3 }]);
  assert.deepEqual(ring.map(l => +l.z.toFixed(2)), [0.85, 1, 1.15]);
  assert.ok(styleAt(7) === styleAt(1) && styleAt(-1) === styleAt(5));
});
