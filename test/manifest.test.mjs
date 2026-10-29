import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { FP, POSES, APPEARANCES, workerId, deskId } from '../public/js/pixel/ids.js';
import { layoutOffice } from '../public/js/pixel/layout.js';
import { countRows, POSE_MINIMUM } from '../tools/sprites/content-minimums.mjs';

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
const PROJS = ['iso', 'front'];
for (const name of PROJS) test(`manifest: ${name}: rectangles and pivots are consistent with the atlas`, () => {
  const P = manifest.projections[name];
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
  for (const name of PROJS) {
    const size = readFileSync(new URL(manifest.projections[name].atlas, dir)).length;
    assert.ok(size <= 1.5e6, `${name} atlas is ${size} bytes`);
  }
});
test('manifest: both projections place the same sprites with the same number of facings', () => {
  assert.deepEqual(Object.keys(manifest.projections.iso.sprites), Object.keys(manifest.projections.front.sprites));
  for (const id of Object.keys(manifest.sprites)) assert.equal(manifest.projections.iso.sprites[id].rects.length, manifest.projections.front.sprites[id].rects.length, id);
});
for (const name of PROJS) test(`manifest: ${name}: no two images overlap in the atlas`, () => {
  const P = manifest.projections[name], rects = Object.values(P.sprites).flatMap(s => s.rects);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const [a, b, c, d] = rects[i], [e, f, g, h] = rects[j];
    assert.ok(!(a < e + g && a + c > e && b < f + h && b + d > f), 'two sprites share atlas pixels');
  }
});

test('manifest: the content minimums of plan section 5 are met (counting rule in the plan)', () => {
  for (const r of countRows(manifest)) assert.ok(r.met, `${r.row}: ${r.actual} of ${r.min}`);
  for (let a = 0; a < APPEARANCES; a++) for (const p of POSE_MINIMUM) assert.ok(manifest.sprites[workerId(a, p)], `appearance ${a} has no ${p} pose`);
});
test('manifest: every sprite id used by the layout props and every animated or lit sprite has what the scene reads', () => {
  const L = layoutOffice([{ id: 'x', cls: 2, project: 'p', color: '#fff' }]);
  for (const pr of L.rooms[0].props) assert.equal(manifest.sprites[pr.id].cat, 'deskprop');
  for (const name of PROJS) for (const [id, s] of Object.entries(manifest.sprites)) {
    const P = manifest.projections[name];
    if (s.tags.includes('lit')) assert.ok(P.sprites[id].anchors, `${id} is tagged lit but has no light anchors`);
    if (P.sprites[id].anchors) assert.equal(P.sprites[id].anchors.length, s.facings, `${id}: anchors per facing`);
  }
});
test('manifest: only small things animate (sway and steam sprites are at most 36 x 48 px)', () => {
  const moving = Object.entries(manifest.sprites).filter(([, s]) => s.tags.includes('sway') || s.tags.includes('steam'));
  assert.ok(moving.length >= 10);
  for (const name of PROJS) for (const [id] of moving) for (const [, , w, h] of manifest.projections[name].sprites[id].rects) assert.ok(w <= 36 && h <= 48, `${name}: ${id} is ${w} x ${h} px, too big to animate`);
});
