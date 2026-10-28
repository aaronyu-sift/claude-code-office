// Renders the sprite catalog with the VoxPix renderer (build time only) and packs it into one atlas per projection.
// usage (through build-atlas.mjs): bun atlas.ts --proj iso [--check] [--out <dir>] [--only <id-prefix>] [--sheet <png>]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = new URL('../../', import.meta.url).pathname;
const VOXPIX = process.env.VOXPIX_DIR || ROOT + '.tools/voxpix';   // pinned checkout, see README
const { Model, render, camera } = await import(VOXPIX + '/src/core/index.ts');
const { encodePNG } = await import(VOXPIX + '/src/core/png.ts');
const { PROJECTIONS, TILE } = await import(ROOT + 'public/js/pixel/projection.js');
const { SPRITES, makePalette } = await import('./catalog.mjs');

const args = process.argv.slice(2);
const val = (f: string) => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : undefined; };
const projName = val('proj') || 'iso';
const check = args.includes('--check');
const outDir = val('out') || ROOT + 'public/pixel';
const proj = (PROJECTIONS as any)[projName];
if (!proj) { console.error('unknown projection ' + projName); process.exit(2); }

const ATLAS_W = 1024, GUTTER = 1, MARGIN = 2;
const pal = makePalette();
type Img = { id: string; facing: number; w: number; h: number; rgba: Uint8ClampedArray; px: number; py: number };
const imgs: Img[] = [];

for (const def of SPRITES as any[]) {
  if (val('only') && !def.id.startsWith(val('only')!)) continue;
  const model = Model.fromJSON(def.make(pal).json());
  const b = model.bounds();
  if (!b) throw new Error(def.id + ': empty model');
  const [fx, fy, fw, fd] = def.fp;
  for (let k = 0; k < def.facings; k++) {
    const base: any = {
      width: 1, height: 1, originX: 0, originY: 0, yaw: proj.facingYaw(k), elevation: proj.render.elevation, ppu: proj.render.ppu,
      pivot: [fx + fw / 2, fy + fd / 2, 0], ...(proj.render.oblique ? { oblique: proj.render.oblique } : {}),
    };
    const cam = camera(base);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const X of [b.minX, b.maxX + 1]) for (const Y of [b.minY, b.maxY + 1]) for (const Z of [b.minZ, b.maxZ + 1]) {
      const [sx, sy] = cam.project(X, Y, Z);
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    const originX = Math.ceil(-x0) + MARGIN, originY = Math.ceil(-y0) + MARGIN;
    const W = Math.ceil(x1 + originX) + MARGIN + 1, H = Math.ceil(y1 + originY) + MARGIN + 1;
    const r = render(model, { ...base, width: W, height: H, originX, originY, outline: def.flat ? 'none' : 'outer', ao: !def.flat, smooth: 0.6, shadows: false });
    // crop to the visible pixels
    let ax0 = W, ay0 = H, ax1 = -1, ay1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (r.rgba[(y * W + x) * 4 + 3]) { ax0 = Math.min(ax0, x); ax1 = Math.max(ax1, x); ay0 = Math.min(ay0, y); ay1 = Math.max(ay1, y); }
    if (ax1 < 0) throw new Error(def.id + ': nothing rendered');
    const cw = ax1 - ax0 + 1, ch = ay1 - ay0 + 1, rgba = new Uint8ClampedArray(cw * ch * 4);
    for (let y = 0; y < ch; y++) rgba.set(r.rgba.subarray(((ay0 + y) * W + ax0) * 4, ((ay0 + y) * W + ax0 + cw) * 4), y * cw * 4);
    imgs.push({ id: def.id, facing: k, w: cw, h: ch, rgba, px: originX + 0.5 - ax0, py: originY - ay0 });
  }
}

