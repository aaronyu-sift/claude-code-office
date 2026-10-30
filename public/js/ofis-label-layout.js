// Where the labels of the three.js Office go on the screen (pure geometry, tested with numbers: test/ofis-label-layout.test.mjs). Two kinds:
//   fixed  labels that sit at one spot of their own (the balloon over a head, the labels of add-ons): they keep it, and one that touches a label placed before it is not shown
//   tags   the labels of the agents (office-labels.js): they may move to a free spot near their agent, found by the pixel scene's own declutter (pixel/labels.js `placeLabels`),
//          so a sub-agent's label is not dropped just because a main agent's label hangs next to it; the figures of the agents are obstacles that a label gives way to.
//          A tag with `near` (its agent's rect) and `maxGap` is shown only within that many px of its agent: farther away it would read as another agent's label.
// `blocked` are the rects of what floats over the scene (the agent card, the shelf card, the zoom buttons): nothing is drawn under them, whatever its priority.
// All rects are { x, y, w, h } in CSS px of the scene's box; a label is { id, x, y, w, h, pri | rank, force }, x and y being the spot it prefers.
// `layoutLabels` decides from scratch every call. The scene uses `createLabelLayout` at the end of this file, which keeps a memory between frames (no hops, no blinks).
import { placeLabels as declutter } from './pixel/labels.js';
import { Spring, SPRING } from './motion.js';

const GAP = 4;                                   // the declutter wants an anchor: the bottom centre of the spot above it, GAP below the label
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const touches = (a, b) => a.x < b.x + b.w + 3 && a.x + a.w + 3 > b.x && a.y < b.y + b.h + 2 && a.y + a.h + 2 > b.y;
// the distance between two rects: 0 when they touch or overlap, else the larger of the horizontal and the vertical gap
export const gapBetween = (a, b) => Math.max(0, Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) - (a.w + b.w) / 2, Math.abs(a.y + a.h / 2 - (b.y + b.h / 2)) - (a.h + b.h) / 2);

// -> Map id -> { x, y } for every label that is shown (the others are hidden)
export function layoutLabels({ fixed = [], tags = [], blocked = [], figures = [], vw, vh }) {
  const out = new Map();
  const kept = [];
  for (const L of [...fixed].sort((a, b) => b.pri - a.pri || b.y - a.y)) {
    if (blocked.some(r => overlaps(L, r))) continue;
    if (!L.force && kept.some(P => touches(L, P))) continue;
    kept.push(L);
    out.set(L.id, { x: L.x, y: L.y });
  }
  // what is in place already (the fixed labels and what floats over the scene) is `taken`: the tags find their place around it and never move it
  const item = T => ({ id: T.id, ax: T.x + T.w / 2, ay: T.y + T.h + GAP, w: T.w, h: T.h, pri: T.rank, force: !!T.force });
  const res = declutter(tags.map(item), vw, vh, GAP, 2, figures, [...kept, ...blocked]);
  const shown = [];                                    // the rects of the tags that are placed
  const lost = [];                                     // forced tags whose spot lies under what floats over the scene
  for (const T of tags) {
    const p = res.get(T.id);
    if (!p || !(p.ok || T.force)) continue;
    const at = { x: p.x, y: p.y, w: T.w, h: T.h };
    if (T.near && gapBetween(at, T.near) > (T.maxGap ?? Infinity)) continue;
    if (blocked.some(r => overlaps(at, r))) { if (T.force) lost.push(T); continue; }
    out.set(T.id, { x: p.x, y: p.y });
    shown.push(at);
  }
  // A main agent's label is never hidden: where the declutter could only find spots under the card, it takes the nearest spot of a grid that is clear of what floats over the
  // scene, of the labels placed and of the balloons; and when the view is too crowded for that, the nearest spot that is clear of what floats over the scene.
  for (const T of lost.sort((a, b) => b.rank - a.rank)) {
    const at = freeSpot(T, [...blocked], [...kept, ...shown], figures, vw, vh) || freeSpot(T, [...blocked], [], figures, vw, vh);
    if (!at) continue;
    out.set(T.id, { x: at.x, y: at.y });
    shown.push(at);
  }
  return out;
}

