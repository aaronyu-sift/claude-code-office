// Design aid (not part of the app): draws the arrangements of the compact 3D map that were scored, each as the footprint it takes in a 1440 x 900 window at its own
// fit zoom (the scene's projection and fit rule), with its numbers, as one SVG (and a PNG made by headless Chrome).
//   node tools/layout-options-svg.mjs <out.svg> [<out.png>]
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { launchChrome } from './qa/cdp.mjs';
import { project, measure, fitZoom, rectsOfRows, baseline, PITCH, PITCH_Z } from './layout-explore-lib.mjs';
import { buildingPlan, ROOM_D, CELL_W, WALL_T, GAP, PAIR_D, PLINTH_M, officesIn } from '../public/js/ofis-layout.js';

const bay = (c0, n = 1) => ({ b: { c0, n }, f: { c0, n } });
const cells = (b, f) => ({ b: { c0: b[0], n: b[1] }, f: { c0: f[0], n: f[1] } });
// bays one by one (row k, column c0): a plinth rectangle each, as the layout draws one per run
const bays = list => list.map(([k, c0, n = 1]) => ({ x0: c0 * PITCH - WALL_T - PLINTH_M, x1: c0 * PITCH + n * PITCH - GAP + WALL_T + PLINTH_M, z0: k * PITCH_Z - GAP / 2, z1: k * PITCH_Z + PAIR_D + GAP / 2, row: k }));
const OPTIONS = [
  { name: 'Now: two rows of five', note: '10 cells', rects: baseline().rects },
  { name: 'A  Plus, bar of 3 bays', note: '5 bays, 10 cells, no free hub', rects: bays([[0, 1], [1, 0, 3], [2, 1]]) },
  { name: 'B  Block 3 + 2 bays, stitched', note: '5 bays, 10 cells', rects: bays([[0, 0, 3], [1, 0.5, 2]]) },
  { name: 'C  Ring around a courtyard', note: '8 bays, 16 cells', rects: bays([[0, 0, 3], [1, 0], [1, 2], [2, 0, 3]]) },
  { name: 'D  Hexagon 3-6-3 cells', note: '12 cells', rects: rectsOfRows([cells([1.5, 1], [1, 2]), cells([0, 3], [0, 3]), cells([1, 2], [1.5, 1])]) },
  { name: 'PICK  X: bar of 4 bays + one bay north and south', note: '6 bays, 11 offices + the hub', rects: buildingPlan(6).plinth, pick: true },
];
const VW = 1440, VH = 900, S = 0.3, PADT = 80, PADB = 16, PADL = 18, PADR = 24;
const base = measure(baseline().rects), baseZoom = fitZoom(base, VW, VH);
const panels = OPTIONS.map((o, i) => {
  const m = measure(o.rects), z = fitZoom(m, VW, VH), cx = PADL + (VW - PADL - PADR) / 2, cy = PADT + (VH - PADT - PADB) / 2;
  // the centre of the box (a0..a1, b0..b1 of the scene's projection) goes to the middle of the free part of the window
  let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
  for (const r of o.rects) for (const x of [r.x0, r.x1]) for (const zz of [r.z0, r.z1]) for (const y of [-0.5, 2.9]) { const [a, b] = project(x, y, zz); a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
  const ac = (a0 + a1) / 2, bc = (b0 + b1) / 2, pt = (x, zz) => { const [a, b] = project(x, 0, zz); return [cx + (a - ac) * z, cy - (b - bc) * z]; };
  const polys = o.rects.map(r => [[r.x0, r.z0], [r.x1, r.z0], [r.x1, r.z1], [r.x0, r.z1]].map(([x, zz]) => pt(x, zz).map(v => (v * S).toFixed(1)).join(',')).join(' '));
  const foot = m.area * z * z / (VW * VH);
  return { o, i, z, foot, gain: z / baseZoom, polys, box: [cx + (a0 - ac) * z, cy - (b1 - bc) * z, (a1 - a0) * z, (b1 - b0) * z] };
});
const col = i => i % 3, row = i => Math.floor(i / 3), PW = VW * S, PH = VH * S + 58, W = 3 * (PW + 24) + 24, H = 2 * (PH + 24) + 70;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif">
<rect width="${W}" height="${H}" fill="#0f1420"/>
<text x="24" y="34" font-size="20" font-weight="700" fill="#e8ecf4">The 10 chats of the 3D map: arrangements scored in a 1440 x 900 window (the scene's own camera and fit rule)</text>
<text x="24" y="56" font-size="13" fill="#9aa6bd">Each panel is the window; the building is drawn as its paved footprint at the zoom the automatic view takes; the dashed box is what the fit frames. Zoom is against the two rows of before (${baseZoom.toFixed(1)}).</text>\n`;
for (const p of panels) {
  const x = 24 + col(p.i) * (PW + 24), y = 70 + row(p.i) * (PH + 24);
  svg += `<g transform="translate(${x},${y})"><rect width="${PW}" height="${VH * S}" fill="#6f8f4e" stroke="${p.o.pick ? '#4cc2ff' : '#2a3350'}" stroke-width="${p.o.pick ? 3 : 1}" rx="4"/>
<rect x="0" y="0" width="${PW}" height="${PADT * S}" fill="#101624" opacity=".85"/>
${p.polys.map(q => `<polygon points="${q}" fill="${p.o.pick ? '#e9edf5' : '#d4d8e0'}" stroke="#4a5163" stroke-width="0.6"/>`).join('\n')}
<rect x="${(p.box[0] * S).toFixed(1)}" y="${(p.box[1] * S).toFixed(1)}" width="${(p.box[2] * S).toFixed(1)}" height="${(p.box[3] * S).toFixed(1)}" fill="none" stroke="#ffdd57" stroke-width="1" stroke-dasharray="4 3"/>
<text x="0" y="${VH * S + 20}" font-size="14" font-weight="700" fill="${p.o.pick ? '#4cc2ff' : '#e8ecf4'}">${p.o.name}</text>
<text x="0" y="${VH * S + 38}" font-size="12" fill="#9aa6bd">${p.o.note}</text>
<text x="0" y="${VH * S + 54}" font-size="12" fill="#e8ecf4">zoom ${p.z.toFixed(1)} (${p.gain >= 1 ? '+' : ''}${((p.gain - 1) * 100).toFixed(0)} percent), covers ${(p.foot * 100).toFixed(0)} percent of the window</text></g>\n`;
}
svg += '</svg>\n';
writeFileSync(process.argv[2] || '/tmp/options.svg', svg);
console.log(panels.map(p => `${p.o.name}: zoom ${p.z.toFixed(1)} gain ${((p.gain - 1) * 100).toFixed(0)}% covers ${(p.foot * 100).toFixed(0)}%`).join('\n'));
if (process.argv[3]) {
  const page = await launchChrome({ width: Math.ceil(W), height: Math.ceil(H) });
  try { await page.goto(pathToFileURL(process.argv[2]).href, 500); await page.screenshot(process.argv[3]); } finally { await page.close(); }
}
