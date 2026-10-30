// The coplanar scan of tools/qa/office3d-coplanar-qa.mjs, on plain triangles (no browser, no three.js: test/coplanar-scan.test.mjs runs it on made-up scenes).
//
// Two faces that lie in one plane (or within a few millimetres of it) and overlap are a depth tie: the depth buffer cannot say which one is in front, and the winner changes
// with every sub-pixel step of the camera, so the stone ground, a floor or a wall blinks between two colours while the user zooms (docs/floors.md). The scan finds them in the
// built scene, whatever line of the builders made them:
//   same facing, offset along the normal below `dd` (9.5 mm: the rule is 10), overlap in that plane above `minArea` (0.01 m2), a colour or a texture that differs, and the overlap is seen:
//   a pair that something nearer covers (the plinth under the stone slab, a wall piece inside a wall) is not a tie anybody can see, so it is dropped. The look from the
//   camera is a ray along `view` from points of the overlap, cast at every face of the scene (a grid over the ground plane); one free point is enough to keep the pair.
//
// A triangle: { a: [x, y, z], b: [x, y, z], c: [x, y, z], col: 0xRRGGBB (the mean of its vertex colours, or the material's), tex: a texture id ('' for none), mesh: an id, tag: any text }.
// The facing is the normal of (a, b, c) as given: the caller turns a BackSide triangle round, and drops the faces the camera does not see.
export const DD = 0.0095, MIN_AREA = 0.01, COL_MIN = 10;      // m (the depth rule is 10 mm: a gap built as 10 mm reads 9.99 to 10.01 in float32), m2, and the largest channel difference (of 255) below which two colours read as the same
const VIEW = (() => { const l = Math.hypot(1, 0.9, 1); return [1 / l, 0.9 / l, 1 / l]; })();     // from the scene to the camera (public/js/ofis.js: VIEW)
const CLEAR = 0.012;                                          // m: the rays start this far above the plane of the pair, past every layer that belongs to it

const sub = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const cross = (u, v) => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];

export const colourGap = (c1, c2) => Math.max(Math.abs(((c1 >> 16) & 255) - ((c2 >> 16) & 255)), Math.abs(((c1 >> 8) & 255) - ((c2 >> 8) & 255)), Math.abs((c1 & 255) - (c2 & 255)));

// the overlap of two convex polygons in the plane (Sutherland-Hodgman); a polygon is [[u, v], ...]
const area2 = p => { let s = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; s += p[i][0] * q[1] - q[0] * p[i][1]; } return s / 2; };
export function clip(subject, clipper) {
  let out = subject;
  const ca = area2(clipper) > 0 ? 1 : -1;
  for (let i = 0; i < clipper.length && out.length; i++) {
    const a = clipper[i], b = clipper[(i + 1) % clipper.length];
    const inside = p => ca * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= -1e-12;
    const inter = (p, q) => {
      const d1x = q[0] - p[0], d1y = q[1] - p[1], d2x = b[0] - a[0], d2y = b[1] - a[1];
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-18) return p;
      const t = ((a[0] - p[0]) * d2y - (a[1] - p[1]) * d2x) / den;
      return [p[0] + t * d1x, p[1] + t * d1y];
    };
    const inp = out; out = [];
    for (let j = 0; j < inp.length; j++) {
      const p = inp[j], q = inp[(j + 1) % inp.length];
      if (inside(q)) { if (!inside(p)) out.push(inter(p, q)); out.push(q); } else if (inside(p)) out.push(inter(p, q));
    }
  }
  return out;
}

// A basis (u, v) of the plane with normal n, the same for every triangle of that normal
const basis = n => {
  const a = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let u = cross(n, a); const l = Math.hypot(...u); u = u.map(x => x / l);
  return [u, cross(n, u)];
};