// the spot nearest to where a label wants to be that overlaps none of `avoid` and touches none of `labels`, one that covers no agent first; null when there is none in reach
const STEP = 14, REACH = 520;
function freeSpot(T, avoid, labels, figures, vw, vh) {
  const cands = [];
  const x0 = Math.max(4, T.x - REACH), x1 = Math.min(vw - T.w - 4, T.x + REACH), y0 = Math.max(4, T.y - REACH), y1 = Math.min(vh - T.h - 4, T.y + REACH);
  for (let y = y0; y <= y1; y += STEP) for (let x = x0; x <= x1; x += STEP) cands.push({ x, y, d: Math.hypot(x - T.x, y - T.y) });
  cands.sort((a, b) => a.d - b.d);
  let best = null;
  for (const c of cands) {
    const at = { x: c.x, y: c.y, w: T.w, h: T.h };
    if (avoid.some(r => overlaps(at, r)) || labels.some(r => touches(at, r))) continue;
    if (!figures.some(r => overlaps(at, r))) return at;              // clear of the agents as well: take it
    if (!best) best = at;                                            // else the nearest spot that only covers an agent
  }
  return best;
}

// ---- the stateful layout --------------------------------------------------------------------------------------------------------------------------------------
// `layoutLabels` above decides every frame from scratch with crisp thresholds, so one pixel of change in a neighbour (a walking agent, a zoom step) picks another spot, and a
// label hops by a whole ring or blinks (docs/labels.md has the measurements). `createLabelLayout` keeps a memory between frames and is the one the scene uses:
//   const layout = createLabelLayout();   const out = layout.step({ fixed, tags, blocked, figures, vw, vh, reduced }, now);   // now: the frame's clock in ms
//   out: Map id -> { x, y, shown, cut, moving }   x, y the rect to draw at (it follows its agent every frame); `shown` false = hide it; `cut` = hide it without a fade (it is under what
//        floats over the scene); `moving` = its spring has not settled. `layout.moving` is true when any label's has not, so the frame loop can keep drawing while a label glides.
// The inputs are those of `layoutLabels` (tags may also carry `walking`). What it does differently, each point a measured cause of the flicker:
//   1. home spot = just below the agent's own figure rect (not the floor point, which is always inside that rect)
//   2. a label keeps its cell while nothing overlaps it by more than 1 px; a new cell needs 3 px of clearance; it goes home again only after RETURN_MS of the home spot being free
//   3. cells are lattice units around home (the rings of pixel/labels.js), so they scale with the zoom; a label glides to its cell on a spring (motion.js, SPRING.glide): no hop
//   4. show and hide are debounced (SHOW_MS, HIDE_MS, MIN_SHOWN_MS, MIN_HIDDEN_MS), so nothing flashes or blinks; a sub-agent's reach rule has a slack (REACH_SLACK) to stay
//   5. the order of placement is rank (priority), then first sight, never the y of the label (it changes as the agents walk)
//   6. a tag with `walking` (a main agent on its way to or from its seat) is carried at its home spot, takes part in no declutter and holds no place: the labels of the seated
//      agents never move for it (it hides only while it is under what floats over the scene)
//   7. a main agent's label that has no spot but under the card takes the nearest free spot of a grid (`freeSpot`) and holds it
// Time is the clock passed in, so 30, 60 and 120 fps decide alike to within one 30 fps frame; one step is capped at DT_MAX ms (a hidden tab resumes without a jump).
export const STABLE = Object.freeze({
  PAD_KEEP: -1,            // px a label may overlap what is around it and stay (a negative pad: it must not even touch)
  PAD_ENTER: 3,            // px of clearance a new cell needs
  ESCAPE_MS: 0,            // an overlapped label leaves at once (on its spring)
  RETURN_MS: 1000,         // how long the home spot must stay free before a label goes back to it
  MOVE_GAP_MS: 350,        // least time between two returns home
  FB_GAP_MS: 150,          // least time between two searches of the fallback grid (the grid is the costly one)
  SHOW_MS: 90, HIDE_MS: 400, MIN_SHOWN_MS: 700, MIN_HIDDEN_MS: 500,
  REACH_SLACK: 24,         // px a sub-agent's label may be farther than maxGap once it is shown
  MAX_SPEED: 380,          // px a second: the fastest a label glides relative to its agent (a free glide of one cell is slower, of three cells faster): 38 px in a 100 ms step at most
  RINGS: 4, FORGET_MS: 1500, DT_MAX: 100,
  SPRING: 'glide',
});
const RING = [[0, -1], [1, 0], [-1, 0], [1, -1], [-1, -1], [0, 1], [1, 1], [-1, 1]];
// the lattice cells around home, nearest first: home, then the rings of pixel/labels.js
export function cells(rings = STABLE.RINGS) {
  const out = [[0, 0]];
  for (let k = 1; k <= rings; k++) for (const [ux, uy] of RING) out.push([ux * k, uy * k]);
  return out;
}

