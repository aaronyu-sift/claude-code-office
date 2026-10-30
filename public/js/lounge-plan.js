// Where everything stands in the lounge: the plan of the pavilion in the hub cell of the X (ofis-layout.js `plan.lounge`), in the coordinates of the cell: u east, v south,
// y up, in metres from the cell's north-west corner (the hall of the bar is on the north side, the camera looks from the south-east). Pure (no three.js, no DOM), so node can
// check that nothing overlaps and that every seat has something to sit on (test/lounge-plan.test.mjs); ofis-lounge.js draws it.
//
//   loungePlan(W, D)  -> { deck, board, items, lights, seats, W, D }
//     deck     the paved wooden platform the pavilion stands on { u0, u1, v0, v1, h }
//     board    the freestanding message wall { cu, cv, w, h, y0, t }: centre, width, height, bottom, thickness; its face looks south (+v), toward the camera
//     items    the furniture in the item format of the room styles (ofis-styles.js: `m`, `lamp`, `rug`, `candle`), drawn by ofis-decor.js `furnish`
//     lights   the light sources of the items (the lamps and the candle), the format of the rooms' lights
//     seats    eight places for the people: { id, u, v, ry, pose: 'sit' | 'stand', lift }; ry is the way the person faces (0 south, PI/2 east, PI north, -PI/2 west)
//   LOUNGE_STYLE  the colours of the pack models in the lounge, the shape of a room style's `pack`
import { footprint, heightOf, rectOf, hit, lightsOf } from './ofis-styles.js';

export const DECK = Object.freeze({ u0: 1.5, u1: 11.1, v0: 0.9, v1: 5.7, h: 0.016 });
export const BOARD = Object.freeze({ cu: 6.3, cv: 1.62, w: 7.6, h: 2.35, y0: 0.55, t: 0.14 });
export const LOUNGE_STYLE = Object.freeze({
  id: 'lounge', name: 'Agent lounge',
  pack: Object.freeze({ wood: '#b98a5c', fabric: '#3f7fa0', fabric2: '#e0a458', shade: '#fff0c4', metal: '#8b929f', accent: '#3f7fa0' }),
});

const m = (m, x, z, o = {}) => ({ k: 'm', m, x, z, ...o });
const lamp = (m, x, z, o = {}) => ({ k: 'lamp', m, x, z, tone: 'warm', ...o });

// the items, from the north: the board stands in front of the hall, two sofas turn their backs to it and face the table, two armchairs at the west end, a coffee counter at the east end
const ITEMS = [
  { k: 'rug', m: 'rugRounded', x: 6.3, z: 4.1, s: 3.3, role: 'fabric2', y: 0.022 },
  m('loungeSofa', 4.3, 2.95, { s: 2.2, ry: 0, role: 'fabric' }),
  m('loungeSofa', 8.3, 2.95, { s: 2.2, ry: 0, role: 'fabric' }),
  m('tableCoffee', 6.3, 4.35, { s: 2.2, ry: 0 }),
  { k: 'candle', x: 6.3, z: 4.35, y: 0.5, n: 2, spread: 0.45, on: true },
  m('books', 6.0, 4.35, { y: 0.5, s: 2.4, ry: 0.4, on: true }),
  m('loungeChairRelax', 2.8, 3.95, { s: 2.0, ry: Math.PI / 2, role: 'fabric' }),
  m('loungeChairRelax', 2.8, 4.95, { s: 2.0, ry: Math.PI / 2, role: 'fabric' }),
  m('kitchenCabinet', 10.55, 5.05, { s: 2.0, ry: -Math.PI / 2 }),
  m('kitchenCoffeeMachine', 10.55, 5.05, { s: 2.0, y: 0.9, ry: -Math.PI / 2, on: true }),
  lamp('lampRoundFloor', 1.95, 2.35, { s: 1.7 }),
  lamp('lampRoundFloor', 10.85, 2.35, { s: 1.7 }),
  m('pottedPlant', 1.75, 5.4, { s: 2.0 }),
  m('pottedPlant', 10.9, 1.3, { s: 2.0 }),
  m('pottedPlant', 10.5, 3.7, { s: 2.0 }),
  m('plantSmall2', 5.0, 5.35, { s: 2.2 }),
  m('plantSmall3', 7.6, 5.35, { s: 2.2 }),
];

