// Renders the sprite catalog into public/pixel/atlas-<proj>.png and manifest.json, or with --check verifies that the committed files
// are identical to a fresh render (determinism). Needs bun and the pinned VoxPix checkout in .tools/voxpix (see README.md).
//   node tools/sprites/build-atlas.mjs --proj iso [--check] [--out <dir>] [--only <id-prefix>] [--sheet <png>]
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const here = new URL('.', import.meta.url).pathname;
const voxpix = process.env.VOXPIX_DIR || new URL('../../.tools/voxpix', import.meta.url).pathname;
if (!existsSync(voxpix + '/src/core/index.ts')) {
  console.error(`VoxPix not found at ${voxpix}\n  git clone https://github.com/andyeswong/voxpix .tools/voxpix && git -C .tools/voxpix checkout c8e9843`);
  process.exit(2);
}
const r = spawnSync('bun', [here + 'atlas.ts', ...process.argv.slice(2)], { stdio: 'inherit' });
if (r.error) { console.error('could not run bun: ' + r.error.message); process.exit(2); }
process.exit(r.status ?? 1);
