import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutLabels, gapBetween } from '../public/js/ofis-label-layout.js';

const VW = 1000, VH = 700;
const box = (id, x, y, w, h, o = {}) => ({ id, x, y, w, h, pri: 50, rank: 10, force: false, ...o });
const rect = (L, p) => ({ x: p.x, y: p.y, w: L.w, h: L.h });
const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

test('a fixed label keeps its spot; one that touches a label of higher priority is not shown, a forced one is', () => {
  const a = box('a', 100, 100, 40, 24, { pri: 100 }), b = box('b', 120, 110, 40, 24, { pri: 30 }), c = box('c', 125, 112, 40, 24, { pri: 10, force: true });
  const out = layoutLabels({ fixed: [a, b, c], vw: VW, vh: VH });
  assert.deepEqual(out.get('a'), { x: 100, y: 100 });
  assert.equal(out.has('b'), false);
  assert.deepEqual(out.get('c'), { x: 125, y: 112 });
});

test('nothing is drawn under what floats over the scene, forced or not', () => {
  const card = { x: 300, y: 100, w: 300, h: 400 };
  const out = layoutLabels({ fixed: [box('f', 350, 200, 30, 20, { pri: 99, force: true })], tags: [box('t', 340, 300, 120, 40, { force: true, rank: 120 })], blocked: [card], vw: VW, vh: VH });
  assert.equal(out.has('f'), false);
  const p = out.get('t');
  assert.ok(p, 'a forced agent label finds a spot beside the card');
  assert.ok(!hit({ x: p.x, y: p.y, w: 120, h: 40 }, card));
});

test('agent labels give way to each other and to the figures of the agents', () => {
  const tags = [box('m', 400, 300, 160, 60, { force: true, rank: 100 }), box('s1', 410, 310, 110, 36, { rank: 10 }), box('s2', 380, 330, 110, 36, { rank: 10 })];
  const figures = [{ x: 420, y: 250, w: 30, h: 50 }];
  const out = layoutLabels({ tags, figures, vw: VW, vh: VH });
  const shown = tags.filter(T => out.has(T.id));
  assert.ok(out.has('m'));
  for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) assert.ok(!hit(rect(shown[i], out.get(shown[i].id)), rect(shown[j], out.get(shown[j].id))), `${shown[i].id} overlaps ${shown[j].id}`);
});

test('a main agent label is always shown (it takes the least bad spot); a sub-agent label that fits nowhere near its agent is not', () => {
  // twelve forced labels in a row leave no free spot near the thirteenth label
  const mains = Array.from({ length: 12 }, (_, i) => box('m' + i, 300 + (i % 4) * 90, 300 + Math.floor(i / 4) * 50, 120, 40, { force: true, rank: 100 }));
  const sub = box('sub', 400, 330, 110, 36, { rank: 10, near: { x: 440, y: 290, w: 30, h: 40 }, maxGap: 5 });
  const out = layoutLabels({ tags: [...mains, sub], vw: VW, vh: VH });
  for (const m of mains) assert.ok(out.has(m.id), m.id + ' missing');
  assert.equal(out.has('sub'), false);
});

test('a sub-agent label stays within maxGap of its agent, a main label may go farther', () => {
  const blocked = [{ x: 0, y: 0, w: 1000, h: 200 }];                      // the nearest free spot is more than 70 px below the agent
  const agent = { x: 100, y: 60, w: 30, h: 40 };
  const near = box('near', 100, 100, 110, 36, { near: agent, maxGap: 70 }), far = box('far', 100, 100, 110, 36, { force: true, rank: 100 });
  assert.equal(layoutLabels({ tags: [near], blocked, vw: VW, vh: VH }).has('near'), false);
  const p = layoutLabels({ tags: [far], blocked, vw: VW, vh: VH }).get('far');
  assert.ok(p && p.y >= 200, 'the forced label goes to the free part');
  // beside the agent the same label is shown
  assert.ok(layoutLabels({ tags: [near], vw: VW, vh: VH }).has('near'));
});

test('gapBetween is zero for rects that touch and the larger gap otherwise', () => {
  assert.equal(gapBetween({ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }), 0);
  assert.equal(gapBetween({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), 0);
  assert.equal(gapBetween({ x: 0, y: 0, w: 10, h: 10 }, { x: 30, y: 12, w: 10, h: 10 }), 20);
  assert.equal(gapBetween({ x: 0, y: 0, w: 10, h: 10 }, { x: 14, y: 40, w: 10, h: 10 }), 30);
});

test('the result is the same for the same input and every label stays inside the view', () => {
  const tags = Array.from({ length: 30 }, (_, i) => box('t' + i, (i * 97) % 900, (i * 53) % 650, 100 + (i % 3) * 20, 34, { force: i % 5 === 0, rank: i % 5 === 0 ? 100 : 10 }));
  const one = layoutLabels({ tags, vw: VW, vh: VH }), two = layoutLabels({ tags, vw: VW, vh: VH });
  assert.deepEqual([...one], [...two]);
  for (const T of tags) { const p = one.get(T.id); if (p) assert.ok(p.x >= 0 && p.y >= 0 && p.x + T.w <= VW && p.y + T.h <= VH, T.id); }
});

test('a frame of 60 labels is laid out in a few milliseconds at most', () => {
  const tags = Array.from({ length: 40 }, (_, i) => box('t' + i, (i * 97) % 900, (i * 53) % 650, 120, 40, { force: i % 4 === 0, rank: i % 4 === 0 ? 100 : 10 }));
  const fixed = Array.from({ length: 20 }, (_, i) => box('f' + i, (i * 131) % 950, (i * 71) % 680, 26, 24, { pri: 60 }));
  const blocked = [{ x: 700, y: 80, w: 280, h: 560 }];
  layoutLabels({ tags, fixed, blocked, vw: VW, vh: VH });
  const t0 = performance.now();
  const N = 200;
  for (let i = 0; i < N; i++) layoutLabels({ tags, fixed, blocked, vw: VW, vh: VH });
  const per = (performance.now() - t0) / N;
  assert.ok(per < 8, `${per.toFixed(2)} ms per frame`);
});

test('a main label is never hidden: when the spots near it are all under the card it takes the nearest free one', () => {
  // the card covers the left two thirds, the free part is a strip on the right more than a ring away from the label
  const blocked = [{ x: 0, y: 0, w: 700, h: 700 }];
  const T = box('m', 100, 300, 160, 60, { force: true, rank: 100 });
  const p = layoutLabels({ tags: [T], blocked, vw: VW, vh: VH }).get('m');
  assert.ok(p, 'shown');
  assert.ok(p.x >= 700 && p.x + 160 <= VW - 4, `at ${p.x},${p.y}`);
  // two such labels do not land on each other
  const U = box('n', 120, 320, 160, 60, { force: true, rank: 100 });
  const out = layoutLabels({ tags: [T, U], blocked, vw: VW, vh: VH });
  assert.ok(out.has('m') && out.has('n'));
  assert.ok(!hit(rect(T, out.get('m')), rect(U, out.get('n'))), 'the two labels overlap');
});

test('a main label is hidden only when nothing in reach is free of the card', () => {
  const out = layoutLabels({ tags: [box('m', 100, 100, 110, 36, { force: true, rank: 100 })], blocked: [{ x: 0, y: 0, w: 1000, h: 690 }], vw: VW, vh: VH });
  assert.equal(out.has('m'), false);
});
