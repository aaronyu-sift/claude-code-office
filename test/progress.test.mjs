import test from 'node:test';
import assert from 'node:assert/strict';
import { progressSegments, progressLabel, currentItem, compareIds, runningMs, toMs, TEXT_EN, SEGMENTS } from '../public/js/progress.js';
import { LANGUAGES, FALLBACK } from '../public/js/lang/index.js';

const item = (id, status, extra = {}) => ({ id, title: 'Item ' + id, status, prio: 'med', complexity: 'S', doingSince: null, doneAt: null, ...extra });
const P = (extra = {}) => ({ topic: 'T', total: 12, done: 7, doing: 2, blocked: 1, items: [], ...extra });
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test('segments: done, doing, blocked and the rest, as fractions of the total that add up to 1', () => {
  const { total, segments } = progressSegments(P());
  assert.equal(total, 12);
  assert.deepEqual(segments.map(s => s.kind), SEGMENTS);
  assert.deepEqual(segments.map(s => s.n), [7, 2, 1, 2]);
  near(segments[0].frac, 7 / 12); near(segments[1].frac, 2 / 12); near(segments[2].frac, 1 / 12); near(segments[3].frac, 2 / 12);
  near(segments.reduce((s, x) => s + x.frac, 0), 1);
});

test('segments: no list is nothing, a finished list is all done, and counts above the total grow the total instead of overflowing the bar', () => {
  for (const none of [null, undefined, {}, { total: 0 }, 'x', 7, [], { total: 'nine', done: '3' }, { total: -4, done: -1 }, { total: NaN, done: Infinity }]) {
    const s = progressSegments(none);
    assert.equal(s.total, 0, JSON.stringify(none));
    assert.ok(s.segments.every(x => x.n === 0 && x.frac === 0));
  }
  const all = progressSegments({ total: 5, done: 5 });
  assert.deepEqual(all.segments.map(s => s.frac), [1, 0, 0, 0]);
  const over = progressSegments({ total: 3, done: 2, doing: 2, blocked: 1 });
  assert.equal(over.total, 5);
  near(over.segments.reduce((s, x) => s + x.frac, 0), 1);
  assert.equal(over.segments[3].n, 0, 'no negative rest');
  assert.equal(progressSegments({ total: 4.9, done: 1.9 }).total, 4, 'whole numbers');
});

test('label: "7 of 12 done · 2 doing", with blocked when there is some, and nothing for no list', () => {
  assert.equal(progressLabel(P()), '7 of 12 done · 2 doing · 1 blocked');
  assert.equal(progressLabel(P({ blocked: 0 })), '7 of 12 done · 2 doing');
  assert.equal(progressLabel(P({ doing: 0, blocked: 0 })), '7 of 12 done');
  assert.equal(progressLabel(P({ total: 12, done: 12, doing: 0, blocked: 0 })), '12 of 12 done');
  assert.equal(progressLabel(P({ total: 3, done: 0, doing: 0, blocked: 0 })), '0 of 3 done');
  assert.equal(progressLabel(null), '');
  assert.equal(progressLabel({ total: 0 }), '');
});

test('label: a translator is used for every part', () => {
  const t = (key, p) => `[${key}${p ? ':' + Object.values(p).join(',') : ''}]`;
  assert.equal(progressLabel(P(), t), '[progress.done:7,12] · [progress.doing:2] · [progress.blocked:1]');
});

test('the English texts are the ones lang/en.js has, so the page and a plain caller say the same', () => {
  const en = LANGUAGES.find(l => l.code === FALLBACK).messages;
  for (const [k, v] of Object.entries(TEXT_EN)) assert.equal(en[k], v, k);
  for (const l of LANGUAGES) for (const k of Object.keys(TEXT_EN)) assert.ok(typeof l.messages[k] === 'string', `${l.code} lacks ${k}`);
});

