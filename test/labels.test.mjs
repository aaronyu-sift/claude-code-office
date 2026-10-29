import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapText, placeLabels, cellWidth } from '../public/js/pixel/labels.js';

const NAME120 = 'Investigate the intermittent Mezmo ingestion lag on the stg1 pipeline after the node-group move and write up what we found so far'.slice(0, 120);
test('wrapping never cuts or drops text', () => {
  for (const text of ['short', NAME120, 'a'.repeat(120), 'word '.repeat(30).trim(), 'Valkey migration 🚀 plan: CAS draft PR and TTL bug', '日本語のチャット名を折り返してもすべて表示する必要があります']) {
    const lines = wrapText(text, 22);
    assert.equal(lines.join(' ').replace(/\s+/g, ' ').replace(/ /g, '') , text.replace(/\s+/g, ''), 'text changed');
    assert.ok(!lines.join('').includes('…'));
    for (const l of lines) assert.ok([...l].reduce((s, ch) => s + cellWidth(ch), 0) <= 22, `line too wide: ${l}`);
  }
});
test('a 120 character name takes at most 5 lines at the width of a label (28 cells)', () => {
  assert.equal(NAME120.length, 120);
  assert.ok(wrapText(NAME120, 28).length <= 5);
  assert.equal(wrapText('', 22).length, 1);
});
test('wide characters count as two cells', () => {
  assert.equal(cellWidth('a'), 1); assert.equal(cellWidth('日'), 2); assert.equal(cellWidth('🚀'), 2);
});
const rect = (p, it) => ({ x0: p.x, y0: p.y, x1: p.x + it.w, y1: p.y + it.h });
const hit = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
test('declutter: 20 labels on a staggered grid get non-overlapping boxes inside the view', () => {
  const items = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) items.push({ id: `l${r}${c}`, ax: 180 + c * 150 + r * 75, ay: 160 + r * 120 - c * 30, w: 120 + ((r * 5 + c) % 3) * 20, h: 34 + ((r + c) % 3) * 14, pri: 100, force: true });
  const out = placeLabels(items, 1500, 790);
  const boxes = items.map(it => [it, out.get(it.id)]);
  for (const [it, p] of boxes) { assert.ok(p.ok, it.id + ' not placed'); assert.ok(p.x >= 0 && p.y >= 0 && p.x + it.w <= 1500 && p.y + it.h <= 790); }
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!hit(rect(boxes[i][1], boxes[i][0]), rect(boxes[j][1], boxes[j][0])), `${boxes[i][0].id} overlaps ${boxes[j][0].id}`);
});
test('declutter: the preferred spot is used when it is free and low priority labels give way', () => {
  const out = placeLabels([{ id: 'a', ax: 400, ay: 300, w: 100, h: 40, pri: 100, force: true }, { id: 'b', ax: 410, ay: 304, w: 100, h: 40, pri: 5 }], 1500, 790);
  assert.deepEqual([out.get('a').x, out.get('a').y], [350, 254]);
  assert.ok(out.get('b').ok === false || (out.get('b').x !== out.get('a').x || out.get('b').y !== out.get('a').y));
});
test('declutter: a label moves off a figure it would cover when a free spot exists', () => {
  const figure = { x: 340, y: 230, w: 24, h: 40 };            // sits where the preferred spot of 'a' would be
  const it = { id: 'a', ax: 400, ay: 300, w: 100, h: 40, pri: 100, force: true };
  const free = placeLabels([it], 1500, 790);
  assert.ok(hit(rect(free.get('a'), it), { x0: figure.x, y0: figure.y, x1: figure.x + figure.w, y1: figure.y + figure.h }), 'the fixture should cover the figure without obstacles');
  const out = placeLabels([it], 1500, 790, 6, 3, [figure]);
  assert.ok(!hit(rect(out.get('a'), it), { x0: figure.x, y0: figure.y, x1: figure.x + figure.w, y1: figure.y + figure.h }), 'label still covers the figure');
  assert.equal(out.get('a').ok, true);
});
test('declutter: labels give way to each other before they give way to figures', () => {
  // no spot is free of both: the label may cover the figure, but never another label
  const items = [{ id: 'a', ax: 100, ay: 100, w: 90, h: 36, pri: 100, force: true }, { id: 'b', ax: 100, ay: 100, w: 90, h: 36, pri: 90, force: true }];
  const out = placeLabels(items, 200, 150, 6, 3, [{ x: 0, y: 0, w: 200, h: 150 }]);
  assert.ok(!hit(rect(out.get('a'), items[0]), rect(out.get('b'), items[1])) || out.get('b').ok === false);
});

test('declutter: `taken` rects are kept clear of and are not part of the result', () => {
  const taken = [{ x: 400, y: 300, w: 200, h: 100 }];
  const items = [{ id: 'a', ax: 500, ay: 330, w: 120, h: 40, pri: 100, force: false }];            // the preferred spot (440, 286) overlaps the taken rect
  const out = placeLabels(items, 1500, 790, 6, 3, [], taken);
  assert.equal(out.size, 1);
  const p = out.get('a');
  assert.ok(p.ok, 'a free spot is found');
  assert.ok(!hit({ x0: p.x, y0: p.y, x1: p.x + 120, y1: p.y + 40 }, { x0: 400, y0: 300, x1: 600, y1: 400 }));
  // without it the label stays at the preferred spot
  const free = placeLabels(items, 1500, 790, 6, 3, []).get('a');
  assert.equal(free.x, 440);
  assert.equal(free.y, 330 - 40 - 6);
});
