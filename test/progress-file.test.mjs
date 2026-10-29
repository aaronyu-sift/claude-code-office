import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, renameSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgress, parseSnapshot, MAX_BYTES, MAX_CHATS, MAX_ITEMS } from '../progress-file.js';

const item = (id, status, extra = {}) => ({ id, title: 'Item ' + id, status, prio: 'med', complexity: 'S', doingSince: null, doneAt: null, ...extra });
const chat = (extra = {}) => ({
  topic: 'Claude Code Office (pixel scene)', updatedAt: '2026-10-29T22:40:00-0700', total: 4, done: 1, doing: 1, blocked: 1,
  items: [item('S1', 'done', { doneAt: '2026-10-29T21:00:00-0700' }), item('S2', 'doing', { doingSince: '2026-10-29T22:00:00-0700' }), item('S3', 'blocked'), item('S4', 'todo')], ...extra,
});
const snap = (chats, extra = {}) => JSON.stringify({ version: 1, updatedAt: '2026-10-29T22:40:00-0700', chats, ...extra });

test('progress file: a good snapshot gives each chat its counts and items, times as epoch ms', () => {
  const m = parseSnapshot(snap({ 'sid-1': chat(), 'sid-2': chat({ topic: 'Other' }) }));
  assert.deepEqual([...m.keys()], ['sid-1', 'sid-2']);
  const p = m.get('sid-1');
  assert.deepEqual([p.topic, p.total, p.done, p.doing, p.blocked], ['Claude Code Office (pixel scene)', 4, 1, 1, 1]);
  assert.equal(p.items.length, 4);
  assert.deepEqual(p.items[1], { id: 'S2', title: 'Item S2', status: 'doing', prio: 'med', complexity: 'S', doingSince: Date.parse('2026-10-29T22:00:00-07:00'), doneAt: null });
  assert.equal(p.updatedAt, Date.parse('2026-10-29T22:40:00-07:00'));
  assert.equal(m.get('sid-2').topic, 'Other');
});

test('progress file: nothing that is not the documented shape gives progress', () => {
  for (const bad of ['', '   ', 'not json', '{', '[]', 'null', '42', '"text"', '{}', '{"version":1}', '{"version":1,"chats":[]}', '{"version":1,"chats":"x"}',
    '{"version":2,"chats":{"a":{"total":3}}}', '{"version":"1","chats":{"a":{"total":3}}}', snap('nope'), snap(null)]) {
    assert.equal(parseSnapshot(bad).size, 0, `"${bad.slice(0, 30)}" gave progress`);
  }
  assert.equal(parseSnapshot('{"chats":{"a":{"total":3}}}').size, 1, 'a missing version is read as version 1');
});

test('progress file: one bad chat entry is dropped, the others stay', () => {
  const m = parseSnapshot(snap({ good: chat(), nil: null, arr: [], str: 'x', empty: {}, zero: { total: 0, items: [] }, 'bad id with spaces': chat(), '': chat(), ['x'.repeat(129)]: chat(), 'also-good': { total: 2, done: 1 } }));
  assert.deepEqual([...m.keys()], ['good', 'also-good']);
});

test('progress file: counts are whole numbers in range and never more than the total', () => {
  const m = parseSnapshot(snap({
    a: { total: 5.9, done: 2.2, doing: -3, blocked: 'x' },
    b: { total: 3, done: 2, doing: 2, blocked: 1 },                      // 5 counted of 3: the total grows to what is counted
    c: { total: 1e12, done: 1 },
    d: { total: NaN, done: Infinity },
    e: { items: [item('S1', 'done'), item('S2', 'doing'), item('S3', 'todo')] },        // no counts: they are tallied from the items
  }));
  assert.deepEqual([m.get('a').total, m.get('a').done, m.get('a').doing, m.get('a').blocked], [5, 2, 0, 0]);
  assert.deepEqual([m.get('b').total, m.get('b').done, m.get('b').doing, m.get('b').blocked], [5, 2, 2, 1]);
  assert.equal(m.get('c').total, 100000);
  assert.equal(m.has('d'), false);
  assert.deepEqual([m.get('e').total, m.get('e').done, m.get('e').doing, m.get('e').blocked], [3, 1, 1, 0]);
});

