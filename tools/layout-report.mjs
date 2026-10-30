// Design aid (not part of the app): the numbers behind the compact 3D map, from the real layout module (public/js/ofis-layout.js) with the scene's own
// projection and fit rule: for a number of bays, the box the building takes on the screen, the zoom the automatic view fits at several window sizes
// (with and without the shelf card open), the share of the window the building covers and the aspect of its box.
//   node tools/layout-report.mjs [--bays 6] [--all]
import { buildingPlan, projectedBox, projectedArea, fitZoom, officesIn, MIN_ROOMS, baysFor, PITCH, GAP, CELL_W, ROOM_D, PAIR_D, WALL_T, PLINTH_M } from '../public/js/ofis-layout.js';

const args = process.argv.slice(2), val = (f, d) => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : d; };
export const VIEWS = [[1440, 900, 0], [1440, 900, 322], [1920, 1080, 0], [1920, 1080, 322], [1280, 800, 0], [1280, 800, 322], [1100, 700, 0]];

// the building as it was: one hall, two rows of five offices, one plinth around all of it
export function oldBuilding(perRow = 5) {
  const w = perRow * PITCH - GAP;
  return [{ x0: -WALL_T - PLINTH_M, x1: w + WALL_T + PLINTH_M, z0: -WALL_T - PLINTH_M, z1: PAIR_D + WALL_T + PLINTH_M }];
}
export function figures(rects) {
  const box = projectedBox(rects), area = projectedArea(rects);
  return { box, area, aspect: box.w / box.h, fill: area / (box.w * box.h),
    views: VIEWS.map(([w, h, shelf]) => { const z = fitZoom(box, w, h, { right: Math.max(24, shelf) }); return { w, h, shelf, zoom: z, foot: area * z * z / (w * h), box: box.w * box.h * z * z / (w * h) }; }) };
}
const line = (name, f) => `${name.padEnd(40)} ${f.views.map(v => v.zoom.toFixed(1).padStart(5)).join(' ')}  aspect ${f.aspect.toFixed(2)} fill ${f.fill.toFixed(2)}  footprint ${(f.views[0].foot * 100).toFixed(0)}%`;
if (process.argv[1] && process.argv[1].endsWith('layout-report.mjs')) {
  console.log('windows'.padEnd(40), VIEWS.map(([w, h, s]) => `${w}${s ? 's' : ' '}`.padStart(5)).join(' '), ' (s = shelf card open)');
  const old = figures(oldBuilding());
  console.log(line('old: two rows of five', old));
  const bays = args.includes('--all') ? Array.from({ length: 30 }, (_, i) => i + 1) : [+val('bays', baysFor(MIN_ROOMS))];
  for (const b of bays) {
    const f = figures(buildingPlan(b).plinth);
    console.log(line(`${b} bays (${officesIn(b)} offices)`, f), `x${(f.views.reduce((t, v, i) => t + v.zoom / old.views[i].zoom, 0) / f.views.length).toFixed(2)}`);
  }
}