// shelf packing, tallest first, deterministic order
const order = [...imgs].sort((a, b) => b.h - a.h || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || a.facing - b.facing);
const pos = new Map<Img, [number, number]>();
let cx = 0, cy = 0, rowH = 0;
for (const im of order) {
  if (cx + im.w > ATLAS_W) { cx = 0; cy += rowH + GUTTER; rowH = 0; }
  pos.set(im, [cx, cy]);
  cx += im.w + GUTTER; rowH = Math.max(rowH, im.h);
}
const ATLAS_H = cy + rowH;
const sheet = new Uint8ClampedArray(ATLAS_W * ATLAS_H * 4);
for (const im of imgs) {
  const [ox, oy] = pos.get(im)!;
  for (let y = 0; y < im.h; y++) sheet.set(im.rgba.subarray(y * im.w * 4, (y + 1) * im.w * 4), ((oy + y) * ATLAS_W + ox) * 4);
}
const png = encodePNG(ATLAS_W, ATLAS_H, sheet);

// manifest: shared description of every sprite plus the per-projection rectangles
const sprites: any = {};
const place: any = {};
for (const def of SPRITES as any[]) {
  const mine = imgs.filter(i => i.id === def.id).sort((a, b) => a.facing - b.facing);
  if (!mine.length) continue;
  sprites[def.id] = { cat: def.cat, fp: def.fp, h: def.h, facings: def.facings, frames: 1, tags: def.tags };
  place[def.id] = { rects: mine.map(i => [...pos.get(i)!, i.w, i.h]), pivots: mine.map(i => [i.px, i.py]) };
}
const sha = createHash('sha256').update(png).digest('hex').slice(0, 16);
const projPart = { atlas: `atlas-${projName}.png`, width: ATLAS_W, height: ATLAS_H, sha, sprites: place };

const manifestFile = outDir + '/manifest.json';
const old = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : { version: 1, tile: TILE, projections: {} };
const full = { version: 1, tile: TILE, sprites, projections: { ...old.projections, [projName]: projPart } };
const text = JSON.stringify(full, null, 1) + '\n';

const cats: Record<string, { ids: number; images: number }> = {};
for (const [id, s] of Object.entries<any>(sprites)) { const c = (cats[s.cat] ||= { ids: 0, images: 0 }); c.ids++; c.images += place[id].rects.length; }
const nIds = Object.keys(sprites).length, nImg = imgs.length;

if (check) {
  const pngFile = `${outDir}/atlas-${projName}.png`;
  const problems: string[] = [];
  if (!existsSync(pngFile)) problems.push('missing ' + pngFile);
  else if (!Buffer.from(png).equals(readFileSync(pngFile))) problems.push(`${pngFile} differs from a fresh render`);
  if (!existsSync(manifestFile)) problems.push('missing ' + manifestFile);
  else if (readFileSync(manifestFile, 'utf8') !== text) problems.push(`${manifestFile} differs from a fresh render`);
  if (problems.length) { console.error('CHECK FAIL\n' + problems.join('\n')); process.exit(1); }
  console.log(`CHECK PASS atlas-${projName}.png and manifest.json are identical to a fresh render (sha ${sha})`);
} else {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(`${outDir}/atlas-${projName}.png`, png);
  writeFileSync(manifestFile, text);
  console.log(`wrote ${outDir}/atlas-${projName}.png and manifest.json`);
}
console.log(`atlas ${ATLAS_W}x${ATLAS_H} px, ${png.length} bytes; ${nIds} sprites (${nImg} images)`);
for (const [c, n] of Object.entries(cats)) console.log(`  ${c.padEnd(10)} ${String(n.ids).padStart(3)} sprites ${String(n.images).padStart(4)} images`);
if (val('sheet')) {
  // contact sheet on a green ground, for looking at the art
  const usedW = Math.max(...imgs.map(i => pos.get(i)![0] + i.w)), S = Number(val('scale') || 3), SW = usedW * S, SH = ATLAS_H * S, out = new Uint8ClampedArray(SW * SH * 4);
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    const a = ((y / S | 0) * ATLAS_W + (x / S | 0)) * 4, o = (y * SW + x) * 4, al = sheet[a + 3] / 255;
    for (let k = 0; k < 3; k++) out[o + k] = sheet[a + k] * al + [0xc9, 0xe6, 0xd3][k] * (1 - al);
    out[o + 3] = 255;
  }
  writeFileSync(val('sheet')!, encodePNG(SW, SH, out));
}