export function createLabelLayout(opts = {}) {
  const P = { ...STABLE, ...opts };
  const spec = typeof P.SPRING === 'string' ? SPRING[P.SPRING] : P.SPRING;
  const CELLS = cells(P.RINGS);
  const mem = new Map();
  let seq = 0, last = null, clock = 0, movingNow = false;
  const state = id => {
    let s = mem.get(id);
    if (!s) {
      s = { id, seq: ++seq, shown: false, cut: false, diffSince: -1, shownSince: -1e9, hiddenSince: -1e9, sx: new Spring(spec, 0), sy: new Spring(spec, 0), tu: 0, tv: 0, fb: false,
        badSince: -1, homeFreeSince: -1, movedAt: -1e9, init: false, seen: clock };
      mem.set(id, s);
    }
    s.seen = clock;
    return s;
  };
  // the verdict of one step (`raw`) becomes the shown state only after it has held for long enough: a label appears after SHOW_MS, goes after HIDE_MS and stays at least MIN_SHOWN_MS
  // and, once gone, MIN_HIDDEN_MS (a main agent's label, `force`, comes back as soon as it has a spot)
  function verdict(s, raw, force) {
    if (raw === s.shown) { s.diffSince = -1; return; }
    if (s.diffSince < 0) s.diffSince = clock;
    const at = raw ? Math.max(s.diffSince + P.SHOW_MS, force ? 0 : s.hiddenSince + P.MIN_HIDDEN_MS) : Math.max(s.diffSince + P.HIDE_MS, s.shownSince + P.MIN_SHOWN_MS);
    if (clock < at) return;
    s.shown = raw; s.diffSince = -1; s.cut = false;
    if (raw) s.shownSince = clock; else s.hiddenSince = clock;
  }
  function cut(s) {                                 // under what floats over the scene: gone in this step, without a fade
    if (!s.shown) return;
    s.shown = false; s.cut = true; s.diffSince = -1; s.hiddenSince = clock;
  }
  // one step of the two springs, in lattice units. A label never travels faster than MAX_SPEED px a second relative to its agent: a long glide cruises instead of dashing, and one
  // step (DT_MAX ms at most) moves it no more than DT_MAX x MAX_SPEED px, however slow the frame rate is. The cut keeps the springs' velocity in step, so nothing overshoots.
  function glide(s, sxu, syu, dts) {
    const x0 = s.sx.value, y0 = s.sy.value;
    s.sx.step(dts); s.sy.step(dts);
    const px = (s.sx.value - x0) * sxu, py = (s.sy.value - y0) * syu, speed = Math.hypot(px, py) / dts;
    if (speed > P.MAX_SPEED) {
      const k = P.MAX_SPEED / speed;
      s.sx.value = x0 + (s.sx.value - x0) * k; s.sy.value = y0 + (s.sy.value - y0) * k;
      s.sx.velocity *= k; s.sy.velocity *= k;
    }
    return [s.sx.value, s.sy.value];
  }

  function step({ fixed = [], tags = [], blocked = [], figures = [], vw, vh, reduced = false }, now) {
    const dt = last == null ? 33 : Math.min(P.DT_MAX, Math.max(1, now - last));
    last = now; clock += dt;
    const out = new Map(), alive = new Set(), blockedSet = new Set(blocked), taken = [...blocked];
    movingNow = false;

    // fixed labels (the balloons, the signs): one spot each; higher priority first, a label that is shown wins a tie, then first sight
    const prio = L => L.pri + (mem.has(L.id) && mem.get(L.id).shown ? 0.5 : 0);
    for (const L of [...fixed].sort((a, b) => prio(b) - prio(a) || (mem.get(a.id) || { seq: 1e9 }).seq - (mem.get(b.id) || { seq: 1e9 }).seq)) {
      const s = state(L.id); alive.add(L.id);
      const under = blocked.some(r => overlaps(L, r));
      const raw = !under && (L.force || !taken.some(r => touches(L, r) && !blockedSet.has(r)));
      verdict(s, raw, L.force);
      if (under) cut(s);
      if (raw) taken.push({ x: L.x, y: L.y, w: L.w, h: L.h });      // a label that wants to be shown holds its place before the debounce lets it in
      out.set(L.id, { x: L.x, y: L.y, shown: s.shown, cut: s.cut && !s.shown, moving: false });
    }

    // the labels of the agents: by rank, then first sight
    const order = [...tags].sort((a, b) => b.rank - a.rank || state(a.id).seq - state(b.id).seq);
    for (const T of order) {
      const s = state(T.id); alive.add(T.id);
      const sxu = T.w * 0.55 + 2, syu = T.h * 0.75 + 2;                                  // one lattice step, as in pixel/labels.js
      const home = T.near ? { x: T.near.x + T.near.w / 2 - T.w / 2, y: T.near.y + T.near.h + 2 } : { x: T.x, y: T.y };
      const spot = (u, v) => ({ x: Math.min(vw - T.w - 4, Math.max(4, home.x + u * sxu)), y: Math.min(vh - T.h - 4, Math.max(4, home.y + v * syu)), w: T.w, h: T.h });
      const dts = dt / 1000, fresh = !s.init;
      s.init = true;

      if (T.walking) {                                      // carried: home spot, holds nothing; a label that was at another cell when its agent got up glides back under it
        s.tu = s.tv = 0; s.fb = false; s.badSince = s.homeFreeSince = -1; s.movedAt = clock;
        s.sx.to(0); s.sy.to(0);
        if (reduced || fresh) { s.sx.jump(0); s.sy.jump(0); }
        const [ex, ey] = glide(s, sxu, syu, dts), at = spot(ex, ey);
        const under = blocked.some(r => overlaps(at, r));
        verdict(s, !under, true);
        if (under) cut(s);
        const moving = !s.sx.atRest || !s.sy.atRest;
        movingNow ||= moving;
        out.set(T.id, { x: at.x, y: at.y, shown: s.shown, cut: s.cut && !s.shown, moving });
        continue;
      }

      // what a rect at a cell collides with: the labels and floating things already in place (counted fourfold, with the pad), then the figures of the agents
      const area = (r, pad, withFigures = true) => {
        let a = 0;
        for (const p of taken) { const ox = Math.min(r.x + r.w, p.x + p.w) - Math.max(r.x, p.x) + pad, oy = Math.min(r.y + r.h, p.y + p.h) - Math.max(r.y, p.y) + pad; if (ox > 0 && oy > 0) a += ox * oy * 4; }
        if (withFigures) for (const p of figures) { const ox = Math.min(r.x + r.w, p.x + p.w) - Math.max(r.x, p.x), oy = Math.min(r.y + r.h, p.y + p.h) - Math.max(r.y, p.y); if (ox > 0 && oy > 0) a += ox * oy; }
        return a;
      };
      // where it is going: stay while the cell is free; leave at once when it is not; go home when home has been free for long enough
      const figs = !s.fb;                                    // a held fallback spot may cover an agent (that is what it is for): only labels and the card count against it
      if (area(spot(s.tu, s.tv), P.PAD_KEEP, figs) > 0) { if (s.badSince < 0) s.badSince = clock; } else s.badSince = -1;
      const homeFree = area(spot(0, 0), P.PAD_ENTER) === 0, atHome = s.tu === 0 && s.tv === 0;
      if (homeFree && !atHome) { if (s.homeFreeSince < 0) s.homeFreeSince = clock; } else s.homeFreeSince = -1;
      if (s.badSince >= 0 && clock - s.badSince >= P.ESCAPE_MS && clock - s.movedAt >= (s.fb ? P.FB_GAP_MS : 1)) {
        let best = null, bestCost = Infinity;                // the nearest free cell to where it is now (home wins a tie), else the least bad
        for (const [u, v] of CELLS) {
          const r = spot(u, v), a = area(r, P.PAD_ENTER);
          const cost = (a === 0 ? 0 : 1e6 + a) + Math.hypot(u - s.tu, v - s.tv) * 10 + Math.hypot(u, v) * 3;
          if (cost < bestCost) { bestCost = cost; best = { u, v, r }; }
        }
        let go = best, fb = false;
        if (T.force && blocked.some(r => overlaps(best.r, r))) {    // a main agent's label has only spots under the card: the nearest spot of a grid that is clear of it
          const labels = taken.filter(r => !blockedSet.has(r)), c = { x: home.x, y: home.y, w: T.w, h: T.h };
          const f = freeSpot(c, blocked, labels, figures, vw, vh) || freeSpot(c, blocked, [], figures, vw, vh);
          if (f) { go = { u: (f.x - home.x) / sxu, v: (f.y - home.y) / syu }; fb = true; }
        }
        if (go.u !== s.tu || go.v !== s.tv) { s.tu = go.u; s.tv = go.v; s.fb = fb; s.movedAt = clock; }
        s.badSince = -1;
      } else if (s.homeFreeSince >= 0 && clock - s.homeFreeSince >= P.RETURN_MS && clock - s.movedAt >= P.MOVE_GAP_MS) {
        s.tu = s.tv = 0; s.fb = false; s.movedAt = clock; s.homeFreeSince = -1;
      }
      // the lattice coordinates ride a spring (no overshoot, the velocity is kept when the target changes, exact at any frame rate)
      s.sx.to(s.tu); s.sy.to(s.tv);
      if (reduced || fresh) { s.sx.jump(s.tu); s.sy.jump(s.tv); }
      const [ex, ey] = glide(s, sxu, syu, dts), at = spot(ex, ey), tgt = spot(s.tu, s.tv);
      // the verdict: is there a spot at all (a free one, or the label is a main agent's) and, for a sub-agent, within reach of its agent (with a slack to stay)
      const clear = area(tgt, P.PAD_KEEP, !s.fb) === 0;
      const reach = (T.maxGap ?? Infinity) + (s.shown ? P.REACH_SLACK : 0);
      const near = !T.near || gapBetween(tgt, T.near) <= reach;
      const under = blocked.some(r => overlaps(at, r));
      const raw = (clear || T.force) && near && !under;
      verdict(s, raw, T.force);
      if (under) cut(s);
      const moving = !s.sx.atRest || !s.sy.atRest;
      movingNow ||= moving;
      if (s.shown || raw) taken.push(at);                    // what this label occupies for the labels after it: where it is drawn and, while it glides, where it is going
      if (moving) taken.push(tgt);
      out.set(T.id, { x: at.x, y: at.y, shown: s.shown, cut: s.cut && !s.shown, moving });
    }

    for (const [id, s] of mem) {
      if (alive.has(id)) continue;
      if (clock - s.seen > P.FORGET_MS) mem.delete(id);
      else if (s.shown) { s.shown = false; s.diffSince = -1; s.hiddenSince = clock; }
    }
    return out;
  }
  return {
    step,
    reset() { mem.clear(); last = null; clock = 0; movingNow = false; },
    get moving() { return movingNow; },
    get size() { return mem.size; },
    peek(id) { const s = mem.get(id); return s ? { u: s.tu, v: s.tv, fallback: s.fb, shown: s.shown, moving: !s.sx.atRest || !s.sy.atRest } : null; },
  };
}