// Is a point of the scene hidden from the camera? A grid over x and z (1 m cells) of the triangles' boxes; the ray runs from the point along `view` (towards the camera) to the top of the scene.
function makeOcclusion(T, view) {
  const CELL = 1, cellKey = (i, j) => i * 100003 + j;
  const grid = new Map(), big = [];
  let top = -1e9;
  T.forEach((x, idx) => {
    top = Math.max(top, x.bb[4]);
    const i0 = Math.floor(x.bb[0] / CELL), i1 = Math.floor(x.bb[3] / CELL), j0 = Math.floor(x.bb[2] / CELL), j1 = Math.floor(x.bb[5] / CELL);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) { big.push(idx); return; }       // a ground slab: tested by every ray
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = cellKey(i, j); (grid.get(k) || grid.set(k, []).get(k)).push(idx); }
  });
  const hit = (idx, o) => {                                                     // Moller-Trumbore, the ray from o along view, the distance past 1e-6
    const x = T[idx], a = x.t.a, e1 = sub(x.t.b, a), e2 = sub(x.t.c, a);
    const pv = cross(view, e2), det = dot(e1, pv);
    if (Math.abs(det) < 1e-12) return false;
    const tv = sub(o, a), u = dot(tv, pv) / det;
    if (u < 0 || u > 1) return false;
    const qv = cross(tv, e1), v = dot(view, qv) / det;
    if (v < 0 || u + v > 1) return false;
    return dot(e2, qv) / det > 1e-6;
  };
  // the first face found in front of the point (its triangle), or null
  return (p, facing) => {
    const t0 = CLEAR / Math.max(facing, 0.3), o = [p[0] + view[0] * t0, p[1] + view[1] * t0, p[2] + view[2] * t0];
    if (o[1] > top) return null;
    const len = (top - o[1]) / view[1], steps = Math.ceil(len * Math.hypot(view[0], view[2]) / (CELL / 2)) + 1, seen = new Set(big);
    for (const idx of big) if (hit(idx, o)) return T[idx].t;
    for (let s = 0; s <= steps; s++) {
      const t = len * s / steps, k = cellKey(Math.floor((o[0] + view[0] * t) / CELL), Math.floor((o[2] + view[2] * t) / CELL));
      for (const idx of grid.get(k) || []) { if (seen.has(idx)) continue; seen.add(idx); if (hit(idx, o)) return T[idx].t; }
    }
    return null;
  };
}

// points inside a convex polygon [[u, v], ...]: its middle, its corners pulled a fifth in, and a grid over its box (about 200 points, 4 cm apart at the closest)
function samples(poly, area) {
  const mid = [poly.reduce((s, q) => s + q[0], 0) / poly.length, poly.reduce((s, q) => s + q[1], 0) / poly.length];
  const out = [mid, ...poly.map(q => [q[0] + (mid[0] - q[0]) * 0.2, q[1] + (mid[1] - q[1]) * 0.2])];
  const x0 = Math.min(...poly.map(q => q[0])), x1 = Math.max(...poly.map(q => q[0])), y0 = Math.min(...poly.map(q => q[1])), y1 = Math.max(...poly.map(q => q[1]));
  const sg = area2(poly) > 0 ? 1 : -1, inside = p => poly.every((a, i) => { const b = poly[(i + 1) % poly.length]; return sg * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= 0; });
  const step = Math.max(0.04, Math.sqrt((x1 - x0) * (y1 - y0) / 200));
  for (let x = x0 + step / 2; x < x1; x += step) for (let y = y0 + step / 2; y < y1; y += step) if (inside([x, y])) out.push([x, y]);
  return out;
}

/** Every pair of overlapping coplanar faces of different colour. Returns [{ n, d, gap, area, lo, hi, box: [x0, y0, z0, x1, y1, z1] (of the overlap), at: [x, y, z] (its middle) }], where lo and hi are
 * the two triangles (lo the one with the smaller offset along the normal: the one behind). `opt`: { dd, minArea, colMin, view, occlude (false keeps the pairs nothing can see) }; the array has `.hidden`, the number of pairs dropped because something covers them. */