test('progress file: hostile strings lose control characters, bidi marks and length; markup is left as text for the page to show as text', () => {
  // an escape character, a bidirectional override, a line separator, a zero-width space and a byte order mark, spelled by code point
  const odd = String.fromCodePoint(0x1b, 0x202e, 0x2028, 0x200b, 0xfeff, 0);
  const evil = ('<img src=x onerror=alert(1)>' + odd + ' reversed line\tTab\n').repeat(3);
  const m = parseSnapshot(snap({ s: chat({ topic: evil, items: [item('<b>S1</b>'.repeat(10), 'todo', { title: evil + 'x'.repeat(5000) }), item('S2', 'todo', { title: 42 }), item('S3', 'todo', { id: { a: 1 }, complexity: '<script>', prio: 'urgent' })] }) }));
  const p = m.get('s');
  const unsafe = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]');
  for (const s of [p.topic, ...p.items.flatMap(i => [i.id, i.title, i.complexity])]) assert.doesNotMatch(s, unsafe, 'control or bidi character left');
  assert.ok(p.topic.length <= 120 && p.items[0].title.length <= 140 && p.items[0].id.length <= 24);
  assert.ok(p.items[0].title.endsWith('…'), 'a cut title says so');
  assert.match(p.topic, /^<img src=x onerror=alert\(1\)> reversed line Tab <img src=x/, 'whitespace collapsed, the text kept as it is');
  assert.equal(p.items[1].title, '');
  assert.deepEqual([p.items[2].id, p.items[2].complexity, p.items[2].prio], ['', '', 'none']);
});

test('progress file: a cut never splits an emoji', () => {
  const m = parseSnapshot(snap({ s: chat({ topic: '🚀'.repeat(300) }) }));
  const t = m.get('s').topic;
  assert.equal(Array.from(t).length, 120);
  assert.equal(t.slice(0, -1), '🚀'.repeat(119));
});

test('progress file: an item with an unknown status is dropped; unknown priority is none; times outside 2000-2100 or not times are null', () => {
  const m = parseSnapshot(snap({ s: chat({ items: [item('S1', 'paused'), item('S2', 'todo', { prio: 'urgent' }), item('S3', 'doing', { doingSince: 'yesterday' }), item('S4', 'done', { doneAt: '1970-01-01T00:00:00Z' }), item('S5', 'doing', { doingSince: 1793338800000 }), null, 7, 'x', []] }) }));
  const it = m.get('s').items;
  assert.deepEqual(it.map(i => i.id), ['S2', 'S3', 'S4', 'S5']);
  assert.deepEqual([it[0].prio, it[1].doingSince, it[2].doneAt, it[3].doingSince], ['none', null, null, 1793338800000]);
});

test('progress file: many items are capped, keeping the one being worked on, the blocked and the open ones before the finished ones, in their own order', () => {
  const items = [];
  for (let i = 1; i <= 100; i++) items.push(item('S' + i, i <= 60 ? 'done' : i === 95 ? 'doing' : i === 99 ? 'blocked' : 'todo'));
  const p = parseSnapshot(snap({ s: { total: 100, done: 60, doing: 1, blocked: 1, items } })).get('s');
  assert.equal(p.items.length, MAX_ITEMS);
  const ids = p.items.map(i => i.id);
  assert.ok(ids.includes('S95') && ids.includes('S99'), 'doing and blocked kept');
  assert.deepEqual(ids.filter(i => +i.slice(1) <= 60), [], 'no finished item took a place from an open one');
  assert.deepEqual(ids, [...ids].sort((a, b) => a.slice(1) - b.slice(1)), 'the order of the file');
  assert.equal(p.total, 100, 'the counts still describe the whole list');
  const few = parseSnapshot(snap({ s: { total: 50, items: items.slice(0, 50) } })).get('s');
  assert.equal(few.items.length, MAX_ITEMS);
});

