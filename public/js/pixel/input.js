// Zoom steps, fit and pan limits of the pixel scene, as pure functions. The scene is drawn at its virtual resolution and scaled by
// whole numbers of device pixels, so the only zoom levels are the integers below and nothing is ever blurred.

export const ZOOMS = [1, 2, 3, 4, 6];

// largest zoom at which a scene of w x h virtual px (plus a margin in device px) fits a view of vw x vh device px; 1 when none does
export function fitZoom(w, h, vw, vh, margin = 24) {
  let best = ZOOMS[0];
  for (const z of ZOOMS) if (w * z + margin * 2 <= vw && h * z + margin * 2 <= vh) best = z;
  return best;
}
export function stepZoom(z, dir) {
  let i = ZOOMS.indexOf(z);
  if (i < 0) i = ZOOMS.reduce((b, v, k) => (Math.abs(v - z) < Math.abs(ZOOMS[b] - z) ? k : b), 0);
  return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + dir))];
}
// pan (device px offset of the virtual origin) that centres the scene bounds {x0, y0, x1, y1} in a view
export function centerPan(b, zoom, vw, vh) {
  return [Math.round((vw - (b.x1 - b.x0) * zoom) / 2 - b.x0 * zoom), Math.round((vh - (b.y1 - b.y0) * zoom) / 2 - b.y0 * zoom)];
}
// keep some of the scene on screen: the scene may leave the view but never entirely
export function clampPan(pan, b, zoom, vw, vh, keep = 80) {
  const x = Math.min(vw - keep - b.x0 * zoom, Math.max(keep - b.x1 * zoom, pan[0]));
  const y = Math.min(vh - keep - b.y0 * zoom, Math.max(keep - b.y1 * zoom, pan[1]));
  return [Math.round(x), Math.round(y)];
}
// zoom about a point (device px of the view): the virtual point under it stays under it
export function zoomAbout(pan, zoom, zoom2, px, py) {
  const k = zoom2 / zoom;
  return [Math.round(px - (px - pan[0]) * k), Math.round(py - (py - pan[1]) * k)];
}
