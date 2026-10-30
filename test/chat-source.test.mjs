// chat-source.js: the read-only, contract-only reader of the agent chat database (docs/chat-source.md).
// Boards are made by the REAL chat.py (the live tool, schema 2, and the next version, schema 3), in a throw-away home; the live board is never touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  createChatSource, checkDatabase, openReadOnly, findOfficeAgent, clean, CONTRACT, POLL_MAX_ROWS, POLL_MIN_MS, TEXT_MAX, SNAPSHOT_MAX_ROWS,
} from '../chat-source.js';
import { makeBoard, tool, missing, insertRows, writer, handmade, scratch, GOOD_DDL } from './helpers/chat-fixtures.mjs';

const quiet = () => {};
const clock = (start = 1_000_000) => { let t = start; const f = () => t; f.tick = ms => { t += ms; return t; }; return f; };
const open = (file, clk, extra = {}) => createChatSource(file, { now: clk, log: quiet, busyMs: 40, ...extra });
const hash = f => createHash('sha256').update(readFileSync(f)).digest('hex');
// the database file, byte for byte and by mtime. SQLite itself makes an empty -wal and -shm next to a WAL database when a reader opens it and
// none exist; that is not a write to the board, so the log counts only when it has content.
const fingerprint = f => ({ sha: hash(f), mtime: statSync(f).mtimeMs, size: statSync(f).size, walBytes: existsSync(f + '-wal') ? statSync(f + '-wal').size : 0 });
const goodDb = (extra = []) => handmade([...GOOD_DDL, ...extra]);
const walDb = (extra = []) => handmade(['PRAGMA journal_mode = WAL', ...GOOD_DDL, ...extra]);          // a board in WAL mode, like the real chat
const withId = (id, wal = false) => (wal ? walDb : goodDb)([`INSERT INTO meta VALUES('db_id','${id}')`]);   // a board with an identity
const fill = (file, rows) => {
  const d = writer(file);
  const ins = d.prepare('INSERT INTO messages(ts_ms, channel, author, human, to_list, body) VALUES (?,?,?,?,?,?)');
  for (const r of rows) ins.run(r.ts ?? 1000, r.channel ?? 'general', r.author ?? 'gamma', r.human ?? 0, r.to ?? '', r.body ?? 'row');
  d.close();
};

// ---------------------------------------------------------------- text

test('clean: control characters and bidirectional marks go, whitespace collapses, the cut counts characters', () => {
  assert.equal(clean('a\u0000b\u0007c\u202ed\u200fe\u200bf\u2066g\u2069h\ufeffi', 100), 'abcdefghi');
  assert.equal(clean('  one\t two\r\n three   four\u2028\u2029five\u0085six  ', 100), 'one two three four five six');
  assert.equal(clean('family \u{1F468}\u200d\u{1F469}\u200d\u{1F467}', 100), 'family \u{1F468}\u200d\u{1F469}\u200d\u{1F467}', 'the joiner stays: emoji need it');
  assert.equal(clean(null, 10), '');
  assert.equal(clean(42, 10), '42');
  const cut = clean('a'.repeat(398) + '\u{1F600}\u{1F600}\u{1F600}', TEXT_MAX);
  assert.equal(Array.from(cut).length, TEXT_MAX);
  assert.ok(cut.endsWith('…') && cut.isWellFormed(), 'a cut never splits a surrogate pair');
  assert.equal(clean('x'.repeat(400), TEXT_MAX), 'x'.repeat(400), 'exactly the limit stays whole');
  assert.equal(clean('x'.repeat(401), TEXT_MAX), 'x'.repeat(399) + '…');
});

test('clean: a text made only of astral characters (emoji) is cut like any other, and the cut agrees with a character count everywhere', () => {
  const emoji = '\u{1F600}';
  for (const n of [401, 402, 500, 801, 802, 803, 1000, 20000]) {
    const c = clean(emoji.repeat(n), TEXT_MAX);
    assert.equal(Array.from(c).length, TEXT_MAX, `${n} emoji`);
    assert.ok(c.endsWith('…') && c.isWellFormed());
  }
  assert.equal(clean(emoji.repeat(400), TEXT_MAX), emoji.repeat(400), 'exactly the limit stays whole');
  assert.equal(Array.from(clean(emoji.repeat(20000), 80)).length, 80, 'a name too');
  // against a plain reference on mixed text, around every boundary
  const ref = (str, n) => { const ch = Array.from(str); return ch.length > n ? ch.slice(0, n - 1).join('') + '…' : str; };
  for (const n of [1, 2, 5, 20, 80]) {
    for (let len = 0; len <= 3 * n + 4; len++) {
      for (const unit of [emoji, 'a', 'ab' + emoji, '\u00e9' + emoji + emoji]) {
        const text = unit.repeat(len);
        assert.equal(clean(text, n), ref(text, n), `n=${n} len=${len} unit=${JSON.stringify(unit)}`);
      }
    }
  }
});

test('contract: the named constant is what the docs promise', () => {
  assert.deepEqual({ ...CONTRACT }, {
    meta: ['k', 'v'],
    messages: ['seq', 'ts_ms', 'channel', 'author', 'to_list', 'body', 'human'],
    agents: ['name', 'kind', 'last_seen_ms'],
    agent_keys: ['key', 'agent'],
  });
  assert.ok(Object.isFrozen(CONTRACT) && Object.isFrozen(CONTRACT.messages));
  assert.deepEqual([POLL_MIN_MS, POLL_MAX_ROWS, TEXT_MAX], [2000, 60, 400]);
});

// ---------------------------------------------------------------- real boards, both versions of the tool

