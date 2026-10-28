import test from 'node:test';
import assert from 'node:assert/strict';
import { ISO, FRONT } from '../public/js/pixel/projection.js';
import { depthSort } from '../public/js/pixel/depth.js';
import { layoutOffice } from '../public/js/pixel/layout.js';
import { FP } from '../public/js/pixel/ids.js';

const mk = (name, x0, y0, x1, y1, proj = ISO, z = 40) => {
  const [a, b] = proj.toScreen(x0, y0, 0), [c, d] = proj.toScreen(x1, y1, 0), [e, f] = proj.toScreen(x0, y1, z), [g, h] = proj.toScreen(x1, y0, 0);
  const xs = [a, c, e, g], ys = [b, d, f, h];
  const fp = { x0, y0, x1, y1 };
  return { name, fp, key: proj.depthKey(fp, 0), bb: { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys) - z, y1: Math.max(...ys) } };
};
const order = (list, proj = ISO) => depthSort(list, proj).map(i => i.name);

test('a wide desk is drawn before the chair in front of it, whatever their sort keys say', () => {
  const desk = mk('desk', 2, 142, 46, 158), chair = mk('chair', 19, 128, 29, 138);
  assert.ok(desk.key > chair.key, 'this pair is the case a single key gets wrong');
  assert.deepEqual(order([chair, desk]), ['desk', 'chair']);
  assert.deepEqual(order([desk, chair]), ['desk', 'chair']);
});
test('walls come before what stands in front of them, west and north', () => {
  const north = mk('north', 0, 160, 32, 162), west = mk('west', -2, 0, 0, 32), desk = mk('desk', 4, 140, 32, 154), chair = mk('chair', 4, 8, 14, 18);
  const o = order([chair, desk, north, west]);
  assert.ok(o.indexOf('north') < o.indexOf('desk'));
  assert.ok(o.indexOf('west') < o.indexOf('chair'));
});
test('nearer rows are drawn after farther rows', () => {
  const rows = [0, 1, 2].map(r => mk('row' + r, 50, 32 + 40 * r, 78, 46 + 40 * r));
  assert.deepEqual(order([...rows].reverse()), ['row2', 'row1', 'row0']);
});
test('front view orders by y only', () => {
  const far = mk('far', 0, 100, 20, 110, FRONT), near = mk('near', 40, 0, 60, 10, FRONT);
  assert.deepEqual(order([near, far], FRONT), ['far', 'near']);
});
test('every room of a real layout sorts without losing or repeating a sprite', () => {
  const L = layoutOffice([{ id: 'a', cls: 1, project: 'p', color: '#fff' }, { id: 'b', cls: 0, project: 'q', color: '#fff' }]);
  const items = [];
  for (const r of L.rooms) {
    for (const it of r.items) if (it.layer === 'stand') items.push(mk(it.id + items.length, it.x, it.y, it.x + it.w, it.y + it.d));
    for (const s of r.slots) for (const b of [s.desk, s.seat]) items.push(mk('slot' + items.length, b.x, b.y, b.x + b.w, b.y + b.d));
  }
  const out = depthSort(items, ISO);
  assert.equal(out.length, items.length);
  assert.equal(new Set(out).size, items.length);
  assert.ok(Object.keys(FP).length > 0);
});
