// Procedural polish for the 3D office (off with ?polish=off): no files, everything is computed from the scene's own geometry.
//  - makeOcc / bakeBatchAO: a coarse occupancy grid of the merged room geometry and a per-vertex ambient-occlusion pass (darkens the
//    base of furniture, corners, the space under desks), written into the vertex colours of the room batch,
//  - floorMesh: a room floor made of vertex colours (smooth value noise + the same occlusion), so no texture tile repeats,
//  - softBlobTexture: a radial gradient for contact shadows under people and chairs.
import * as THREE from 'three';

const CS = 0.1, ICS = 1 / CS;         // occupancy cell (m)

export function makeOcc(P, I) {
  let x0 = 1e9, y0 = 0, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  for (let i = 0; i < P.length; i += 3) {
    x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]);
    y1 = Math.max(y1, P[i + 1]);
    z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]);
  }
  x0 -= 0.5; z0 -= 0.5; x1 += 0.5; z1 += 0.5; y1 += 0.3;
  const nx = Math.ceil((x1 - x0) * ICS), ny = Math.ceil((y1 - y0) * ICS), nz = Math.ceil((z1 - z0) * ICS);
  const g = new Uint8Array(nx * ny * nz);
  // mark the cells a triangle passes through: points on it, at most 0.07 m apart along each of its edges and between its edges
  const mark = (x, y, z) => {
    const i = Math.floor((x - x0) * ICS), j = Math.floor((y - y0) * ICS), k = Math.floor((z - z0) * ICS);
    if (i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz) g[(k * ny + j) * nx + i] = 1;
  };
  const step = CS * 0.7, step2 = step * step, tiny2 = (CS * 0.3) * (CS * 0.3);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ax = P[a], ay = P[a + 1], az = P[a + 2];
    const bx = P[b] - ax, by = P[b + 1] - ay, bz = P[b + 2] - az, cx = P[c] - ax, cy = P[c + 1] - ay, cz = P[c + 2] - az;
    const ab2 = bx * bx + by * by + bz * bz, ac2 = cx * cx + cy * cy + cz * cz, long2 = Math.max(ab2, ac2);
    if (long2 <= tiny2) { mark(ax + (bx + cx) / 3, ay + (by + cy) / 3, az + (bz + cz) / 3); continue; }     // well inside one cell
    if (long2 <= step2) { mark(ax, ay, az); mark(ax + bx, ay + by, az + bz); mark(ax + cx, ay + cy, az + cz); continue; }
    const n1 = Math.min(200, Math.max(1, Math.ceil(Math.sqrt(ab2 / step2)))), n2 = Math.min(200, Math.max(1, Math.ceil(Math.sqrt(ac2 / step2))));
    for (let i = 0; i <= n1; i++) {
      const u = i / n1;
      for (let j = 0, jm = Math.floor((1 - u) * n2 + 1e-9); j <= jm; j++) {
        const v = j / n2;
        mark(ax + bx * u + cx * v, ay + by * u + cy * v, az + bz * u + cz * v);
      }
    }
    const dx = cx - bx, dy = cy - by, dz = cz - bz, n3 = Math.min(200, Math.max(1, Math.ceil(Math.sqrt((dx * dx + dy * dy + dz * dz) / step2))));
    for (let i = 0; i <= n3; i++) { const w = i / n3; mark(ax + bx + dx * w, ay + by + dy * w, az + bz + dz * w); }
  }
  const solid = (x, y, z) => {
    if (y < 0.02) return true;              // the floor
    const i = Math.floor((x - x0) * ICS), j = Math.floor((y - y0) * ICS), k = Math.floor((z - z0) * ICS);
    return i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && g[(k * ny + j) * nx + i] === 1;
  };
  return { solid, grid: g, nx, ny, nz };
}

// cosine-weighted hemisphere directions in tangent space (x, y across the surface, z along the normal), at least ~20 degrees above it
const NDIR = 14;
const DIRS = (() => {
  const out = new Float64Array(NDIR * 3);
  for (let i = 0; i < NDIR; i++) {
    const u = (i + 0.5) / NDIR, a = i * 2.399963;
    const r = Math.sqrt(u) * 0.94, z = Math.sqrt(1 - r * r);
    out[i * 3] = Math.cos(a) * r; out[i * 3 + 1] = Math.sin(a) * r; out[i * 3 + 2] = z;
  }
  return out;
})();
const STEPS = [0.14, 0.26, 0.42, 0.62, 0.9];