for (const [variant, schema] of [['v2', 2], ['v3', 3]]) {
  const skip = missing(variant);

  test(`${variant}: a board made by the real chat.py is ok, schema ${schema}, and reads in order`, { skip }, () => {
    const b = makeBoard(variant);
    const clk = clock();
    const s = open(b.db, clk);
    assert.deepEqual(s.state(), { state: 'ok', schema, reason: '' });
    const r = s.poll(-1, { sinceMs: 0 });
    assert.equal(r.lastSeq, 3);
    assert.deepEqual(r.rows.map(m => m.seq), [1, 2, 3]);
    assert.deepEqual(r.rows[0], { seq: 1, ts: r.rows[0].ts, channel: 'general', from: 'alpha', to: ['beta'], text: 'hello @beta, can you review the lounge?', human: false });
    assert.deepEqual(r.rows[2].to, []);
    assert.equal(r.rows[2].channel, 'scratch');
    // nothing new: no rows; a post: exactly the new row
    clk.tick(POLL_MIN_MS);
    assert.deepEqual(s.poll(3).rows, []);
    b.post('beta', 'general', '@alpha one more');
    clk.tick(POLL_MIN_MS);
    const r2 = s.poll(3);
    assert.deepEqual(r2.rows.map(m => [m.seq, m.from, m.to, m.text]), [[4, 'beta', ['alpha'], '@alpha one more']]);
    assert.equal(r2.lastSeq, 4);
    s.close();
  });

  test(`${variant}: the snapshot has messages, channel counts and the active agents with their office session`, { skip }, () => {
    const b = makeBoard(variant);
    const s = open(b.db, clock());
    const office = new Map([
      ['sess-aaaa', { id: 'sess-aaaa', kind: 'main', name: 'Alpha chat', project: 'p1' }],
      ['sess-b', { id: 'sess-b', kind: 'main', name: 'beta', project: 'p2' }],
      ['sub-1', { id: 'sub-1', kind: 'sub', name: 'gamma', project: 'gamma' }],
    ]);
    const snap = s.snapshot({ sinceMs: 0, limit: 10, office });
    assert.deepEqual(snap.state, { state: 'ok', schema, reason: '' });
    assert.deepEqual(snap.messages.map(m => m.seq), [1, 2, 3]);
    assert.deepEqual(snap.channels, [{ name: 'general', count: 2 }, { name: 'scratch', count: 1 }]);
    assert.equal(snap.truncated, false);
    const byName = Object.fromEntries(snap.agents.map(a => [a.name, a]));
    assert.deepEqual(Object.keys(byName).sort(), ['alpha', 'beta', 'gamma']);
    assert.equal(byName.alpha.session, 'sess-aaaa', 'agent_keys row session:<id> gives the session');
    assert.equal(byName.alpha.office, 'sess-aaaa');
    assert.equal(byName.beta.office, 'sess-b', 'no key: the office agent whose name equals the chat agent');
    assert.equal(byName.beta.session, null);
    assert.equal(byName.gamma.office, null, 'a subagent is never matched by name');
    assert.ok(snap.agents.every(a => a.lastSeenMs > 0 && typeof a.kind === 'string'));
    // the window: nothing is older than sinceMs
    assert.deepEqual(s.snapshot({ sinceMs: Date.now() + 60e3 }).messages, []);
    // limit: the newest ones, oldest first
    assert.deepEqual(s.snapshot({ sinceMs: 0, limit: 2 }).messages.map(m => m.seq), [2, 3]);
    assert.equal(s.snapshot({ sinceMs: 0, limit: 2 }).truncated, true);
    s.close();
  });

  test(`${variant}: nothing writes: the file bytes and mtime stay, and a write through the connection fails`, { skip }, () => {
    const b = makeBoard(variant);
    const before = fingerprint(b.db);
    const clk = clock();
    const s = open(b.db, clk);
    s.state(); s.poll(-1, {}); clk.tick(2000); s.poll(3); s.snapshot({ sinceMs: 0 }); s.snapshot({ sinceMs: 0 });
    clk.tick(16e3); s.poll(3);                           // the slow safety pass too
    s.close();
    assert.deepEqual(fingerprint(b.db), before, 'the board file is byte for byte and mtime for mtime what it was');
    const db = openReadOnly(b.db);
    assert.equal(db.prepare('PRAGMA query_only').get().query_only, 1);
    for (const sql of ["INSERT INTO messages(ts_ms, channel, author, via, body) VALUES (1,'general','x','y','z')", 'DELETE FROM messages', 'UPDATE messages SET body = 1',
      'CREATE TABLE evil(a)', 'DROP TABLE agent_keys', 'PRAGMA journal_mode = DELETE', 'PRAGMA user_version = 9']) {
      let failed = false;
      try { db.exec(sql); } catch { failed = true; }
      // PRAGMA journal_mode answers instead of failing on some builds: what matters is that the file did not change
      if (!sql.startsWith('PRAGMA')) assert.ok(failed, `${sql} must fail`);
    }
    db.close();
    assert.deepEqual(fingerprint(b.db), before, 'the failed writes left the file alone');
  });

  test(`${variant}: the future may come: an extra table, an extra column and a version we never heard of still read ok`, { skip }, () => {
    const b = makeBoard(variant);
    const w = writer(b.db);
    w.exec('ALTER TABLE messages ADD COLUMN mood TEXT');
    w.exec('CREATE TABLE moods(seq INTEGER PRIMARY KEY, vec BLOB)');
    w.exec("UPDATE meta SET v = '9' WHERE k = 'schema_version'");
    w.close();
    const s = open(b.db, clock());
    assert.deepEqual(s.state(), { state: 'ok', schema: 9, reason: '' });
    const r = s.poll(-1, {});
    assert.deepEqual(Object.keys(r.rows[0]).sort(), ['channel', 'from', 'human', 'seq', 'text', 'to', 'ts']);
    s.close();
  });
}

// ---------------------------------------------------------------- an upgrade that happens while the Office runs