test('ids sort the way a person reads them: S2 before S10, S1 before S1.1, S1.2 before S1.10', () => {
  const ids = ['S10', 'S2', 'S1.10', 'S1', 'S1.2', 'S1.1', 'S20', 'S3', 'S02'];
  assert.deepEqual([...ids].sort(compareIds), ['S1', 'S1.1', 'S1.2', 'S1.10', 'S2', 'S02', 'S3', 'S10', 'S20']);
  assert.equal(compareIds('S2', 'S2'), 0);
  assert.ok(compareIds('', 'S1') < 0 && compareIds(undefined, null) === 0);
});

test('current item: the first one being worked on, in list order', () => {
  const p = P({ items: [item('S1', 'done'), item('S2', 'todo', { prio: 'high' }), item('S3', 'doing'), item('S4', 'doing'), item('S5', 'blocked')] });
  const c = currentItem(p);
  assert.equal(c.item.id, 'S3');
  assert.equal(c.kind, 'doing');
});

test('current item: with nothing being worked on, the open item with the highest priority, then the lowest id', () => {
  const p = P({ items: [item('S1', 'done'), item('S12', 'todo', { prio: 'high' }), item('S3', 'todo', { prio: 'low' }), item('S9', 'todo', { prio: 'high' }), item('S2', 'todo', { prio: 'none' }), item('S4', 'blocked', { prio: 'high' })] });
  const c = currentItem(p);
  assert.deepEqual([c.item.id, c.kind], ['S9', 'next'], 'S9 before S12 (a number, not text), blocked never');
  p.items = p.items.filter(i => i.id !== 'S9' && i.id !== 'S12');
  assert.equal(currentItem(p).item.id, 'S3', 'low before none');
  p.items = [item('S5', 'todo', { prio: 'weird' }), item('S4', 'todo', { prio: 'none' })];
  assert.equal(currentItem(p).item.id, 'S4', 'an unknown priority counts as none; equal priority goes by id');
});

test('current item: nothing when everything is done or blocked, or there are no items', () => {
  assert.equal(currentItem(P({ items: [item('S1', 'done'), item('S2', 'blocked')] })), null);
  assert.equal(currentItem(P({ items: [] })), null);
  assert.equal(currentItem(P({ items: 'nope' })), null);
  assert.equal(currentItem(P({ items: [null, 3, 'x', item('S1', 'todo')] })).item.id, 'S1');
  assert.equal(currentItem(null), null);
  assert.equal(currentItem(undefined), null);
});

test('running time: ms since doingSince, for an item being worked on', () => {
  const now = Date.parse('2026-10-29T23:00:00Z');
  const since = Date.parse('2026-10-29T22:46:00Z');
  assert.equal(runningMs(item('S1', 'doing', { doingSince: since }), now), 14 * 60e3);
  assert.equal(runningMs(item('S1', 'doing', { doingSince: '2026-10-29T22:46:00Z' }), now), 14 * 60e3, 'an ISO string is read too');
  assert.equal(runningMs(item('S1', 'doing', { doingSince: now + 5000 }), now), 0, 'a start in the future (clock skew) is 0, not negative');
  assert.equal(runningMs(item('S1', 'doing', { doingSince: null }), now), null);
  assert.equal(runningMs(item('S1', 'doing', { doingSince: 'soon' }), now), null);
  assert.equal(runningMs(item('S1', 'todo', { doingSince: since }), now), null, 'only an item being worked on runs');
  assert.equal(runningMs(item('S1', 'done', { doingSince: since }), now), null);
  assert.equal(runningMs(null, now), null);
  assert.equal(runningMs(item('S1', 'doing', { doingSince: since }), NaN), null);
});

test('toMs: epoch ms or an ISO string, else null', () => {
  assert.equal(toMs(1793338800000), 1793338800000);
  assert.equal(toMs('2026-10-29T22:40:00-0700'), 1793338800000);
  assert.equal(toMs('nope'), null);
  assert.equal(toMs(null), null);
  assert.equal(toMs({}), null);
});
