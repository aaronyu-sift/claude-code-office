const VOXPIX = process.env.VOXPIX_DIR;
if (!VOXPIX) throw new Error('set VOXPIX_DIR to a checkout of https://github.com/andyeswong/voxpix');
const { camera } = await import(VOXPIX + '/src/core/index.ts');
// A room: 66 x 62 voxels (2 desks wide, 2 rows), walls 30 high, 4 agents. Streets between rooms: 14 voxels.
const W = 66, D = 62, G = 14, H = 38, AG = 38;           // AG: agent height in voxels incl. hair
const VIEW = { w: 1500, h: 790 };
function bbox(o: any, c: number, r: number) {
  const X = c * W + (c - 1) * G, Y = r * D + (r - 1) * G;
  const cam = camera({ width: 1, height: 1, originX: 0, originY: 0, ppu: 1, ...o });
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (const x of [0, X]) for (const y of [0, Y]) for (const z of [0, H]) { const [sx, sy] = cam.project(x, y, z); x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); }
  return { w: x1 - x0, h: y1 - y0, X, Y };
}
const projs: Record<string, any> = { iso: { yaw: -45, elevation: 30 }, oblique: { yaw: 0, oblique: { y: 0.75, z: 1 } } };
console.log('agents rooms | projection  grid  scene(px at 1x)  fit-scale  agent-height(px)  room-width(px)  screen-fill');
for (const n of [4, 8, 12, 16, 24, 40, 60]) {
  const rooms = Math.ceil(n / 4);
  for (const [name, o] of Object.entries(projs)) {
    let best: any = null;
    for (let c = 1; c <= rooms; c++) { const r = Math.ceil(rooms / c); const b = bbox(o, c, r); const s = Math.min(VIEW.w / b.w, VIEW.h / b.h); if (!best || s > best.s) best = { c, r, b, s }; }
    const roomPx = bbox(o, 1, 1).w * best.s;
    const fill = (best.b.w * best.b.h * best.s * best.s) / (VIEW.w * VIEW.h);
    console.log(String(n).padStart(6), String(rooms).padStart(5), '|', name.padEnd(8), `${best.c}x${best.r}`.padEnd(5), `${Math.round(best.b.w)}x${Math.round(best.b.h)}`.padStart(9), best.s.toFixed(2).padStart(9), (AG * best.s).toFixed(0).padStart(12), roomPx.toFixed(0).padStart(14), (fill * 100).toFixed(0) + '%');
  }
}