test('upgrade while open: a version 2 board migrated to 3 by the real tool keeps working and reports the new schema', { skip: missing('v2') || missing('v3') }, () => {
  const b = makeBoard('v2');
  const clk = clock();
  const s = open(b.db, clk);
  assert.equal(s.state().schema, 2);
  assert.equal(s.poll(-1, {}).lastSeq, 3);
  // the next version of the tool opens the same home: it migrates the file (adds idtok, the new index, version 3) and posts
  tool('v3', b.home, ['post', 'general', 'after the upgrade @alpha'], { AGENTCHAT_AGENT: 'beta' });
  const w = new DatabaseSync(b.db, { readOnly: true });
  assert.equal(w.prepare("SELECT v FROM meta WHERE k = 'schema_version'").get().v, '3', 'the real tool migrated it');
  assert.ok(w.prepare('PRAGMA table_info(messages)').all().some(c => c.name === 'idtok'));
  w.close();
  clk.tick(POLL_MIN_MS);
  const r = s.poll(3);
  assert.deepEqual(r.rows.map(m => [m.seq, m.from, m.text]), [[4, 'beta', 'after the upgrade @alpha']]);
  assert.deepEqual(s.state(), { state: 'ok', schema: 3, reason: '' }, 'the new schema is reported');
  assert.equal(s.stats.reopens, 1);
  // and it keeps going on the new file
  tool('v3', b.home, ['post', 'general', 'and again'], { AGENTCHAT_AGENT: 'beta' });
  clk.tick(POLL_MIN_MS);
  assert.deepEqual(s.poll(4).rows.map(m => m.seq), [5]);
  assert.equal(s.snapshot({ sinceMs: 0 }).state.schema, 3);
  s.close();
});

test('upgrade while open: a column that disappears under a running reader gives unsupported, and it recovers when it comes back', () => {
  const file = goodDb();
  fill(file, [{ body: 'one' }]);
  const clk = clock();
  const s = open(file, clk);
  assert.equal(s.poll(-1, {}).rows.length, 1);
  const w = writer(file);
  w.exec('ALTER TABLE messages RENAME COLUMN human TO is_human');          // a contract column is gone: schema cookie changes
  clk.tick(POLL_MIN_MS);
  assert.deepEqual(s.poll(1).rows, []);
  assert.equal(s.state().state, 'unsupported');
  assert.match(s.state().reason, /messages lacks human/);
  w.exec('ALTER TABLE messages RENAME COLUMN is_human TO human');
  w.close();
  clk.tick(RETRY_AFTER);
  fill(file, [{ body: 'two' }]);
  s.poll(1);
  assert.equal(s.state().state, 'ok');
  clk.tick(POLL_MIN_MS);
  assert.deepEqual(s.poll(1).rows.map(m => m.text), ['two']);
  s.close();
});
const RETRY_AFTER = 31e3;

test('the board file is replaced by an older copy (a restored backup): the poll says reset and gives the lastSeq to continue from', { skip: missing('v2') }, () => {
  const b = makeBoard('v2');
  const backup = join(scratch(), 'backup.db');
  copyFileSync(b.db, backup);
  b.post('alpha', 'general', 'four');
  b.post('alpha', 'general', 'five');
  const clk = clock();
  const s = open(b.db, clk);
  assert.equal(s.poll(-1, {}).lastSeq, 5);
  s.close();
  const s2 = open(b.db, clk);                      // a fresh reader on the new file, then the swap
  s2.poll(-1, {});
  for (const x of ['-wal', '-shm']) rmSync(b.db + x, { force: true });
  renameSync(backup, b.db);
  clk.tick(POLL_MIN_MS);
  const r = s2.poll(5);
  assert.equal(r.reset, true);
  assert.equal(r.lastSeq, 3);
  assert.deepEqual(r.rows, []);
  s2.close();
});

// another board under the same name: its rows do not continue ours, so the answer is a reset to its top, whatever its size
for (const via of ['poll', 'snapshot']) {
  test(`another board under the same name (meta.db_id differs) answers reset at its top, shorter, as long, longer or empty (reopened by the ${via})`, () => {
    for (const rows of [0, 1, 3, 13, 200]) {
      const a = withId('board-a');
      fill(a, [{ body: 'a1' }, { body: 'a2' }, { body: 'a3' }]);
      const b = withId('board-b');
      fill(b, Array.from({ length: rows }, (_, i) => ({ body: 'b' + (i + 1) })));
      const clk = clock();
      const s = open(a, clk);
      assert.equal(s.poll(-1, {}).lastSeq, 3);
      renameSync(b, a);
      clk.tick(POLL_MIN_MS);
      if (via === 'snapshot') assert.equal(s.snapshot({ sinceMs: 0 }).state.state, 'ok');       // the lounge reopens the file first
      const r = s.poll(3);
      assert.deepEqual([r.reset, r.lastSeq, r.rows.length, r.more], [true, rows, 0, false], `a board of ${rows} posts`);
      // it carries on from there, once
      fill(a, [{ body: 'next' }]);
      clk.tick(POLL_MIN_MS);
      const r2 = s.poll(r.lastSeq);
      assert.deepEqual([r2.reset, r2.rows.map(m => m.text), r2.lastSeq], [false, ['next'], rows + 1]);
      clk.tick(POLL_MIN_MS);
      assert.deepEqual([s.poll(r2.lastSeq).reset, s.poll(r2.lastSeq).rows.length], [false, 0]);
      s.close();
    }
  });
}

