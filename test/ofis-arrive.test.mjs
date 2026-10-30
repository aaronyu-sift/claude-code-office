import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WALK, STAGGER_S, SPREAD_MAX_S, MIN_STAGGER_S, LOAD_BUDGET_S, CALM_QUEUE, PACE_MAX, RAMP_UNITS, RAMP_FLOOR,
  pathLength, compact, rampFactor, etaSeconds, arrivalPlan, stepWalk, turnBack, nearestOnPath, repath, routeSig, dist, sharedUpTo, meet, leadOut, rejoin,
} from '../public/js/ofis-arrive.js';

const P = (x, z) => ({ x, z });
// the walk of a sub-agent: the entrance, along the hall, in at the door, down the aisle to the desk
const ROUTE = [P(60, 2), P(20, 2), P(20, 0.5), P(15, 0.5), P(15, 4), P(14, 4)];

// walk a path to its end at a frame rate: every frame { x, z, moved }
function walk(path, { dt = 1 / 30, pace = 1, max = 600 } = {}) {
  const w = { x: path[0].x, z: path[0].z, path, pi: 1, travelled: 0, plen: pathLength(path) };
  const frames = [];
  for (let t = 0; t < max / dt; t++) {
    const r = stepWalk(w, dt, { pace });
    frames.push({ x: w.x, z: w.z, moved: r.moved, t: (t + 1) * dt });
    if (r.done) return { frames, w };
  }
  throw new Error('the walk never ended');
}

// ---------------------------------------------------------------- the ramp and the speed

test('rampFactor: slow at both ends of a path, 1 in the middle, never zero', () => {
  assert.equal(rampFactor(0, 50), RAMP_FLOOR);
  assert.equal(rampFactor(50, 0), RAMP_FLOOR);
  assert.equal(rampFactor(RAMP_UNITS, 50), 1);
  assert.equal(rampFactor(25, 25), 1);
  let prev = 0;
  for (let x = 0; x <= RAMP_UNITS; x += 0.01) { const f = rampFactor(x, 99); assert.ok(f >= prev - 1e-12 && f > 0, `rises smoothly at ${x}`); prev = f; }
  assert.ok(rampFactor(0.2, 99) < rampFactor(0.5, 99));
  assert.equal(rampFactor(3, 0.3), rampFactor(0.3, 3), 'the same slow-down at the two ends');
});

test('stepWalk: reaches the end, exactly, at a constant speed between the ramps and never faster than speed x pace x dt', () => {
  for (const [dt, pace] of [[1 / 30, 1], [1 / 8, 1], [0.1, 3], [1 / 60, 2.2]]) {
    const { frames, w } = walk(ROUTE, { dt, pace });
    assert.deepEqual([w.x, w.z], [14, 4], 'ends on the seat');
    assert.ok(Math.abs(w.travelled - pathLength(ROUTE)) < 1e-6, 'the distance walked is the length of the path');
    assert.ok(Math.max(...frames.map(f => f.moved)) <= WALK * pace * dt + 1e-9, `no frame covers more than ${WALK * pace * dt} (dt ${dt}, pace ${pace})`);
    const mid = frames.filter(f => f.x < 50 && f.x > 25 && f.z === 2).map(f => f.moved);
    assert.ok(mid.length > 3 && mid.every(m => Math.abs(m - WALK * pace * dt) < 1e-9), 'a constant speed in the middle of the hall');
  }
});

test('stepWalk: starts slowly and ends slowly (the short speed-up and slow-down of docs/motion.md)', () => {
  const { frames } = walk(ROUTE);
  const speed = f => f.moved * 30;
  assert.ok(speed(frames[0]) <= WALK * RAMP_FLOOR + 0.05, 'the first frame is a slow one');
  assert.ok(speed(frames[0]) < speed(frames[10]) && speed(frames[10]) < speed(frames[30]), 'it speeds up');
  const last = frames.at(-1), before = frames.at(-8);
  assert.ok(before.moved > last.moved || last.moved < WALK / 30, 'it slows down into the seat');
});

test('stepWalk: a figure that is already on its point does not stall', () => {
  const path = [P(0, 0), P(0, 0), P(5, 0)];
  const { w } = walk(path);
  assert.deepEqual([w.x, w.z], [5, 0]);
});

