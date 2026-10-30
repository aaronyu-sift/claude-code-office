// How well the 3D building uses the screen (headless Chrome with software WebGL, throw-away profile, one scene at a time):
//   node tools/qa/office3d-map.mjs [--root <copy of the repo>] [--sizes 1440x900,1920x1080] [--n 3,10] [--query rooms=21] [--shots <dir> --label <name>] [--json]
// For every window size and number of chats it opens the Office on ?scene=3d, lets the automatic view fit the building and reads, with the
// scene's own projection (`s.project`): the fit zoom, the box the building takes on the screen, the share of the window that box and the building's
// footprint cover, and the aspect of the box against 16:10 and 16:9. --root serves another copy of the repo (the layout before the change, for a
// comparison); --shots writes one picture per size and number of chats named <label>-<WxH>-<n>chats.png.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { scenario3d, o3, sleep } from './harness3d.mjs';
import { MEASURE } from './map-measure.mjs';

const args = process.argv.slice(2);
const val = (f, d) => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : d; };
const root = val('root'), shotsDir = val('shots'), label = val('label', 'map'), query = val('query', '');       // --query rooms=21: a building grown past the hexagon
const sizes = val('sizes', '1440x900,1920x1080,1280x800,1100x700').split(',').map(s => s.split('x').map(Number));
const counts = val('n', '3,10').split(',').map(Number);

if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const rows = [];
for (const [width, height] of sizes) {
  for (const n of counts) {
    const S = await scenario3d(n, { tag: `map${width}x${height}`, root, width, height, query });
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