test('a real board of the live tool is replaced by another real board with more posts: reset at the new top, no replay of its rows', { skip: missing('v2') }, () => {
  const a = makeBoard('v2');
  const b = makeBoard('v2');
  insertRows(b.db, Array.from({ length: 10 }, (_, i) => ({ body: 'board B post ' + i, author: 'zed' })));
  const idOf = f => { const d = new DatabaseSync(f, { readOnly: true }); try { return d.prepare("SELECT v FROM meta WHERE k = 'db_id'").get()?.v; } finally { d.close(); } };
  assert.ok(idOf(a.db) && idOf(b.db) && idOf(a.db) !== idOf(b.db), 'the real tool gives every board an identity');
  const clk = clock();
  const s = open(a.db, clk);
  assert.equal(s.poll(-1, {}).lastSeq, 3);
  for (const x of ['-wal', '-shm']) rmSync(a.db + x, { force: true });
  renameSync(b.db, a.db);
  clk.tick(POLL_MIN_MS);
  const r = s.poll(3);
  assert.deepEqual([r.reset, r.lastSeq, r.rows.length], [true, 13, 0]);
  s.close();
});

// A restore done by copying over the file in place (cp, the same inode): only a new connection sees the new file.
const restoreInPlace = (file, backup) => {
  const ino = statSync(file).ino;
  writeFileSync(file, backup);
  assert.equal(statSync(file).ino, ino, 'the same inode: this is a copy over the file, not a rename');
};

test('a backup copied over a real board in place (same inode, as cp does) is noticed: reset to the backup, then the new posts arrive', { skip: missing('v2') }, () => {
  const b = makeBoard('v2');
  const backup = readFileSync(b.db);                 // three posts; no connection is open, so the file is complete
  b.post('alpha', 'general', 'four');
  b.post('alpha', 'general', 'five');
  const clk = clock();
  const s = open(b.db, clk);
  assert.equal(s.poll(-1, {}).lastSeq, 5);
  const w = writer(b.db);
  w.exec('PRAGMA wal_checkpoint(TRUNCATE)');         // everything is in the main file, the log is empty
  w.close();
  clk.tick(POLL_MIN_MS);
  assert.deepEqual([s.poll(5).reset, s.poll(5).throttled], [false, true]);
  restoreInPlace(b.db, backup);
  clk.tick(POLL_MIN_MS);
  const r = s.poll(5);
  assert.deepEqual([r.reset, r.lastSeq, r.rows.length], [true, 3, 0]);
  b.post('beta', 'general', 'after the restore');
  clk.tick(POLL_MIN_MS);
  assert.deepEqual(s.poll(3).rows.map(m => [m.seq, m.text]), [[4, 'after the restore']]);
  s.close();
});

// The safety net must not be starved by the lounge: snapshot() and poll() are called by different parts of the server, in either order,
// and a reopen done by one of them has to reach the other.
for (const [name, mk, firstSnapshot] of [
  ['WAL board, poll only', walDb, null], ['WAL board, snapshot then poll', walDb, true], ['WAL board, poll then snapshot', walDb, false],
  ['journal board, poll only', goodDb, null], ['journal board, snapshot then poll', goodDb, true], ['journal board, poll then snapshot', goodDb, false],
]) {
  test(`an older copy restored in place while the lounge also asks (${name}): one reset within 20 s, then the 5 new posts, none lost`, () => {
    const file = mk();
    fill(file, Array.from({ length: 34 }, (_, i) => ({ body: 'old ' + (i + 1), ts: 1000 + i })));
    const backup = readFileSync(file);
    fill(file, Array.from({ length: 40 }, (_, i) => ({ body: 'newer ' + (i + 35), ts: 2000 + i })));
    const clk = clock();
    const s = open(file, clk);
    let last = s.poll(-1, {}).lastSeq;
    assert.equal(last, 74);
    restoreInPlace(file, backup);
    const resets = [], got = [];
    for (let sec = 1; sec <= 40; sec++) {
      clk.tick(1000);
      if (firstSnapshot === true) s.snapshot({ sinceMs: 0, limit: 60 });
      const r = s.poll(last);
      if (firstSnapshot === false) s.snapshot({ sinceMs: 0, limit: 60 });
      if (r.reset) resets.push(sec);
      last = r.lastSeq;
      got.push(...r.rows.map(m => m.text));
      if (sec === 25) fill(file, Array.from({ length: 5 }, (_, i) => ({ body: 'after ' + i, ts: 3000 + i })));      // the board lives on after the restore
    }
    assert.equal(resets.length, 1, 'exactly one reset');
    assert.ok(resets[0] <= 20, 'noticed within 20 s, not never: ' + resets[0]);
    assert.deepEqual(got, Array.from({ length: 5 }, (_, i) => 'after ' + i), 'the five new posts, once each');
    assert.equal(last, 39);
    s.close();
  });
}

test('the board is a symbolic link (--chat-db ~/chat.db): a post that is only in the write-ahead log arrives at the next poll, not after the safety net', () => {
  const real = walDb();
  fill(real, [{ body: 'one' }]);
  const link = join(scratch(), 'link.db');
  symlinkSync(real, link);
  for (const [path, label] of [[real, 'direct'], [link, 'through the link']]) {
    const clk = clock();
    const s = open(path, clk);
    let last = s.poll(-1, {}).lastSeq;
    const n = s.stats.polls;
    const w = writer(real);
    w.exec('PRAGMA wal_autocheckpoint = 0');          // the commit stays in the log: the main file does not change
    w.prepare('INSERT INTO messages(ts_ms, channel, author, human, to_list, body) VALUES (?,?,?,?,?,?)').run(5000, 'general', 'a', 0, '', 'only in the log ' + label);
    const mainBefore = statSync(real).mtimeMs;
    clk.tick(POLL_MIN_MS);
    const r = s.poll(last);
    assert.deepEqual(r.rows.map(m => m.text), ['only in the log ' + label], label + ': delivered 2 s after the commit');
    assert.equal(statSync(real).mtimeMs, mainBefore, 'the post was only in the log');
    last = r.lastSeq;
    w.close();
    s.close();
    assert.ok(s.stats.polls > n);
  }
});

