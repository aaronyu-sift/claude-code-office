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
  for (const T of tags) {
    const p = res.get(T.id);
    if (!p || !(p.ok || T.force)) continue;
    const at = { x: p.x, y: p.y, w: T.w, h: T.h };
    if (T.near && gapBetween(at, T.near) > (T.maxGap ?? Infinity)) continue;
    if (blocked.some(r => overlaps(at, r))) continue;
    out.set(T.id, { x: p.x, y: p.y });
  }
  return out;
}
