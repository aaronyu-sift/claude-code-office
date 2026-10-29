// The content minimums of plan section 5 and the counting rule that turns them into numbers (see the table "Counting rule" there).
// Used by test/manifest.test.mjs and by `npm run sprites:table`, which prints the table.
export const POSE_MINIMUM = ['typeA', 'typeB', 'think', 'wait', 'sleep', 'stand'];       // 6 appearances x these 6 poses; `relax` is an extra
export const ROWS = [
  { row: 'floors', min: 8, cat: 'floor' },
  { row: 'walls', min: 14, cat: 'wall' },
  { row: 'furniture', min: 24, cat: 'furniture' },
  { row: 'desk props', min: 14, cat: 'deskprop' },
  { row: 'people (appearance x pose)', min: 6 * POSE_MINIMUM.length, people: true },
  { row: 'plants', min: 12, cat: 'plant' },
  { row: 'trees', min: 6, cat: 'tree' },
  { row: 'bushes', min: 4, cat: 'bush' },
  { row: 'hedges', min: 2, cat: 'hedge' },
  { row: 'flower beds', min: 4, cat: 'flowerbed' },
  { row: 'grass tufts', min: 2, cat: 'tuft' },
  { row: 'rocks', min: 4, cat: 'rock' },
  { row: 'outdoor', min: 14, cat: 'outdoor' },
];
export function countRows(manifest) {
  const ids = Object.keys(manifest.sprites).filter(id => !id.includes('@'));            // seasonal variants (Goal 4) are not counted
  const byCat = {};
  for (const id of ids) byCat[manifest.sprites[id].cat] = (byCat[manifest.sprites[id].cat] || 0) + 1;
  return ROWS.map(r => {
    let actual;
    if (r.people) { let n = 0; for (let a = 0; a < 6; a++) for (const p of POSE_MINIMUM) if (manifest.sprites[`worker_${a}_${p}`]) n++; actual = n; }
    else actual = byCat[r.cat] || 0;
    return { ...r, actual, met: actual >= r.min };
  });
}