// ---------------------------------------------------------------- states

test('states: no path is off; a missing file is off and becomes ok when the file appears', () => {
  const none = open(null, clock());
  assert.deepEqual(none.state(), { state: 'off', schema: null, reason: 'no chat database configured' });
  assert.deepEqual(none.poll(-1, {}).rows, []);
  assert.deepEqual(none.snapshot({}).messages, []);
  const dir = scratch();
  const file = join(dir, 'later.db');
  const clk = clock();
  const s = open(file, clk);
  assert.equal(s.state().state, 'off');
  assert.match(s.state().reason, /database file not found: later\.db/);
  assert.equal(s.poll(-1, {}).rows.length, 0);
  assert.equal(s.snapshot({}).state.state, 'off');
  const good = goodDb();
  copyFileSync(good, file);
  clk.tick(POLL_MIN_MS);
  s.poll(-1, {});
  assert.equal(s.state().state, 'ok');
  assert.equal(s.state().schema, 7);
  s.close();
});

test('states: a file that goes away is off again, and comes back', () => {
  const good = goodDb();
  const file = join(scratch(), 'x.db');
  copyFileSync(good, file);
  const clk = clock();
  const s = open(file, clk);
  assert.equal(s.state().state, 'ok');
  rmSync(file);
  clk.tick(POLL_MIN_MS);
  s.poll(-1, {});
  assert.equal(s.state().state, 'off');
  copyFileSync(good, file);
  clk.tick(POLL_MIN_MS);
  s.poll(-1, {});
  assert.equal(s.state().state, 'ok');
  s.close();
});

const BROKEN = [
  ['messages lacks human', [...GOOD_DDL.filter(s => !s.includes('CREATE TABLE messages')), 'CREATE TABLE messages(seq INTEGER PRIMARY KEY, ts_ms INTEGER, channel TEXT, author TEXT, to_list TEXT, body TEXT)'], /messages lacks human/],
  ['messages lacks two columns', [...GOOD_DDL.filter(s => !s.includes('CREATE TABLE messages')), 'CREATE TABLE messages(seq INTEGER PRIMARY KEY, ts_ms INTEGER, channel TEXT, author TEXT, human INTEGER)'], /messages lacks to_list, body/],
  ['agents lacks last_seen_ms', [...GOOD_DDL.filter(s => !s.includes('CREATE TABLE agents')), 'CREATE TABLE agents(name TEXT PRIMARY KEY, kind TEXT)'], /agents lacks last_seen_ms/],
  ['no agent_keys table', GOOD_DDL.filter(s => !s.includes('agent_keys')), /table agent_keys is missing/],
  ['no meta table', GOOD_DDL.filter(s => !s.includes('meta')), /table meta is missing/],
  ['meta lacks v', [...GOOD_DDL.filter(s => !s.includes('meta')), 'CREATE TABLE meta(k TEXT PRIMARY KEY, value TEXT)'], /meta lacks v/],
  ['no messages table', GOOD_DDL.filter(s => !s.includes('CREATE TABLE messages')), /table messages is missing/],
  ['seq is not indexed', [...GOOD_DDL.filter(s => !s.includes('CREATE TABLE messages')), 'CREATE TABLE messages(seq INTEGER, ts_ms INTEGER, channel TEXT, author TEXT, human INTEGER, to_list TEXT, body TEXT)'], /not the primary key or indexed/],
  ['an empty database file', [], /table meta is missing/],
];
for (const [name, ddl, reason] of BROKEN) {
  test(`a broken board is unsupported with a reason, and never throws: ${name}`, () => {
    const file = handmade(ddl);
    const clk = clock();
    const s = open(file, clk);
    const st = s.state();
    assert.equal(st.state, 'unsupported');
    assert.match(st.reason, reason);
    assert.ok(!st.reason.includes('\n') && st.reason.length < 300, 'one line');
    for (let i = 0; i < 4; i++) {
      assert.deepEqual(s.poll(-1, {}).rows, []);
      assert.deepEqual(s.poll(7, {}).rows, []);
      const snap = s.snapshot({ sinceMs: 0 });
      assert.deepEqual([snap.messages, snap.channels, snap.agents], [[], [], []]);
      assert.equal(snap.state.state, 'unsupported');
      clk.tick(POLL_MIN_MS);
    }
    const c = checkDatabase(file);
    assert.equal(c.state, 'unsupported');
    assert.match(c.reason, reason);
    assert.ok(c.problems.length >= 1);
    s.close();
  });
}

test('a broken board is not checked again every poll: the check runs again when the file changes or after a pause', () => {
  const file = handmade(GOOD_DDL.filter(s => !s.includes('agent_keys')));
  const clk = clock();
  const s = open(file, clk);
  s.state();
  const opens = s.stats.opens;
  for (let i = 0; i < 10; i++) { clk.tick(POLL_MIN_MS); s.poll(-1, {}); }      // 20 s, file unchanged
  assert.equal(s.stats.opens, opens, 'no re-check while the file is as it was');
  const w = writer(file);
  w.exec('CREATE TABLE agent_keys(key TEXT PRIMARY KEY, agent TEXT NOT NULL)');
  w.close();
  clk.tick(POLL_MIN_MS);
  s.poll(-1, {});
  assert.equal(s.state().state, 'ok', 'the fix is seen at once');
  s.close();
});

test('a file that is not a database, and a directory, are unsupported, not a crash', () => {
  const dir = scratch();
  const junk = join(dir, 'junk.db');
  writeFileSync(junk, 'this is not an sqlite database '.repeat(200));
  for (const f of [junk, dir]) {
    const s = open(f, clock());
    assert.equal(s.state().state, 'unsupported');
    assert.match(s.state().reason, /cannot read the database/);
    assert.deepEqual(s.poll(-1, {}).rows, []);
    assert.deepEqual(s.snapshot({}).messages, []);
    s.close();
  }
});

