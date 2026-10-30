// Design aid (not part of the app): the named arrangements of the compact 3D map, scored the same way. Run: node tools/layout-candidates.mjs [--set options|plus]
// An arrangement is a list of hall rows, top to bottom; bay(c0, n) is n bays side by side from column c0 (columns in half-bay steps).
import { baseline, VIEWS, scoreRows0 } from './layout-explore-lib.mjs';

const bay = (c0, n = 1) => ({ b: { c0, n }, f: { c0, n } });
const cells = (b, f) => ({ b: { c0: b[0], n: b[1] }, f: { c0: f[0], n: f[1] } });
const SETS = {
  options: {
    'A plus, the X on the screen (5 bays, 10 cells)': [bay(1), bay(0, 3), bay(1)],
    'B block, two hall rows of 3 and 2 bays stitched at the half bay (5 bays)': [bay(0, 3), bay(0.5, 2)],
    'B2 block, 3 and 2 bays flush right (5 bays)': [bay(0, 3), bay(1, 2)],
    'B3 block 2 x 3 bays (6 bays, 12 cells)': [bay(0, 3), bay(0, 3)],
    'C ring around a courtyard, 3 x 3 bays (8 bays, 16 cells)': [bay(0, 3), bay(0, 1), bay(0, 3)],
    'D hexagon 3-6-3 cells (12 cells)': [cells([1.5, 1], [1, 2]), cells([0, 3], [0, 3]), cells([1, 2], [1.5, 1])],
  },
  plus: {
    'plus (5 bays)': [bay(1), bay(0, 3), bay(1)],
    'plus + W tip: middle 4 bays, arms at col 1 (6 bays)': [bay(1), bay(0, 4), bay(1)],
    'plus arms centred over a 4-bay middle (6 bays)': [bay(1.5), bay(0, 4), bay(1.5)],
    'plus + N tip: N arm 2 bays stacked (6 bays)': [bay(1), bay(1), bay(0, 3), bay(1)],
    'plus + N tip + S tip (7 bays)': [bay(1), bay(1), bay(0, 3), bay(1), bay(1)],
    'plus + one corner bay (6 bays)': [bay(1, 2), bay(0, 3), bay(1)],
    'plus + two opposite corner bays (7 bays)': [bay(1, 2), bay(0, 3), bay(0, 2)],
    'plus, arms half-offset (5 bays)': [bay(0.5), bay(0, 3), bay(1.5)],
  },
};
const args = process.argv.slice(2), set = SETS[args.includes('--set') ? args[args.indexOf('--set') + 1] : 'options'];
const base = baseline();
const fmt = s => VIEWS.map((v, i) => s.per[i].z.toFixed(1)).join(' ');
console.log('views', VIEWS.map(v => v.join('x')).join(' | '));
console.log('now: two rows of five (10 cells)'.padEnd(72), fmt(base), 'aspect', base.aspect.toFixed(2), 'fill', base.fill.toFixed(2));
for (const [name, rows] of Object.entries(set)) {
  const s = scoreRows0(rows), rel = s.per.reduce((t, p, i) => t + p.z / base.per[i].z, 0) / s.per.length;
  console.log(name.padEnd(72), fmt(s), 'aspect', s.aspect.toFixed(2), 'fill', s.fill.toFixed(2), 'x' + rel.toFixed(2), 'cells', s.cells, 'foot% (1440x900)', (s.per[0].foot * 100).toFixed(0));
}
