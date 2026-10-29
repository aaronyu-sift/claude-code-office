'use strict';
// Is the process behind a ~/.claude/sessions/<pid>.json file still that chat? The file is named after the pid and Claude Code does not always
// remove it when the chat ends (a crash, a killed window, a restart). The pid is then given to another program, and a bare "does this pid exist"
// check keeps the dead chat on screen as a working agent: a file from August made Notes.app look like a chat for two months.
//
// The file records when the chat's process started (`procStart`, UTC, in `ps` format; not `startedAt`, which is the session's start and may
// be older than the process of a resumed chat). A process cannot start after its own record, so a process that started later than it is
// another program that has the pid now. The test is one-sided on purpose: a record that is a little late or early never hides a live chat,
// only a process that is clearly newer does. A file without `procStart` (an older Claude Code, a test fixture) is trusted as before.

const { execFileSync } = require('child_process');

const SLACK_MS = 5000;                           // `ps` shows whole seconds, and the record is written a moment after the process starts
const RECHECK_MS = 30e3;                         // a verified pid is looked at again after this long (a pid can be reused later)

// `ps -o etime=`: [[dd-]hh:]mm:ss, the time the process has been running
function parseElapsed(text) {
  const m = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s*$/.exec(String(text || ''));
  if (!m) return null;
  return (((+m[1] || 0) * 24 + (+m[2] || 0)) * 3600 + +m[3] * 60 + +m[4]) * 1000;
}

// the process start time a session file records, as epoch ms, or null
function recordedStart(s) {
  if (!s || typeof s.procStart !== 'string') return null;
  const t = Date.parse(s.procStart.replace(/\s+/g, ' ').trim() + ' UTC');
  return Number.isFinite(t) ? t : null;
}

// true when a process that started `elapsedMs` before `at` is clearly newer than the session the file records
function startedAfterRecord(s, elapsedMs, at) {
  const rec = recordedStart(s);
  return rec !== null && elapsedMs !== null && at - elapsedMs > rec + SLACK_MS;
}

function psElapsed(pid) {
  try { return parseElapsed(execFileSync('ps', ['-o', 'etime=', '-p', String(pid)], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return null; }
}

// `alive(pid)` is the plain existence check; `elapsed(pid)` how long it has run (null when it cannot be read: then the pid is trusted, as before)
function createSessionCheck({ alive, elapsed = psElapsed, now = Date.now, recheckMs = RECHECK_MS }) {
  const seen = new Map();                        // `${pid}:${recorded start}` -> { at, ok }
  return function sessionAlive(pid, s) {
    if (!alive(pid)) return false;
    const rec = recordedStart(s);
    if (rec === null) return true;
    const key = `${pid}:${rec}`, t = now(), hit = seen.get(key);
    if (hit && t - hit.at < recheckMs) return hit.ok;
    const ok = !startedAfterRecord(s, elapsed(pid), t);
    seen.set(key, { at: t, ok });
    if (seen.size > 500) for (const [k, v] of seen) if (t - v.at > recheckMs) seen.delete(k);
    return ok;
  };
}

module.exports = { createSessionCheck, parseElapsed, recordedStart, startedAfterRecord };
