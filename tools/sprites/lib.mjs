// Tiny voxel DSL for generating VoxPix models (.voxpix.json) from code.
// Axes as in VoxPix: x east, y north (away from the camera at yaw 0), z up. The model's front faces -y.

// ---- colour: sRGB <-> OKLab, ramps with hue shift -------------------------------------------------------
const toLin = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = c => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
export function hexToLab(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = toLin(((n >> 16) & 255) / 255), g = toLin(((n >> 8) & 255) / 255), b = toLin((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function labToHex(L, a, b) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  return '#' + rgb.map(v => Math.round(Math.max(0, Math.min(1, toSrgb(Math.max(0, v)))) * 255).toString(16).padStart(2, '0')).join('');
}
// n tones from dark to light around `base` (which sits at tone `mid`). Shadows drift toward blue-violet and get a
// little more saturated, highlights drift toward warm yellow and lose saturation: the usual pixel-art hue shift.
export function rampColors(base, n = 5, mid = 2, step = 0.085, shift = 1) {
  const [L0, a0, b0] = hexToLab(base);
  const C0 = Math.hypot(a0, b0), h0 = Math.atan2(b0, a0);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = (i - mid) / Math.max(mid, n - 1 - mid);           // -1 .. 1
    const L = Math.max(0.12, Math.min(0.97, L0 + (i - mid) * step));
    const target = t < 0 ? (265 * Math.PI) / 180 : (85 * Math.PI) / 180;
    let dh = target - h0; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    const h = h0 + dh * Math.abs(t) * 0.18 * shift;
    const C = C0 * (t < 0 ? 1 + 0.12 * -t : 1 - 0.28 * t);
    out.push(labToHex(L, C * Math.cos(h), C * Math.sin(h)));
  }
  return out;
}

// ---- palette + model --------------------------------------------------------------------------------
export class Pal {
  constructor() { this.ramps = []; this.index = new Map(); }
  add(name, base, o = {}) {
    const colors = o.colors || rampColors(base, o.n ?? 5, o.mid ?? 2, o.step ?? 0.085, o.shift ?? 1);
    const r = { name, colors };
    if (o.emissive) r.emissive = true;
    if (o.material) r.material = o.material;
    this.index.set(name, this.ramps.length);
    this.ramps.push(r);
    return this;
  }
  // voxel value for ramp `name` at tone `tone` (default: the ramp's middle tone)
  m(name, tone) {
    const i = this.index.get(name);
    if (i === undefined) throw new Error('no ramp ' + name);
    const t = tone ?? this.ramps[i].mid ?? Math.min(2, this.ramps[i].colors.length - 1);
    return i * 16 + Math.max(0, Math.min(this.ramps[i].colors.length - 1, t)) + 1;
  }
}

export class Vox {
  constructor(pal, name) { this.pal = pal; this.name = name; this.v = new Map(); }
  set(x, y, z, m) { x = Math.round(x); y = Math.round(y); z = Math.round(z); if (m) this.v.set(x + ',' + y + ',' + z, [x, y, z, m]); else this.v.delete(x + ',' + y + ',' + z); return this; }
  get(x, y, z) { const e = this.v.get(Math.round(x) + ',' + Math.round(y) + ',' + Math.round(z)); return e ? e[3] : 0; }
  // half-open box [x0,x1) x [y0,y1) x [z0,z1); m is a value or (x,y,z) => value
  box(x0, y0, z0, x1, y1, z1, m) {
    for (let x = x0; x < x1; x++) for (let y = y0; y < y1; y++) for (let z = z0; z < z1; z++) this.set(x, y, z, typeof m === 'function' ? m(x, y, z) : m);
    return this;
  }
  ellipsoid(cx, cy, cz, rx, ry, rz, m) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++)
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
          const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2;
          if (d <= 1) this.set(x, y, z, typeof m === 'function' ? m(x, y, z, d) : m);
        }
    return this;
  }
  // vertical cylinder (axis z)
  cyl(cx, cy, z0, z1, r, m) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) for (let z = z0; z < z1; z++) this.set(x, y, z, typeof m === 'function' ? m(x, y, z) : m);
    return this;
  }
  // copy another model in at an offset, optionally rotated by quarter turns about z
  put(o, dx = 0, dy = 0, dz = 0, quarter = 0) {
    for (const [x, y, z, m] of o.v.values()) {
      let X = x, Y = y;
      for (let q = 0; q < ((quarter % 4) + 4) % 4; q++) { const t = X; X = -Y - 1; Y = t; }
      this.set(X + dx, Y + dy, z + dz, m);
    }
    return this;
  }
  json() {
    const voxels = [...this.v.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    return { format: 'voxpix', version: 1, name: this.name, palette: { ramps: this.pal.ramps, outline: this.pal.outline || '#1d1830' }, voxels };
  }
}

// deterministic hash noise in [0,1)
export function hash(x, y, z = 0, s = 0) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + s * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) % 100000) / 100000;
}
