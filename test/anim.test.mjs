import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduler } from '../public/js/pixel/anim.js';

// a tiny event loop: 1 ms steps, rAF fires on a 60 Hz grid, timers when due
function world() {
  const w = { t: 0, hidden: false, reduced: false, draws: [], rafs: [], timers: [], rafCalls: 0, nextId: 1 };
  w.sched = createScheduler({
    draw: (t, anim) => w.draws.push([t, anim]),
    maxFps: 10,
    raf: f => { const id = w.nextId++; w.rafs.push([id, f]); return id; },
    caf: id => { w.rafs = w.rafs.filter(r => r[0] !== id); },
    setTimer: (f, ms) => { const id = w.nextId++; w.timers.push([id, w.t + ms, f]); return id; },
    clearTimer: id => { w.timers = w.timers.filter(x => x[0] !== id); },
    now: () => w.t,
    isHidden: () => w.hidden,
    reducedMotion: () => w.reduced,
  });
  w.run = ms => {
    for (let i = 0; i < ms; i++) {
      w.t++;
      for (const x of w.timers.filter(x => x[1] <= w.t)) { w.timers = w.timers.filter(y => y !== x); x[2](); }
      if (w.t % 16 === 0) { const q = w.rafs; w.rafs = []; for (const [, f] of q) { w.rafCalls++; f(w.t); } }
    }
  };
  return w;
}

test('scheduler: nothing runs without a request or an active animation', () => {
  const w = world();
  w.run(2000);
  assert.equal(w.draws.length, 0);
  assert.equal(w.rafCalls, 0);
  assert.equal(w.sched.pending, false);
});

test('scheduler: an animation source draws at most 10 frames per second', () => {
  const w = world();
  w.sched.setActive('typing', true);
  w.run(5000);
  assert.ok(w.draws.length >= 40 && w.draws.length <= 51, `drew ${w.draws.length} frames in 5 s`);
  assert.ok(w.draws.every(d => d[1] === true));
  for (let i = 1; i < w.draws.length; i++) assert.ok(w.draws[i][0] - w.draws[i - 1][0] >= 90, 'frames closer than 90 ms');
});

test('scheduler: with every source off it stops by itself and costs nothing', () => {
  const w = world();
  w.sched.setActive('a', true); w.sched.setActive('b', true);
  w.run(500);
  w.sched.setActive('a', false);
  w.run(500);
  const n = w.draws.length;
  w.sched.setActive('b', false);
  w.run(100);
  const after = w.draws.length, calls = w.rafCalls;
  w.run(3000);
  assert.ok(n > 0);
  assert.ok(w.draws.length - after <= 1);
  assert.equal(w.rafCalls, calls, 'rAF still ticking while idle');
  assert.equal(w.sched.pending, false);
});

test('scheduler: while the page is hidden no callback runs, and it resumes when shown', () => {
  const w = world();
  w.sched.setActive('typing', true);
  w.run(300);
  w.hidden = true;
  w.run(100);                                             // let an in-flight frame drain
  const draws = w.draws.length, calls = w.rafCalls;
  w.sched.requestFrame();
  w.run(3000);
  assert.equal(w.draws.length, draws);
  assert.equal(w.rafCalls, calls);
  w.hidden = false;
  w.sched.wake();
  w.run(1000);
  assert.ok(w.draws.length > draws);
});

test('scheduler: reduced motion ignores animation sources but still draws explicit requests', () => {
  const w = world();
  w.reduced = true;
  w.sched.setActive('typing', true);
  w.run(2000);
  assert.equal(w.draws.length, 0);
  w.sched.requestFrame();
  w.run(100);
  assert.equal(w.draws.length, 1);
  assert.equal(w.draws[0][1], false);
});

test('scheduler: explicit requests are coalesced into one frame', () => {
  const w = world();
  w.sched.requestFrame(); w.sched.requestFrame(); w.sched.requestFrame();
  w.run(100);
  assert.equal(w.draws.length, 1);
  assert.equal(w.sched.stats.frames, 1);
});

test('scheduler: the ambient source joins the others without adding frames and stops when nobody is awake', () => {
  const w = world();
  for (const k of ['typing', 'attention', 'ambient']) w.sched.setActive(k, true);
  w.run(5000);
  assert.ok(w.draws.length >= 40 && w.draws.length <= 51, `three sources drew ${w.draws.length} frames in 5 s`);
  assert.deepEqual(w.sched.activeSources.sort(), ['ambient', 'attention', 'typing']);
  for (const k of ['typing', 'attention', 'ambient']) w.sched.setActive(k, false);
  w.run(300);
  const n = w.draws.length, calls = w.rafCalls;
  w.run(3000);
  assert.equal(w.draws.length, n);
  assert.equal(w.rafCalls, calls);
});