export function scanCoplanar(tris, opt = {}) {
  const dd = opt.dd ?? DD, minArea = opt.minArea ?? MIN_AREA, colMin = opt.colMin ?? COL_MIN;
  const view = opt.view || VIEW, T = [];
  for (const t of tris) {
    let n = cross(sub(t.b, t.a), sub(t.c, t.a));
    const len = Math.hypot(...n);
    if (len < 1e-9) continue;
    n = n.map(x => x / len);
    const bb = [0, 1, 2].map(k => Math.min(t.a[k], t.b[k], t.c[k])).concat([0, 1, 2].map(k => Math.max(t.a[k], t.b[k], t.c[k])));
    T.push({ t, n, d: dot(n, t.a), bb, area: len / 2 });
  }
  // buckets by normal (to 1e-3) and offset (1 cm): a pair is looked for inside a bucket and the two next to it
  const bucket = new Map();
  T.forEach((x, i) => {
    const k = x.n.map(v => Math.round(v * 1000) + 0).join(',') + '|' + Math.floor(x.d / 0.01);
    (bucket.get(k) || bucket.set(k, []).get(k)).push(i);
  });
  const eps = 1e-4, slack = dd + eps, seen = new Set(), out = [];
  out.hidden = 0;
  const covered = opt.occlude === false ? null : makeOcclusion(T, view);
  const consider = (i, j) => {
    const A = T[i], B = T[j], gap = (dot(A.n, B.t.a) + dot(A.n, B.t.b) + dot(A.n, B.t.c)) / 3 - A.d;      // how far B lies above A's plane
    if (Math.abs(gap) > dd) return;
    for (let k = 0; k < 3; k++) if (A.bb[k] > B.bb[k + 3] + slack || B.bb[k] > A.bb[k + 3] + slack) return;     // the boxes overlap, to the offset allowed (faces a few mm apart along the normal)
    if (A.t.tex === B.t.tex && colourGap(A.t.col, B.t.col) < colMin) return;
    const key = i < j ? i * 1e7 + j : j * 1e7 + i;
    if (seen.has(key)) return;
    seen.add(key);
    const [u, v] = basis(A.n);
    const P = x => [x.t.a, x.t.b, x.t.c].map(q => [dot(q, u), dot(q, v)]);
    const poly = clip(P(A), P(B));
    if (poly.length < 3) return;
    const ar = Math.abs(area2(poly));
    if (ar < minArea) return;
    const [lo, hi] = gap >= 0 ? [A, B] : [B, A];
    // the overlap back in the world: its corners on the plane of the lower face
    const w = poly.map(([pu, pv]) => [0, 1, 2].map(k => u[k] * pu + v[k] * pv + lo.n[k] * lo.d));
    const box = [0, 1, 2].map(k => Math.min(...w.map(q => q[k]))).concat([0, 1, 2].map(k => Math.max(...w.map(q => q[k]))));
    if (covered) {                                         // seen? points over the overlap (a grid, finer for a small one), and the middle; one free point and the pair is seen
      const world = ([pu, pv]) => [0, 1, 2].map(k => u[k] * pu + v[k] * pv + lo.n[k] * lo.d), facing = dot(lo.n, view);
      const by = [];
      let free = false;
      for (const pt of samples(poly, ar)) { const c = covered(world(pt), facing); if (!c) { free = true; break; } by.push(c); }
      if (!free) { out.hidden++; if (opt.debug) (out.hiddenList || (out.hiddenList = [])).push({ lo: lo.t, hi: hi.t, by, area: ar, at: [0, 1, 2].map(k => (box[k] + box[k + 3]) / 2) }); return; }
    }
    out.push({ n: lo.n, d: lo.d, gap: Math.abs(gap), area: ar, lo: lo.t, hi: hi.t, box, at: [0, 1, 2].map(k => (box[k] + box[k + 3]) / 2) });
  };
  for (const [k, list] of bucket) {
    const [nk, dk] = k.split('|'), cand = [...list];
    for (const dn of [-1, 1]) { const k2 = nk + '|' + (+dk + dn); if (bucket.has(k2)) cand.push(...bucket.get(k2)); }
    cand.sort((x, y) => T[x].bb[0] - T[y].bb[0]);
    const mine = new Set(list);
    for (let ii = 0; ii < cand.length; ii++) {
      const i = cand[ii];
      for (let jj = ii + 1; jj < cand.length; jj++) {
        const j = cand[jj];
        if (T[j].bb[0] > T[i].bb[3] + slack) break;
        if (!mine.has(i) && !mine.has(j)) continue;
        consider(i, j);
      }
    }
  }
  return out;
}
