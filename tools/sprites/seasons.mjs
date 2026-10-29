// Seasons of the pixel scene, at build time: nothing is recoloured at run time, every seasonal sprite is baked into the atlas as
// `<id>@spring|autumn|winter` (summer is the plain sprite). Two tools make a variant out of an existing model without touching it:
//   - a palette: the models name their colour ramps (leaf, grass, flowerP ...), so a model built with another palette is the same
//     shape in other colours (fresh green and blossom in spring, orange and red in autumn, dark green and snow in winter);
//   - a post-process on the voxels: snow caps on every surface that faces up, bare branches for the trees that lose their leaves,
//     fallen leaves and flowers on the ground.
// Plus the four seasonal props (bird bath, pumpkins, a pile of leaves, a snowman).
import { Vox, hash, rampColors } from './lib.mjs';
import { makePalette } from './models.mjs';

export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

// ramps that change with the season (base colour; every ramp keeps its 5 tones and the hue shift of the others)
const COLORS = {
  spring: {
    leaf: '#86dd5a', leaf2: '#4fbd62', leafLight: '#ffb8d6', leafPine: '#3fa56a', hedgeG: '#3fb35c', grass: '#9fe86e',
    flowerP: '#ff9ccb', flowerY: '#fff27d', flowerR: '#ff8d8d', flowerO: '#ffc47d', flowerW: '#ffffff', flowerB: '#9dc4ff',
  },
  autumn: {
    leaf: '#eb8a3b', leaf2: '#c4492f', leafLight: '#ffd45e', leafPine: '#2f7d55', hedgeG: '#8c8d33', grass: '#b9b45c',
    flowerP: '#b5527f', flowerY: '#e9a92f', flowerR: '#c13a2c', flowerO: '#d9701f', flowerW: '#f1e7c9', flowerB: '#7d6cc4',
  },
  winter: {
    leaf: '#3f7a62', leaf2: '#2d5e55', leafLight: '#5d9a78', leafPine: '#2a665c', hedgeG: '#2f6a56', grass: '#eef3fb',
    flowerP: '#d98aa8', flowerY: '#e8c64a', flowerR: '#d05a5a', flowerO: '#e09a4a', flowerW: '#f4f8ff', flowerB: '#8fb0e8',
  },
};
const palettes = {};
export function seasonPalette(season) {
  if (palettes[season]) return palettes[season];
  const p = makePalette();
  for (const [name, hex] of Object.entries(COLORS[season] || {})) {
    const r = p.ramps[p.index.get(name)];
    if (!r) throw new Error('no ramp ' + name);
    r.colors = rampColors(hex, r.colors.length, 2);
  }
  return (palettes[season] = p);
}

const rampOf = (pal, m) => pal.ramps[(m - 1) >> 4].name;
const entries = v => [...v.v.values()];
const FOLIAGE = new Set(['leaf', 'leaf2', 'leafLight', 'leafPine', 'hedgeG', 'flowerP', 'flowerY', 'flowerR', 'flowerO', 'flowerW', 'flowerB']);
const WOOD = new Set(['trunk', 'bark', 'paper']);

// Snow on every surface that faces up: the voxel on top of a column turns into snow and, most of the time, one more snow voxel sits on it.
// `keep`: ramps (by prefix) that stay visible through the snow some of the time (flowers poking out of a bed).
export function snowCaps(v, pal, { prob = 0.9, lift = 0.6, keep = [], keepProb = 0.35, seed = 1 } = {}) {
  for (const [x, y, z, m] of entries(v)) {
    const name = rampOf(pal, m);
    if (name === 'snow' || v.get(x, y, z + 1)) continue;
    if (hash(x, y, z, 600 + seed) > prob) continue;
    if (keep.some(k => name.startsWith(k)) && hash(x, y, z, 700 + seed) < keepProb) continue;
    v.set(x, y, z, pal.m('snow', hash(x, y, z, 800 + seed) > 0.85 ? 4 : 3));
    if (hash(x, y, z, 900 + seed) < lift) v.set(x, y, z + 1, pal.m('snow', 3));
  }
  return v;
}