test('progress file: a huge item list or a huge number of chats is cut, not followed', () => {
  const items = Array.from({ length: 5000 }, (_, i) => item('S' + i, 'todo'));
  assert.equal(parseSnapshot(snap({ s: { total: 5000, items } })).get('s').items.length, MAX_ITEMS);
  const chats = {};
  for (let i = 0; i < MAX_CHATS + 50; i++) chats['sid-' + i] = { total: 1 };
  assert.equal(parseSnapshot(snap(chats)).size, MAX_CHATS);
});

test('progress file: a session id named like an Object property is only a key', () => {
  const m = parseSnapshot('{"version":1,"chats":{"__proto__":{"total":2},"constructor":{"total":3},"toString":{"total":4}}}');
  assert.deepEqual([...m.keys()].sort(), ['__proto__', 'constructor', 'toString'].sort());
  assert.equal(({}).total, undefined, 'Object.prototype untouched');
  assert.equal(m.get('constructor').total, 3);
});

// ---------------------------------------------------------------- the file

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'cco-progress-'));
  const file = join(dir, 'office-progress.json');
  let t = 1e6;
  const progress = createProgress({ file, every: 2000, now: () => t });
  return { dir, file, progress, tick: ms => { t += ms; progress.step(); }, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

test('progress file: a missing file is no progress, and it appears when the file does', () => {
  const s = setup();
  try {
    s.tick(0);
    assert.equal(s.progress.of('sid-1'), null);
    assert.deepEqual(s.progress.all(), {});
    writeFileSync(s.file, snap({ 'sid-1': chat() }));
    s.tick(2500);
    assert.equal(s.progress.of('sid-1').total, 4);
    assert.equal(s.progress.of('sid-2'), null);
    rmSync(s.file);
    s.tick(2500);
    assert.equal(s.progress.of('sid-1'), null, 'a deleted file is no progress');
  } finally { s.clean(); }
});

test('progress file: the file is looked at once per interval, and read only when it changed', () => {
  const reads = [];
  const real = { statSync: (f) => { reads.push('stat'); return { ino: 1, size: 10, mtimeMs: 5, isFile: () => true }; }, readFileSync: () => { reads.push('read'); return snap({ a: chat() }); } };
  let t = 0;
  const p = createProgress({ file: '/x/y.json', every: 2000, now: () => t, fsx: real });
  for (let i = 0; i < 10; i++) { p.step(); t += 500; }                          // 5 s in half-second steps
  assert.deepEqual(reads, ['stat', 'read', 'stat', 'stat'], 'three looks in five seconds, one read');
  assert.equal(p.of('a').total, 4);
});

test('progress file: a malformed file is no progress, a good file after it is read, and a file replaced by rename is noticed', () => {
  const s = setup();
  try {
    writeFileSync(s.file, snap({ a: chat() }));
    s.tick(0);
    assert.equal(s.progress.of('a').total, 4);
    writeFileSync(s.file, '{"version":1,"chats":{"a":{"total":3,');           // a writer that died half way
    s.tick(2500);
    assert.equal(s.progress.of('a'), null);
    const next = join(s.dir, 'next.json');
    writeFileSync(next, snap({ a: chat({ total: 9, done: 5 }) }));
    renameSync(next, s.file);                                                  // the way a careful writer replaces the file
    s.tick(2500);
    assert.equal(s.progress.of('a').total, 9);
  } finally { s.clean(); }
});

test('progress file: a file over the size limit is refused unread, a directory or a missing parent is no progress', () => {
  const s = setup();
  try {
    writeFileSync(s.file, snap({ a: chat() }) + ' '.repeat(MAX_BYTES));
    s.tick(0);
    assert.equal(s.progress.of('a'), null, 'over the limit');
    rmSync(s.file);
    mkdirSync(s.file);                                                         // the path is a directory
    s.tick(2500);
    assert.equal(s.progress.of('a'), null);
    const gone = createProgress({ file: join(s.dir, 'no', 'such', 'dir', 'f.json'), now: () => 0 });
    gone.step();
    assert.deepEqual(gone.all(), {});
    const none = createProgress({ file: null });
    none.step();
    assert.equal(none.of('a'), null);
    none.load(snap({ a: chat() }));
    assert.equal(none.of('a').total, 4, 'load() fills it without a file');
  } finally { s.clean(); }
});
