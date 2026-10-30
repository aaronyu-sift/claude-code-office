import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const third = readFileSync(join(ROOT, 'THIRD_PARTY.md'), 'utf8');

test('THIRD_PARTY.md records every folder of shipped models: author, link, CC0, and the real number of files', () => {
  const dir = join(ROOT, 'public', 'models');
  let files = 0;
  for (const d of readdirSync(dir).filter(d => statSync(join(dir, d)).isDirectory())) {
    assert.ok(third.includes(`public/models/${d}/`), `THIRD_PARTY.md does not list public/models/${d}/`);
    const lic = readFileSync(join(dir, d, 'License.txt'), 'utf8');
    assert.match(lic, /Created\/distributed by Kenney|Kenney/, `${d}/License.txt does not name the author`);
    files += readdirSync(join(dir, d)).filter(f => f.endsWith('.glb')).length;
  }
  assert.match(third, /Kenney/);
  assert.match(third, /Creative Commons Zero \(CC0 1\.0\)/);
  for (const pack of ['furniture-kit', 'nature-kit', 'mini-characters']) assert.ok(third.includes(`https://kenney.nl/assets/${pack}`), `no link to the ${pack} page`);
  assert.ok(third.includes(`Only the ${files} files the scene uses are shipped`), `THIRD_PARTY.md names another number of files than the ${files} that ship`);
  // the one claim about three.js that must stay true: the pixel office does not load it
  assert.match(third, /loaded by the 3D scene \(the default\) and not by the pixel office \(`\?scene=pixel`\)/);
  for (const f of ['GLTFLoader.js', 'BufferGeometryUtils.js', 'SkeletonUtils.js']) assert.ok(third.includes(f), `${f} is vendored but not listed`);
});
