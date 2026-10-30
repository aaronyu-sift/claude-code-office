import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORK_IDS, SOFT_IDS, SEATS, W, D, DOOR, DOOR_X, FOYER, THEMES_N, STAND, composeRoom, planRoom, looksAll, lookOf, shapeOf, buildPart, extentFor, sampleTemplate, heightOfPiece,
} from '../public/js/ofis-arrange.js';
import { TABLE } from '../public/js/ofis-arrange-table.js';
import { STYLE_IDS, STYLES, neighbourSlots, MODEL_SIZE, SEAT_TOP } from '../public/js/ofis-styles.js';
import { CAP, buildingPlan, baysForOffices } from '../public/js/ofis-layout.js';
import { polyOf, distToPoly, polyGap } from '../public/js/ofis-geom.js';
import { PROPS } from '../public/js/ofis-rig.js';

const DOORS = ['front', 'back'];
const seatsOf = p => [p.chef, ...p.seats];
const solid = p => p.obstacles.map(o => ({ id: o.id, poly: polyOf(shapeOf(o.piece), 24), piece: o.piece }));
// one plan for every pair of arrangements and every door, with the styles taken in turn so that each style meets every arrangement
const plans = [];
{
  let n = 0;
  for (const work of WORK_IDS) for (const soft of SOFT_IDS) for (const door of DOORS) {
    const style = STYLE_IDS[n++ % STYLE_IDS.length];
    plans.push({ work, soft, door, style, plan: planRoom({ style, work, soft, seed: 1000 + n * 37 }, { door }) });
  }
}

test('arrangements: eight for work, three for soft; every one is built, has its seats and a chair that is not an office chair', () => {
  assert.deepEqual(WORK_IDS, ['communal', 'rounds', 'oval', 'bench', 'kidney', 'ell', 'pods', 'bar']);
  assert.deepEqual(SOFT_IDS, ['corner', 'ring', 'booths']);
  for (const [kind, ids] of [['work', WORK_IDS], ['soft', SOFT_IDS]]) for (const id of ids) {
    const part = buildPart(kind, id);
    assert.ok(part.seats.length >= 7, `${id}: ${part.seats.length} seats`);
    assert.ok(part.order.length >= 6, `${id} fills ${part.order.length} seats after the chat's own`);
    for (const p of part.pieces) assert.ok(p.m !== 'chairDesk' && p.m !== 'chair', `${id} has an office chair`);
    if (kind === 'work') assert.ok(part.chef, `${id} has a seat for the chat itself`);
    const e = extentFor(kind, id, 0), e1 = extentFor(kind, id, 1);
    assert.ok(Math.abs(e.w - e1.d) < 0.01 && Math.abs(e.d - e1.w) < 0.01, `${id}: a quarter turn swaps the sides of its box`);
  }
});

test('seat kinds: desk, lounge and stool, each with a height from the seat model and a model that is no office chair', () => {
  const kinds = new Set(), models = new Set();
  for (const { plan } of plans) for (const s of seatsOf(plan)) {
    kinds.add(s.kind);
    const piece = plan.items.find(p => p.id === s.piece);
    assert.ok(piece && SEAT_TOP[piece.m] != null, `seat ${s.id}: ${piece && piece.m}`);
    models.add(piece.m);
    assert.ok(Math.abs(s.hip - (SEAT_TOP[piece.m] * (piece.s || 1.7) + 0.065)) < 0.002, 'hip = seat top + the pad of the figure');
    assert.ok(s.hip > 0.3 && s.hip < 0.75);
  }
  assert.deepEqual([...kinds].sort(), ['desk', 'lounge', 'stool']);
  for (const m of models) assert.ok(/lounge|bench|stool/i.test(m), m);
  assert.ok(models.has('loungeChair') && models.has('loungeSofa') && models.has('benchCushion') && models.has('stoolBar'));
});

test('table: every pair and door has templates, and every template of it makes a room where all 13 seats have a way in', () => {
  for (const work of WORK_IDS) for (const soft of SOFT_IDS) for (const door of DOORS) {
    const list = TABLE[`${work}:${soft}:${door}`];
    assert.ok(list && list.length >= 1, `${work} ${soft} ${door}: no template (node tools/arrange-pick.mjs)`);
    for (const tpl of list) {
      const room = composeRoom({ work, soft, tpl, door });
      assert.ok(room.ok, `${work} ${soft} ${door} ${JSON.stringify(tpl)}: ${room.problems}`);
      assert.equal(room.seats.length, SEATS);
    }
  }
});