test('a missing contract: seq may be indexed by a secondary index instead of being the primary key', () => {
  const file = handmade([...GOOD_DDL.filter(s => !s.includes('CREATE TABLE messages')),
    'CREATE TABLE messages(seq INTEGER, ts_ms INTEGER, channel TEXT, author TEXT, human INTEGER, to_list TEXT, body TEXT)', 'CREATE INDEX messages_seq ON messages(seq)']);
  const s = open(file, clock());
  assert.equal(s.state().state, 'ok');
  s.close();
});

test('contract columns that are generated columns (virtual or stored) are columns: the board is ok and reads', () => {
  const file = handmade([...GOOD_DDL.filter(s => !s.includes('CREATE TABLE messages')),
    "CREATE TABLE messages(seq INTEGER PRIMARY KEY, ts_s INTEGER NOT NULL, ts_ms INTEGER GENERATED ALWAYS AS (ts_s * 1000) STORED, channel TEXT NOT NULL, author TEXT NOT NULL, via TEXT NOT NULL, " +
    "human INTEGER GENERATED ALWAYS AS (via = 'human') VIRTUAL, to_list TEXT NOT NULL DEFAULT '', body TEXT NOT NULL)",
    "INSERT INTO messages(ts_s, channel, author, via, body) VALUES (7, 'general', 'ann', 'human', 'from the person')",
    "INSERT INTO messages(ts_s, channel, author, via, body) VALUES (8, 'general', 'bob', 'agent', 'from an agent')"]);
  assert.deepEqual(checkDatabase(file), { state: 'ok', schema: 7, reason: '', problems: [] });
  const s = open(file, clock());
  assert.deepEqual(s.state(), { state: 'ok', schema: 7, reason: '' });
  assert.deepEqual(s.poll(-1, {}).rows.map(m => [m.from, m.ts, m.human]), [['ann', 7000, true], ['bob', 8000, false]]);
  s.close();
});

test('a future board: extra tables, extra columns, an unknown or missing version, a version that is not a number', () => {
  const file = goodDb(['CREATE TABLE vectors(seq INTEGER PRIMARY KEY, v BLOB)', 'ALTER TABLE messages ADD COLUMN idtok TEXT', 'ALTER TABLE agents ADD COLUMN about TEXT',
    "UPDATE meta SET v = 'v4-beta' WHERE k = 'schema_version'"]);
  fill(file, [{ body: 'hi', author: 'a' }]);
  const s = open(file, clock());
  assert.deepEqual(s.state(), { state: 'ok', schema: 'v4-beta', reason: '' });
  assert.deepEqual(s.poll(-1, {}).rows.map(m => m.text), ['hi']);
  s.close();
  const noVersion = goodDb(["DELETE FROM meta WHERE k = 'schema_version'"]);
  const s2 = open(noVersion, clock());
  assert.deepEqual(s2.state(), { state: 'ok', schema: null, reason: '' });
  s2.close();
});

test('a locked database is unsupported for now, never a throw, and ok again when the lock is gone', () => {
  const file = goodDb();                              // a rollback-journal file: an exclusive lock stops readers
  fill(file, [{ body: 'x' }]);
  const w = writer(file);
  w.exec('BEGIN EXCLUSIVE');
  const clk = clock();
  const s = open(file, clk, { busyMs: 20 });
  assert.equal(s.state().state, 'unsupported');
  assert.match(s.state().reason, /locked/);
  assert.deepEqual(s.poll(-1, {}).rows, []);
  assert.deepEqual(s.snapshot({}).messages, []);
  w.exec('COMMIT');
  w.close();
  clk.tick(6e3);
  const r = s.poll(-1, {});
  assert.equal(s.state().state, 'ok');
  assert.deepEqual(r.rows.map(m => m.text), ['x']);
  // and a lock that arrives while it is open: the poll returns nothing, the state stays ok
  const w2 = writer(file);
  w2.exec('BEGIN EXCLUSIVE');
  clk.tick(POLL_MIN_MS);
  assert.doesNotThrow(() => s.poll(1));
  assert.equal(s.state().state, 'ok');
  w2.exec('ROLLBACK');
  w2.close();
  s.close();
});

// ---------------------------------------------------------------- load rules

test('a writer in the middle of a transaction does not block the reader, and no read transaction is left open (a checkpoint can truncate)', { skip: missing('v2') }, () => {
  const b = makeBoard('v2');
  const clk = clock();
  const s = open(b.db, clk);
  s.poll(-1, {});
  const w = writer(b.db);
  w.exec('BEGIN IMMEDIATE');
  w.exec("INSERT INTO messages(ts_ms, channel, author, via, body) VALUES (5, 'general', 'zed', 't', 'uncommitted')");
  clk.tick(POLL_MIN_MS);
  assert.deepEqual(s.poll(3).rows, [], 'the uncommitted row is not seen, and the reader does not wait for it');
  w.exec('COMMIT');
  clk.tick(POLL_MIN_MS);
  assert.deepEqual(s.poll(3).rows.map(m => m.text), ['uncommitted']);
  s.snapshot({ sinceMs: 0 });
  // a held read transaction would make this checkpoint report busy
  const cp = w.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  assert.equal(cp.busy, 0, 'no read transaction is open between calls');
  w.close();
  s.close();
});