test('etaSeconds: a bit longer than length over speed, and shorter at a higher pace', () => {
  const len = pathLength(ROUTE);
  const t1 = etaSeconds(len, 1), t3 = etaSeconds(len, 3);
  assert.ok(t1 > len / WALK && t1 < len / WALK + 1, `${t1} against ${len / WALK}`);
  assert.ok(t3 < t1 / 2.5);
  const { frames } = walk(ROUTE);
  assert.ok(Math.abs(frames.at(-1).t - t1) < 0.2, `the simulated ${frames.at(-1).t} s agrees with ${t1.toFixed(2)} s`);
  assert.equal(etaSeconds(0), 0);
});

// ---------------------------------------------------------------- the queue

test('arrivalPlan: a few figures leave the entrance 0.35 s apart and walk at pace 1', () => {
  const plan = arrivalPlan([30, 30, 30]);
  assert.deepEqual(plan.map(p => p.delay), [0, STAGGER_S, STAGGER_S * 2]);
  assert.ok(plan.every(p => p.pace === 1));
  assert.deepEqual(arrivalPlan([12]), [{ delay: 0, pace: 1 }]);
  assert.deepEqual(arrivalPlan([]), []);
});

test('arrivalPlan: the longest walk leaves first, the plan comes back in the order asked for', () => {
  const plan = arrivalPlan([10, 60, 30]);
  assert.deepEqual(plan.map(p => p.delay), [STAGGER_S * 2, 0, STAGGER_S]);
});

test('arrivalPlan: more than four with a rush are sped up so that all are in their seat within the budget', () => {
  const lengths = [66, 60, 55, 50, 44, 40, 33, 30, 22, 18, 12, 9];       // a page load in the X: the far offices of the bar down to the near ones
  const plan = arrivalPlan(lengths, { rush: true });
  lengths.forEach((len, i) => {
    const t = plan[i].delay + etaSeconds(len, plan[i].pace);
    assert.ok(t <= LOAD_BUDGET_S + 0.35, `walk ${i} (${len} units): delay ${plan[i].delay}, pace ${plan[i].pace}, arrives at ${t.toFixed(1)} s`);
    assert.ok(plan[i].pace >= 1 && plan[i].pace <= PACE_MAX);
  });
  assert.ok(plan[0].pace > 2 && plan[0].pace <= PACE_MAX, 'the longest walk is hurried most');
  assert.ok(plan[9].pace > 1 && plan[9].pace < plan[0].pace, 'a middle walk is hurried less');
  assert.equal(plan[10].pace, 1, 'a short walk is not hurried');
  assert.equal(plan[11].pace, 1);
});

test('arrivalPlan: four or fewer are never hurried, and a calm reload never is', () => {
  assert.ok(arrivalPlan([66, 60, 55, 50], { rush: true }).every(p => p.pace === 1), `up to ${CALM_QUEUE} walk at pace 1`);
  const many = Array.from({ length: 20 }, (_, i) => 20 + i * 2);
  assert.ok(arrivalPlan(many).every(p => p.pace === 1), 'without a rush: pace 1');
  assert.ok(arrivalPlan(many, { rush: true }).some(p => p.pace > 1));
});

test('arrivalPlan: a hurried queue that fits is released within SPREAD_MAX_S, a bigger one never closer than MIN_STAGGER_S', () => {
  const lens = Array.from({ length: 16 }, (_, i) => 66 - i * 3);                  // the far offices of the bar down to the near ones
  const plan = arrivalPlan(lens, { rush: true });
  const last = Math.max(...plan.map(p => p.delay));
  assert.ok(last <= SPREAD_MAX_S + 1e-6 && last > SPREAD_MAX_S - 0.3, `last delay ${last}`);
  assert.ok(plan.every((p, i) => p.delay + etaSeconds(lens[i], p.pace) <= LOAD_BUDGET_S + 0.6), 'a queue of 16 is in within the budget (long walks first)');
  const big = arrivalPlan(Array.from({ length: 40 }, (_, i) => 66 - i), { rush: true });
  const delays = big.map(p => p.delay).sort((a, b) => a - b), gaps = delays.slice(1).map((d, i) => d - delays[i]);
  assert.ok(Math.min(...gaps) >= MIN_STAGGER_S - 1e-3, `the closest two leave ${Math.min(...gaps)} s apart`);
  assert.ok(Math.max(...big.map(p => p.pace)) <= PACE_MAX + 1e-9);
});

test('arrivalPlan: a calm queue is not squeezed however long it is (the stagger shrinks only for a hurried one)', () => {
  const plan = arrivalPlan(Array.from({ length: 30 }, () => 30));
  const delays = plan.map(p => p.delay).sort((a, b) => a - b);
  assert.ok(delays.slice(1).every((d, i) => Math.abs(d - delays[i] - STAGGER_S) < 1e-3), 'every figure leaves 0.35 s after the one before');
  assert.ok(plan.every(p => p.pace === 1));
});

