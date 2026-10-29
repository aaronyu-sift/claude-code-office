// Light for the pixel scene, the parts that touch a canvas: glow sprites for lit windows, lamps and monitors, and the sky behind the
// island. The numbers (tint, lights, sky colours) come from time.js; nothing here knows what time it is.
import { rgb } from './time.js';

const newCanvas = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));

// What lights up: the colour of its glow. Kinds come from the anchors of the manifest (monitor, lamp, window, led).
export const GLOW = {
  window: { color: [255, 200, 110], k: 0.95 },
  lamp: { color: [255, 214, 130], k: 1 },
  monitor: { color: [120, 205, 255], k: 0.9 },
  led: { color: [120, 255, 170], k: 1 },
};

// A glow is a few hard-edged discs, faint outside and strong in the middle, so it keeps the look of the pixel art. One small canvas per
// (radius, kind) is made once and drawn with additive blending; the strength is the canvas alpha.
const glows = new Map();
export function glowSprite(kind, r) {
  r = Math.max(2, Math.round(r));
  const key = kind + r;
  let s = glows.get(key);
  if (s) return s;
  const c = newCanvas(2 * r + 1, 2 * r + 1), g = c.getContext('2d'), col = (GLOW[kind] || GLOW.lamp).color;
  for (const [f, a] of [[1, 0.10], [0.72, 0.17], [0.46, 0.28], [0.22, 0.45]]) {
    const rr = r * f;
    g.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${a})`;
    for (let dy = -Math.floor(rr); dy <= Math.floor(rr); dy++) { const hw = Math.floor(Math.sqrt(rr * rr - dy * dy)); g.fillRect(r - hw, r + dy, hw * 2 + 1, 1); }
  }
  glows.set(key, s = { canvas: c, r });
  return s;
}

// Sky: banded gradient, stars and the sun or moon, drawn small (a quarter of the view) and scaled up with nearest-neighbour sampling.
const hashN = (i, s) => { let h = Math.imul(i * 374761393 + s * 668265263, 1274126177); h ^= h >>> 15; return ((h >>> 0) % 10000) / 10000; };
export function drawSky(canvas, amb, scale = 4) {
  const w = Math.max(2, Math.ceil(canvas.clientWidth ? canvas.clientWidth * (window.devicePixelRatio || 1) / scale : 200)), h = Math.max(2, Math.ceil(canvas.clientHeight ? canvas.clientHeight * (window.devicePixelRatio || 1) / scale : 120));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const g = canvas.getContext('2d');
  const bands = 14;
  for (let i = 0; i < bands; i++) {
    const t = i / (bands - 1), c = amb.top.map((v, j) => Math.round(v + (amb.bottom[j] - v) * t));
    g.fillStyle = rgb(c);
    g.fillRect(0, Math.floor((i * h) / bands), w, Math.ceil(h / bands) + 1);
  }
  if (amb.stars > 0.01) {
    for (let i = 0; i < 110; i++) {
      const x = Math.floor(hashN(i, 1) * w), y = Math.floor(hashN(i, 2) * h * 0.7), a = amb.stars * (0.35 + hashN(i, 3) * 0.65);
      g.fillStyle = `rgba(255,250,230,${a.toFixed(2)})`;
      g.fillRect(x, y, 1, 1);
      if (hashN(i, 4) > 0.93) { g.fillRect(x - 1, y, 3, 1); g.fillRect(x, y - 1, 1, 3); }
    }
  }
  const body = amb.sun || amb.moon;
  if (body) {
    const f = body.f, x = Math.round(w * (0.1 + 0.8 * f)), y = Math.round(h * (0.42 - 0.32 * Math.sin(Math.PI * f))), r = Math.max(3, Math.round(h * 0.045));
    const disc = (cx, cy, rad, fill) => { g.fillStyle = fill; for (let dy = -rad; dy <= rad; dy++) { const hw = Math.floor(Math.sqrt(rad * rad - dy * dy + 0.5)); g.fillRect(cx - hw, cy + dy, hw * 2 + 1, 1); } };
    if (amb.sun) { disc(x, y, r + 3, 'rgba(255,230,160,0.25)'); disc(x, y, r + 1, 'rgba(255,240,190,0.45)'); disc(x, y, r, '#fff6c8'); }
    else { disc(x, y, r + 3, 'rgba(210,225,255,0.14)'); disc(x, y, r, '#eef3ff'); disc(x + Math.ceil(r * 0.45), y - 1, Math.round(r * 0.85), rgb(amb.top.map((v, j) => Math.round(v + (amb.bottom[j] - v) * 0.15)))); }
  }
}