// A tree without its leaves: the trunk, eight branches that reach to where the foliage was, and a little snow on top of them.
export function bareTree(v, pal, seed = 1) {
  const all = entries(v), fol = all.filter(e => FOLIAGE.has(rampOf(pal, e[3]))), wood = all.filter(e => WOOD.has(rampOf(pal, e[3])));
  if (!fol.length || !wood.length) return v;
  const woodName = rampOf(pal, wood[0][3]);
  let top = -Infinity;
  for (const [x, y, z] of wood) if (Math.abs(x) <= 3 && Math.abs(y) <= 3) top = Math.max(top, z);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const e of fol) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], e[k]); hi[k] = Math.max(hi[k], e[k]); }
  const c = lo.map((a, k) => (a + hi[k]) / 2), r = lo.map((a, k) => (hi[k] - a) / 2);
  for (const e of fol) v.set(e[0], e[1], e[2], 0);
  const branch = [];
  const line = (ax, ay, az, bx, by, bz) => {
    const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay), Math.abs(bz - az), 1);
    for (let t = 0; t <= n; t++) {
      const x = Math.round(ax + ((bx - ax) * t) / n), y = Math.round(ay + ((by - ay) * t) / n), z = Math.round(az + ((bz - az) * t) / n);
      if (!v.get(x, y, z)) { v.set(x, y, z, pal.m(woodName, x > 0 ? 1 : 2)); branch.push([x, y, z]); }
    }
  };
  for (let k = 0; k < 12; k++) {
    const a = ((k + hash(k, 1, seed) * 0.6) / 12) * Math.PI * 2, u = hash(k, 2, seed), f = 0.45 + 0.5 * u;
    const tx = c[0] + r[0] * 0.85 * f * Math.cos(a), ty = c[1] + r[1] * 0.85 * f * Math.sin(a), tz = c[2] + r[2] * (u * 1.5 - 0.6);
    const sz = top - (k % 3) * 2, mx = tx * 0.55, my = ty * 0.55, mz = sz + (tz - sz) * 0.55;
    line(0, 0, sz, tx, ty, tz);
    line(tx, ty, tz, tx + Math.cos(a + 0.7) * 3, ty + Math.sin(a + 0.7) * 3, tz + 3);       // twigs at the tip
    line(tx, ty, tz, tx + Math.cos(a - 0.7) * 3, ty + Math.sin(a - 0.7) * 3, tz + 2);
    line(mx, my, mz, mx + Math.cos(a + 1.4) * 3, my + Math.sin(a + 1.4) * 3, mz + 2);        // and one halfway out
  }
  for (const [x, y, z] of branch) if (!v.get(x, y, z + 1) && hash(x, y, z, 950 + seed) < 0.55) v.set(x, y, z + 1, pal.m('snow', 3));
  return v;
}

// every voxel of one ramp moved to another ramp (same tone)
export function remap(v, pal, from, to) {
  for (const [x, y, z, m] of entries(v)) if (rampOf(pal, m) === from) v.set(x, y, z, pal.m(to, (m - 1) & 15));
  return v;
}
// delete every voxel of the given ramps
export function strip(v, pal, names) {
  for (const [x, y, z, m] of entries(v)) if (names.includes(rampOf(pal, m))) v.set(x, y, z, 0);
  return v;
}

// ---- ground tiles (16 x 16, top surface at z = -1) -----------------------------------------------------------------------------------------
// single voxels laid on a tile: `n` spots from hashes of the index, `at` the z of the voxel (0 = standing on the surface, -1 = flat in it)
function scatter(v, pal, ramps, n, seed, at, tones = [2, 3]) {
  for (let i = 0; i < n; i++) {
    const x = 1 + Math.floor(hash(i, 1, seed) * 13), y = 1 + Math.floor(hash(i, 2, seed) * 14), name = ramps[Math.floor(hash(i, 3, seed) * ramps.length)];
    v.set(x, y, at, pal.m(name, tones[Math.floor(hash(i, 4, seed) * tones.length)]));
    if (at < 0) v.set(x + 1, y, at, pal.m(name, tones[0]));                                  // a fallen leaf is two voxels long
  }
  return v;
}
export const groundSpring = (v, pal, seed) => scatter(v, pal, ['flowerW', 'flowerY', 'flowerP', 'flowerW'], 5, 40 + seed, 0, [3]);
export const groundAutumn = (v, pal, seed) => scatter(v, pal, ['autumnO', 'autumnR', 'autumnY', 'autumnO'], 7, 50 + seed, -1);
export function pathWinter(v, pal) {
  for (const [x, y, z, m] of entries(v)) if (z === -1 && hash(x >> 1, y >> 1, 0, 61) < 0.45) v.set(x, y, z, pal.m('snow', hash(x, y, 2, 62) > 0.8 ? 4 : hash(x, y, 3, 63) > 0.4 ? 3 : 2));
  return v;
}