/** occlusion in [0, 1] (1 = open) at p with unit normal n */
export function aoAt(occ, px, py, pz, nx, ny, nz) {
  // tangent frame: t = up x n (or x x n for a surface that faces up or down), b = n x t
  let tx, ty, tz;
  if (Math.abs(ny) < 0.9) { tx = nz; ty = 0; tz = -nx; } else { tx = 0; ty = -nz; tz = ny; }
  const tl = 1 / (Math.hypot(tx, ty, tz) || 1);
  tx *= tl; ty *= tl; tz *= tl;
  const bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
  const ox = px + nx * CS * 1.1, oy = py + ny * CS * 1.1, oz = pz + nz * CS * 1.1;
  let hit = 0;
  for (let i = 0; i < NDIR * 3; i += 3) {
    const d0 = DIRS[i], d1 = DIRS[i + 1], d2 = DIRS[i + 2];
    const dx = tx * d0 + bx * d1 + nx * d2, dy = ty * d0 + by * d1 + ny * d2, dz = tz * d0 + bz * d1 + nz * d2;
    for (let k = 0; k < STEPS.length; k++) {
      const s = STEPS[k];
      if (occ.solid(ox + dx * s, oy + dy * s, oz + dz * s)) { hit += 1 - s * 0.55; break; }
    }
  }
  return 1 - hit / NDIR;
}

/** darken a Batch's vertex colours by the occlusion. strength 0..1. Pieces larger than `big` metres (walls, slabs) get only a trace. */
export function bakeBatchAO(batch, occ, strength = 0.5, big = 1.3) {
  const P = batch.p, N = batch.n, C = batch.c;
  for (const [v0, v1, dim] of batch.rg) {
    const w = dim > big ? 0.12 : 1;
    for (let v = v0; v < v1; v++) {
      const k = v * 3;
      const ao = aoAt(occ, P[k], P[k + 1], P[k + 2], N[k], N[k + 1], N[k + 2]);
      const m = Math.max(0.55, 1 - strength * w * (1 - ao) * 1.3);
      C[k] *= m; C[k + 1] *= m; C[k + 2] *= m;
    }
  }
}

// ---- smooth value noise, world-anchored (so neighbouring rooms do not repeat each other either)
function h2(x, z, s) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(z | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function vnoise(x, z, s) {
  const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = h2(xi, zi, s), b = h2(xi + 1, zi, s), c = h2(xi, zi + 1, s), d = h2(xi + 1, zi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** a room floor: vertex colours = base colour * (soft mottling) * (occlusion from furniture and walls) */
export function floorMesh(X, Z, W, D, hex, occ, y = 0.012, cell = 0.3) {
  const nx = Math.max(2, Math.round(W / cell)), nz = Math.max(2, Math.round(D / cell));
  const pos = new Float32Array((nx + 1) * (nz + 1) * 3), col = new Float32Array((nx + 1) * (nz + 1) * 3), nor = new Float32Array((nx + 1) * (nz + 1) * 3);
  const base = new THREE.Color(hex), c = new THREE.Color();
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const k = (j * (nx + 1) + i) * 3, x = X + (i / nx) * W, z = Z + (j / nz) * D;
    pos[k] = x; pos[k + 1] = y; pos[k + 2] = z; nor[k + 1] = 1;
    const m = 1 + (vnoise(x * 0.45, z * 0.45, 5) - 0.5) * 0.10 + (vnoise(x * 1.9, z * 1.9, 6) - 0.5) * 0.035;
    c.copy(base).multiplyScalar(m);
    if (occ) { const ao = aoAt(occ, x, y, z, 0, 1, 0); c.multiplyScalar(Math.max(0.62, 1 - 0.55 * (1 - ao) * 1.3)); }
    col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
  }
  const idx = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const a = j * (nx + 1) + i, b = a + 1, d = a + nx + 1, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

export function softBlobTexture() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d');
  const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  rg.addColorStop(0, 'rgba(255,255,255,0.95)'); rg.addColorStop(0.45, 'rgba(255,255,255,0.5)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = rg; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