test('every arrangement and door: a plan that works, with the chat\'s own seat and 12 more, the three classes using the first 3, 6 and 12', () => {
  assert.equal(plans.length, WORK_IDS.length * SOFT_IDS.length * DOORS.length);
  for (const { work, soft, door, style, plan } of plans) {
    const tag = `${work} ${soft} ${door} ${style}`;
    assert.ok(plan.ok, `${tag}: ${plan.problems}`);
    assert.equal(plan.chef.id, 'chef');
    assert.ok(plan.chef.kind === 'desk' || plan.chef.kind === 'stool', 'the chat sits at the work part');
    assert.equal(plan.seats.length, SEATS);
    plan.seats.forEach((s, i) => assert.equal(s.id, i));
    assert.deepEqual(CAP, [3, 6, 12]);
    assert.ok(plan.windows.length >= 1, `${tag}: a window`);
    assert.ok(plan.lights.length >= 1, `${tag}: a light`);
    assert.ok(plan.lights.some(l => l.kind === 'lamp' || l.kind === 'candle' || l.kind === 'bulb' || l.kind === 'sconce'), `${tag}: a lamp or something like it`);
  }
});

test('seats: inside the room, none on another seat or in a table, each in the furniture it names, facing a way a person can sit', () => {
  for (const { work, soft, door, plan } of plans) {
    const tag = `${work} ${soft} ${door}`, all = seatsOf(plan), obs = solid(plan);
    for (const s of all) {
      assert.ok(s.x > 0.2 && s.x < W - 0.2 && s.z > 0.2 && s.z < D - 0.2, `${tag}: seat ${s.id} at ${s.x}, ${s.z}`);
      const own = plan.items.find(p => p.id === s.piece);
      assert.ok(own, `${tag}: seat ${s.id} sits in ${s.piece}`);
      assert.ok(distToPoly(s.x, s.z, polyOf(shapeOf(own), 24)) < 0.05, `${tag}: seat ${s.id} is in its own chair or sofa`);
      for (const o of obs) {
        if (o.piece === own) continue;
        if (o.piece.seatOf) assert.ok(distToPoly(s.x, s.z, o.poly) > 0.05, `${tag}: seat ${s.id} is inside ${o.id}`);
        else assert.ok(distToPoly(s.x, s.z, o.poly) > (o.piece.k === 'table' || o.piece.top != null ? 0.18 : 0.08), `${tag}: seat ${s.id} is in or at the edge of ${o.id}`);
      }
    }
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      assert.ok(Math.hypot(all[i].x - all[j].x, all[i].z - all[j].z) > 0.4, `${tag}: seats ${all[i].id} and ${all[j].id} are on top of each other`);
    }
  }
});

test('furniture: nothing outside the room, none on the foyer inside the door, nothing tall in front of the sign, and no two solid things inside each other', () => {
  for (const { work, soft, door, plan } of plans) {
    const tag = `${work} ${soft} ${door}`, obs = solid(plan), fo = FOYER(door);
    for (let i = 0; i < obs.length; i++) {
      const a = obs[i];
      for (const [x, z] of a.poly) assert.ok(x > 0 && x < W && z > 0 && z < D, `${tag}: ${a.id} leaves the room`);
      assert.ok(polyGap(a.poly, fo) > 0.04, `${tag}: ${a.id} is on the foyer`);
      for (let j = i + 1; j < obs.length; j++) {
        const b = obs[j];
        if (a.piece.grp && a.piece.grp === b.piece.grp) continue;
        if ((a.piece.seatOf && (b.piece.k === 'table' || b.piece.top != null)) || (b.piece.seatOf && (a.piece.k === 'table' || a.piece.top != null))) continue;
        assert.ok(polyGap(a.poly, b.poly) > 0.01, `${tag}: ${a.id} touches ${b.id}`);
      }
    }
    for (const it of plan.items) {
      if (it.k === 'win' || !shapeOf(it) || heightOfPiece(it) <= 1.0) continue;
      assert.ok(polyGap(polyOf(shapeOf(it), 24), [[0, 0], [6.3, 0], [6.3, 1.3], [0, 1.3]]) > 0.04, `${tag}: ${it.id} stands in front of the sign`);
    }
    assert.ok(!plan.items.some(p => p.m === 'chairDesk' || p.m === 'chair'), `${tag}: an office chair`);
  }
});

