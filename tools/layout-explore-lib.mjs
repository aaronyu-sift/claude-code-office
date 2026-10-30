// Design aid for the compact 3D map (not part of the app): scores arrangements of the office cells by how well their projected footprint fits a window,
// with the same projection and the same fit rule as public/js/ofis.js. Used by layout-candidates.mjs and layout-explore-cells.mjs.
//
// An arrangement is a list of hall rows, top to bottom (z grows). A hall row is { b, f }: a back run and a front run of cells, each { c0, n } (the
// first cell's column in half-cell steps and how many cells), with the row's hall between them. Two runs that are equal make bays ([office | hall |
// office], the unit the explorer calls a bay). Every hall row has its own entrance at its right end, as in the two-row building.
import { CELL_W, ROOM_D, GAP, WALL_T, HALL_D, HALL_GAP } from '../public/js/ofis-layout.js';

const WALL_H = 2.2;
const norm = v => { const l = Math.hypot(...v); return v.map(c => c / l); };
const VIEW = norm([1, 0.9, 1]), R = norm([1, 0, -1]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const U = norm(cross(VIEW, R));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const project = (x, y, z) => [dot([x, y, z], R), dot([x, y, z], U)];

export const PITCH = CELL_W + GAP;                                   // one cell along x
const PAIR_D = ROOM_D + HALL_GAP + HALL_D + WALL_T + ROOM_D;         // the depth of a hall row: office, hall, office
export const PITCH_Z = PAIR_D + GAP;                                 // one hall row along z
const M0 = 0.7;                                                      // margin of the plinth around the rooms

// the plinth rectangles of an arrangement: a back run, the hall and a front run per hall row
export function rectsOfRows(rows) {
  const out = [];
  rows.forEach((r, i) => {
    const z0 = i * PITCH_Z, hz0 = z0 + ROOM_D + HALL_GAP, hz1 = hz0 + HALL_D, fz0 = hz1 + WALL_T;
    const run = ({ c0, n }) => [c0 * PITCH, c0 * PITCH + n * PITCH - GAP];
    const spans = [r.b, r.f].filter(q => q.n);
    const xa = Math.min(...spans.map(q => run(q)[0])), xb = Math.max(...spans.map(q => run(q)[1]));
    const pad = (x0, x1, za, zb, tag) => out.push({ x0: x0 - WALL_T - M0, x1: x1 + WALL_T + M0, z0: za - WALL_T - M0, z1: zb + WALL_T + M0, row: i, tag });
    if (r.b.n) pad(...run(r.b), z0, z0 + ROOM_D, 'b');
    pad(xa, xb, hz0, hz1, 'h');
    if (r.f.n) pad(...run(r.f), fz0, fz0 + ROOM_D, 'f');
  });
  return out;
}

// the box of the projected footprint (plinth corners, from below the floor to above the walls) and its area
export function measure(rects) {
  let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9, area = 0;
  for (const r of rects) {
    for (const x of [r.x0, r.x1]) for (const z of [r.z0, r.z1]) for (const y of [-0.5, WALL_H + 0.7]) {
      const [a, b] = project(x, y, z);
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
  }
  const J = Math.abs(R[0] * U[2] - R[2] * U[0]);         // the area scale of the projection of the ground plane
  const xs = [...new Set(rects.flatMap(r => [r.x0, r.x1]))].sort((p, q) => p - q), zs = [...new Set(rects.flatMap(r => [r.z0, r.z1]))].sort((p, q) => p - q);
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
    if (rects.some(r => cx > r.x0 && cx < r.x1 && cz > r.z0 && cz < r.z1)) area += (xs[i + 1] - xs[i]) * (zs[j + 1] - zs[j]);
  }
  return { ea: a1 - a0, eb: b1 - b0, area: area * J };
}

// the fit rule of ofis.js: the box in what the bar (72 px + 8) and the shelf card (322 px at 1440, when open) leave free
export function fitZoom(m, vw, vh, shelf = 0) {
  const narrow = vw < 640, padT = Math.max(narrow ? 52 : 18, 72 + 8), padB = narrow ? 12 : 16, padL = narrow ? 8 : 18, padR = Math.max(narrow ? 8 : 24, shelf);
  const zf = Math.min((vw - padL - padR) / m.ea, (vh - padT - padB) / m.eb);
  return Math.min(70, Math.max(3, zf));
}
export const VIEWS = [[1440, 900, 0], [1440, 900, 322], [1920, 1080, 0], [1920, 1080, 322], [1280, 800, 0], [1280, 800, 322], [1100, 700, 0]];

function scoreRects(rects) {
  const m = measure(rects), per = VIEWS.map(([w, h, sh]) => {
    const z = fitZoom(m, w, h, sh);
    return { z, foot: m.area * z * z / (w * h), box: m.ea * m.eb * z * z / (w * h) };
  });
  const xr = Math.max(...rects.map(r => r.x1)), hall = rects.filter(r => r.tag === 'h');
  return { rects, m, per, aspect: m.ea / m.eb, fill: m.area / (m.ea * m.eb), stub: hall.length ? Math.max(...hall.map(r => xr - r.x1)) : 0 };
}
export const scoreRows0 = rows => ({ ...scoreRects(rectsOfRows(rows)), cells: rows.reduce((t, r) => t + r.b.n + r.f.n, 0) });

// the building as it is: one hall, two rows of five, a single plinth around all of it
export function baseline() {
  const w = 5 * PITCH - GAP;
  return scoreRects([{ x0: -WALL_T - M0, x1: w + WALL_T + M0, z0: -WALL_T - M0, z1: PAIR_D + WALL_T + M0 }]);
}
