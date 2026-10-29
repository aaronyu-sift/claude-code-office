import test from 'node:test';
import assert from 'node:assert/strict';
import { placeCard } from '../public/js/pixel/cardplace.js';

const B = { x0: 0, y0: 0, x1: 1200, y1: 800 };
const CARD = { w: 340, h: 360 };
const inside = (p, card, b, m = 8) => p.x >= b.x0 + m && p.y >= b.y0 + m && p.x + card.w <= b.x1 - m && p.y + card.h <= b.y1 - m;
const hit = (p, card, a) => p.x < a.x + a.w && p.x + card.w > a.x && p.y < a.y + a.h && p.y + card.h > a.y;

test('card: it sits to the right of an agent with the gap, level with it', () => {
  const a = { x: 300, y: 400, w: 40, h: 60 };
  const p = placeCard({ anchor: a, card: CARD, bounds: B });
  assert.equal(p.side, 'right');
  assert.equal(p.x, 300 + 40 + 14);
  assert.equal(p.y, Math.round(430 - 180));
  assert.deepEqual(p.tail, { side: 'left', at: 180 });
});

test('card: near the right edge it flips to the left, near the bottom it slides up, and it stays inside the bounds', () => {
  const a = { x: 1100, y: 740, w: 40, h: 60 };
  const p = placeCard({ anchor: a, card: CARD, bounds: B });
  assert.equal(p.side, 'left');
  assert.ok(inside(p, CARD, B) && !hit(p, CARD, a));
  assert.equal(p.y, 800 - 8 - 360);
  assert.equal(p.tail.at, 770 - p.y, 'the pointer still points at the agent');
});

test('card: a shelf row prefers the left, where the scene is', () => {
  const row = { x: 940, y: 200, w: 236, h: 52 };
  const p = placeCard({ anchor: row, card: CARD, bounds: B, prefer: 'left' });
  assert.equal(p.side, 'left');
  assert.equal(p.x, 940 - 14 - 340);
  assert.ok(inside(p, CARD, B) && !hit(p, CARD, row));
});

test('card: when neither side has room it goes below or above, centred on the agent where possible', () => {
  const narrow = { x0: 0, y0: 0, x1: 380, y1: 900 };
  const a = { x: 170, y: 300, w: 40, h: 60 };
  const p = placeCard({ anchor: a, card: CARD, bounds: narrow });
  assert.equal(p.side, 'below');
  assert.ok(inside(p, CARD, narrow) && !hit(p, CARD, a));
  const low = placeCard({ anchor: { x: 170, y: 700, w: 40, h: 60 }, card: CARD, bounds: narrow });
  assert.equal(low.side, 'above');
  assert.ok(inside(low, CARD, narrow));
});

test('card: in a window too small for any side it docks in the corner farthest from the agent and never leaves the bounds', () => {
  const tiny = { x0: 0, y0: 0, x1: 380, y1: 400 };
  const a = { x: 150, y: 150, w: 40, h: 60 };
  const p = placeCard({ anchor: a, card: CARD, bounds: tiny });
  assert.equal(p.side, 'dock');
  assert.equal(p.tail, null);
  assert.ok(p.x >= 8 && p.y >= 8);
  const huge = placeCard({ anchor: a, card: { w: 500, h: 900 }, bounds: tiny });
  assert.ok(huge.x === 8 && huge.y === 8, 'a card bigger than the bounds starts at the margin');
});

test('card: every anchor in a grid gets a card inside the bounds, and one that does not cover it unless it docked', () => {
  for (let x = 0; x <= 1160; x += 40) for (let y = 0; y <= 740; y += 37) for (const prefer of ['right', 'left']) {
    const a = { x, y, w: 40, h: 60 }, p = placeCard({ anchor: a, card: CARD, bounds: B, prefer });
    assert.ok(inside(p, CARD, B), `${x},${y} ${prefer}: ${JSON.stringify(p)}`);
    if (p.side !== 'dock') assert.ok(!hit(p, CARD, a), `${x},${y} ${prefer} covers its agent: ${JSON.stringify(p)}`);
    if (p.tail) assert.ok(p.tail.at >= 22 && p.tail.at <= (p.tail.side === 'left' || p.tail.side === 'right' ? CARD.h : CARD.w) - 22);
  }
});