test('walks: for every seat of every plan a way from just inside the door to the stand point, clear of all furniture, and from there to the seat through its own chair only', () => {
  for (const { work, soft, door, plan } of plans) {
    const tag = `${work} ${soft} ${door}`, obs = solid(plan), inner = DOOR[door].inner;
    for (const s of seatsOf(plan)) {
      assert.ok(s.approach && s.approach.length >= 2, `${tag}: seat ${s.id} has no walk`);
      assert.deepEqual(s.approach[0], inner, `${tag}: seat ${s.id} walks from the door`);
      assert.deepEqual(s.approach[s.approach.length - 1], s.stand, `${tag}: seat ${s.id} walks to its stand point`);
      for (let i = 0; i + 1 < s.approach.length; i++) {
        const [a, b] = [s.approach[i], s.approach[i + 1]], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05));
        for (let k = 0; k <= n; k++) {
          const x = a[0] + (b[0] - a[0]) * k / n, z = a[1] + (b[1] - a[1]) * k / n;
          assert.ok(x > 0.15 && x < W - 0.15 && z > 0.15 && z < D - 0.15, `${tag}: seat ${s.id}'s walk leaves the room at ${x.toFixed(2)}, ${z.toFixed(2)}`);
          for (const o of obs) assert.ok(distToPoly(x, z, o.poly) > 0.2, `${tag}: seat ${s.id}'s walk is ${distToPoly(x, z, o.poly).toFixed(2)} m from ${o.id} at ${x.toFixed(2)}, ${z.toFixed(2)}`);
        }
      }
      // the last step, from the stand point to the hip, touches nothing but the seat's own chair
      for (let k = 0; k <= 10; k++) {
        const x = s.stand[0] + (s.x - s.stand[0]) * k / 10, z = s.stand[1] + (s.z - s.stand[1]) * k / 10;
        for (const o of obs) if (o.piece.id !== s.piece && !(o.piece.k === 'table' && false)) assert.ok(distToPoly(x, z, o.poly) > 0.04 || o.piece.top != null || o.piece.k === 'table', `${tag}: seat ${s.id}'s last step runs into ${o.id}`);
      }
      assert.ok(Math.hypot(s.stand[0] - s.x, s.stand[1] - s.z) <= STAND + 0.01);
    }
  }
});

test('the stand point of a seat is where a person who is not at a seat can stand: on the side the seat prefers, 0.8 m from the hip', () => {
  for (const { plan } of plans) for (const s of seatsOf(plan)) {
    assert.ok(Math.abs(Math.hypot(s.stand[0] - s.x, s.stand[1] - s.z) - STAND) < 0.01);
    assert.ok(['front', 'back', 'left', 'right'].includes(s.standFrom));
  }
});

test('determinism: the same look is the same room, when it is planned again from scratch', async () => {
  const fresh = await import('../public/js/ofis-arrange.js?fresh');
  for (const { work, soft, door, style, plan } of plans.filter((_, i) => i % 5 === 0)) {
    const again = fresh.planRoom({ style, work, soft, seed: plan.look.seed }, { door });
    assert.equal(JSON.stringify(again.items), JSON.stringify(plan.items), `${work} ${soft} ${door} ${style}`);
    assert.equal(JSON.stringify(seatsOf(again)), JSON.stringify(seatsOf(plan)));
  }
});

test('the dressing: windows and lamps come from the style; a bench stands against its windows; a prop never stands in front of a window it would hide', () => {
  for (const { work, plan, style } of plans) {
    if (work === 'bench') assert.ok(plan.windows.filter(w => w.wall === 'w').length >= 3, 'the window wall of a bench');
    assert.equal(plan.look.style, style);
    for (const w of plan.windows) assert.ok(w.w > 0 && w.h > 0 && w.y0 > 0);
  }
  const tall = plans.filter(p => p.plan.props.some(it => it.k === 'shelf' || it.k === 'rack' || it.k === 'plantwall'));
  assert.ok(tall.length > 5, 'the tall pieces of the styles find a place');
});

// ---------------------------------------------------------------- the looks of a building

