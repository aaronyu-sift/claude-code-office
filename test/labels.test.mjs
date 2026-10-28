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
