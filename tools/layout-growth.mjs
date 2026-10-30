// Design aid (not part of the app): how well the building fits the window as bays are added. Prints the fit zoom (1440 x 900, with and without the shelf
// card, 1920 x 1080, 1280 x 800 with the card) for the order of public/js/ofis-layout.js and for orders found by greedy search (every step adds the bay,
// next to the building and in a row that stays whole, that fits best; with --from the first bays are kept as they are, with --bar-left the bar never grows
// to the left so that the reception end of its hall stays where it is), next to the two rows of before with a row of five appended at a time.
//   node tools/layout-growth.mjs [--bays 32] [--from 10] [--bar-left]
import { bayAt, projectedBox, fitZoom, PITCH, PITCH_Z, PAIR_D, GAP, WALL_T, PLINTH_M, CELL_W, ROOM_D, HALL_GAP, officesIn } from '../public/js/ofis-layout.js';

const args = process.argv.slice(2), arg = (f, d) => (args.includes('--' + f) ? args[args.indexOf('--' + f) + 1] : d);
const N = +arg('bays', 32), FROM = +arg('from', 6), BAR_LEFT = args.includes('--bar-left');
const plinthOf = bays => {
  const rows = new Map();
  for (const [k, c] of bays) { const r = rows.get(k) || { x0: Infinity, x1: -Infinity }; r.x0 = Math.min(r.x0, c * PITCH); r.x1 = Math.max(r.x1, c * PITCH + CELL_W); rows.set(k, r); }
  return [...rows].map(([k, r]) => ({ x0: r.x0 - WALL_T - PLINTH_M, x1: r.x1 + WALL_T + PLINTH_M, z0: (k + 1) * PITCH_Z - GAP / 2, z1: (k + 1) * PITCH_Z + PAIR_D + GAP / 2 }));
};
const score = bays => {
  const rects = plinthOf(bays), box = projectedBox(rects);
  return [fitZoom(box, 1440, 900), fitZoom(box, 1440, 900, { right: 322 }), fitZoom(box, 1920, 1080), fitZoom(box, 1280, 800, { right: 322 })];
};
const mean = a => a.reduce((t, v) => t + v, 0) / a.length;
const key = ([k, c]) => k + '/' + c;
const whole = bays => { const rows = new Map(); for (const [k, c] of bays) (rows.get(k) || rows.set(k, []).get(k)).push(c); return [...rows.values()].every(cs => { cs.sort((a, b) => a - b); return cs.every((c, i) => !i || Math.abs(c - cs[i - 1] - 1) < 1e-9); }); };
const joined = (bays, [k, c]) => bays.some(([k2, c2]) => (k2 === k && Math.abs(c2 - c) === 1) || (Math.abs(k2 - k) === 1 && Math.abs(c2 - c) <= 0.5 + 1e-9));
// the two rows of before: a row of five cells appended at a time (a pair of rows is one bar of 5 bays deep 1; one more row is 5 cells with an open hall in front)
const oldZoom = cells => {
  const rows = cells / 5, depth = Math.ceil(rows / 2) * PAIR_D + (Math.ceil(rows / 2) - 1) * GAP - (rows % 2 ? PAIR_D - (ROOM_D + HALL_GAP + 3.6) : 0), w = 5 * PITCH - GAP;
  return fitZoom(projectedBox([{ x0: -WALL_T - PLINTH_M, x1: w + WALL_T + PLINTH_M, z0: -WALL_T - PLINTH_M, z1: depth + WALL_T + PLINTH_M }]), 1440, 900);
};

const current = Array.from({ length: N }, (_, i) => bayAt(i));
const lattice = [];
for (let k = -6; k <= 6; k++) for (let c = -6; c <= 10; c += 0.5) lattice.push([k, c]);
// greedy: every step adds the bay that fits best, ties go to the middle; `step` pairs bays that the turn of the building by half maps onto each other
function grow(start, pairs) {
  const out = start.slice(), mirror = ([k, c]) => [-k, 3 - c];
  while (out.length < N) {
    const taken = new Set(out.map(key));
    let best = null;
    for (const cand of lattice) {
      if (taken.has(key(cand)) || !joined(out, cand) || (BAR_LEFT && cand[0] === 0 && cand[1] < 0)) continue;
      const add = [cand];
      if (pairs) { const m = mirror(cand); if (taken.has(key(m)) || key(m) === key(cand)) continue; add.push(m); }
      const next = [...out, ...add];
      if (!whole(next)) continue;
      // ties go to the middle and to the side (north or south of the bar) that has fewer bays, so the building grows on both sides
      const side = Math.sign(cand[0]), onSide = side ? out.filter(b => Math.sign(b[0]) === side).length : 0;
      const sc = mean(score(next)) - 0.002 * Math.abs(cand[0]) - 0.0005 * Math.abs(cand[1] - 1.5) - 0.0003 * onSide;
      if (!best || sc > best.sc) best = { add, sc };
    }
    out.push(...best.add);
  }
  return out.slice(0, N);
}
const greedy = grow(current.slice(0, FROM), false), sym = grow(current.slice(0, FROM), true);
console.log('bays offices | order of the layout: zoom 1440 | + shelf | 1920 | 1280 shelf || greedy order: same || symmetric pairs: same | old rows (cells): zoom 1440');
for (let b = 6; b <= N; b++) {
  const a = score(current.slice(0, b)), g = score(greedy.slice(0, b)), y = score(sym.slice(0, b)), cells = officesIn(b) + 1;
  console.log(`${String(b).padStart(3)} ${String(officesIn(b)).padStart(3)} | ${a.map(v => v.toFixed(1).padStart(5)).join(' ')} || ${g.map(v => v.toFixed(1).padStart(5)).join(' ')} || ${y.map(v => v.toFixed(1).padStart(5)).join(' ')} | old ${oldZoom(Math.ceil(cells / 5) * 5).toFixed(1)} for ${Math.ceil(cells / 5) * 5}`);
}
console.log('greedy order:', JSON.stringify(greedy.slice(FROM)));
console.log('symmetric order:', JSON.stringify(sym.slice(FROM)));
