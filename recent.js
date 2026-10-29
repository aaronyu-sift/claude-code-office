'use strict';
// Recently closed Claude Code sessions: a transcript (<projDir>/<project>/<sessionId>.jsonl) written within the window whose session has no
// live process. Transcripts are big (a median of 2 MB, some of 90 MB) and this runs on the user's own disk next to everything else they do,
// so a scan is built to cost little and never to repeat itself:
//   - a project directory is listed again only when its own mtime changed (a new transcript changes it);
//   - the files already known are stat'ed each pass (a stat is cheap) and only the newest `max` of them are ever read, through `read(file)`;
//   - a file whose size and mtime did not change is never read again;
//   - a pass stops reading when its time budget is spent and carries on at the next pass, newest first, so the list fills from the top.
// The close time is the moment the server saw the process go (`add`), otherwise the file's mtime: Claude Code appends its bookkeeping
// records (last prompt, title, cost) when a chat ends, so the mtime is when the chat was closed, not when its last message was written.

const fs = require('fs');
const path = require('path');

const TRANSCRIPT = /^[\w.-]+\.jsonl$/;
const DAY = 86400e3;

function createRecent(o) {
  const {
    projDir, read, days = 14, max = 50, budgetMs = 150,
    now = Date.now, clock = () => performance.now(), fsx = fs,
  } = o;
  const files = new Map();                         // file -> { id, dir, size, mtimeMs, summary, tried }
  const dirs = new Map();                          // directory -> its mtime when it was last listed
  const observed = new Map();                      // session id -> when the server saw it close
  let last = { ms: 0, dirs: 0, listed: 0, statted: 0, read: 0, readMs: 0, pending: 0, files: 0, window: days };

  const idOf = f => f.slice(0, -'.jsonl'.length);
  const newer = (a, b) => b.closedAt - a.closedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  function entry(file, dir) {
    let e = files.get(file);
    if (!e) files.set(file, e = { id: idOf(path.basename(file)), dir, size: -1, mtimeMs: -1, summary: null, tried: false });
    return e;
  }
  function load(file, e) {
    const t0 = clock();
    let s = null;
    try { s = read(file, { size: e.size, mtimeMs: e.mtimeMs }) || null; } catch { s = null; }     // an unreadable file is not retried until it changes
    e.summary = s; e.tried = true;
    last.read++; last.readMs += clock() - t0;
  }

  // One pass. `live` is the set of session ids that have a live process (they are not closed). Returns the list, newest first.
  function scan(live = new Set()) {
    const t0 = clock(), deadline = t0 + budgetMs, t = now();
    last = { ms: 0, dirs: 0, listed: 0, statted: 0, read: 0, readMs: 0, pending: 0, files: 0, window: days };
    if (days > 0) {
      let names = [];
      try { names = fsx.readdirSync(projDir); } catch { /* no projects yet */ }
      const seen = new Set();
      for (const n of names) {
        const dir = path.join(projDir, n);
        let st;
        try { st = fsx.statSync(dir); } catch { continue; }
        if (!st.isDirectory()) continue;
        seen.add(dir); last.dirs++;
        if (dirs.get(dir) === st.mtimeMs) continue;                                 // nothing was added or removed there
        dirs.set(dir, st.mtimeMs); last.listed++;
        let list = [];
        try { list = fsx.readdirSync(dir); } catch { continue; }
        for (const f of list) if (TRANSCRIPT.test(f)) entry(path.join(dir, f), dir);
      }
      for (const d of [...dirs.keys()]) if (!seen.has(d)) dirs.delete(d);
      for (const [file, e] of [...files]) {                                         // known files: still there, still in the window, changed?
        let st;
        try { st = fsx.statSync(file); } catch { files.delete(file); continue; }
        last.statted++;
        if (t - st.mtimeMs > days * DAY) { files.delete(file); continue; }
        if (st.size !== e.size || st.mtimeMs !== e.mtimeMs) { e.size = st.size; e.mtimeMs = st.mtimeMs; e.summary = null; e.tried = false; }
      }
    } else { files.clear(); dirs.clear(); }
    last.files = files.size;
    const top = [...files.entries()].filter(([, e]) => !live.has(e.id))
      .sort((a, b) => b[1].mtimeMs - a[1].mtimeMs || (a[1].id < b[1].id ? -1 : 1)).slice(0, max);
    for (const [file, e] of top) {
      if (e.tried) continue;
      if (last.read > 0 && clock() >= deadline) { last.pending++; continue; }       // out of time: the next pass goes on (always one read per pass)
      load(file, e);
    }
    for (const id of [...observed.keys()]) if (![...files.values()].some(e => e.id === id)) observed.delete(id);
    last.ms = clock() - t0;
    return list(live);
  }

  // The closed sessions known now, newest first: the top `max` files that have a summary.
  function list(live = new Set()) {
    const out = [];
    for (const e of files.values()) {
      if (!e.summary || live.has(e.id)) continue;
      const at = observed.get(e.id);
      out.push({ ...e.summary, id: e.id, closedAt: at != null ? Math.max(at, e.mtimeMs) : e.mtimeMs, observed: at != null });
    }
    return out.sort(newer).slice(0, max);
  }

  // A session the server just saw close: read it now, whatever the budget (one tail), so it shows on the shelf at once.
  function add(file, at = now()) {
    let st;
    try { st = fsx.statSync(file); } catch { return null; }
    const e = entry(file, path.dirname(file));
    e.size = st.size; e.mtimeMs = st.mtimeMs;
    observed.set(e.id, at);
    load(file, e);
    return e.summary;
  }

  return { scan, list, add, get stats() { return last; } };
}

module.exports = { createRecent };
