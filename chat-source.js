'use strict';
// Reader of the agent chat database (docs/chat-source.md). It is the one place in the Office that knows how the board is stored: the
// bridge (chatbridge.js) and the lounge endpoint (GET /api/lounge) read through it and see only the plain objects it returns.
//
// What it promises, whatever version of the chat tool wrote the file:
//  - READ-ONLY. The file is opened with the read-only flag and PRAGMA query_only=ON, no statement here writes, and no read transaction is held
//    between calls (every statement runs to its end, so a WAL checkpoint is never blocked).
//  - CONTRACT-ONLY. It uses the tables and columns of CONTRACT and nothing else. Extra tables, extra columns, an index, a full-text table or a
//    vector file next to the database are ignored. A missing contract column or table, or a file that cannot be read, gives the state
//    "unsupported" with a one-line reason; a missing file gives "off". Nothing here throws into the server loop.
//  - UPGRADE-SAFE. The database is reopened and checked again when its schema cookie or meta.schema_version changes, when the file is replaced
//    (another inode) or, on a WAL board, when the database file itself changes (a backup copied over it in place), so a migration or a restore
//    that happens while the Office runs is picked up without a restart. poll() answers reset when the board is another one (meta.db_id) or went
//    backwards.
//  - CHEAP. poll() reads by the primary key (seq > last, at most POLL_MAX_ROWS rows, never a scan, never a sort on an unindexed column), runs at
//    most once per POLL_MIN_MS, and runs no SQL at all while the file (database and -wal) is unchanged: it compares two stat() results, and
//    only every CHECK_EVERY_MS does it look at the database anyway, as a safety net.
//  - SAFE TO SHOW. Text is stripped of control characters and bidirectional marks, whitespace is collapsed, and every field is cut to a length.
//    The page must still put it on screen with textContent, never as HTML.

const fs = require('fs');
const path = require('path');

let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch { /* Node without node:sqlite: the source reports "unsupported" */ }

// The columns the Office needs. Everything else in the database is none of its business.
const CONTRACT = Object.freeze({
  meta: Object.freeze(['k', 'v']),
  messages: Object.freeze(['seq', 'ts_ms', 'channel', 'author', 'to_list', 'body', 'human']),
  agents: Object.freeze(['name', 'kind', 'last_seen_ms']),
  agent_keys: Object.freeze(['key', 'agent']),
});

const POLL_MIN_MS = 2000;        // no poll runs sooner than this after the last one
const POLL_MAX_ROWS = 60;        // rows one poll returns; a bigger backlog is taken over the next polls
const SNAPSHOT_MAX_ROWS = 200;   // rows a snapshot returns at most
const SNAPSHOT_ROWS = 60;
const TEXT_MAX = 400;            // characters of a message text
const NAME_MAX = 80;             // characters of an agent, channel or recipient name
const TO_MAX = 20;               // recipients kept per message
const BODY_READ = 2000;          // characters read from a body; the rest is never loaded
const KEYS_MAX = 5000;
const AGENTS_MAX = 100;
const COUNT_SCAN_MAX = 2000;     // per-channel counts look at the newest messages only, at most this many
const CHECK_EVERY_MS = 15e3;     // a quiet file is looked at anyway this often (safety net for a missed change)
const RETRY_MS = 5e3;            // after a failed open
const RETRY_SLOW_MS = 30e3;      // after a check that found the contract broken, while the file stays as it is
const BUSY_MS = 300;             // busy timeout of the connection: the server loop must not stall for long
const SNAP_REUSE_MS = 30e3;      // a snapshot of an unchanged file is reused while its window moved less than this