test('arrivalPlan: start is when the first figure leaves (the entrance clock of a second queue)', () => {
  const a = arrivalPlan([30, 30], { start: 1.2 });
  assert.deepEqual(a.map(p => p.delay), [1.2, 1.55]);
  assert.deepEqual(arrivalPlan([30, 30], { start: -3 }).map(p => p.delay), [0, STAGGER_S], 'a negative start is 0');
  // two queues made 0.4 s apart: the second leaves after the first, not with it
  const first = arrivalPlan([40, 40, 40, 40]), t = 0.4;
  const second = arrivalPlan([40, 40], { start: Math.max(0, Math.max(...first.map(p => p.delay)) + STAGGER_S - t) });
  assert.ok(Math.min(...second.map(p => p.delay)) + t >= Math.max(...first.map(p => p.delay)) + STAGGER_S - 1e-9, 'the second queue leaves a stagger after the last of the first');
});

test('arrivalPlan: nobody overtakes: a figure is never faster than the ones that left before it', () => {
  const cases = [
    [66, 60, 55, 50, 44, 40, 33, 30, 22, 18, 12, 9],
    Array.from({ length: 30 }, (_, i) => 40 - (i % 3) * 0.5),                  // three figures of a chat: walks of about the same length
    Array.from({ length: 40 }, () => 30),
    [30, 30, 30, 30, 30, 30, 60, 10],
  ];
  for (const lengths of cases) {
    const plan = arrivalPlan(lengths, { rush: true });
    const order = lengths.map((_, i) => i).sort((a, b) => plan[a].delay - plan[b].delay || a - b);
    for (let r = 1; r < order.length; r++) assert.ok(plan[order[r]].pace <= plan[order[r - 1]].pace + 1e-9, `figure ${order[r]} (pace ${plan[order[r]].pace}) is faster than the one before it (${plan[order[r - 1]].pace})`);
  }
  // and so, on one lane, the closest two never touch: simulate the hall of a page load
  const lengths = Array.from({ length: 30 }, (_, i) => 60 - Math.floor(i / 3) * 4);
  const plan = arrivalPlan(lengths, { rush: true });
  const routes = lengths.map(len => [P(70, 0), P(70 - (len - 6), 0), P(70 - (len - 6), 3), P(70 - (len - 4), 3)]);
  const ws = routes.map((r, i) => ({ r, i, w: { x: 70, z: 0, path: r, pi: 1, travelled: 0, plen: pathLength(r) }, done: false }));
  let closest = 9;
  for (let t = 0; t < 90; t += 0.1) {
    const live = [];
    for (const f of ws) {
      if (f.done || t < plan[f.i].delay) continue;
      if (stepWalk(f.w, 0.1, { pace: plan[f.i].pace }).done) f.done = true; else live.push(f);
    }
    for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++) closest = Math.min(closest, dist(live[a].w, live[b].w));
  }
  assert.ok(closest > 0.25, `the closest two walkers in a page load were ${closest.toFixed(2)} units apart`);
});

// ---------------------------------------------------------------- turning around, re-pathing

test('turnBack: the way back along the points already passed, to the entrance', () => {
  // between the door and the first aisle point: path[0..2] passed, walking toward path[3]
  const pos = P(17, 0.5);
  const back = turnBack(ROUTE, 3, pos);
  assert.deepEqual(back.map(p => [p.x, p.z]), [[17, 0.5], [20, 0.5], [20, 2], [60, 2]]);
  assert.ok(Math.abs(pathLength(back) - (3 + 1.5 + 40)) < 1e-9);
  const w = { x: 17, z: 0.5, path: back, pi: 1, travelled: 0, plen: pathLength(back) };
  let r;
  for (let i = 0; i < 4000 && !(r = stepWalk(w, 1 / 30)).done; i++);
  assert.deepEqual([w.x, w.z], [60, 2], 'it ends at the entrance');
});

test('turnBack: just after the entrance it is a short way; on a point of the path that point is not repeated', () => {
  const back = turnBack(ROUTE, 1, P(58.5, 2));
  assert.deepEqual(back.map(p => [p.x, p.z]), [[58.5, 2], [60, 2]]);
  assert.deepEqual(turnBack(ROUTE, 1, P(60, 2)).map(p => [p.x, p.z]), [[60, 2]], 'it has not moved: nothing to walk');
  assert.deepEqual(turnBack(ROUTE, 3, P(20, 0.5)).map(p => [p.x, p.z]), [[20, 0.5], [20, 2], [60, 2]]);
});

