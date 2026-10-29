// Zoom steps, fit and pan limits of the pixel scene, as pure functions. The scene is drawn at its virtual resolution and scaled by
// whole numbers of device pixels, so the only zoom levels are the integers below and nothing is ever blurred.

export const ZOOMS = [1, 2, 3, 4, 6];

// largest zoom at which a scene of w x h virtual px (plus a margin in device px) fits a view of vw x vh device px; 1 when none does
export function fitZoom(w, h, vw, vh, margin = 24) {
  let best = ZOOMS[0];
  for (const z of ZOOMS) if (w * z + margin * 2 <= vw && h * z + margin * 2 <= vh) best = z;
  return best;
}
// the lowest zoom at which a view of vw x vh device px still lies inside the world {x0, y0, x1, y1} (virtual px); below it the landscape would end
// inside the view. When no zoom does (a screen larger than the world at every level) the highest one, so the least is outside.
export function minZoom(world, vw, vh) {
  for (const z of ZOOMS) if (vw <= (world.x1 - world.x0) * z && vh <= (world.y1 - world.y0) * z) return z;
  return ZOOMS[ZOOMS.length - 1];
}
// the next zoom level up (dir 1) or down (dir -1), never below `min`
export function stepZoom(z, dir, min = ZOOMS[0]) {
  let i = ZOOMS.indexOf(z);
  if (i < 0) i = ZOOMS.reduce((b, v, k) => (Math.abs(v - z) < Math.abs(ZOOMS[b] - z) ? k : b), 0);
  return ZOOMS[Math.max(Math.max(0, ZOOMS.indexOf(min)), Math.min(ZOOMS.length - 1, i + dir))];
}
// pan (device px offset of the virtual origin) that centres the scene bounds {x0, y0, x1, y1} in a view
export function centerPan(b, zoom, vw, vh) {
  return [Math.round((vw - (b.x1 - b.x0) * zoom) / 2 - b.x0 * zoom), Math.round((vh - (b.y1 - b.y0) * zoom) / 2 - b.y0 * zoom)];
}
// keep the view inside the world {x0, y0, x1, y1}: the world never ends inside it. When the world is smaller than the view on an axis (a screen larger
// than the world at every zoom level) it is centred on that axis.
export function clampPan(pan, b, zoom, vw, vh) {
  const axis = (p, lo, hi, v) => { const max = -lo * zoom, min = v - hi * zoom; return Math.round(min > max ? (min + max) / 2 : Math.min(max, Math.max(min, p))); };
  return [axis(pan[0], b.x0, b.x1, vw), axis(pan[1], b.y0, b.y1, vh)];
}
// zoom about a point (device px of the view): the virtual point under it stays under it
export function zoomAbout(pan, zoom, zoom2, px, py) {
  const k = zoom2 / zoom;
  return [Math.round(px - (px - pan[0]) * k), Math.round(py - (py - pan[1]) * k)];
}
