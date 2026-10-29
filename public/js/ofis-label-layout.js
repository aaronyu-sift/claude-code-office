// Where the labels of the three.js Office go on the screen (pure geometry, tested with numbers: test/ofis-label-layout.test.mjs). Two kinds:
//   fixed  labels that sit at one spot of their own (the balloon over a head, the labels of add-ons): they keep it, and one that touches a label placed before it is not shown
//   tags   the labels of the agents (office-labels.js): they may move to a free spot near their agent, found by the pixel scene's own declutter (pixel/labels.js `placeLabels`),
//          so a sub-agent's label is not dropped just because a main agent's label hangs next to it; the figures of the agents are obstacles that a label gives way to.
//          A tag with `near` (its agent's rect) and `maxGap` is shown only within that many px of its agent: farther away it would read as another agent's label.
// `blocked` are the rects of what floats over the scene (the agent card, the shelf card, the zoom buttons): nothing is drawn under them, whatever its priority.
// All rects are { x, y, w, h } in CSS px of the scene's box; a label is { id, x, y, w, h, pri | rank, force }, x and y being the spot it prefers.
import { placeLabels as declutter } from './pixel/labels.js';

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