test('turnBack twice returns to the seat: a figure that walks out and is asked back', () => {
  const out = turnBack(ROUTE, ROUTE.length, P(14, 4));                          // stands up at the seat and leaves
  assert.deepEqual(out.map(p => [p.x, p.z]), [...ROUTE].reverse().map(p => [p.x, p.z]));
  const again = turnBack(out, 2, P(15, 1.0));                                   // on the way out, between the second and the third point
  assert.deepEqual(again.map(p => [p.x, p.z]), [[15, 1], [15, 4], [14, 4]]);
});

test('nearestOnPath: the point on the nearest leg, the end points when beyond them', () => {
  assert.deepEqual(nearestOnPath(ROUTE, P(40, 5)).q, { x: 40, z: 2 });
  assert.equal(nearestOnPath(ROUTE, P(40, 5)).i, 0);
  const past = nearestOnPath(ROUTE, P(10, 4));
  assert.deepEqual(past.q, { x: 14, z: 4 });
  assert.deepEqual(nearestOnPath([P(1, 1)], P(5, 5)).q, { x: 1, z: 1 });
});

test('repath: from where a figure stands to the seat of a new route, or back to its entrance', () => {
  const moved = ROUTE.map(p => P(p.x + 3, p.z));                                // the building grew: the whole route is 3 to the right
  const pos = P(40, 2);                                                         // a walker that was on the old route
  const toSeat = repath(moved, pos, 'seat');
  assert.deepEqual(toSeat.map(p => [p.x, p.z]), [[40, 2], [23, 2], [23, 0.5], [18, 0.5], [18, 4], [17, 4]], 'goes along the hall to the new door');
  const toEntrance = repath(moved, pos, 'entrance');
  assert.deepEqual(toEntrance.map(p => [p.x, p.z]), [[40, 2], [63, 2]]);
  const seated = repath(moved, P(14, 4), 'seat');
  assert.deepEqual(seated.map(p => [p.x, p.z]), [[14, 4], [17, 4]], 'a figure whose seat moved walks to the new seat');
  assert.equal(repath([P(1, 1)], P(3, 3), 'seat').length, 2);
});

test('repath: at the start of a leg it does not backtrack', () => {
  const r = repath(ROUTE, P(20, 0.5), 'seat');                                   // exactly on a corner
  assert.deepEqual(r.map(p => [p.x, p.z]), [[20, 0.5], [15, 0.5], [15, 4], [14, 4]]);
  const e = repath(ROUTE, P(20, 0.5), 'entrance');
  assert.deepEqual(e.map(p => [p.x, p.z]), [[20, 0.5], [20, 2], [60, 2]]);
});

test('compact and routeSig', () => {
  assert.equal(compact([P(0, 0), P(0, 0.0001), P(1, 0)]).length, 2);
  assert.equal(routeSig(ROUTE), routeSig(ROUTE.map(p => ({ ...p }))));
  assert.notEqual(routeSig(ROUTE), routeSig(ROUTE.map(p => P(p.x + 0.1, p.z))));
  assert.equal(dist(P(0, 0), P(3, 4)), 5);
});

// ---------------------------------------------------------------- a walk that changes seat keeps to the routes of the office

// one office, seen from above: the hall lane z = 2 from the entrance (x 60) to the door (x 20), the door out (20, 0.5), the way into the room (15, 0.5), and then two seats on
// either side of a table that stands on the straight line between them: seat A is reached by the corridor on the left (x 15, down to z 4, then to the seat at 10, 4), seat B on the right
const SHARED = [P(60, 2), P(20, 2), P(20, 0.5), P(15, 0.5)];
const ROUTE_A = [...SHARED, P(12, 0.5), P(12, 6), P(10, 6)];
const ROUTE_B = [...SHARED, P(18, 0.5), P(18, 6), P(20, 6)];
const TABLE = { x0: 13, x1: 17, z0: 1.5, z1: 5 };                                   // between the two corridors: a straight line from seat A to seat B goes through it
const crossesTable = (path, t = TABLE) => {
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], n = Math.max(1, Math.ceil(dist(a, b) / 0.05));
    for (let k = 0; k <= n; k++) { const x = a.x + (b.x - a.x) * k / n, z = a.z + (b.z - a.z) * k / n; if (x > t.x0 && x < t.x1 && z > t.z0 && z < t.z1) return true; }
  }
  return false;
};

