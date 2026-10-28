import test from 'node:test';
import assert from 'node:assert/strict';
import { ZOOMS, fitZoom, stepZoom, centerPan, clampPan, zoomAbout } from '../public/js/pixel/input.js';

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
test('centering and zooming about a point keep that point fixed', () => {
  const b = { x0: -100, y0: -50, x1: 400, y1: 250 };
  const [px, py] = centerPan(b, 2, 1500, 800);
  assert.equal(px + ((b.x0 + b.x1) / 2) * 2, 750);
  assert.equal(py + ((b.y0 + b.y1) / 2) * 2, 400);
  const [qx, qy] = zoomAbout([px, py], 2, 4, 300, 200);
  assert.equal(Math.round((300 - qx) / 4), Math.round((300 - px) / 2));
  assert.equal(Math.round((200 - qy) / 4), Math.round((200 - py) / 2));
});
test('panning cannot throw the whole scene out of the view', () => {
  const b = { x0: 0, y0: 0, x1: 600, y1: 300 };
  const far = clampPan([-99999, 99999], b, 2, 1500, 800);
  assert.ok(far[0] + b.x1 * 2 >= 80);
  assert.ok(far[1] + b.y0 * 2 <= 800 - 80);
});
