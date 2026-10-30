// What the QA reads from the 3D scene about how well the building uses the window (office3d-map.mjs prints it, office3d-qa.mjs checks it).
// MEASURE is run in the page (with `o` = root.__ofis3d and `s` = root.__ofis, see o3 in harness3d.mjs). It projects the footprint of the building (the paved
// rectangles under it, `o.footprint()`) with the scene's own camera (`s.project`) and returns:
//   zoom      the fit zoom (the automatic view, in pixels per metre)
//   boxW/boxH the box the building takes on the screen (the footprint from below the floor to above the walls, as the fit frames it), in pixels
//   aspect    boxW / boxH, to compare with 16:10 (1.6) and 16:9 (1.78)
//   boxShare  that box's share of the window; footShare the share of the window the footprint itself covers; fill = footprint / box
// An older copy of the repo without `o.footprint()` (the two rows) is measured on the box that was drawn around the two rows.
export const MEASURE = `(() => {
  const [vw, vh] = s.size;
  let rects = o.footprint ? o.footprint() : null;
  if (!rects) {
    const off = o.office(), x1 = Math.max(...off.slots.map(r => r.X + r.W)), z1 = Math.max(...off.slots.map(r => r.Z + r.D));
    rects = [{ x0: -0.16 - 0.7, x1: x1 + 0.16 + 0.7, z0: -0.16 - 0.7, z1: z1 + 0.16 + 0.7 }];       // as ofis.js drew it: the whole box
  }
  const W = Math.ceil(vw), H = Math.ceil(vh), mask = new Uint8Array(W * H);
  let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9;
  for (const r of rects) {
    const P = [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]].map(([x, z]) => s.project(x, 0, z));
    const ys = P.map(p => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(H - 1, Math.ceil(Math.max(...ys))); y++) {
      const xs = [];
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = P[i], [cx, cy] = P[(i + 1) % 4];
        if ((ay <= y + 0.5 && cy > y + 0.5) || (cy <= y + 0.5 && ay > y + 0.5)) xs.push(ax + (y + 0.5 - ay) / (cy - ay) * (cx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.round(xs[k])); x < Math.min(W, Math.round(xs[k + 1])); x++) mask[y * W + x] = 1;
    }
    for (const [x, z] of [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]]) for (const y of [-0.5, 2.9]) {
      const p = s.project(x, y, z);
      bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); by0 = Math.min(by0, p[1]); by1 = Math.max(by1, p[1]);
    }
  }
  let px = 0;
  for (let i = 0; i < mask.length; i++) px += mask[i];
  const bw = bx1 - bx0, bh = by1 - by0;
  return { vw, vh, zoom: +s.zoom.toFixed(2), autoFit: s.autoFit, boxW: Math.round(bw), boxH: Math.round(bh), aspect: +(bw / bh).toFixed(2),
    boxShare: +(bw * bh / (vw * vh)).toFixed(3), footShare: +(px / (vw * vh)).toFixed(3), fill: +(px / (bw * bh)).toFixed(3), offices: o.office().slots.length };
})()`;