test('looks: no two neighbouring offices share a style, a colour theme or a work arrangement, in every size of the building', () => {
  for (const bays of [1, 2, 3, 6, 10, 16, 30]) {
    const cells = buildingPlan(bays).cells, looks = looksAll(cells);
    for (const c of cells) {
      if (c.slot == null || c.slot < 0) continue;
      const l = looks.get(c.slot);
      assert.ok(l, `slot ${c.slot} has a look`);
      for (const s of neighbourSlots(c.slot, cells)) {
        const o = looks.get(s);
        if (!o) continue;
        assert.notEqual(l.style, o.style, `${bays} bays: slots ${c.slot} and ${s} share a style`);
        assert.notEqual(l.theme, o.theme, `${bays} bays: slots ${c.slot} and ${s} share a colour theme`);
        assert.notEqual(l.work, o.work, `${bays} bays: slots ${c.slot} and ${s} share a work arrangement`);
      }
    }
  }
});

test('looks: the first offices all differ (six styles, eight themes, eight arrangements), and it is the slot that decides: the same slot looks the same when the building grows', () => {
  const small = looksAll(buildingPlan(6).cells), big = looksAll(buildingPlan(24).cells);
  const first = [...small.keys()].sort((a, b) => a - b).slice(0, 8);
  assert.equal(new Set(first.slice(0, 6).map(s => small.get(s).style)).size, 6, 'six offices, six styles');
  assert.equal(new Set(first.map(s => small.get(s).theme)).size, 8, 'eight offices, eight themes');
  assert.equal(new Set(first.map(s => small.get(s).work)).size, 8, 'eight offices, eight arrangements');
  for (const [slot, l] of small) assert.deepEqual(big.get(slot), l, `slot ${slot} changed when the building grew`);
  assert.ok(first.every(s => small.get(s).theme < THEMES_N));
});

test('looks: a building of 11 offices has every kind of seat somewhere, every arrangement of work at least once in 20, and no two rooms next to each other read the same', () => {
  const cells = buildingPlan(baysForOffices(11)).cells, looks = looksAll(cells), kinds = new Set();
  for (const c of cells) {
    if (c.slot == null || c.slot < 0) continue;
    const p = planRoom(lookOf(looks.get(c.slot)), { door: c.door });
    assert.ok(p.ok, `slot ${c.slot}: ${p.problems}`);
    for (const s of seatsOf(p)) kinds.add(s.kind);
  }
  assert.deepEqual([...kinds].sort(), ['desk', 'lounge', 'stool']);
  const big = buildingPlan(baysForOffices(20)).cells, bl = looksAll(big);
  assert.equal(new Set([...bl.values()].map(l => l.work)).size, WORK_IDS.length);
  assert.equal(new Set([...bl.values()].map(l => l.soft)).size, SOFT_IDS.length);
  for (const c of big) {
    if (c.slot == null || c.slot < 0) continue;
    const l = bl.get(c.slot);
    for (const s of neighbourSlots(c.slot, big)) { const o = bl.get(s); if (o) assert.ok(l.style !== o.style && l.work !== o.work); }
  }
});

test('sampler: a random template is six numbers inside the room, or null when the parts do not fit; the same seed gives the same one', () => {
  const rand = () => { let a = 5; return () => { a = (a * 1664525 + 1013904223) >>> 0; return a / 4294967296; }; };
  const a = sampleTemplate('communal', 'corner', rand()), b = sampleTemplate('communal', 'corner', rand());
  assert.deepEqual(a, b);
  assert.equal(a.length, 6);
  assert.ok(a[2] >= 0 && a[2] < W && a[3] >= 0 && a[3] < D && a[4] >= 0 && a[4] < W && a[5] >= 0 && a[5] < D);
});

test('model sizes: every model the arrangements use has a size and a file in the manifest', () => {
  for (const kind of ['work', 'soft']) for (const id of kind === 'work' ? WORK_IDS : SOFT_IDS) {
    for (const p of buildPart(kind, id).pieces) if (p.m) { assert.ok(MODEL_SIZE[p.m], p.m); assert.ok(PROPS[p.m], `${p.m} is not in the manifest`); }
  }
  for (const id of STYLE_IDS) for (const p of [...STYLES[id].props, ...STYLES[id].accents]) for (const q of [p, ...(p.with || [])]) if (q.m) { assert.ok(MODEL_SIZE[q.m], q.m); assert.ok(PROPS[q.m], q.m); }
});
