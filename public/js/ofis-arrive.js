// How a person comes into the 3D office and goes out of it: the timeline of a walk, with no WebGL and no DOM so that node can test it (test/ofis-arrive.test.mjs).
// ofis.js draws what this file decides. Nobody in the scene appears or vanishes inside a room: a figure is made at the building entrance, walks in, sits, and
// when its job ends it stands up and walks the way it came, to be removed at the entrance again. Points are plain { x, z } (a THREE.Vector3 fits).
//
//   arrivalPlan(lengths, opts)    when each figure of a queue leaves the entrance (delay) and how fast it walks (pace): the stagger, the speed-up of a big queue, a start that
//                                 carries the queue of an earlier pass on (the entrance clock), and no figure faster than the ones that left before it (nobody overtakes)
//   stepWalk(w, dt, opts)         one frame along a path: constant speed (WALK x pace) with a short speed-up and slow-down at the two ends of the path
//   turnBack(path, pi, pos)       the way back along the points a walk has passed: a brief job that ends before the desk turns around where it stands
//   repath(route, pos, toward)    a path from where a figure stands to the end of a route ('seat') or to its start ('entrance'), joined at the nearest point of it:
//                                 a rebuilt building, a seat that moved, a figure that comes back
//   etaSeconds(len, pace)         the time a walk of that length takes with the ramps (the test of the 10 second budget)

export const WALK = 2.2;                 // units per second at pace 1 (about 1 unit to the metre)
export const STAGGER_S = 0.35;           // time between two figures leaving the entrance
export const SPREAD_MAX_S = 4;           // a big hurried queue is released within this long (the stagger shrinks), so that the last one still has time to walk
export const MIN_STAGGER_S = 0.25;       // ...but never closer than this: a hurried queue of 40 is released over 10 s, because figures that leave the entrance 0.05 s apart walk through each other
export const LOAD_BUDGET_S = 10;         // a page load: everybody who is in the data is in their seat within about this long
export const CALM_QUEUE = 4;             // up to this many in a queue walk at pace 1; more are sped up when the budget asks for it
export const PACE_MAX = 3;               // the fastest a crowd is hurried: 6.6 units per second
export const RAMP_UNITS = 0.7;           // the speed-up at the start of a walk and the slow-down at its end take this much of the path
export const RAMP_FLOOR = 0.25;          // the share of the speed a walk starts and ends with
export const STAND_S = 0.35;             // a seated person stands up before walking out
export const TURN_S = 0.3;               // a person who turns around stands still this long (the body turns, then walks)
const NEAR = 1e-3;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function pathLength(path) {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += dist(path[i - 1], path[i]);
  return s;
}

// the points of a path without the ones that sit on their neighbour (a turn or a re-path can start where the path already is)
export function compact(points) {
  const out = [];
  for (const p of points) if (!out.length || dist(out[out.length - 1], p) > NEAR) out.push(p);
  return out;
}

// the fraction of the walking speed at a point of a path: low at both ends, 1 from RAMP_UNITS on, smooth in between
export function rampFactor(travelled, remaining, ramp = RAMP_UNITS) {
  const e = Math.min(travelled, remaining);
  if (e >= ramp) return 1;
  const t = clamp(e / ramp, 0, 1);
  return RAMP_FLOOR + (1 - RAMP_FLOOR) * t * t * (3 - 2 * t);
}

// seconds a walk of `len` takes at `pace`, ramps included (integrated, not guessed)
export function etaSeconds(len, pace = 1, speed = WALK) {
  if (len <= 0) return 0;
  const n = 400, h = len / n;
  let s = 0;
  for (let i = 0; i < n; i++) { const x = (i + 0.5) * h; s += h / (speed * pace * rampFactor(x, len - x)); }
  return s;
}

