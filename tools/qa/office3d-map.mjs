// How well the 3D building uses the screen (headless Chrome with software WebGL, throw-away profile, one scene at a time):
//   node tools/qa/office3d-map.mjs [--root <copy of the repo>] [--sizes 1440x900,1920x1080] [--n 3,10] [--shots <dir> --label <name>] [--json]
// For every window size and number of chats it opens the Office on ?scene=3d, lets the automatic view fit the building and reads, with the
// scene's own projection (`s.project`): the fit zoom, the box the building takes on the screen, the share of the window that box and the building's
// footprint cover, and the aspect of the box against 16:10 and 16:9. --root serves another copy of the repo (the layout before the change, for a
// comparison); --shots writes one picture per size and number of chats named <label>-<WxH>-<n>chats.png.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { scenario3d, o3, sleep } from './harness3d.mjs';

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : d; };
const root = val('root'), shotsDir = val('shots'), label = val('label', 'map');
const sizes = val('sizes', '1440x900,1920x1080,1280x800,1100x700').split(',').map(s => s.split('x').map(Number));
const counts = val('n', '3,10').split(',').map(Number);

// Runs in the page: the footprint of the building (the rectangles of its plinth) projected with the scene's own camera, and what it covers.
// The new code lists the plinth in o.footprint(); the old one (a single box around two rows) is derived from the offices.
const MEASURE = `(() => {
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

if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const rows = [];
for (const [width, height] of sizes) {
  for (const n of counts) {
    const S = await scenario3d(n, { tag: `map${width}x${height}`, root, width, height });
    try {
      if (!S.ready.ok) { console.log(`${width}x${height} ${n} chats: the scene did not become ready ${JSON.stringify(S.ready.last)}`); continue; }
      await sleep(700);
      const m = await S.page.evaluate(o3(MEASURE));
      rows.push({ n, ...m });
      console.log(`${width}x${height} ${n} chats: ${JSON.stringify(m)}`);
      if (shotsDir) { await S.page.mouse.move(2, 2); await sleep(500); await S.page.screenshot(join(shotsDir, `${label}-${width}x${height}-${n}chats.png`)); }
    } finally { await S.done(); }
  }
}
if (args.includes('--json')) console.log(JSON.stringify(rows));
