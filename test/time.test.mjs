import test from 'node:test';
import assert from 'node:assert/strict';
import { SUN, sunTimes, phaseAt, parseClock, fmtClock, ambient, keyframes, createMinuteTicker, PHASES } from '../public/js/pixel/time.js';

const at = (h, m = 0) => h * 60 + m;

test('sunrise and sunset by month: sunrise before sunset, longest day in June, shortest in December', () => {
  assert.equal(SUN.length, 12);
  const len = SUN.map(([r, s]) => s - r);
  for (const [r, s] of SUN) assert.ok(r > at(4) && r < at(8) && s > at(16) && s < at(20) && r < s);
  assert.equal(len.indexOf(Math.max(...len)), 5, 'June has the longest day');
  assert.equal(len.indexOf(Math.min(...len)), 11, 'December has the shortest day');
  assert.deepEqual(sunTimes(6), [at(4, 35), at(19, 30)]);
  assert.deepEqual(sunTimes(12), [at(7, 20), at(16, 40)]);
  assert.deepEqual(sunTimes(13), sunTimes(1), 'months wrap');
});

test('phases of the day in March, June and December', () => {
  const table = {
    3: [[at(2), 'night'], [at(5, 40), 'dawn'], [at(6, 15), 'dawn'], [at(9), 'day'], [at(12), 'day'], [at(16, 40), 'golden'], [at(18, 30), 'dusk'], [at(22), 'night']],
    6: [[at(2), 'night'], [at(4, 0), 'dawn'], [at(5), 'dawn'], [at(6), 'day'], [at(9), 'day'], [at(12), 'day'], [at(18, 30), 'golden'], [at(19, 45), 'dusk'], [at(22), 'night']],
    12: [[at(2), 'night'], [at(6), 'night'], [at(7, 30), 'dawn'], [at(9), 'day'], [at(12), 'day'], [at(15, 30), 'golden'], [at(17), 'dusk'], [at(22), 'night']],
  };
  for (const [month, rows] of Object.entries(table)) for (const [min, want] of rows) assert.equal(phaseAt(min, +month), want, `month ${month} at ${fmtClock(min)}`);
  assert.deepEqual([...new Set(Array.from({ length: 1440 }, (_, m) => phaseAt(m, 6)))].sort(), [...PHASES].sort());
});

test('?time=HH:MM parses and prints back', () => {
  assert.equal(parseClock('06:00'), 360);
  assert.equal(parseClock('18:30'), 1110);
  assert.equal(parseClock('2200'), 1320);
  assert.equal(parseClock('7:05'), 425);
  for (const bad of ['24:00', '12:60', 'noon', '', null, '1:2']) assert.equal(parseClock(bad), null, String(bad));
  assert.equal(fmtClock(1110), '18:30');
  assert.equal(fmtClock(-30), '23:30');
});

test('lights and tint: dark at night, off at noon, a believable curve between; no sky fields', () => {
  for (const month of [1, 4, 7, 10]) {
    const noon = ambient(at(12), month), night = ambient(at(2), month);
    assert.equal(noon.lights, 0); assert.equal(noon.room[3], 0); assert.equal(noon.phase, 'day');
    assert.equal(night.lights, 1); assert.ok(night.room[3] > 0.25 && night.room[3] <= 0.4); assert.equal(night.phase, 'night');
    for (const k of ['sun', 'moon', 'stars', 'top', 'bottom']) assert.ok(!(k in noon) && !(k in night), `the scene has no sky: ambient() has no ${k}`);
  }
  const [, ss] = sunTimes(6);
  assert.ok(ambient(ss + 20, 6).lights > 0.5, 'lamps are on soon after sunset');
  assert.ok(ambient(ss - 120, 6).lights === 0, 'and off two hours before');
});

test('ambient changes smoothly: no jump between two minutes, every value in range', () => {
  for (const month of [3, 6, 12]) {
    let prev = ambient(0, month);
    for (let m = 1; m <= 1440; m++) {
      const a = ambient(m, month);
      assert.ok(Math.abs(a.room[3] - prev.room[3]) < 0.02, `tint jumps at ${fmtClock(m)}`);
      assert.ok(Math.abs(a.lights - prev.lights) < 0.05, `lights jump at ${fmtClock(m)}`);
      for (const c of [a.room.slice(0, 3), a.out.slice(0, 3)]) assert.ok(c.every(v => v >= 0 && v <= 255));
      prev = a;
    }
  }
  const K = keyframes(6);
  for (let i = 1; i < K.length; i++) assert.ok(K[i][0] >= K[i - 1][0], 'keyframes in order');
});

test('the minute ticker fires at the minute boundary and a fixed time never schedules anything', () => {
  let nowMs = new Date(2026, 5, 15, 12, 34, 40, 0).getTime();
  const timers = [], seen = [];
  const t = createMinuteTicker({ onChange: c => seen.push(c.minute), now: () => new Date(nowMs), setTimer: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimer: () => {} });
  assert.equal(timers.length, 1);
  assert.ok(timers[0].ms > 19000 && timers[0].ms < 21000, `first timer waits for the next minute, got ${timers[0].ms}`);
  nowMs += timers[0].ms; timers[0].f();
  assert.deepEqual(seen, [12 * 60 + 35]);
  assert.equal(timers.length, 2, 'it re-arms after firing');
  t.stop();
  nowMs += timers[1].ms; timers[1].f();
  assert.deepEqual(seen, [12 * 60 + 35], 'a stopped ticker does not fire');
  const fixed = []; createMinuteTicker({ onChange() {}, fixed: 360, setTimer: (f, ms) => fixed.push(ms) });
  assert.equal(fixed.length, 0);
});