// the people: four on the sofas, one in each of the two armchairs, two at the coffee counter. `lift` is how far the seat is above the platform (a person's hip is 0.47 above its root
// when it sits), `ry` the way it faces. The first seats are filled first: the sofas, then the armchairs, then the counter.
const SEATS = [
  { id: 'sofa-a1', u: 3.75, v: 2.92, ry: 0, pose: 'sit', lift: -0.06 },
  { id: 'sofa-b1', u: 7.75, v: 2.92, ry: 0, pose: 'sit', lift: -0.06 },
  { id: 'sofa-a2', u: 4.85, v: 2.92, ry: 0, pose: 'sit', lift: -0.06 },
  { id: 'sofa-b2', u: 8.85, v: 2.92, ry: 0, pose: 'sit', lift: -0.06 },
  { id: 'chair-w1', u: 2.8, v: 3.95, ry: Math.PI / 2, pose: 'sit', lift: -0.03 },
  { id: 'chair-w2', u: 2.8, v: 4.95, ry: Math.PI / 2, pose: 'sit', lift: -0.03 },
  { id: 'counter-1', u: 9.6, v: 4.78, ry: Math.PI / 2, pose: 'stand', lift: 0 },
  { id: 'counter-2', u: 9.6, v: 5.4, ry: Math.PI / 2, pose: 'stand', lift: 0 },
];

const cache = new Map();
export function loungePlan(W = 12.6, D = 6.8) {
  const key = W + '|' + D;
  if (cache.has(key)) return cache.get(key);
  const dx = (W - 12.6) / 2;                                   // a cell of another width (the layout can change) keeps the pavilion in its middle
  const move = o => ({ ...o, x: o.x + dx });
  const items = ITEMS.map(it => ({ ...move(it) })).map((it, i) => ({ ...it, y: it.y == null ? DECK.h : it.y, id: `lounge-${i}` }));
  const seats = SEATS.map(s => ({ ...s, u: s.u + dx }));
  const deck = { ...DECK, u0: DECK.u0 + dx, u1: DECK.u1 + dx };
  const board = { ...BOARD, cu: BOARD.cu + dx };
  const plan = { deck, board, items, lights: lightsOf(items, 'lounge'), seats, W, D };
  cache.set(key, plan);
  return plan;
}

// ---- checks (the test reads these): the footprints on the platform, and what a seat sits on
export const solid = it => (it.k === 'm' || it.k === 'lamp') && !it.on;               // stands on the floor and takes room (a rug is flat, a candle or a lamp on a table stands on something)
export const boardRect = b => [b.cu - b.w / 2 - 0.3, b.cu + b.w / 2 + 0.3, b.cv - b.t / 2 - 0.1, b.cv + b.t / 2 + 0.1];     // with its posts
export function overlaps(plan) {
  const out = [], br = boardRect(plan.board), floor = plan.items.filter(solid);
  for (let i = 0; i < floor.length; i++) {
    for (let j = i + 1; j < floor.length; j++) if (hit(rectOf(floor[i]), rectOf(floor[j]))) out.push([floor[i].m, floor[j].m]);
    if (hit(rectOf(floor[i]), br)) out.push([floor[i].m, 'board']);
  }
  return out;
}
// the furniture a seat's person sits on, or null (a standing place is clear of every piece instead)
export function seatOf(plan, seat) {
  const at = [seat.u - 0.01, seat.u + 0.01, seat.v - 0.01, seat.v + 0.01];
  return plan.items.find(it => solid(it) && /sofa|chair/i.test(it.m) && hit(rectOf(it), at)) || null;
}
export const standClear = (plan, seat) => !plan.items.some(it => solid(it) && hit(rectOf(it), [seat.u - 0.3, seat.u + 0.3, seat.v - 0.3, seat.v + 0.3]));
export { footprint, heightOf };
