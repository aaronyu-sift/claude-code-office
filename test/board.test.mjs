import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD, boardFonts, boardFrame, frameCorners, frameStrips, frameHit, quadHitsRect } from '../public/js/pixel/board.js';
import { ISO, FRONT } from '../public/js/pixel/projection.js';
import { G } from '../public/js/pixel/layout.js';

const ROOM = { x: 0, y: 0, w: 128, d: 160, walls: { north: 'tall', west: 'tall' } };
// CSS px of a world point at a scale (CSS px per virtual px), with no pan
const atOf = (proj, scale) => (x, y, z) => proj.toScreen(x, y, z).map(v => v * scale);

test('board: the name is never smaller than it can be read and never above the cap; the small text is always smaller', () => {
  assert.deepEqual(boardFonts(1), { name: 12, small: 9 });
  assert.deepEqual(boardFonts(2), { name: 16, small: 10 });
  assert.deepEqual(boardFonts(3), { name: 24, small: 15 });
  assert.equal(boardFonts(6).name, BOARD.MAX_FONT);
  for (const s of [0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8]) {
    const f = boardFonts(s);
    assert.ok(f.name >= BOARD.MIN_FONT && f.name <= BOARD.MAX_FONT, `name at ${s}`);
    assert.ok(f.small < f.name && f.small >= 9, `small at ${s}`);
  }
});

test('board: in the isometric view the plate stands on the wall top, centred, as wide as the wall allows, sheared to the wall slope', () => {
  const f = boardFrame(ROOM, ISO, atOf(ISO, 2), 2);
  const [cx, cy] = atOf(ISO, 2)(64, 160 + G.WALL_T / 2, G.WALL_H - BOARD.SINK);
  assert.ok(Math.abs(f.ax - cx) < 1e-9 && Math.abs(f.ay - cy) < 1e-9, 'bottom centre is the middle of the wall top');
  assert.equal(f.tan, 0.5);
  assert.ok(Math.abs(f.w - 128 * 0.75 * 2 * BOARD.SHARE) < 1e-9, 'a share of the wall as it looks on screen');
  assert.equal(f.ok, true);
  assert.deepEqual(f.fonts, boardFonts(2));
});

test('board: in the front view the plate is straight; a low wall carries it lower; a wall that looks narrow carries none', () => {
  const front = boardFrame(ROOM, FRONT, atOf(FRONT, 2), 2);
  assert.equal(front.tan, 0);
  assert.ok(Math.abs(front.w - 128 * 2 * BOARD.SHARE) < 1e-9);
  const tall = boardFrame(ROOM, ISO, atOf(ISO, 2), 2), low = boardFrame({ ...ROOM, walls: { north: 'low', west: 'low' } }, ISO, atOf(ISO, 2), 2);
  assert.ok(low.ay > tall.ay, 'a low wall is lower on screen');
  assert.ok(Math.abs((low.ay - tall.ay) - (G.WALL_H - G.LOW_H) * ISO.toScreen(0, 0, 1)[1] * -2) < 1e-9, 'by the difference of the wall heights');
  assert.equal(boardFrame(ROOM, ISO, atOf(ISO, 0.4), 0.4).ok, false, 'at a scale where the wall is 40 px wide there is no board');
  const wide = boardFrame({ ...ROOM, w: 256 }, ISO, atOf(ISO, 6), 6);
  assert.ok(wide.w <= wide.fonts.name * BOARD.EM_MAX + 1e-9, 'a very wide wall does not make a very wide plate');
});

test('board: the corners, strips and hit test agree with each other', () => {
  const f = { ax: 200, ay: 100, w: 120, tan: 0.5 }, h = 30;
  const q = frameCorners(f, h);
  assert.deepEqual(q, [[140, 70], [260, 130], [260, 100], [140, 40]]);
  const strips = frameStrips(f, h, 6);
  assert.equal(strips.length, 6);
  assert.ok(Math.abs(strips.reduce((s, r) => s + r.w, 0) - 120) < 1e-9);
  for (const [x, y] of q) assert.ok(strips.some(r => x >= r.x - 1e-9 && x <= r.x + r.w + 1e-9 && y >= r.y - 1e-9 && y <= r.y + r.h + 1e-9), 'every corner is in a strip');
  const area = strips.reduce((s, r) => s + r.w * r.h, 0), box = 120 * (130 - 40);
  assert.ok(area < box * 0.7, 'the strips follow the slope, they are not one big box');
  assert.equal(frameHit(f, h, 200, 85), true);
  assert.equal(frameHit(f, h, 259, 129), true, 'just inside the bottom right corner');
  assert.equal(frameHit(f, h, 141, 129), false, 'the same height at the left is below the plate');
  assert.equal(frameHit(f, h, 141, 41), true, 'just inside the top left corner');
  assert.equal(frameHit(f, h, 259, 41), false, 'the same height at the right is above the plate');
  assert.equal(frameHit(f, h, 139, 60), false); assert.equal(frameHit(f, h, 261, 120), false);
  assert.equal(frameHit({ ...f, tan: 0 }, h, 200, 80), true); assert.equal(frameHit({ ...f, tan: 0 }, h, 200, 60), false);
});

test('board: a label touches a board only where the sheared plate is, not where its box is empty', () => {
  const q = frameCorners({ ax: 0, ay: 0, w: 100, tan: 0.5 }, 20);          // (-50,-25) (50,25) (50,5) (-50,-45)
  assert.equal(quadHitsRect(q, { x: 40, y: 5, w: 10, h: 10 }), true, 'on the plate');
  assert.equal(quadHitsRect(q, { x: 40, y: -45, w: 10, h: 10 }), false, 'in the empty corner of the plate\'s box');
  assert.equal(quadHitsRect(q, { x: -50, y: 15, w: 20, h: 10 }), false, 'in the other empty corner');
  assert.equal(quadHitsRect(q, { x: -10, y: -40, w: 20, h: 60 }), true, 'across it');
  assert.equal(quadHitsRect(q, { x: 60, y: 0, w: 20, h: 20 }), false, 'beside it');
  assert.equal(quadHitsRect(q, { x: 52, y: 10, w: 10, h: 10 }), false); assert.equal(quadHitsRect(q, { x: 52, y: 10, w: 10, h: 10 }, 3), true, 'the pad is room to spare');
  const flat = frameCorners({ ax: 0, ay: 0, w: 100, tan: 0 }, 20);
  assert.equal(quadHitsRect(flat, { x: 0, y: -30, w: 10, h: 20 }), true); assert.equal(quadHitsRect(flat, { x: 0, y: -50, w: 10, h: 20 }), false);
});