// A queue of figures that are all to come in now (a page load, a scene switch, a burst of sub-agents): `lengths` are the lengths of their walks, in any order.
// The longest walks leave first, so that the nearest rooms are the last to be reached and everybody arrives at about the same time; each leaves STAGGER_S after the one before.
// With `rush` and more than CALM_QUEUE figures every walk that would not be over within `budget` seconds is sped up (at most PACE_MAX), and a queue of more than
// SPREAD_MAX_S / STAGGER_S figures is released within SPREAD_MAX_S (the stagger shrinks, but never below MIN_STAGGER_S); without `rush` everybody walks at pace 1 and leaves
// STAGGER_S after the one before, however many they are. `start` is when the first leaves (0: now): the entrance clock of ofis.js passes the time at which the entrance is free
// again, so that a second queue (the sub-agents that come in the next poll) does not leave together with the first.
// The figures of a queue share the hall, so none is faster than the ones that left before it: it would catch up and walk through them. Each walks at the fastest pace
// that it or any figure after it needs (a longer walk with an earlier start never needs less), so everybody still makes the budget.
// Returns { delay, pace } for each figure, in the order of `lengths`.
export function arrivalPlan(lengths, { rush = false, budget = LOAD_BUDGET_S, stagger = STAGGER_S, spread = SPREAD_MAX_S, minStagger = MIN_STAGGER_S, speed = WALK, paceMax = PACE_MAX, calm = CALM_QUEUE, start = 0 } = {}) {
  const n = lengths.length;
  const st = n > 1 ? (rush ? Math.max(Math.min(stagger, minStagger), Math.min(stagger, spread / (n - 1))) : stagger) : 0;
  const order = lengths.map((_, i) => i).sort((a, b) => lengths[b] - lengths[a] || a - b);
  const delay = order.map((_, rank) => Math.max(0, start) + rank * st);
  const pace = order.map((i, rank) => {
    let p = 1;
    if (rush && n > calm) {
      const room = Math.max(budget - delay[rank], 1);
      for (let k = 0; k < 24 && p < paceMax && etaSeconds(lengths[i], p, speed) > room; k++) p = Math.min(paceMax, p * 1.1);
    }
    return p;
  });
  for (let r = n - 2; r >= 0; r--) pace[r] = Math.max(pace[r], pace[r + 1]);        // nobody overtakes
  const out = new Array(n);
  order.forEach((i, rank) => { out[i] = { delay: +delay[rank].toFixed(4), pace: +pace[rank].toFixed(3) }; });
  return out;
}

// One frame of a walk. `w` is { x, z, path, pi, travelled, plen }: the figure's place, its path (the first point is where the walk began), the index of the point
// it walks to, the distance walked and the length of the path. It is moved in place. Returns { moved, done, hx, hz }: the distance covered this frame, whether the
// path is over, and the direction of the leg walked (hx, hz; not unit length). Never more than speed x pace x dt in one frame.
export function stepWalk(w, dt, { speed = WALK, pace = 1 } = {}) {
  const p = w.path[w.pi];
  const dx = p.x - w.x, dz = p.z - w.z, d = Math.hypot(dx, dz);
  const stp = speed * pace * rampFactor(w.travelled, w.plen - w.travelled) * dt;
  if (d <= stp) {
    w.x = p.x; w.z = p.z; w.travelled += d; w.pi++;
    return { moved: d, done: w.pi >= w.path.length, hx: dx, hz: dz };
  }
  w.x += dx / d * stp; w.z += dz / d * stp; w.travelled += stp;
  return { moved: stp, done: false, hx: dx, hz: dz };
}

// A walk turns around: the way back from `pos` along the points of `path` already passed (path[0] .. path[pi - 1]), ending where the walk began.
// For a path that is being walked out (a seat to the entrance) it is the way back to the seat.
export function turnBack(path, pi, pos) {
  return compact([{ x: pos.x, z: pos.z }, ...path.slice(0, Math.max(0, Math.min(pi, path.length))).reverse()]);
}

// The nearest point of a route to p: { i, t, q, d }, q on the leg route[i] to route[i + 1] at t (0 to 1). A route of one point is that point.
export function nearestOnPath(route, p) {
  if (route.length < 2) return { i: 0, t: 0, q: { x: route[0].x, z: route[0].z }, d: dist(route[0], p) };
  let best = null;
  for (let i = 0; i + 1 < route.length; i++) {
    const a = route[i], b = route[i + 1], vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz;
    const t = l2 > 0 ? clamp(((p.x - a.x) * vx + (p.z - a.z) * vz) / l2, 0, 1) : 0;
    const q = { x: a.x + vx * t, z: a.z + vz * t }, d = dist(q, p);
    if (!best || d < best.d - 1e-9) best = { i, t, q, d };
  }
  return best;
}

// A path from where a figure stands to the end of a route (toward 'seat') or to its start ('entrance'): straight to the nearest point of the route, then along it.
// The way for a building that was rebuilt under a walker (the route is the new one), for a seat that moved, and for a figure that comes back.
export function repath(route, pos, toward) {
  const p = { x: pos.x, z: pos.z };
  if (route.length < 2) return compact([p, ...route]);
  const n = nearestOnPath(route, p);
  let i = n.i;
  if (n.t >= 1 - 1e-9 && i < route.length - 2) i++;               // the nearest point is the start of the next leg: go on from there
  const rest = toward === 'seat' ? route.slice(i + 1) : route.slice(0, i + 1).reverse();
  return compact([p, n.q, ...rest]);
}

// a string that tells whether two routes are the same walk (to the centimetre)
export const routeSig = route => route.map(p => p.x.toFixed(2) + ',' + p.z.toFixed(2)).join(';');
