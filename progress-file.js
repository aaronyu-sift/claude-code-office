'use strict';
// The progress of each chat's task list. The task tracker writes a snapshot file (default <claude dir>/office-progress.json, format in
// docs/progress.md) after every change; the Office reads it and puts each chat's entry on that chat's agent as `progress`.
//
// The file is data from outside, so it is never trusted: a missing, unreadable, malformed, oversize or unknown-version file means "no progress",
// one bad chat entry is dropped without hiding the others, every string is stripped of control characters and cut to a length, every number is
// a whole number inside a range, and the item list is capped (what matters stays: the item being worked on, blocked ones, then the rest).
// The page puts the strings on screen with textContent, never as HTML.
//
// The file is looked at with one stat per pass (a pass is the server's own one-second tick, at most once per `every`) and read again only when its
// identity, size or modification time changed, so an idle Office costs one stat every two seconds and no timer of its own.

const fs = require('fs');

const MAX_BYTES = 1024 * 1024;                      // a bigger file is refused without being read
const MAX_CHATS = 200;
const MAX_ITEMS = 40;                               // items kept per chat
const MAX_RAW_ITEMS = 2000;                         // items looked at per chat before the cap
const MAX_COUNT = 100000;
const STATUSES = new Set(['done', 'doing', 'blocked', 'todo']);
const PRIOS = new Set(['high', 'med', 'low', 'none']);
const SESSION_ID = /^[\w.:-]{1,128}$/;
const COMPLEXITY = /^[A-Za-z0-9+]{1,4}$/;
const MIN_MS = Date.UTC(2000, 0, 1), MAX_MS = Date.UTC(2100, 0, 1);
const KEEP_RANK = { doing: 0, blocked: 0, todo: 1, done: 2 };

// control characters, line and paragraph separators, zero-width marks and the bidirectional overrides that can reorder text on screen
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]+/g;

function text(v, n) {
  if (typeof v !== 'string') return '';
  const s = v.slice(0, n * 4).replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(s);                       // whole characters: a cut never splits a surrogate pair
  return chars.length > n ? chars.slice(0, n - 1).join('') + '…' : s;
}
const count = v => (Number.isFinite(v) ? Math.min(MAX_COUNT, Math.max(0, Math.floor(v))) : null);
// an ISO time string (with or without a colon in the offset) or epoch ms, as epoch ms; null for anything else or a date outside 2000-2100
function stamp(v) {
  const ms = typeof v === 'number' ? v : typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(ms) && ms >= MIN_MS && ms <= MAX_MS ? Math.round(ms) : null;
}

function item(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !STATUSES.has(raw.status)) return null;
  return {
    id: text(raw.id, 24), title: text(raw.title, 200), status: raw.status,
    prio: PRIOS.has(raw.prio) ? raw.prio : 'none',
    complexity: typeof raw.complexity === 'string' && COMPLEXITY.test(raw.complexity) ? raw.complexity : '',
    doingSince: stamp(raw.doingSince), doneAt: stamp(raw.doneAt),
  };
}

// at most MAX_ITEMS, in their own order: the ones being worked on and blocked first, then the open ones, then the finished ones
function capItems(list) {
  if (list.length <= MAX_ITEMS) return list;
  const keep = list.map((it, i) => ({ it, i })).sort((a, b) => KEEP_RANK[a.it.status] - KEEP_RANK[b.it.status] || a.i - b.i).slice(0, MAX_ITEMS);
  return keep.sort((a, b) => a.i - b.i).map(k => k.it);
}

function chat(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const all = (Array.isArray(raw.items) ? raw.items.slice(0, MAX_RAW_ITEMS) : []).map(item).filter(Boolean);
  const tally = s => all.filter(it => it.status === s).length;
  // the counts of the file are the truth about the whole list; the items are only the part of it that is shown
  const done = count(raw.done) ?? tally('done'), doing = count(raw.doing) ?? tally('doing'), blocked = count(raw.blocked) ?? tally('blocked');
  const total = Math.max(count(raw.total) ?? all.length, done + doing + blocked);
  if (!total) return null;
  return { topic: text(raw.topic, 120), updatedAt: stamp(raw.updatedAt), total, done, doing, blocked, items: capItems(all) };
}

// The text of a snapshot file -> Map session id -> progress. Anything that is not the documented shape gives an empty map.
function parseSnapshot(source) {
  const out = new Map();
  let d;
  try { d = JSON.parse(source); } catch { return out; }
  if (!d || typeof d !== 'object' || Array.isArray(d) || (d.version !== undefined && d.version !== 1)) return out;
  const chats = d.chats;
  if (!chats || typeof chats !== 'object' || Array.isArray(chats)) return out;
  for (const sid of Object.keys(chats)) {
    if (out.size >= MAX_CHATS) break;
    if (!SESSION_ID.test(sid)) continue;
    const c = chat(chats[sid]);
    if (c) out.set(sid, c);
  }
  return out;
}

// `file` is the snapshot path; `step()` looks at it (cheaply, at most every `every` ms); `of(sessionId)` is that chat's progress or null;
// `all()` is every parsed entry, as a plain object. `load(text)` replaces the content without a file (the demo).
function createProgress({ file, every = 2000, now = Date.now, fsx = fs } = {}) {
  let map = new Map(), key = '', at = -Infinity;
  function look() {
    let st;
    try { st = fsx.statSync(file); } catch { key = ''; map = new Map(); return; }              // missing: no progress
    const k = `${st.ino}:${st.size}:${st.mtimeMs}`;
    if (k === key) return;
    if (!st.isFile() || st.size > MAX_BYTES) { key = k; map = new Map(); return; }
    let source;
    try { source = fsx.readFileSync(file, 'utf8'); } catch { key = ''; map = new Map(); return; }   // gone between the stat and the read: asked again next pass
    key = k;
    map = parseSnapshot(source);
  }
  return {
    step() { const t = now(); if (!file || t - at < every) return; at = t; look(); },
    of: sid => map.get(sid) || null,
    all: () => Object.fromEntries(map),
    load(source) { map = parseSnapshot(source); },
  };
}

module.exports = { createProgress, parseSnapshot, MAX_BYTES, MAX_CHATS, MAX_ITEMS };
