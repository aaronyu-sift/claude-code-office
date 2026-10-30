// The plane geometry of a 3D office room, as pure functions (no three.js, no DOM): the shapes furniture stands on, how far a point is from them, and the router that
// finds the way a person walks from the door to a seat without touching any of it. ofis-arrange.js builds the room's furniture and asks this file for the walks;
// test/ofis-geom.test.mjs and test/ofis-arrange.test.mjs check both.
//
//   Room coordinates: x east, z south, in metres from the room's back corner; a heading h is the direction (sin h, cos h), the same angle three.js turns a model by
//   about y (ry = 0: its front looks to +z, PI / 2: to +x).
//   shape      { t: 'box', x, z, w, d, ry } an oriented rectangle (w along the model's x, d along its z), or { t: 'ell', x, z, rx, rz, ry } an ellipse
//   polyOf(shape)                    the shape as a convex polygon [[x, z], ...] (an ellipse as 24 corners, drawn inside the real ellipse)
//   distToPoly(x, z, poly)           how far a point is from a polygon, 0 inside it
//   shapeDist(x, z, shape)           the same for a shape
//   createRouter({ W, D, obstacles }) { clearance, free, tree(from) -> { reach(x, z), path(to) } }, the walking lines on a grid with the obstacles grown by a body's width
export const TAU = Math.PI * 2;

export const rot = (lx, lz, ry) => [lx * Math.cos(ry) + lz * Math.sin(ry), -lx * Math.sin(ry) + lz * Math.cos(ry)];
export const headingVec = h => [Math.sin(h), Math.cos(h)];
export const headingOf = (dx, dz) => Math.atan2(dx, dz);
// the angle turned by a quarter-turn count (0..3) in the same sense as ry
export const quarter = n => ((n % 4) + 4) % 4 * Math.PI / 2;

export function polyOf(s, n = 24) {
  const out = [];
  if (s.t === 'box') {
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const [dx, dz] = rot(a * s.w / 2, b * s.d / 2, s.ry || 0); out.push([s.x + dx, s.z + dz]); }
  } else {
    for (let i = 0; i < n; i++) { const a = i / n * TAU, [dx, dz] = rot(Math.cos(a) * s.rx, Math.sin(a) * s.rz, s.ry || 0); out.push([s.x + dx, s.z + dz]); }
  }
  return out;
}
export function bboxOf(poly) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { x0, x1, z0, z1 };
}

function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + t * dx - px, z = az + t * dz - pz;
  return x * x + z * z;
}
export function inPoly(px, pz, poly) {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length], c = (bx - ax) * (pz - az) - (bz - az) * (px - ax);
    if (c !== 0) { const s = c > 0 ? 1 : -1; if (sign && s !== sign) return false; sign = s; }
  }
  return true;
}
export function distToPoly(px, pz, poly) {
  if (inPoly(px, pz, poly)) return 0;
  let d2 = Infinity;
  for (let i = 0; i < poly.length; i++) { const [ax, az] = poly[i], [bx, bz] = poly[(i + 1) % poly.length]; d2 = Math.min(d2, segDist2(px, pz, ax, az, bx, bz)); }
  return Math.sqrt(d2);
}
export const shapeDist = (x, z, s) => distToPoly(x, z, s.poly || polyOf(s));

// the least distance between two convex polygons (0 when they touch or overlap)
export function polyGap(a, b) {
  for (const [x, z] of a) if (inPoly(x, z, b)) return 0;
  for (const [x, z] of b) if (inPoly(x, z, a)) return 0;
  let d2 = Infinity;
  for (let i = 0; i < a.length; i++) {
    const [ax, az] = a[i], [bx, bz] = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const [cx, cz] = b[j], [dx, dz] = b[(j + 1) % b.length];
      if (segCross(ax, az, bx, bz, cx, cz, dx, dz)) return 0;
      d2 = Math.min(d2, segDist2(ax, az, cx, cz, dx, dz), segDist2(bx, bz, cx, cz, dx, dz), segDist2(cx, cz, ax, az, bx, bz), segDist2(dx, dz, ax, az, bx, bz));
    }
  }
  return Math.sqrt(d2);
}
function segCross(ax, az, bx, bz, cx, cz, dx, dz) {
  const o = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = o(ax, az, bx, bz, cx, cz), d2 = o(ax, az, bx, bz, dx, dz), d3 = o(cx, cz, dx, dz, ax, az), d4 = o(cx, cz, dx, dz, bx, bz);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0 && d3 !== 0 && d4 !== 0;
}

// ------------------------------------------------------------ the router

