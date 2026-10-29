import test from 'node:test';
import assert from 'node:assert/strict';
import { ZOOMS, fitZoom, minZoom, stepZoom, centerPan, clampPan, zoomAbout } from '../public/js/pixel/input.js';

test('zoom levels are whole numbers only', () => {
  assert.deepEqual(ZOOMS, [1, 2, 3, 4, 6]);
  assert.ok(ZOOMS.every(Number.isInteger));
});
test('fit picks the largest zoom that fits and never less than 1', () => {
  assert.equal(fitZoom(600, 350, 1500, 800, 0), 2);
  assert.equal(fitZoom(600, 350, 3000, 1600, 0), 4);
  assert.equal(fitZoom(250, 150, 1500, 900, 24), 4);
  assert.equal(fitZoom(250, 150, 1500, 900, 0), 6);
  assert.equal(fitZoom(5000, 3000, 800, 600), 1);
  assert.equal(fitZoom(700, 400, 1500, 790, 12), 1);              // 1400 + 24 fits the width but 800 + 24 does not fit the height
});
test('stepping moves one level and stops at the ends', () => {
  assert.equal(stepZoom(1, 1), 2); assert.equal(stepZoom(4, 1), 6); assert.equal(stepZoom(6, 1), 6);
  assert.equal(stepZoom(1, -1), 1); assert.equal(stepZoom(3, -1), 2);
});
test('the lowest zoom is the lowest level at which the view still lies inside the world', () => {
  const world = { x0: -900, y0: -500, x1: 900, y1: 500 };                  // 1800 x 1000 virtual px
  assert.equal(minZoom(world, 1500, 900), 1);                              // a plain 1500 x 900 window
  assert.equal(minZoom(world, 2880, 1800), 2);                             // a retina window of 1440 x 900 css px: 1800 x 1000 x 2 covers it
  assert.equal(minZoom(world, 3600, 2000), 2);
  assert.equal(minZoom(world, 3601, 2000), 3);
  assert.equal(minZoom(world, 99999, 99999), 6);                           // a screen larger than the world at every level: the least is outside
  for (const [vw, vh] of [[1500, 900], [2880, 1800], [3456, 2234], [5120, 2880]]) {
    const z = minZoom(world, vw, vh);
    assert.ok(z === 6 || (vw <= 1800 * z && vh <= 1000 * z), `${vw}x${vh}: zoom ${z} covers the view`);
    for (const lower of ZOOMS.filter(q => q < z)) assert.ok(vw > 1800 * lower || vh > 1000 * lower, `${vw}x${vh}: zoom ${lower} would not cover it`);
  }
});
test('stepping down stops at the minimum zoom, stepping up is not limited by it', () => {
  assert.equal(stepZoom(4, -1, 3), 3); assert.equal(stepZoom(3, -1, 3), 3); assert.equal(stepZoom(2, -1, 2), 2);
  assert.equal(stepZoom(3, 1, 3), 4); assert.equal(stepZoom(6, 1, 3), 6);
  assert.equal(stepZoom(1, 1, 3), 3, 'a zoom below the minimum comes up to it');
});
test('centering and zooming about a point keep that point fixed', () => {
  const b = { x0: -100, y0: -50, x1: 400, y1: 250 };
  const [px, py] = centerPan(b, 2, 1500, 800);
  assert.equal(px + ((b.x0 + b.x1) / 2) * 2, 750);
  assert.equal(py + ((b.y0 + b.y1) / 2) * 2, 400);
  const [qx, qy] = zoomAbout([px, py], 2, 4, 300, 200);
  assert.equal(Math.round((300 - qx) / 4), Math.round((300 - px) / 2));
  assert.equal(Math.round((200 - qy) / 4), Math.round((200 - py) / 2));
});
test('panning keeps the view inside the world on every side', () => {
  const b = { x0: -900, y0: -500, x1: 900, y1: 500 }, vw = 1500, vh = 900, z = 2;
  for (const [px, py] of [[-99999, 99999], [99999, -99999], [-99999, -99999], [99999, 99999], [0, 0]]) {
    const [x, y] = clampPan([px, py], b, z, vw, vh);
    assert.ok(x <= -b.x0 * z && x + b.x1 * z >= vw, `x ${x} for ${px}: the left and right edge of the world are outside the view`);
    assert.ok(y <= -b.y0 * z && y + b.y1 * z >= vh, `y ${y} for ${py}: the top and bottom edge of the world are outside the view`);
  }
  assert.deepEqual(clampPan([100, -50], b, z, vw, vh), [100, -50], 'a pan that is inside is left alone');
});
test('a world smaller than the view on an axis is centred on it', () => {
  const b = { x0: 0, y0: 0, x1: 400, y1: 300 };
  const [x, y] = clampPan([-99999, 99999], b, 2, 1500, 800);
  assert.equal(x + 200 * 2, 750); assert.equal(y + 150 * 2, 400);
});
