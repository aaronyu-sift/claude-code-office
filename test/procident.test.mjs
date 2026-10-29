import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionCheck, parseElapsed, recordedStart, startedAfterRecord } from '../procident.js';

const MIN = 60e3, DAY = 86400e3;
// the two real files that started this: a chat from 2026-08-27 whose pid Notes.app got on 2026-10-09, and a live chat
const STALE = { pid: 1509, sessionId: 's1', startedAt: 1787863886696, procStart: 'Thu Aug 27 20:51:22 2026', name: 'ayu-46' };
const LIVE = { pid: 78765, sessionId: 's2', startedAt: Date.UTC(2026, 9, 29, 5, 30, 31), procStart: 'Thu Oct 29 05:30:30 2026' };
const at = Date.UTC(2026, 9, 29, 17, 17, 44);

test('procident: ps elapsed time formats', () => {
  assert.equal(parseElapsed('06:00'), 360e3);
  assert.equal(parseElapsed('  09:06:00\n'), (9 * 3600 + 6 * 60) * 1000);
  assert.equal(parseElapsed('20-09:06:00'), (20 * 86400 + 9 * 3600 + 6 * 60) * 1000);
  assert.equal(parseElapsed(''), null);
  assert.equal(parseElapsed('not a time'), null);
});

test('procident: the recorded start is procStart read as UTC; startedAt says nothing about the process', () => {
  assert.equal(recordedStart(LIVE), Date.UTC(2026, 9, 29, 5, 30, 30));
  assert.equal(recordedStart({ procStart: 'Thu Oct  9 01:11:44 2026' }), Date.UTC(2026, 9, 9, 1, 11, 44));       // ps pads a one-digit day with a space
  assert.equal(recordedStart({ startedAt: 123 }), null, 'a resumed chat keeps an old startedAt in a new process');
  assert.equal(recordedStart({ procStart: 'garbage' }), null);
  assert.equal(recordedStart({}), null);
});

test('procident: only a process clearly newer than its record is another program', () => {
  const rec = recordedStart(LIVE);
  const elapsedFor = start => at - start;
  assert.equal(startedAfterRecord(LIVE, elapsedFor(rec), at), false, 'started when the record says');
  assert.equal(startedAfterRecord(LIVE, elapsedFor(rec + 3000), at), false, 'a few seconds of slack');
  assert.equal(startedAfterRecord(LIVE, elapsedFor(rec - DAY), at), false, 'older than the record (a resumed chat): never hidden');
  assert.equal(startedAfterRecord(LIVE, elapsedFor(rec + MIN), at), true, 'a minute newer: another program');
  assert.equal(startedAfterRecord(LIVE, null, at), false, 'elapsed time unreadable: trusted');
  assert.equal(startedAfterRecord({ sessionId: 'x' }, 1000, at), false, 'no record: trusted');
  assert.equal(startedAfterRecord({ sessionId: 'x', startedAt: at - 10 * DAY }, 1000, at), false, 'startedAt alone (an older Claude Code, a fixture) is never used to hide a chat');
});

test('procident: a dead pid is dead; the stale August file whose pid Notes.app now has is not a chat; a live chat is', () => {
  const alive = new Set([1509, 78765]);
  const elapsed = pid => (pid === 1509 ? at - Date.UTC(2026, 9, 9, 8, 11, 44) : at - Date.UTC(2026, 9, 29, 5, 30, 30));
  const check = createSessionCheck({ alive: p => alive.has(p), elapsed, now: () => at });
  assert.equal(check(1509, STALE), false, 'pid reused by another program');
  assert.equal(check(78765, LIVE), true);
  assert.equal(check(99999, { ...LIVE, sessionId: 's3' }), false, 'no such process');
});

test('procident: a pid is checked once in a while, not on every pass (ps is a process spawn)', () => {
  let t = at, calls = 0;
  const check = createSessionCheck({ alive: () => true, elapsed: () => { calls++; return at - recordedStart(LIVE); }, now: () => t, recheckMs: 30e3 });
  for (let i = 0; i < 10; i++) { assert.equal(check(78765, LIVE), true); t += 1000; }
  assert.equal(calls, 1);
  t += 30e3;
  check(78765, LIVE);
  assert.equal(calls, 2, 'looked at again after the interval');
});

test('procident: the real ps answers for this very process', () => {
  const check = createSessionCheck({ alive: p => { try { process.kill(p, 0); return true; } catch { return false; } } });
  const start = Date.now() - process.uptime() * 1000;
  assert.equal(check(process.pid, { procStart: new Date(start).toUTCString().replace(/^(\w+), (\d+) (\w+) (\d+) ([\d:]+) GMT$/, '$1 $3 $2 $5 $4') }), true, 'a record of this process: alive');
  assert.equal(check(process.pid, { procStart: 'Thu Aug 27 20:51:22 2026' }), false, 'this process is newer than a record from August');
});