// ---- the seasonal props ------------------------------------------------------------------------------------------------------------------------
export function birdBath(p) {
  const v = new Vox(p, 'birdbath');
  v.cyl(0, 0, 0, 2, 3.6, (x, y) => p.m('stone', Math.hypot(x, y) > 2.8 ? 1 : 2));
  v.cyl(0, 0, 2, 9, 1.9, (x, y) => p.m('stone', x < 0 ? 3 : 2));
  v.cyl(0, 0, 9, 11, 6.4, (x, y, z) => p.m('stone', z === 10 && Math.hypot(x, y) < 5.4 ? 3 : Math.hypot(x, y) > 5.4 ? 1 : 2));
  v.cyl(0, 0, 11, 12, 6.4, (x, y) => (Math.hypot(x, y) > 5.2 ? p.m('stone', 3) : p.m('water', hash(x, y, 3) > 0.85 ? 3 : 2)));
  // a small blue bird on the rim, facing the front
  v.box(4, -2, 12, 7, 0, 14, p.m('chairBlue', 2)).box(4, -3, 14, 6, -1, 16, p.m('chairBlue', 3)).set(4, -4, 15, p.m('flowerO', 2)).set(6, 0, 13, p.m('chairBlue', 1)).set(7, 1, 13, p.m('chairBlue', 1)).set(4, -3, 15, p.m('eye', 0));
  return v;
}
export function pumpkins(p) {
  const v = new Vox(p, 'pumpkins');
  const one = (cx, cy, r) => {
    const rz = r * 0.78;
    v.ellipsoid(cx, cy, rz, r, r, rz, (x, y, z) => {
      const rib = Math.floor(((Math.atan2(y - cy, x - cx) + Math.PI) / (Math.PI * 2)) * 12) % 2;
      return p.m('pumpkin', Math.max(0, Math.min(4, 2 + (x < cx ? 1 : 0) - rib - (z < rz * 0.5 ? 1 : 0))));
    });
    v.box(cx, cy, Math.round(rz * 2) - 1, cx + 1, cy + 1, Math.round(rz * 2) + 2, p.m('leaf2', 1));
  };
  one(-2, 0, 4.6); one(4, 2, 3.6); one(1, -5, 2.8);
  v.set(6, -3, 0, p.m('leaf', 2)).set(7, -3, 0, p.m('leaf', 3)).set(-6, 4, 0, p.m('leaf', 2));
  return v;
}
export function leafPile(p) {
  const v = new Vox(p, 'leafpile');
  v.ellipsoid(0, 0, 0.5, 7, 5.8, 4.2, (x, y, z) => {
    const n = hash(x >> 1, y, z, 5), t = hash(x, y, z, 6);
    return p.m(n > 0.6 ? 'autumnO' : n > 0.28 ? 'autumnR' : 'autumnY', Math.max(0, Math.min(4, 2 + (t > 0.72 ? 1 : t < 0.25 ? -1 : 0) + (z > 3 ? 1 : 0))));
  });
  for (let k = 0; k < 10; k++) {
    const x = Math.round((hash(k, 1, 6) - 0.5) * 14), y = Math.round((hash(k, 2, 6) - 0.5) * 12);
    if (!v.get(x, y, 0)) v.set(x, y, 0, p.m(['autumnO', 'autumnR', 'autumnY'][k % 3], 2));
  }
  return v;
}
export function snowman(p) {
  const v = new Vox(p, 'snowman');
  const ball = (cz, r) => v.ellipsoid(0, 0, cz, r, r, r, (x, y, z, d) => p.m('snow', x < -r * 0.15 || z > cz + r * 0.55 ? 3 : x > r * 0.3 || d > 0.8 ? 1 : 2));
  ball(5, 5.2); ball(11.5, 3.9); ball(17.2, 3.0);
  const front = (x, z) => { let y = 0; for (let k = -8; k < 8; k++) if (v.get(x, k, z)) { y = k; break; } return y; };
  for (const z of [13, 11, 9]) v.set(0, front(0, z), z, p.m('coal', 0));
  for (const x of [-1, 1]) v.set(x, front(x, 18), 18, p.m('coal', 0));
  for (let k = 0; k < 3; k++) v.set(0, front(0, 17) - k - 1, 17, p.m('flowerO', 2));            // carrot nose
  for (let a = 0; a < 24; a++) { const x = Math.round(Math.cos((a / 24) * 6.283) * 3.6), y = Math.round(Math.sin((a / 24) * 6.283) * 3.6); v.set(x, y, 14, p.m('mug', 2)); }
  v.set(3, front(3, 11) - 1, 12, p.m('mug', 1)).set(3, front(3, 11) - 1, 11, p.m('mug', 1));      // scarf end
  v.cyl(0, 0, 19, 20, 4, p.m('coal', 1)).cyl(0, 0, 20, 24, 2.6, p.m('coal', 1));                  // hat: brim and crown
  for (let a = 0; a < 20; a++) v.set(Math.round(Math.cos((a / 20) * 6.283) * 2.7), Math.round(Math.sin((a / 20) * 6.283) * 2.7), 21, p.m('mug', 2));
  for (const s of [-1, 1]) {
    for (let t = 0; t < 6; t++) v.set(s * (4 + t), 0, 11 + Math.floor(t * 0.7), p.m('trunk', 1));
    v.set(s * 9, 0, 15, p.m('trunk', 1)).set(s * 10, 0, 16, p.m('trunk', 1)).set(s * 8, 0, 16, p.m('trunk', 1));
  }
  return v;
}