test('poll: the 2 second floor, 60 rows at most, by seq, every row exactly once', () => {
  const file = goodDb();
  fill(file, Array.from({ length: 150 }, (_, i) => ({ body: 'm' + (i + 1), ts: 1000 + i })));
  const clk = clock();
  const s = open(file, clk);
  // first call: the newest 60 (a replay), lastSeq at the top
  const first = s.poll(-1, { sinceMs: 0 });
  assert.equal(first.rows.length, 60);
  assert.equal(first.lastSeq, 150);
  assert.deepEqual([first.rows[0].seq, first.rows[59].seq], [91, 150]);
  // a poll sooner than 2 s after the last one is refused without touching the database
  const n = s.stats.statements;
  clk.tick(POLL_MIN_MS - 1);
  const early = s.poll(0);
  assert.equal(early.throttled, true);
  assert.deepEqual(early.rows, []);
  assert.equal(s.stats.statements, n, 'a throttled poll runs no SQL');
  // a backlog is taken 60 rows at a time, in order, nothing twice, nothing lost
  const seen = [];
  let last = 0, more = true, polls = 0;
  while (more && polls < 10) {
    clk.tick(POLL_MIN_MS);
    const r = s.poll(last);
    assert.ok(r.rows.length <= POLL_MAX_ROWS);
    seen.push(...r.rows.map(m => m.seq));
    last = r.lastSeq;
    more = r.more;
    polls++;
  }
  assert.equal(polls, 3);
  assert.deepEqual(seen, Array.from({ length: 150 }, (_, i) => i + 1));
  assert.equal(more, false);
  s.close();
});

test('a start on an empty board begins at seq 0; a start replays only what is younger than sinceMs', () => {
  const file = goodDb();
  const s = open(file, clock());
  const e = s.poll(-1, {});
  assert.deepEqual([e.rows.length, e.lastSeq], [0, 0]);
  s.close();
  fill(file, [{ ts: 100, body: 'old' }, { ts: 5000, body: 'new' }]);
  const s2 = open(file, clock());
  const r = s2.poll(-1, { sinceMs: 1000 });
  assert.deepEqual(r.rows.map(m => m.text), ['new']);
  assert.equal(r.lastSeq, 2, 'but lastSeq is where the board stands');
  s2.close();
});

test('a quiet board costs almost no queries: a minute of one-second ticks runs a handful of statements', { skip: missing('v2') }, t => {
  const b = makeBoard('v2');
  const clk = clock();
  const s = open(b.db, clk);
  s.poll(-1, {});
  const afterOpen = s.stats.statements;
  for (let i = 0; i < 60; i++) { clk.tick(1000); s.poll(3); }
  const perMinute = s.stats.statements - afterOpen;
  t.diagnostic(`quiet board, 60 ticks of 1 s: ${perMinute} statements in the minute, ${s.stats.polls} polls ran, ${s.stats.idle} were idle (file unchanged), ${s.stats.throttled} throttled`);
  assert.ok(perMinute <= 20, `${perMinute} statements in a quiet minute`);
  assert.ok(s.stats.idle >= 20, 'most polls saw an unchanged file and ran no SQL');
  assert.equal(s.stats.polls + s.stats.throttled, 61);
  s.close();
});

test('a burst of 50 posts is delivered once each, in order, for a few statements', { skip: missing('v2') }, t => {
  const b = makeBoard('v2');
  const clk = clock();
  const s = open(b.db, clk);
  s.poll(-1, {});
  const base = s.stats.statements;
  const got = [];
  let last = 3;
  for (let sec = 1; sec <= 30; sec++) {
    clk.tick(1000);
    if (sec >= 2 && sec <= 11) insertRows(b.db, Array.from({ length: 5 }, (_, i) => ({ body: `burst ${sec}.${i}`, author: 'agent' + (i % 3) })));   // 50 posts over 10 s
    const r = s.poll(last);
    got.push(...r.rows);
    last = r.lastSeq;
  }
  t.diagnostic(`burst of 50 posts over 10 s, 30 ticks: ${s.stats.statements - base} statements (${s.stats.polls} polls ran, ${s.stats.idle} idle)`);
  assert.equal(got.length, 50);
  assert.deepEqual(got.map(m => m.seq), Array.from({ length: 50 }, (_, i) => 4 + i));
  assert.equal(new Set(got.map(m => m.seq)).size, 50);
  assert.ok(s.stats.statements - base <= 80, 'a burst is cheap: ' + (s.stats.statements - base));
  // one single batch of 50 at once: one poll
  insertRows(b.db, Array.from({ length: 50 }, (_, i) => ({ body: 'at once ' + i })));
  const n = s.stats.statements;
  clk.tick(2000);
  const r = s.poll(last);
  assert.equal(r.rows.length, 50);
  assert.ok(s.stats.statements - n <= 4, 'one poll for the whole batch: ' + (s.stats.statements - n) + ' statements');
  s.close();
});

test('snapshot of an unchanged board is reused: no queries until the file changes', { skip: missing('v2') }, () => {
  const b = makeBoard('v2');
  const clk = clock();
  const s = open(b.db, clk);
  s.snapshot({ sinceMs: 0 });
  const n = s.stats.statements;
  for (let i = 0; i < 5; i++) { clk.tick(2000); s.snapshot({ sinceMs: 0 }); }
  assert.equal(s.stats.statements, n);
  assert.equal(s.stats.snapshotReuse, 5);
  b.post('beta', 'general', 'a new one');
  clk.tick(2000);
  assert.equal(s.snapshot({ sinceMs: 0 }).messages.length, 4, 'a changed file is read again');
  s.close();
});

test('snapshot limits: at most 200 messages, 100 agents; counts look at the newest 2000 only', () => {
  const file = goodDb();
  fill(file, Array.from({ length: 2500 }, (_, i) => ({ body: 'm' + i, channel: i % 2 ? 'a' : 'b', ts: 5000 + i })));
  const s = open(file, clock());
  const snap = s.snapshot({ sinceMs: 0, limit: 5000 });
  assert.equal(snap.messages.length, SNAPSHOT_MAX_ROWS);
  assert.equal(snap.messages[SNAPSHOT_MAX_ROWS - 1].text, 'm2499');
  assert.equal(snap.truncated, true);
  assert.equal(snap.channels.reduce((n, c) => n + c.count, 0), 2000);
  assert.equal(snap.countsCapped, true);
  s.close();
});

