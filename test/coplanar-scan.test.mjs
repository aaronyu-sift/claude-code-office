// The coplanar scan (tools/qa/coplanar-scan.mjs) on made-up scenes: what it must find, and what it must leave alone. The scan of the real scene is tools/qa/office3d-coplanar-qa.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanCoplanar, clip, colourGap, DD, MIN_AREA } from '../tools/qa/coplanar-scan.mjs';

// a horizontal square facing up: two triangles; x0, z0 .. x1, z1 at height y
const top = (x0, z0, x1, z1, y, col, o = {}) => [
  { a: [x0, y, z0], b: [x0, y, z1], c: [x1, y, z0], col, tex: o.tex || '', mesh: o.mesh || 0 },
  { a: [x0, y, z1], b: [x1, y, z1], c: [x1, y, z0], col, tex: o.tex || '', mesh: o.mesh || 0 },
];
const RED = 0xcc3322, BLUE = 0x2233cc;

test('coplanar: two squares in one plane with different colours are a tie', () => {
  const found = scanCoplanar([...top(0, 0, 2, 2, 0, RED), ...top(1, 1, 3, 3, 0, BLUE)], { occlude: false });
  assert.equal(found.length > 0, true);
  const area = found.reduce((s, g) => s + g.area, 0);
  assert.ok(Math.abs(area - 1) < 1e-6, `the overlap is 1 m2, got ${area}`);
  assert.deepEqual(found[0].n.map(v => Math.round(v) + 0), [0, 1, 0]);
});

test('coplanar: the same colour, or a gap of 12 mm, or a tiny overlap, or a facing apart, is no tie', () => {
  assert.equal(scanCoplanar([...top(0, 0, 2, 2, 0, RED), ...top(1, 1, 3, 3, 0, RED)], { occlude: false }).length, 0, 'the same colour: nothing to see');
  assert.equal(scanCoplanar([...top(0, 0, 2, 2, 0, RED), ...top(1, 1, 3, 3, 0.012, BLUE)], { occlude: false }).length, 0, '12 mm apart');
  assert.equal(scanCoplanar([...top(0, 0, 2, 2, 0, RED), ...top(1.95, 1.95, 3, 3, 0, BLUE)], { occlude: false }).length, 0, 'an overlap of 0.0025 m2');
  const down = top(1, 1, 3, 3, 0, BLUE).map(t => ({ ...t, b: t.c, c: t.b }));                      // turned over: faces down, not the same facing
  assert.equal(scanCoplanar([...top(0, 0, 2, 2, 0, RED), ...down], { occlude: false }).length, 0, 'facing apart');
});

test('coplanar: the rule is 10 mm: 2, 4 and 9 mm are ties, 10 and 12 mm are not', () => {
  for (const mm of [0, 2, 4, 5, 9]) assert.ok(scanCoplanar([...top(0, 0, 2, 2, 0, RED), ...top(0, 0, 2, 2, mm / 1000, BLUE)], { occlude: false }).length > 0, `${mm} mm`);
  for (const mm of [10, 12, 30]) assert.equal(scanCoplanar([...top(0, 0, 2, 2, 0, RED), ...top(0, 0, 2, 2, mm / 1000, BLUE)], { occlude: false }).length, 0, `${mm} mm`);
  assert.ok(DD < 0.01 && DD > 0.009, 'the threshold sits between a 9 mm and a 10 mm gap');
});

test('coplanar: two textures of one colour differ, one texture twice does not', () => {
  assert.ok(scanCoplanar([...top(0, 0, 2, 2, 0, 0xffffff, { tex: 1 }), ...top(0, 0, 2, 2, 0, 0xffffff, { tex: 2 })], { occlude: false }).length > 0);
  assert.equal(scanCoplanar([...top(0, 0, 2, 2, 0, 0xffffff, { tex: 1 }), ...top(0, 0, 2, 2, 0, 0xffffff, { tex: 1 })], { occlude: false }).length, 0);
});

test('coplanar: a wall face (a plane that is not horizontal) is found the same way', () => {
  const wall = (z, x0, x1, y1, col) => [{ a: [x0, 0, z], b: [x1, 0, z], c: [x0, y1, z], col, tex: '', mesh: 0 }, { a: [x1, 0, z], b: [x1, y1, z], c: [x0, y1, z], col, tex: '', mesh: 0 }];
  const found = scanCoplanar([...wall(5, 0, 3, 2, RED), ...wall(5.003, 1, 4, 2, BLUE)], { occlude: false });
  assert.ok(found.length > 0);
  assert.deepEqual(found[0].n.map(v => Math.round(v) + 0), [0, 0, 1]);
  assert.ok(Math.abs(found.reduce((s, g) => s + g.area, 0) - 4) < 1e-6, 'the overlap is 2 x 2 m');
});

test('coplanar: a tie that something nearer covers is not seen from the camera', () => {
  const ties = [...top(0, 0, 2, 2, 0, RED), ...top(0, 0, 2, 2, 0.004, BLUE)];
  // a roof over all of it, 0.5 m up and wide enough that every ray along the view meets it
  const roof = top(-4, -4, 8, 8, 0.5, 0x888888);
  assert.equal(scanCoplanar([...ties, ...roof]).length, 0, 'covered');
  assert.equal(scanCoplanar([...ties, ...roof]).hidden > 0, true, 'and counted as covered');
  assert.ok(scanCoplanar(ties).length > 0, 'nothing over it: seen');
  assert.ok(scanCoplanar([...ties, ...top(20, 20, 22, 22, 0.5, 0x888888)]).length > 0, 'a roof elsewhere covers nothing');
  assert.ok(scanCoplanar([...ties, ...top(-4, -4, 1, 8, 0.5, 0x888888)]).length > 0, 'a roof over half of it leaves the other half seen');
  assert.equal(scanCoplanar([...ties, ...roof], { occlude: false }).length > 0, true, 'without the cover test the pair stays');
});

test('coplanar: the ray starts clear of the layers of the pair itself (a third layer 8 mm up does not cover it)', () => {
  const found = scanCoplanar([...top(0, 0, 2, 2, 0, RED), ...top(0, 0, 2, 2, 0.003, BLUE), ...top(0, 0, 2, 2, 0.008, 0x44aa44)]);
  assert.ok(found.length > 0);
});

test('coplanar: the clip of two convex polygons is their overlap, and the colour gap is the largest channel', () => {
  const sq = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const c = clip(sq(0, 0, 2, 2), sq(1, 1, 3, 3));
  const area = Math.abs(c.reduce((s, p, i) => s + (p[0] * c[(i + 1) % c.length][1] - c[(i + 1) % c.length][0] * p[1]), 0) / 2);
  assert.ok(Math.abs(area - 1) < 1e-9);
  assert.ok(clip(sq(0, 0, 1, 1), sq(2, 2, 3, 3)).length < 3, 'two squares apart share nothing');
  assert.equal(colourGap(0x102030, 0x182838), 8);
  assert.equal(MIN_AREA, 0.01);
});