const MSG_COLS = "seq, ts_ms, channel, author, to_list, substr(body, 1, " + BODY_READ + ') AS body, human';
const SQL = {
  rows: `SELECT ${MSG_COLS} FROM messages WHERE seq > ? ORDER BY seq LIMIT ${POLL_MAX_ROWS}`,
  newest: `SELECT ${MSG_COLS} FROM messages ORDER BY seq DESC LIMIT ?`,
  top: 'SELECT seq FROM messages ORDER BY seq DESC LIMIT 1',
  counts: `SELECT channel, COUNT(*) AS n FROM (SELECT channel, ts_ms FROM messages ORDER BY seq DESC LIMIT ${COUNT_SCAN_MAX}) WHERE ts_ms >= ? GROUP BY channel ORDER BY n DESC, channel LIMIT 50`,
  agents: `SELECT name, kind, last_seen_ms FROM agents WHERE last_seen_ms >= ? ORDER BY last_seen_ms DESC LIMIT ${AGENTS_MAX}`,
  keys: `SELECT key, agent FROM agent_keys WHERE key LIKE 'session:%' LIMIT ${KEYS_MAX}`,
  meta: "SELECT k, v FROM meta WHERE k IN ('schema_version', 'db_id')",
  cookie: 'PRAGMA schema_version',
};

// ---------------------------------------------------------------- text

// Whitespace-like controls become a space; the other controls, the bidirectional marks (LRM, RLM, ALM, embeddings, overrides, isolates), the
// zero-width space, the word joiner and the byte order mark are removed. The joiners U+200C and U+200D stay: emoji and several scripts need them.
const SPACEY = /[\t\n\v\f\r\u0085\u2028\u2029]+/g;
const STRIP = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]+/g;

function clean(v, n) {
  if (v == null) return '';
  let s = typeof v === 'string' ? v : String(v);
  s = s.replace(SPACEY, ' ').replace(STRIP, '').replace(/\s{2,}/g, ' ').trim();
  if (s.length <= n) return s;                       // fewer UTF-16 units means fewer characters
  // Whole characters: a cut never splits a surrogate pair. 2n+2 units hold at least n+1 characters when the text is longer than that (a character is
  // at most 2 units), so a text of astral characters only (emoji) is cut too; a shorter text is counted exactly.
  const chars = Array.from(s.slice(0, n * 2 + 2));
  return chars.length > n ? chars.slice(0, n - 1).join('') + '…' : s;
}

function mapRow(r) {
  const seq = Number(r.seq);
  if (!Number.isFinite(seq)) return null;
  const ts = Number(r.ts_ms);
  const to = [];
  if (typeof r.to_list === 'string' && r.to_list) {
    for (const part of r.to_list.slice(0, 2000).split(',')) {
      const n = clean(part, NAME_MAX);
      if (n) to.push(n);
      if (to.length >= TO_MAX) break;
    }
  }
  return {
    seq, ts: Number.isFinite(ts) ? ts : 0, channel: clean(r.channel, NAME_MAX), from: clean(r.author, NAME_MAX), to,
    text: clean(r.body, TEXT_MAX), human: Number(r.human) === 1,
  };
}

// ---------------------------------------------------------------- opening and checking

