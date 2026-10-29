// Light for the pixel scene, the parts that touch a canvas: glow sprites for lit windows, lamps and monitors. The numbers (tint, lights)
// come from time.js; nothing here knows what time it is.

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
