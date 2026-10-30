import test from 'node:test';
import assert from 'node:assert/strict';
import { loungePlan, overlaps, seatOf, standClear, solid, boardRect, DECK, BOARD, LOUNGE_STYLE } from '../public/js/lounge-plan.js';
import { rectOf, MODEL_SIZE, hit } from '../public/js/ofis-styles.js';

const plan = loungePlan(12.6, 6.8);
const inside = (r, W, D, m = 0) => r[0] >= m && r[1] <= W - m && r[2] >= m && r[3] <= D - m;

test('lounge plan: the deck, the board and every piece stand inside the hub cell', () => {
  assert.ok(inside([plan.deck.u0, plan.deck.u1, plan.deck.v0, plan.deck.v1], 12.6, 6.8));
  assert.ok(inside(boardRect(plan.board), 12.6, 6.8), 'the board with its posts');
  for (const it of plan.items) {
    assert.ok(MODEL_SIZE[it.m] || it.k === 'candle', 'a known model: ' + it.m);
    const r = rectOf(it);
    assert.ok(inside(r, 12.6, 6.8), it.m + ' is inside the cell');
    assert.ok(r[0] >= plan.deck.u0 - 0.05 && r[1] <= plan.deck.u1 + 0.05 && r[2] >= plan.deck.v0 - 0.05 && r[3] <= plan.deck.v1 + 0.05, `${it.m} is on the deck`);
  }
});

test('lounge plan: nothing on the floor overlaps anything else, or the board', () => {
  assert.deepEqual(overlaps(plan), []);
});

test('lounge plan: eight seats, every sitting place is on a sofa or an armchair, every standing place is clear', () => {
  assert.equal(plan.seats.length, 8);
  assert.equal(new Set(plan.seats.map(s => s.id)).size, 8);
  for (const s of plan.seats) {
    if (s.pose === 'sit') assert.ok(seatOf(plan, s), `${s.id} sits on a sofa or an armchair`);
    else assert.ok(standClear(plan, s), `${s.id} has room to stand`);
    assert.ok(s.u > plan.deck.u0 && s.u < plan.deck.u1 && s.v > plan.deck.v0 && s.v < plan.deck.v1, `${s.id} is on the deck`);
  }
  // two seats of one sofa are further apart than a person is wide
  const dist = (a, b) => Math.hypot(a.u - b.u, a.v - b.v);
  for (let i = 0; i < plan.seats.length; i++) for (let j = i + 1; j < plan.seats.length; j++) assert.ok(dist(plan.seats[i], plan.seats[j]) >= 0.6, `${plan.seats[i].id} and ${plan.seats[j].id} are not on top of each other`);
});

test('lounge plan: the first seats are the sofas, then the armchairs, then the counter', () => {
  assert.deepEqual(plan.seats.map(s => s.pose), ['sit', 'sit', 'sit', 'sit', 'sit', 'sit', 'stand', 'stand']);
  assert.ok(plan.seats.slice(0, 4).every(s => /sofa/i.test(seatOf(plan, s).m)));
  assert.ok(plan.seats.slice(4, 6).every(s => /Chair/.test(seatOf(plan, s).m)));
});

test('lounge plan: the lamps and the candles make the lights, in the format of the rooms', () => {
  assert.ok(plan.lights.length >= 3);
  assert.ok(plan.lights.some(l => l.kind === 'candle'));
  for (const l of plan.lights) { assert.ok(Number.isFinite(l.x) && Number.isFinite(l.z) && Number.isFinite(l.y)); assert.ok(l.tone && l.r > 0); }
  assert.deepEqual(new Set(plan.lights.map(l => l.id)).size, plan.lights.length);
});

test('lounge plan: the board faces the camera side and the sofas look at the table, away from it', () => {
  const b = plan.board;
  assert.ok(b.w > 6 && b.h > 2 && b.y0 >= 0.4 && b.cv < plan.items.find(i => i.m === 'tableCoffee').z);
  for (const s of plan.items.filter(i => /Sofa/.test(i.m))) {
    assert.ok(!hit(rectOf(s), boardRect(b)), 'a sofa does not touch the board');
    assert.equal(Math.round(Math.cos(s.ry || 0)), 1, 'a sofa faces south');
  }
});

test('lounge plan: a cell of another width keeps the pavilion in its middle; a plan is made once per size', () => {
  const wide = loungePlan(14.6, 6.8);
  assert.equal(wide.deck.u0, DECK.u0 + 1);
  assert.equal(wide.board.cu, BOARD.cu + 1);
  assert.equal(wide.seats[0].u, plan.seats[0].u + 1);
  assert.deepEqual(overlaps(wide), []);
  assert.equal(loungePlan(12.6, 6.8), plan);
});

test('lounge plan: the style has the colours the pack models ask for', () => {
  for (const k of ['wood', 'fabric', 'fabric2', 'shade', 'metal', 'accent']) assert.match(LOUNGE_STYLE.pack[k], /^#[0-9a-f]{6}$/i, k);
  assert.ok(plan.items.filter(solid).length >= 8);
});
