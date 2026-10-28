import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { FP, POSES, APPEARANCES, workerId, deskId } from '../public/js/pixel/ids.js';
import { layoutOffice } from '../public/js/pixel/layout.js';

const dir = new URL('../public/pixel/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'));

test('manifest: every sprite id the code uses exists with the same footprint, and the other way round', () => {
  for (const [id, fp] of Object.entries(FP)) {
    assert.ok(manifest.sprites[id], `ids.js names ${id}, the manifest has no such sprite`);
    assert.deepEqual(manifest.sprites[id].fp, fp, `${id}: footprint differs between ids.js and the manifest`);
  }
  for (const id of Object.keys(manifest.sprites)) assert.ok(FP[id], `the manifest has ${id}, ids.js does not know it`);
});
test('manifest: every id the layout places and every state of desk and worker exists', () => {
  const L = layoutOffice([{ id: 'x', cls: 2, project: 'p', color: '#fff' }, { id: 'y', cls: 0, project: 'p', color: '#fff' }]);
  const ids = new Set([...L.rooms.flatMap(r => [...r.items, ...r.floor]), ...L.outdoor.items, ...L.outdoor.tiles].map(i => i.id));
  for (const s of ['on', 'idle', 'off']) { ids.add(deskId(true, s)); ids.add(deskId(false, s)); }
  ids.add('chair');
  for (let a = 0; a < APPEARANCES; a++) for (const p of POSES) ids.add(workerId(a, p));
  for (const id of ids) assert.ok(manifest.sprites[id], `${id} is used but not in the manifest`);
});
test('manifest: rectangles and pivots are consistent with the atlas', () => {
  const P = manifest.projections.iso;
  assert.ok(P && existsSync(new URL(P.atlas, dir)));
  for (const [id, s] of Object.entries(manifest.sprites)) {
    const pl = P.sprites[id];
    assert.ok(pl, id + ' has no iso placement');
    assert.equal(pl.rects.length, s.facings, id + ': one rectangle per facing');
    assert.equal(pl.pivots.length, s.facings);
    pl.rects.forEach(([x, y, w, h], k) => {
      assert.ok(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= P.width && y + h <= P.height, `${id}#${k} sticks out of the atlas`);
      const [px, py] = pl.pivots[k];
      assert.ok(px >= 0 && px <= w && py >= 0 && py <= h + 4, `${id}#${k}: pivot outside the sprite`);
    });
  }
});
test('manifest: at least 60 sprites, no river, car, road or traffic, atlas within budget', () => {
  assert.ok(Object.keys(manifest.sprites).length >= 60);
  for (const id of Object.keys(manifest.sprites)) assert.doesNotMatch(id, /river|car|road|traffic/);
  const size = readFileSync(new URL(manifest.projections.iso.atlas, dir)).length;
  assert.ok(size <= 1.5e6, `atlas is ${size} bytes`);
});
test('manifest: no two images overlap in the atlas', () => {
  const P = manifest.projections.iso, rects = Object.values(P.sprites).flatMap(s => s.rects);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const [a, b, c, d] = rects[i], [e, f, g, h] = rects[j];
    assert.ok(!(a < e + g && a + c > e && b < f + h && b + d > f), 'two sprites share atlas pixels');
  }
});
