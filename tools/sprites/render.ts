// usage: bun render.ts <sheet.png> <ppu> <yaw> <elev> model1.json model2.json ...
import { readFileSync, writeFileSync } from 'node:fs';
const VOXPIX = process.env.VOXPIX_DIR || new URL('../../.tools/voxpix', import.meta.url).pathname;   // pinned checkout, see README
const { Model, render, camera } = await import(VOXPIX + '/src/core/index.ts');
const { encodePNG } = await import(VOXPIX + '/src/core/png.ts');

const [out, ppuS, yawS, elevS, ...files] = process.argv.slice(2);
const ppu = Number(ppuS), yaw = Number(yawS), elev = Number(elevS);
const cells: { w: number; h: number; rgba: Uint8ClampedArray }[] = [];
for (const f of files) {
  const m = Model.fromJSON(JSON.parse(readFileSync(f, 'utf8')));
  const b = m.bounds()!;
  const OBL = process.env.OBL ? process.env.OBL.split(',').map(Number) : null;
  const base = { width: 1, height: 1, originX: 0, originY: 0, yaw, elevation: elev, ppu, ...(OBL ? { oblique: { y: OBL[0], z: OBL[1] } } : {}) } as any;
  const cam = camera(base);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const X of [b.minX, b.maxX + 1]) for (const Y of [b.minY, b.maxY + 1]) for (const Z of [b.minZ, b.maxZ + 1]) {
    const [sx, sy] = cam.project(X, Y, Z); x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  const mar = 6 * ppu;
  const W = Math.ceil(x1 - x0) + 2 * mar, H = Math.ceil(y1 - y0) + 2 * mar;
  const r = render(m, { ...base, width: W, height: H, originX: Math.round(-x0 + mar), originY: Math.round(-y0 + mar), outline: 'outer', ao: true, smooth: 0.6, shadows: false });
  cells.push({ w: W, h: H, rgba: r.rgba });
}
const gap = 10, bg = [0xc9, 0xe6, 0xd3];
const SW = cells.reduce((a, c) => a + c.w + gap, gap), SH = Math.max(...cells.map(c => c.h)) + 2 * gap;
const sheet = new Uint8ClampedArray(SW * SH * 4);
for (let i = 0; i < SW * SH; i++) { sheet[i * 4] = bg[0]; sheet[i * 4 + 1] = bg[1]; sheet[i * 4 + 2] = bg[2]; sheet[i * 4 + 3] = 255; }
let x0 = gap;
for (const c of cells) {
  const y0 = SH - gap - c.h;
  for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
    const s = (y * c.w + x) * 4, d = ((y0 + y) * SW + x0 + x) * 4, a = c.rgba[s + 3] / 255;
    if (a > 0) for (let k = 0; k < 3; k++) sheet[d + k] = c.rgba[s + k] * a + sheet[d + k] * (1 - a);
  }
  x0 += c.w + gap;
}
writeFileSync(out, encodePNG(SW, SH, sheet));
console.log(out, SW + 'x' + SH);