// ---------------------------------------------------------------- hostile or odd content

test('a very long body is read in part and clipped to 400 characters', () => {
  const file = goodDb();
  const d = writer(file);
  d.prepare('INSERT INTO messages(ts_ms, channel, author, human, to_list, body) VALUES (?,?,?,?,?,?)').run(1, 'general', 'a', 0, '', 'word '.repeat(300000));
  d.close();
  const s = open(file, clock());
  const t0 = Date.now();
  const r = s.poll(-1, {});
  const snap = s.snapshot({ sinceMs: 0 });
  assert.ok(Date.now() - t0 < 2000);
  for (const m of [r.rows[0], snap.messages[0]]) {
    assert.ok(Array.from(m.text).length <= TEXT_MAX);
    assert.ok(m.text.endsWith('…'));
  }
  s.close();
});

test('control characters, bidi marks and odd names in the data never reach the output', () => {
  const file = goodDb();
  fill(file, [{
    author: 'ev\u0001il\u202e', channel: 'ge\u0007neral', to: 'bob,, \u200fcarol ,' + Array.from({ length: 30 }, (_, i) => 'n' + i).join(','),
    body: 'a\u0001b\u0007c \u202edcba\u200f\n\tline two\r\nthree four \u2066x\u2069',
  }]);
  const s = open(file, clock());
  const m = s.poll(-1, {}).rows[0];
  assert.equal(m.from, 'evil');
  assert.equal(m.channel, 'general');
  assert.equal(m.to.length, 20, 'at most 20 recipients');
  assert.deepEqual(m.to.slice(0, 3), ['bob', 'carol', 'n0']);
  assert.equal(m.text, 'abc dcba line two three four x');
  for (const v of [m.from, m.channel, m.text, ...m.to]) assert.ok(!/[\u0000-\u001f\u007f-\u009f\u200b\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/.test(v));
  s.close();
});

test('names and text made of emoji only are capped too: a board of huge emoji posts gives small answers', () => {
  const emoji = '\u{1F600}';
  const file = goodDb(["ALTER TABLE agents ADD COLUMN extra TEXT"]);
  const d = writer(file);
  const ins = d.prepare('INSERT INTO messages(ts_ms, channel, author, human, to_list, body) VALUES (?,?,?,?,?,?)');
  for (let i = 0; i < 5; i++) ins.run(1000 + i, emoji.repeat(20000), emoji.repeat(20000), 0, Array.from({ length: 30 }, () => emoji.repeat(500)).join(','), emoji.repeat(2000));
  d.prepare('INSERT INTO agents(name, kind, last_seen_ms) VALUES (?,?,?)').run(emoji.repeat(20000), emoji.repeat(20000), Date.now());
  d.close();
  const s = open(file, clock());
  const m = s.poll(-1, {}).rows[0];
  assert.deepEqual([Array.from(m.text).length, Array.from(m.from).length, Array.from(m.channel).length], [400, 80, 80]);
  assert.ok(m.to.length >= 1 && m.to.length <= 20 && m.to.every(n => Array.from(n).length <= 80), 'recipients: at most 20, each cut to 80 characters');
  const snap = s.snapshot({ sinceMs: 0 });
  assert.ok(JSON.stringify(snap).length < 12000, 'the whole snapshot is small: ' + JSON.stringify(snap).length);
  assert.ok(snap.agents.every(a => Array.from(a.name).length <= 80 && Array.from(a.kind).length <= 20));
  assert.ok(snap.channels.every(c => Array.from(c.name).length <= 80));
  s.close();
});

test('odd values in the columns are survived: nulls, numbers as text, a non-numeric timestamp', () => {
  const file = goodDb();
  const d = writer(file);
  d.exec("INSERT INTO messages(ts_ms, channel, author, human, to_list, body) VALUES ('soon', 'c', 'a', 'maybe', '', 'x')");
  d.exec("INSERT INTO messages(ts_ms, channel, author, human, to_list, body) VALUES (1.5, 'c', 'a', 1, 'b', 'y')");
  d.close();
  const s = open(file, clock());
  const rows = s.poll(-1, {}).rows;
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(m => [m.ts, m.human]), [[0, false], [1.5, true]]);
  s.close();
});

test('the office agent of a chat agent: the key first, then main agents by id, name or project', () => {
  const office = new Map([
    ['s1', { id: 's1', kind: 'main', name: 'One', project: 'proj' }],
    ['s2', { id: 's2', kind: 'main', name: 'Two', project: 'other' }],
    ['s3', { id: 's3', kind: 'sub', name: 'three', project: 'three' }],
  ]);
  assert.equal(findOfficeAgent(office, 'x', ['s2']).id, 's2', 'by key, whatever the name');
  assert.equal(findOfficeAgent(office, 'x', ['gone', 's1']).id, 's1', 'the first key that is in the office');
  assert.equal(findOfficeAgent(office, 'proj', []).id, 's1', 'by project');
  assert.equal(findOfficeAgent(office, 'Two', undefined).id, 's2', 'by name');
  assert.equal(findOfficeAgent(office, 's1', null).id, 's1', 'by id');
  assert.equal(findOfficeAgent(office, 'three', null), null, 'a subagent is only found by key');
  assert.equal(findOfficeAgent(office, 'nobody', []), null);
  assert.equal(findOfficeAgent(null, 'x', ['s1']), null);
});

test('close: a closed source is off and stays off', () => {
  const s = open(goodDb(), clock());
  assert.equal(s.state().state, 'ok');
  s.close();
  assert.deepEqual(s.state(), { state: 'off', schema: null, reason: 'closed' });
  assert.deepEqual(s.poll(-1, {}).rows, []);
});
