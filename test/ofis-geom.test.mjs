import test from 'node:test';
import assert from 'node:assert/strict';
import { polyOf, bboxOf, inPoly, distToPoly, polyGap, shapeDist, createRouter, rot, headingVec, quarter } from '../public/js/ofis-geom.js';

const close = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} is not ${b}`);

test('rot: the same angle three.js turns a model by about y (ry = PI / 2 sends +z to +x)', () => {
  const [x, z] = rot(0, 1, Math.PI / 2);
  close(x, 1); close(z, 0);
  const [a, b] = rot(1, 0, Math.PI / 2);
  close(a, 0); close(b, -1);
  const h = headingVec(Math.PI / 2);
  close(h[0], 1); close(h[1], 0);
  close(quarter(5), Math.PI / 2); close(quarter(-1), 3 * Math.PI / 2);
});

test('polygons: a box turned by ry, an ellipse as 24 corners, the box around them', () => {
  const box = polyOf({ t: 'box', x: 2, z: 3, w: 2, d: 1, ry: 0 });
  assert.equal(box.length, 4);
  const bb = bboxOf(box);
  close(bb.x0, 1); close(bb.x1, 3); close(bb.z0, 2.5); close(bb.z1, 3.5);
  const turned = bboxOf(polyOf({ t: 'box', x: 2, z: 3, w: 2, d: 1, ry: Math.PI / 2 }));
  close(turned.x0, 1.5); close(turned.x1, 2.5); close(turned.z0, 2); close(turned.z1, 4);
  const el = polyOf({ t: 'ell', x: 0, z: 0, rx: 2, rz: 1, ry: 0 });
  assert.equal(el.length, 24);
  const eb = bboxOf(el);
  close(eb.x1, 2); close(eb.z1, 1, 0.02);
});

test('distances: inside is 0, outside is the least distance to an edge, two polygons have a gap', () => {
  const sq = polyOf({ t: 'box', x: 0, z: 0, w: 2, d: 2, ry: 0 });
  assert.ok(inPoly(0.5, 0.5, sq)); assert.ok(!inPoly(1.5, 0, sq));
  close(distToPoly(0, 0, sq), 0); close(distToPoly(2, 0, sq), 1); close(distToPoly(2, 2, sq), Math.SQRT2);
  close(shapeDist(3, 0, { t: 'box', x: 0, z: 0, w: 2, d: 2, ry: 0 }), 2);
  const other = polyOf({ t: 'box', x: 3, z: 0, w: 2, d: 2, ry: 0 });
  close(polyGap(sq, other), 1);
  close(polyGap(sq, polyOf({ t: 'box', x: 1, z: 0, w: 2, d: 2, ry: 0 })), 0);
  const cross = polyOf({ t: 'box', x: 0, z: 0, w: 5, d: 0.2, ry: 0 });
  close(polyGap(polyOf({ t: 'box', x: 0, z: 0, w: 0.2, d: 5, ry: 0 }), cross), 0);
});

// a room 8 x 6 with a table in the middle, and a closet that no door leads to
function room(extra = []) {
  const table = { id: 'table', poly: polyOf({ t: 'box', x: 4, z: 3, w: 3, d: 1, ry: 0 }) };
  return createRouter({ W: 8, D: 6, obstacles: [table, ...extra] });
}

test('router: a walk from the door to a point on the far side of the table goes round it and keeps its distance', () => {
  const r = room(), t = r.tree([7, 5.4]);
  assert.ok(t.reach(1, 1));
  const p = t.path([1, 1]);
  assert.deepEqual(p[0], [7, 5.4]); assert.deepEqual(p[p.length - 1], [1, 1]);
  const table = polyOf({ t: 'box', x: 4, z: 3, w: 3, d: 1, ry: 0 });
  for (let i = 0; i + 1 < p.length; i++) {
    for (let k = 0; k <= 20; k++) {
      const x = p[i][0] + (p[i + 1][0] - p[i][0]) * k / 20, z = p[i][1] + (p[i + 1][1] - p[i][1]) * k / 20;
      assert.ok(distToPoly(x, z, table) >= 0.27, `the walk is ${distToPoly(x, z, table).toFixed(2)} m from the table at ${x.toFixed(1)}, ${z.toFixed(1)}`);
      assert.ok(Math.min(x, z, 8 - x, 6 - z) >= 0.2, 'and from the walls');
    }
  }
  assert.ok(p.length >= 3, 'it bends round the table');
});

test('router: what a body does not fit through is closed, and a pocket the door cannot reach is not reachable', () => {
  const r = room();
  assert.ok(!r.free(4, 3), 'on the table');
  assert.ok(!r.free(4, 3.7), 'a body next to the table edge touches it');
  assert.ok(r.free(4, 4.2));
  assert.ok(!r.free(0.1, 3), 'inside the wall margin');
  // a wall of boxes shuts the left of the room off
  const wall = [0, 1, 2, 3, 4, 5, 6].map(i => ({ id: 'w' + i, poly: polyOf({ t: 'box', x: 1.5, z: i * 1, w: 0.3, d: 1, ry: 0 }) }));
  const t = room(wall).tree([7, 5.4]);
  assert.ok(!t.reach(0.7, 3), 'behind the wall');
  assert.equal(t.path([0.7, 3]), null);
  assert.ok(t.reach(3, 5));
});

test('router: clearance is the distance to the nearest obstacle or wall (a seat can be left out of it)', () => {
  const r = room();
  close(r.clearance(4, 4.0, null), 0.5, 1e-9);                                  // the table's edge is 0.5 m from here (the wall is 2 m away)
  assert.ok(r.clearance(4, 3.6) < r.clearance(4, 5));
  assert.ok(r.clearance(4, 3.6, new Set(['table'])) > r.clearance(4, 3.6), 'skipping the table opens the cell');
  assert.ok(r.lineClear([1, 1], [1, 5]));
  assert.ok(!r.lineClear([1, 3], [7, 3]), 'a straight line through the table is not clear');
});