// obstacles: [{ id, poly }] (what a person cannot walk through). Walls keep a person `wall` metres inside the room. Cells whose centre is nearer than `body` to an obstacle are
// closed. `tree(from)` is one Dijkstra from a point (the door inside); `path(to)` then reads the shortest walk to any free point off it, pulled straight where the way is clear.
export function createRouter({ W, D, obstacles, cell = 0.15, body = 0.34, check = 0.27, wall = 0.28 }) {
  const nx = Math.ceil(W / cell), nz = Math.ceil(D / cell);
  const obs = obstacles.map(o => ({ id: o.id, poly: o.poly, box: bboxOf(o.poly) }));
  // the least distance to the walls and to the obstacles that are not in `skip` (a Set of ids); a point outside the room's walls is blocked by them
  function clearance(x, z, skip) {
    let d = Math.min(x, z, W - x, D - z) - wall + body;                  // blocked (below `body`) once nearer to a wall than `wall`
    for (const o of obs) {
      if (skip && skip.has(o.id)) continue;
      const b = o.box;
      if (x < b.x0 - 1 || x > b.x1 + 1 || z < b.z0 - 1 || z > b.z1 + 1) continue;
      const k = distToPoly(x, z, o.poly);
      if (k < d) d = k;
    }
    return d;
  }
  const blocked = new Uint8Array(nx * nz), near = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const c = clearance((i + 0.5) * cell, (j + 0.5) * cell);
    blocked[j * nx + i] = c < body ? 1 : 0;
    near[j * nx + i] = c < body + 0.3 ? 1 : 0;
  }
  const cellOf = (x, z) => [Math.max(0, Math.min(nx - 1, Math.floor(x / cell))), Math.max(0, Math.min(nz - 1, Math.floor(z / cell)))];
  const free = (x, z) => x > 0 && z > 0 && x < W && z < D && !blocked[cellOf(x, z)[1] * nx + cellOf(x, z)[0]];
  // is the straight line from a to b clear (no obstacle nearer than `check`, wall margins included)?
  function lineClear(a, b, skip, k = check) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(len / 0.05));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (clearance(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, skip) < k) return false;
    }
    return true;
  }
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];

  function tree(from) {
    const dist = new Float64Array(nx * nz).fill(Infinity), prev = new Int32Array(nx * nz).fill(-1);
    // the start may sit in a closed cell (right at a wall's margin): open the nearest free cell
    let [si, sj] = cellOf(from[0], from[1]);
    if (blocked[sj * nx + si]) {
      let best = null;
      for (let r = 1; r < 8 && !best; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        const i = si + di, j = sj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= nz || blocked[j * nx + i]) continue;
        const d = Math.hypot(di, dj);
        if (!best || d < best.d) best = { i, j, d };
      }
      if (!best) return { reach: () => false, path: () => null, empty: true };
      si = best.i; sj = best.j;
    }
    const heap = [[0, sj * nx + si]];
    dist[sj * nx + si] = 0;
    const push = it => { heap.push(it); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
      return top;
    };
    while (heap.length) {
      const [d, id] = pop();
      if (d > dist[id]) continue;
      const i = id % nx, j = (id - i) / nx;
      for (const [di, dj, w] of NB) {
        const a = i + di, b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const nid = b * nx + a;
        if (blocked[nid]) continue;
        if (di && dj && (blocked[j * nx + a] || blocked[b * nx + i])) continue;       // no cutting a corner
        const nd = d + w * (near[nid] ? 1.35 : 1);
        if (nd < dist[nid]) { dist[nid] = nd; prev[nid] = id; push([nd, nid]); }
      }
    }
    const start = [(si + 0.5) * cell, (sj + 0.5) * cell];
    return {
      reach(x, z) { const [i, j] = cellOf(x, z); return Number.isFinite(dist[j * nx + i]); },
      // the shortest walk from the start to a free point, as [x, z] points from `from` to `to`
      path(to) {
        const [ti, tj] = cellOf(to[0], to[1]);
        let id = tj * nx + ti;
        if (!Number.isFinite(dist[id])) return null;
        const cells = [];
        while (id >= 0) { const i = id % nx, j = (id - i) / nx; cells.push([(i + 0.5) * cell, (j + 0.5) * cell]); id = prev[id]; }
        cells.reverse();
        const pts = [from.slice(), ...cells.slice(1, -1), to.slice()];
        // pull the line straight wherever it is clear
        const out = [pts[0]];
        let i = 0;
        while (i < pts.length - 1) {
          let j = pts.length - 1;
          while (j > i + 1 && !lineClear(pts[i], pts[j])) j--;
          out.push(pts[j]);
          i = j;
        }
        return out;
      },
      start,
    };
  }
  return { clearance, free, lineClear, tree, nx, nz, cell, blocked };
}