test('sharedUpTo: the points two seats of one office have in common, whatever the entrance does', () => {
  assert.equal(sharedUpTo(ROUTE_A, ROUTE_B), 3);
  assert.equal(sharedUpTo(ROUTE_A, ROUTE_A.map(p => ({ ...p }))), ROUTE_A.length - 1);
  const grown = ROUTE_B.map((p, i) => (i === 0 ? P(75, 2) : p));                   // the building grew: the entrance moved, nothing else did
  assert.equal(sharedUpTo(ROUTE_A, grown), 3, 'the entrance is not compared');
  assert.equal(sharedUpTo(ROUTE_A, ROUTE_B.map(p => P(p.x + 40, p.z))), -1, 'another office shares nothing');
});

test('rejoin: from one seat to another it goes back along the first route to where they part, then in along the second', () => {
  const seatedAtA = P(10, 6);
  const straight = repath(ROUTE_B, seatedAtA, 'seat');
  assert.ok(crossesTable(straight), 'the nearest-point repath walks through the table (this is why rejoin exists)');
  const way = rejoin(ROUTE_A, ROUTE_B, seatedAtA);
  assert.deepEqual(way.map(p => [p.x, p.z]), [[10, 6], [12, 6], [12, 0.5], [15, 0.5], [18, 0.5], [18, 6], [20, 6]]);
  assert.ok(!crossesTable(way), 'and it keeps to the corridors');
  assert.ok(Math.abs(pathLength(way) - way.slice(1).reduce((s, p, i) => s + dist(way[i], p), 0)) < 1e-9);
});

test('rejoin: from the middle of a walk on the first route, and from the part the two share', () => {
  const mid = rejoin(ROUTE_A, ROUTE_B, P(12, 3));                                 // in the left corridor
  assert.deepEqual(mid.map(p => [p.x, p.z]), [[12, 3], [12, 0.5], [15, 0.5], [18, 0.5], [18, 6], [20, 6]]);
  const hall = rejoin(ROUTE_A, ROUTE_B, P(40, 2));                                // in the hall: both go the same way for now
  assert.deepEqual(hall.map(p => [p.x, p.z]), [[40, 2], [20, 2], [20, 0.5], [15, 0.5], [18, 0.5], [18, 6], [20, 6]]);
  for (const w of [mid, hall]) assert.ok(!crossesTable(w));
  const same = rejoin(ROUTE_A, ROUTE_A, P(12, 3));                                // the same seat again
  assert.deepEqual(same.map(p => [p.x, p.z]), [[12, 3], [12, 6], [10, 6]]);
  assert.deepEqual(rejoin(null, ROUTE_B, P(40, 2)).map(p => [p.x, p.z]), repath(ROUTE_B, P(40, 2), 'seat').map(p => [p.x, p.z]));
});

test('rejoin: a figure on a link (it was put on a new route once already) finishes the link, then goes on', () => {
  const first = rejoin(ROUTE_A, ROUTE_B, P(10, 6));                               // out of seat A toward seat B
  const pos = P(12, 4);                                                           // on its way up the left corridor
  const link = first;
  const again = rejoin(ROUTE_B, ROUTE_A, pos, link, 2);                           // the seat changes again: toward A. It is not on route B (it is on the link), so the link is finished first
  assert.deepEqual(again.slice(0, 3).map(p => [p.x, p.z]), [[12, 4], [12, 0.5], [15, 0.5]], 'to the first point of the link that is on the route it knows');
  assert.ok(!crossesTable(again));
  assert.deepEqual(again[again.length - 1], { x: 10, z: 6 }, 'and ends at seat A');
});

test('leadOut: out to the entrance along the route, or along the link until it meets the route', () => {
  assert.deepEqual(leadOut(ROUTE_B, P(18, 3), null, 0).map(p => [p.x, p.z]), [[18, 3], [18, 0.5], [15, 0.5], [20, 0.5], [20, 2], [60, 2]].filter((p, i, a) => i === 0 || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]));
  const link = rejoin(ROUTE_A, ROUTE_B, P(10, 6));                                // walking out of seat A to B: [10,6] [12,6] [12,0.5] [15,0.5] [18,0.5] [18,6] [20,6]
  const out = leadOut(ROUTE_B, P(11, 6), link, 1);                                // still on the first leg of the link, in a place that is not on route B
  assert.deepEqual(out.slice(0, 4).map(p => [p.x, p.z]), [[11, 6], [12, 6], [12, 0.5], [15, 0.5]], 'on along the link to where it meets the route');
  assert.deepEqual(out[out.length - 1], { x: 60, z: 2 });
  assert.ok(!crossesTable(out));
  assert.deepEqual(meet(ROUTE_B, P(18, 3), null, 0).link, [], 'on the route: no link');
});
