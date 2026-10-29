import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRecent } from '../recent.js';

const H = 3600e3;
// a projects directory with files: [project, id, age in hours, bytes]
function makeProjects(spec, t = Date.now()) {
  const dir = mkdtempSync(join(tmpdir(), 'cco-recent-'));
  for (const [proj, id, ageH, bytes = 100] of spec) {
    mkdirSync(join(dir, proj), { recursive: true });
    const f = join(dir, proj, id + '.jsonl');
    writeFileSync(f, 'x'.repeat(bytes));
    const at = (t - ageH * H) / 1000;
    utimesSync(f, at, at);
  }
  return dir;
}
const spy = () => { const calls = []; return { calls, read: file => { calls.push(file); return { name: 'n-' + file.split('/').pop() }; } }; };
const ids = list => list.map(s => s.id);
const clean = dir => rmSync(dir, { recursive: true, force: true });

test('recent: closed sessions are the transcripts in the window with no live process, newest first', () => {
  const dir = makeProjects([['a', 's1', 3], ['a', 's2', 1], ['b', 's3', 30 * 24], ['b', 's4', 2], ['b', 's5', 5]]);
  try {
    mkdirSync(join(dir, 'a', 's2', 'subagents'), { recursive: true });                       // a subagent folder is not a session
    writeFileSync(join(dir, 'a', 'notes.txt'), 'not a transcript');
    const { read } = spy();
    const r = createRecent({ projDir: dir, read, days: 14 });
    assert.deepEqual(ids(r.scan(new Set(['s5']))), ['s2', 's4', 's1'], 'newest first; s3 is outside the window, s5 is live');
    assert.deepEqual(ids(r.scan(new Set())), ['s2', 's4', 's1', 's5'], 'a session that is no longer live shows up');
  } finally { clean(dir); }
});

test('recent: only the newest `max` files are read, and a file that did not change is never read again', () => {
  const spec = Array.from({ length: 20 }, (_, i) => ['p', 's' + String(i).padStart(2, '0'), i + 1]);
  const dir = makeProjects(spec);
  try {
    const s = spy();
    const r = createRecent({ projDir: dir, read: s.read, max: 5 });
    assert.deepEqual(ids(r.scan()), ['s00', 's01', 's02', 's03', 's04']);
    assert.equal(s.calls.length, 5, 'five reads for twenty files');
    r.scan(); r.scan();
    assert.equal(s.calls.length, 5, 'the next passes read nothing');
    assert.equal(r.stats.read, 0);
    assert.equal(r.stats.listed, 0, 'the directory was not listed again');
    assert.ok(r.stats.statted >= 20, 'the known files are still stat\'ed (a stat is cheap)');
    appendFileSync(join(dir, 'p', 's02.jsonl'), 'more');                                       // one file grows
    r.scan();
    assert.deepEqual(s.calls.slice(5).map(f => f.split('/').pop()), ['s02.jsonl'], 'only the changed file is read again');
  } finally { clean(dir); }
});

test('recent: a new transcript appears when its directory changes, and a deleted one disappears', () => {
  const dir = makeProjects([['p', 'old', 4]]);
  try {
    const r = createRecent({ projDir: dir, read: spy().read });
    assert.deepEqual(ids(r.scan()), ['old']);
    writeFileSync(join(dir, 'p', 'fresh.jsonl'), 'x');                                         // a new file changes the directory's mtime
    const bump = (Date.now() + 5000) / 1000;
    utimesSync(join(dir, 'p'), bump, bump);
    assert.deepEqual(ids(r.scan()), ['fresh', 'old']);
    assert.equal(r.stats.listed, 1);
    rmSync(join(dir, 'p', 'old.jsonl'));
    assert.deepEqual(ids(r.scan()), ['fresh']);
  } finally { clean(dir); }
});

test('recent: a pass stops reading when its time budget is spent and the next pass goes on; the order never changes on the way', () => {
  const spec = Array.from({ length: 12 }, (_, i) => ['p', 's' + String(i).padStart(2, '0'), i + 1]);
  const dir = makeProjects(spec);
  try {
    let ticks = 0;                                                                              // a clock that advances 40 ms per call to read
    const read = () => { ticks += 40; return { name: 'x' }; };
    const r = createRecent({ projDir: dir, read, max: 12, budgetMs: 100, clock: () => ticks });
    const first = r.scan();
    assert.ok(first.length >= 1 && first.length < 12, `${first.length} read in the first pass`);
    assert.ok(r.stats.pending > 0 && r.stats.read === first.length);
    assert.deepEqual(ids(first), spec.slice(0, first.length).map(s => s[1]), 'the newest come first');
    let all = first;
    for (let i = 0; i < 12 && r.stats.pending > 0; i++) all = r.scan();
    assert.equal(all.length, 12);
    assert.equal(r.stats.pending, 0);
    assert.deepEqual(ids(r.scan()), ids(all), 'the finished list is the same on every pass');
    assert.deepEqual(ids(all), spec.map(s => s[1]));
  } finally { clean(dir); }
});

test('recent: an unreadable file is not tried again until it changes, and one bad file does not stop the others', () => {
  const dir = makeProjects([['p', 'bad', 1], ['p', 'good', 2]]);
  try {
    let n = 0;
    const read = file => { n++; if (file.endsWith('bad.jsonl')) throw new Error('boom'); return { name: 'ok' }; };
    const r = createRecent({ projDir: dir, read });
    assert.deepEqual(ids(r.scan()), ['good']);
    r.scan(); r.scan();
    assert.equal(n, 2, 'each file was read once');
  } finally { clean(dir); }
});

test('recent: a session the server saw close is added at once with its close time; others use the file time', () => {
  const t = Date.now();
  const dir = makeProjects([['p', 'seen', 0.5], ['p', 'other', 2]], t);
  try {
    const r = createRecent({ projDir: dir, read: spy().read });
    r.scan();
    const before = Object.fromEntries(r.list().map(s => [s.id, s]));
    assert.equal(before.seen.observed, false);
    assert.ok(Math.abs(before.seen.closedAt - (t - 0.5 * H)) < 2000, 'unobserved: the file time');
    const at = t + 1000;
    r.add(join(dir, 'p', 'seen.jsonl'), at);
    const after = Object.fromEntries(r.list().map(s => [s.id, s]));
    assert.equal(after.seen.observed, true);
    assert.ok(after.seen.closedAt >= at);
    assert.deepEqual(ids(r.list()), ['seen', 'other']);
  } finally { clean(dir); }
});

test('recent: days = 0 turns it off, and a missing projects directory is an empty list', () => {
  const dir = makeProjects([['p', 's', 1]]);
  try {
    const s = spy();
    assert.deepEqual(createRecent({ projDir: dir, read: s.read, days: 0 }).scan(), []);
    assert.equal(s.calls.length, 0);
    assert.deepEqual(createRecent({ projDir: join(dir, 'nope'), read: s.read }).scan(), []);
  } finally { clean(dir); }
});
