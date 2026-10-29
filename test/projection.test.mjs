import test from 'node:test';
import assert from 'node:assert/strict';
import { ISO, FRONT, TILE, FACINGS, screenBounds } from '../public/js/pixel/projection.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

for (const proj of [ISO, FRONT]) {
  test(`${proj.name}: toGround inverts toScreen for ground and raised points`, () => {
    for (const [x, y, z] of [[0, 0, 0], [16, 0, 0], [0, 16, 0], [37, 91, 0], [-20, 44, 12], [250, 300, 30], [3.5, 7.25, 38]]) {
      const [sx, sy] = proj.toScreen(x, y, z);
      const [gx, gy] = proj.toGround(sx, sy, z);
      near(gx, x, 1e-7); near(gy, y, 1e-7);
    }
  });

  test(`${proj.name}: height moves a point straight up the screen`, () => {
    const [x0, y0] = proj.toScreen(40, 24, 0);
    const [x1, y1] = proj.toScreen(40, 24, 30);
    near(x0, x1);
    assert.ok(y1 < y0);
  });

  test(`${proj.name}: facings are quarter turns and wrap around`, () => {
    assert.equal(FACINGS, 4);
    near(proj.facingYaw(4) - proj.facingYaw(0), 0);
    near(proj.facingYaw(1) - proj.facingYaw(0), 90);
    near(proj.facingYaw(-1) - proj.facingYaw(3), 0);
    assert.deepEqual(proj.rotateFootprint(28, 14, 0), [28, 14]);
    assert.deepEqual(proj.rotateFootprint(28, 14, 1), [14, 28]);
    assert.deepEqual(proj.rotateFootprint(28, 14, 2), [28, 14]);
  });
}

test('iso: a tile is a clean 24 x 12 px diamond', () => {
  const [ax, ay] = ISO.toScreen(TILE, 0, 0);
  const [bx, by] = ISO.toScreen(0, TILE, 0);
  near(ax, 12); near(ay, 6); near(bx, 12); near(by, -6);
  assert.deepEqual(ISO.tile, [24, 12]);
});

test('iso: north and west walls are the far sides, painter order puts the nearer box later', () => {
  assert.deepEqual(ISO.wallSides, ['north', 'west']);
  const far = { x0: 0, y0: 100, x1: 20, y1: 120 };          // north-west of the other box
  const near_ = { x0: 40, y0: 0, x1: 60, y1: 20 };
  assert.ok(ISO.depthKey(near_) > ISO.depthKey(far));
  // a desk in front (south) of a north wall piece is drawn after it
  const wall = { x0: 0, y0: 128, x1: 32, y1: 130 };
  const desk = { x0: 4, y0: 110, x1: 32, y1: 124 };
  assert.ok(ISO.depthKey(desk) > ISO.depthKey(wall));
  // a desk east of a west wall piece is drawn after it
  const west = { x0: -2, y0: 0, x1: 0, y1: 32 };
  const desk2 = { x0: 4, y0: 4, x1: 32, y1: 18 };
  assert.ok(ISO.depthKey(desk2) > ISO.depthKey(west));
});

test('front: only the north wall faces the camera and nearer (smaller y) is drawn later', () => {
  assert.deepEqual(FRONT.wallSides, ['north']);
  assert.ok(FRONT.depthKey({ x0: 0, y0: 0, x1: 10, y1: 10 }) > FRONT.depthKey({ x0: 0, y0: 50, x1: 10, y1: 60 }));
});

test('screenBounds covers all corners of a box', () => {
  const b = screenBounds(ISO, 0, 0, 96, 128, 30);
  near(b.x0, 0); near(b.x1, 0.75 * (96 + 128));
  near(b.w, 0.75 * 224);
  assert.ok(b.y0 < 0 && b.y1 > 0);
  const f = screenBounds(FRONT, 0, 0, 96, 128, 30);
  near(f.w, 96); near(f.h, 0.75 * 128 + 30);
});

// The layout and the scene ask the Projection, they never look at which one it is.
import { readFileSync, readdirSync } from 'node:fs';
test('layout, scene and the other pixel modules do not branch on the projection name', () => {
  const dir = new URL('../public/js/pixel/', import.meta.url);
  const allowed = new Set(['projection.js', 'index.js', 'gallery.js']);      // the view chooses and stores a name, the gallery loads an atlas by name
  const files = readdirSync(dir).filter(f => f.endsWith('.js') && !allowed.has(f));
  assert.ok(files.includes('layout.js') && files.includes('scene.js'));
  for (const f of files) {
    const code = readFileSync(new URL(f, dir), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert.doesNotMatch(code, /['"`](iso|front)['"`]/, `${f} names a projection`);
    assert.doesNotMatch(code, /proj(ection)?\.name\s*[!=]==?/, `${f} compares the projection name`);
    assert.doesNotMatch(code, /\bFRONT\b/, `${f} uses the FRONT projection directly`);
  }
});