// The only way this module opens a database. A write through the handle fails (read-only flag and query_only).
function openReadOnly(file, busyMs = BUSY_MS) {
  if (!DatabaseSync) throw new Error('node:sqlite is not available in this Node (22.13 or newer is needed)');
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(busyMs))}`);
    db.exec('PRAGMA query_only = ON');
  } catch (e) {
    try { db.close(); } catch { /* closed */ }
    throw e;
  }
  return db;
}

const oneLine = (s, n = 160) => String(s == null ? '' : s).split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, n);
// SQLITE_BUSY (5) and SQLITE_LOCKED (6): somebody else holds a lock, the file is fine
const isBusy = e => !!e && ([5, 6].includes(Number(e.errcode) & 0xff) || /database (table )?is locked|SQLITE_BUSY/i.test(String(e.message)));

function readMeta(rows) {
  let version = '', identity = '';
  for (const r of rows) {
    if (r.k === 'schema_version') version = oneLine(r.v, 20);
    else if (r.k === 'db_id') identity = oneLine(r.v, 40);
  }
  return { version, identity };
}
const schemaOf = version => (/^\d{1,9}$/.test(version) ? Number(version) : (version || null));

// What is in the file, against CONTRACT. Throws only on a database error; a database that does not meet the contract returns problems.
function inspect(db) {
  const problems = [];
  const have = {};
  let statements = 0;                // how many queries this check ran (counted in stats.statements)
  for (const [table, cols] of Object.entries(CONTRACT)) {
    statements++;
    // table_xinfo, not table_info: the latter hides generated columns, which a SELECT reads like any other
    const names = new Set(db.prepare(`PRAGMA table_xinfo(${table})`).all().map(c => String(c.name).toLowerCase()));
    if (!names.size) { problems.push(`table ${table} is missing`); continue; }
    have[table] = true;
    const miss = cols.filter(c => !names.has(c));
    if (miss.length) { problems.push(`${table} lacks ${miss.join(', ')}`); have[table] = false; }
  }
  let meta = { version: '', identity: '' };
  if (have.meta) { statements++; meta = readMeta(db.prepare(SQL.meta).all()); }
  // the poll must be an index search by seq, or it would read the whole table on every call
  if (have.messages) {
    try {
      statements++;
      const plan = db.prepare('EXPLAIN QUERY PLAN ' + SQL.rows).all(0).map(r => String(r.detail));
      if (!plan.some(d => /^SEARCH\b/.test(d)) || plan.some(d => /TEMP B-TREE|^SCAN\b/.test(d))) {
        problems.push('messages.seq is not the primary key or indexed (a poll would scan the table)');
      }
    } catch (e) { problems.push('the poll query does not run: ' + oneLine(e.message, 80)); }
  }
  statements++;
  const cookie = db.prepare(SQL.cookie).get();
  return { statements, problems, version: meta.version, identity: meta.identity, schema: schemaOf(meta.version), cookie: String(cookie ? cookie.schema_version : '') };
}

// Check a database file against the contract without keeping anything open (tools/check-chat-contract.mjs, tests).
function checkDatabase(file, { busyMs = BUSY_MS } = {}) {
  if (!file || !fs.statSync(String(file), { throwIfNoEntry: false })) {
    return { state: 'off', schema: null, reason: 'database file not found: ' + path.basename(String(file || '')), problems: [] };
  }
  if (!DatabaseSync) return { state: 'unsupported', schema: null, reason: 'node:sqlite is not available in this Node (22.13 or newer is needed)', problems: [] };
  let db = null;
  try {
    db = openReadOnly(file, busyMs);
    const info = inspect(db);
    if (info.problems.length) return { state: 'unsupported', schema: info.schema, reason: info.problems.slice(0, 3).join('; '), problems: info.problems };
    return { state: 'ok', schema: info.schema, reason: '', problems: [] };
  } catch (e) {
    const reason = isBusy(e) ? 'database is locked' : 'cannot read the database: ' + oneLine(e.message, 100);
    return { state: 'unsupported', schema: null, reason, problems: [reason] };
  } finally {
    try { if (db) db.close(); } catch { /* closed */ }
  }
}

// ---------------------------------------------------------------- finding the office session of a chat agent

// The chat agent's name -> the office agent: the agent_keys rows 'session:<id>' first (written when a Claude Code session joins the board),
// else the main office agent whose id, name or project equals the name.
function findOfficeAgent(office, name, sids) {
  if (!office || typeof office.get !== 'function') return null;
  for (const sid of sids || []) {
    const a = office.get(sid);
    if (a) return a;
  }
  for (const a of office.values()) {
    if (a.kind === 'main' && (a.id === name || a.name === name || a.project === name)) return a;
  }
  return null;
}

// ---------------------------------------------------------------- the source

function createChatSource(dbPath, { log = console.error, now: clock = Date.now, busyMs = BUSY_MS } = {}) {
  const file = dbPath ? String(dbPath) : null;
  const base = file ? path.basename(file) : '';
  let realFile = file;          // the path with symbolic links resolved (at the last open): SQLite names the -wal file after it, not after the link
  let db = null;
  let stmts = null;
  let cur = { state: 'off', schema: null, reason: file ? '' : 'no chat database configured' };
  let shapeCookie = '', shapeVersion = '', identity = '';   // what the open connection was checked against
  let openIno = null;
  let shapeSig = '', shapeMain = '', shapeWal = '-';   // file signature (whole, database part, log part) at the last open or shape check
  let liveSig = null;           // the signature taken right after the last open
  let checkedAt = -Infinity;    // the last slow shape check (ready()); poll() keeps its own clock for the board check, see topCheckAt
  let retryAt = 0;
  // Two flags that outlive the call that sets them: a reopen can happen inside snapshot() or poll(), whichever comes first, and poll() must still
  // hear about it. Both are cleared by poll() only.
  let needTop = true;           // the connection was (re)opened: poll() looks at the top seq once, in case the board went backwards
  let resetPending = false;     // the last open found another board (meta.db_id changed): the next poll answers reset
  let topCheckAt = -Infinity;   // the last time poll() looked at the top seq (its own safety-net clock, apart from the snapshot's)
  let started = false;          // has the state been worked out at least once
  let closed = false;
  let lastPollAt = -Infinity;
  let lastSig = '';             // file signature taken before the last poll query that left nothing behind
  let gateSeq = -2;             // the lastSeq that poll left the caller with (a caller that asks from another seq is never gated)
  let pending = false;          // the last poll was full: more rows are waiting, so do not gate on the file
  let keys = new Map();         // chat agent name -> [session ids]
  let keysAt = -Infinity;
  let snap = null;
  let logged = '';
  const stats = { statements: 0, polls: 0, throttled: 0, idle: 0, snapshots: 0, snapshotReuse: 0, opens: 0, reopens: 0 };

  const say = msg => { if (logged !== msg) { logged = msg; try { log('[chat] ' + msg); } catch { /* a broken logger must not break the loop */ } } };

  function set(state, schema, reason) {
    const was = cur.state === 'ok' ? cur.schema : undefined;
    cur = { state, schema, reason };
    if (state === 'ok') say(`reading ${file} (read-only), schema ${schema == null ? 'unknown' : schema}` + (was !== undefined && was !== schema ? ` (was ${was})` : ''));
    else say(`${state}: ${reason}`);
  }

  // every statement goes through here, so stats.statements is the real number of queries made against the database
  const all = (name, ...args) => { stats.statements++; return stmts[name].all(...args); };
  const get = (name, ...args) => { stats.statements++; return stmts[name].get(...args); };

  function closeDb() {
    stmts = null;
    snap = null;
    keysAt = -Infinity;
    try { if (db) db.close(); } catch { /* already closed */ }
    db = null;
  }

  // identity, size and modification time of the database and of its write-ahead log: two stat calls, no SQL. The log is looked up under the
  // resolved name (realFile): with a symbolic link as the path SQLite writes <target>-wal, and <link>-wal never exists.
  function sigOf() {
    const stat = f => { try { return fs.statSync(f, { bigint: true, throwIfNoEntry: false }) || null; } catch { return null; } };
    const st = stat(file);
    if (!st) return null;
    const w = stat(realFile + '-wal');
    const main = `${st.ino}:${st.size}:${st.mtimeNs}`, wal = w ? `${w.ino}:${w.size}:${w.mtimeNs}` : '-';
    return { key: main + '|' + wal, ino: String(st.ino), main, wal };
  }
  const remember = sig => { shapeSig = sig.key; shapeMain = sig.main; shapeWal = sig.wal; };

  // Open the file and check it against the contract. Sets the state. Returns true when it can be read.
  // Opening a WAL database can create its (empty) -wal and -shm files, so the signature is taken again afterwards: that one is the baseline.
  function attempt(t, sig) {
    const ok = open1(t, sig);
    liveSig = file ? sigOf() : null;
    if (liveSig) { remember(liveSig); if (ok) openIno = liveSig.ino; }
    return ok;
  }

  function open1(t, sig) {
    closeDb();
    if (!file) { set('off', null, 'no chat database configured'); retryAt = Infinity; return false; }
    if (!sig) { set('off', null, 'database file not found: ' + base); retryAt = t + POLL_MIN_MS; return false; }
    if (!DatabaseSync) { set('unsupported', null, 'node:sqlite is not available in this Node (22.13 or newer is needed)'); retryAt = Infinity; return false; }
    stats.opens++;
    remember(sig);
    let info;
    try {
      try { realFile = fs.realpathSync.native(file); } catch { realFile = file; }
      db = openReadOnly(file, busyMs);
      info = inspect(db);
      stats.statements += info.statements;
    } catch (e) {
      closeDb();
      if (isBusy(e)) {
        if (cur.state === 'ok') cur = { ...cur, reason: 'database is busy, will retry' };
        else set('unsupported', null, 'database is locked, will retry');
      } else set('unsupported', null, 'cannot read the database: ' + oneLine(e.message, 100));
      retryAt = t + RETRY_MS;
      return false;
    }
    if (info.problems.length) {
      closeDb();
      set('unsupported', info.schema, info.problems.slice(0, 3).join('; '));
      retryAt = t + RETRY_SLOW_MS;
      return false;
    }
    try {
      stmts = {};
      for (const name of ['rows', 'newest', 'top', 'counts', 'agents', 'keys', 'meta', 'cookie']) stmts[name] = db.prepare(SQL[name]);
    } catch (e) {
      closeDb();
      set('unsupported', info.schema, 'a query does not run: ' + oneLine(e.message, 100));
      retryAt = t + RETRY_SLOW_MS;
      return false;
    }
    if (cur.state === 'ok' && cur.schema !== info.schema) stats.reopens++;
    if (identity !== '' && info.identity !== '' && info.identity !== identity) resetPending = true;     // another board under the same name
    needTop = true;
    shapeCookie = info.cookie; shapeVersion = info.version; identity = info.identity;
    openIno = sig.ino; checkedAt = t; retryAt = 0;
    set('ok', info.schema, '');
    return true;
  }

  // Is the open connection still the right one for this file? One cheap PRAGMA each time; the logical version too on the slow pass.
  function stillRight(full) {
    try {
      const c = get('cookie');
      if (String(c ? c.schema_version : '') !== shapeCookie) return false;
      if (full) {
        const m = readMeta(all('meta'));
        if (m.version !== shapeVersion || (m.identity !== identity && m.identity !== '' && identity !== '')) return false;
      }
      return true;
    } catch (e) {
      return isBusy(e);            // busy: cannot tell, keep the connection and look again next time
    }
  }

  // Make the connection ready for a read at time t; `sig` is the file signature taken just now. Returns { ok, sig }. When it had to reopen, it
  // sets needTop (and resetPending for another board), which poll() acts on whoever made the reopen.
  function ready(t, sig) {
    started = true;
    const no = () => ({ ok: false, sig });
    if (!file || closed) return no();
    if (!sig) {                                                // the file is gone, or was never there
      if (db || t >= retryAt || cur.state !== 'off') attempt(t, null);
      return no();
    }
    const reopen = () => { const ok = attempt(t, sig); return { ok, sig: liveSig || sig }; };
    if (!db) return t < retryAt && sig.key === shapeSig ? no() : reopen();
    if (sig.ino !== openIno) return reopen();                  // another file under that name
    // The database file itself changed. A board in WAL mode only changes it at a checkpoint (rare, and a reopen costs a few statements), or when
    // somebody copied another file over it in place: that leaves this connection with pages of the old file in its cache, and only a new
    // connection sees the new one. (A board in rollback-journal mode rewrites the file at every commit and SQLite notices that itself.)
    if (sig.main !== shapeMain && (sig.wal !== '-' || shapeWal !== '-')) return reopen();
    const due = t - checkedAt >= CHECK_EVERY_MS;
    if (sig.key === shapeSig && !due) return { ok: true, sig };
    if (!stillRight(due)) return reopen();
    remember(sig);
    if (due) checkedAt = t;
    return { ok: true, sig };
  }

  // a database error in the middle of a read: a busy file is retried, anything else drops the connection and says why
  function failed(t, e) {
    if (isBusy(e)) {
      cur = { ...cur, reason: 'database is busy, will retry' };
      lastSig = '';
      return;
    }
    closeDb();
    set('unsupported', cur.schema, 'read failed: ' + oneLine(e && e.message, 100));
    retryAt = t + RETRY_MS;
    lastSig = '';
  }

  function refreshKeys(t, maxAge) {
    if (t - keysAt < maxAge) return;
    keysAt = t;
    try {
      const map = new Map();
      for (const r of all('keys')) {
        const name = clean(r.agent, NAME_MAX), key = String(r.key || '');
        if (!name || !key.startsWith('session:')) continue;
        const sid = key.slice('session:'.length);
        if (!sid) continue;
        if (!map.has(name)) map.set(name, []);
        map.get(name).push(sid);
      }
      keys = map;
    } catch { /* keep the map we have; the next call tries again */ }
  }

  // ------------------------------------------------------------ API

  function state() {
    if (!started) { try { ready(clock(), file ? sigOf() : null); } catch (e) { set('unsupported', null, 'check failed: ' + oneLine(e && e.message, 100)); } }
    return { state: cur.state, schema: cur.schema, reason: cur.reason };
  }

  // Rows with seq > lastSeq, oldest first (at most POLL_MAX_ROWS). lastSeq < 0 (or not a number) means "start": the newest rows younger than
  // opts.sinceMs are returned, and lastSeq is where the board stands now. opts.now is the caller's clock (defaults to Date.now).
  // Returns { rows, lastSeq, more, reset, throttled }. `reset` says the board went backwards or was replaced: continue from the lastSeq given.
  function poll(lastSeq, opts = {}) {
    const t = Number.isFinite(opts.now) ? opts.now : clock();
    const first = !(Number.isFinite(lastSeq) && lastSeq >= 0);
    const out = { rows: [], lastSeq: first ? -1 : lastSeq, more: false, reset: false, throttled: false };
    try {
      if (t >= lastPollAt && t - lastPollAt < POLL_MIN_MS) { stats.throttled++; out.throttled = true; return out; }
      lastPollAt = t;
      stats.polls++;
      const r = ready(t, file ? sigOf() : null);
      if (!r.ok) return out;
      const sig = r.sig;
      // the board is looked at from its top once after every open and then every CHECK_EVERY_MS, on this clock only (snapshot() has its own)
      const check = needTop || t - topCheckAt >= CHECK_EVERY_MS;
      if (!first && !pending && !check && sig.key === lastSig && lastSeq === gateSeq) { stats.idle++; return out; }   // same file, same place: nothing can be new
      const sinceMs = Number.isFinite(opts.sinceMs) ? opts.sinceMs : 0;
      let raw;
      if (first) {
        raw = all('newest', POLL_MAX_ROWS);                                             // newest first
        out.lastSeq = raw.length ? Math.max(0, Number(raw[0].seq) || 0) : 0;
        out.rows = raw.map(mapRow).filter(m => m && m.ts >= sinceMs).reverse();
        pending = false; resetPending = false; needTop = false; topCheckAt = t;
      } else if (resetPending) {                                                        // another board: its rows do not continue ours, whatever their number
        const top = get('top');
        out.reset = true; out.lastSeq = top ? Number(top.seq) || 0 : 0;
        pending = false; resetPending = false; needTop = false; topCheckAt = t;
      } else {
        raw = all('rows', lastSeq);
        for (const m of raw) { const s = Number(m.seq); if (Number.isFinite(s) && s > out.lastSeq) out.lastSeq = s; }
        out.rows = raw.map(mapRow).filter(Boolean);
        out.more = raw.length >= POLL_MAX_ROWS;
        pending = out.more;
        if (!raw.length && check) {                                                     // nothing new: did the board go backwards (a restored backup)?
          const top = get('top');
          const topSeq = top ? Number(top.seq) || 0 : 0;
          if (topSeq < lastSeq) { out.reset = true; out.lastSeq = topSeq; }
        }
        if (raw.length || check) { needTop = false; topCheckAt = t; }                   // rows past lastSeq: the board is not behind us
      }
      lastSig = sig.key;
      gateSeq = out.lastSeq;
      if (cur.state === 'ok' && cur.reason) cur = { ...cur, reason: '' };
      if (out.rows.length) refreshKeys(t, 0);                                           // a session that just joined must map at once
    } catch (e) {
      failed(t, e);
      out.rows = []; out.more = false; out.reset = false;
      out.lastSeq = first ? -1 : lastSeq;
    }
    return out;
  }

  // The recent board in one object: { state, now, sinceMs, messages (oldest first), channels [{ name, count }], agents, truncated, countsCapped }.
  // opts.office is the Office's agent map (id -> agent); each active chat agent then carries the Office session it maps to.
  function snapshot(opts = {}) {
    const t = Number.isFinite(opts.now) ? opts.now : clock();
    const sinceMs = Number.isFinite(opts.sinceMs) ? opts.sinceMs : 0;
    const limit = Math.max(1, Math.min(SNAPSHOT_MAX_ROWS, Math.floor(Number(opts.limit)) || SNAPSHOT_ROWS));
    const empty = () => ({ state: state(), now: t, sinceMs, messages: [], channels: [], agents: [], truncated: false, countsCapped: false });
    try {
      const r = ready(t, file ? sigOf() : null);
      if (!r.ok) return empty();
      const sig = r.sig;
      stats.snapshots++;
      let d;
      if (snap && snap.limit === limit && snap.sig === sig.key && Math.abs(sinceMs - snap.sinceMs) < SNAP_REUSE_MS && t - snap.at < CHECK_EVERY_MS) {
        d = snap;                                                                       // the file has not changed: nothing to read again
        stats.snapshotReuse++;
      } else {
        const raw = all('newest', limit);
        const mapped = raw.map(mapRow).filter(Boolean);
        const oldest = mapped.length ? mapped[mapped.length - 1] : null;
        const counts = all('counts', sinceMs).map(c => ({ name: clean(c.channel, NAME_MAX), count: Number(c.n) || 0 }));
        const rows = all('agents', sinceMs);
        refreshKeys(t, 0);
        d = snap = {
          limit, sig: sig.key, sinceMs, at: t,
          messages: mapped.filter(m => m.ts >= sinceMs).reverse(),
          truncated: raw.length >= limit && !!oldest && oldest.ts >= sinceMs,
          channels: counts,
          countsCapped: counts.reduce((n, c) => n + c.count, 0) >= COUNT_SCAN_MAX,
          agentRows: rows.map(a => ({ name: clean(a.name, NAME_MAX), kind: clean(a.kind, 20), lastSeenMs: Number(a.last_seen_ms) || 0 })).filter(a => a.name),
        };
      }
      const office = opts.office;
      const agents = d.agentRows.map(a => {
        const sids = keys.get(a.name) || [];
        const o = findOfficeAgent(office, a.name, sids);
        return { ...a, session: o && sids.includes(o.id) ? o.id : (sids[0] || null), office: o ? o.id : null };
      });
      return { state: state(), now: t, sinceMs: d.sinceMs, messages: d.messages, channels: d.channels, agents, truncated: d.truncated, countsCapped: d.countsCapped };
    } catch (e) {
      failed(t, e);
      return empty();
    }
  }

  // The Office agent a chat agent name stands for (agent_keys first, then name or project), as of the last time the keys were read.
  const officeAgent = (office, name) => findOfficeAgent(office, name, keys.get(name));

  function close() { closed = true; closeDb(); cur = { state: 'off', schema: null, reason: 'closed' }; }

  return { state, poll, snapshot, officeAgent, close, stats };
}

module.exports = {
  CONTRACT, POLL_MIN_MS, POLL_MAX_ROWS, TEXT_MAX, SNAPSHOT_MAX_ROWS,
  createChatSource, checkDatabase, openReadOnly, findOfficeAgent, clean,
};
