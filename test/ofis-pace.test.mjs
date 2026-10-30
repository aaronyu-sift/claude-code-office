// The frame pacer (public/js/ofis-pace.js) against made-up streams of animation-frame timestamps: nothing here needs a browser. The display is a grid of vsyncs with a little jitter; a
// stream can miss frames, change its rate, or be a machine whose GPU needs more than a frame (a model with two frames in flight).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createPacer, IDLE_FPS, DEEP_FPS, HOLD_MS, SW_FPS, DEEP_AFTER_MS, MAX_SKIP, GAP_CLEAN_MS, GAP_MAX_CHANGES, GAP_SPAN_MS, GAP_BACKOFF_MAX_MS, RESEED_RUN,
  SHADOW_MOVING_MS, SHADOW_IDLE_MS,
} from '../public/js/ofis-pace.js';

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const gauss = r => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
const gaps = d => d.slice(1).map((v, i) => v - d[i]);
const stat = g => { const m = g.reduce((a, b) => a + b, 0) / g.length; return { n: g.length, mean: m, sd: Math.sqrt(g.reduce((a, b) => a + (b - m) ** 2, 0) / g.length), min: Math.min(...g), max: Math.max(...g) }; };
const between = (d, a, b) => d.filter(t => t >= a && t < b);

// A display of `hz` for `ms`: rAF timestamps k * P + N(0, sigma). `events` are calls of wake() just before the callback at that time ({ at, ms }); `cost` is the CPU ms of a drawn frame;
// `late` the share of vsyncs the browser misses; `pre` the time the stream starts at; `pacer` an existing pacer (the stream goes on); `moveAll` keeps it moving all the time.
function run({ hz, ms, events = [], softwareGL = false, sigma = 0.3, cost = 1.7, late = 0, seed = 5, pre = 0, pacer = createPacer({ softwareGL }), maxFps }) {
  const P = 1000 / hz, r = rng(seed), draws = [], wakes = [...events].sort((a, b) => a.at - b.at);
  if (maxFps) pacer = createPacer({ softwareGL, maxFps });
  let drift = 0;
  for (let k = 0; k * P < ms; k++) {
    if (late && r() < late) drift += P;
    const now = pre + k * P + drift + (sigma ? gauss(r) * sigma : 0);
    while (wakes.length && wakes[0].at <= now) { const e = wakes.shift(); pacer.wake(e.at, e.ms); }
    if (pacer.due(now)) { draws.push(now); pacer.cost(cost); }
  }
  return { draws, pacer };
}

// A machine that needs `gpuMs` of GPU time for every frame drawn, with at most two frames in flight: a vsync that comes while two are still in the queue is missed (the browser does not
// hand over the animation frame), so the gaps that the pacer sees are the machine's own answer to the rate it asks for. `events` keep it moving. Returns what the guard did.
function gpuRun({ hz = 120, ms, gpuMs, pacer = createPacer(), moveFrom = 0, moveTo = ms, sigma = 0.2, seed = 11, pre = 1000 }) {
  const P = 1000 / hz, r = rng(seed), draws = [], levels = [], changes = [];
  const fin = [];                                   // when each frame in flight finishes on the GPU
  let lastFin = 0, last = null;
  for (let k = 0; k * P < ms; k++) {
    const now = pre + k * P + gauss(r) * sigma;
    while (fin.length && fin[0] <= now) fin.shift();
    if (fin.length >= 2) continue;                  // missed vsync
    if (now >= pre + moveFrom && now < pre + moveTo) pacer.wake(now, 100);
    if (pacer.due(now)) {
      draws.push(now);
      const start = Math.max(now, lastFin);
      lastFin = start + gpuMs; fin.push(lastFin);
      pacer.cost(1.5);
    }
    const g = pacer.state.gapSkip;
    if (g !== last) { if (last !== null) changes.push({ t: now - pre, to: g }); last = g; }
    levels.push(g);
  }
  return { draws, levels, changes, pacer };
}

test('pace: no dependence on focus, the page or a clock of its own', () => {
  const src = readFileSync(new URL('../public/js/ofis-pace.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  for (const word of ['hasFocus', 'document', 'window', 'performance', 'Date.now', 'setTimeout', 'requestAnimationFrame', 'THREE']) assert.ok(!src.includes(word), `the pacer mentions ${word}`);
});

test('pace: 119.9 Hz idles at 30 fps, a wake gives every display frame for the hold, then 30 fps again', () => {
  const { draws } = run({ hz: 119.9, ms: 6000, events: [{ at: 2000, ms: HOLD_MS }] });
  const idle = stat(gaps(between(draws, 0, 1990))), moving = stat(gaps(between(draws, 2010, 2990))), after = stat(gaps(between(draws, 3200, 6000)));
  assert.ok(Math.abs(idle.mean - 33.36) < 0.6, `idle ${idle.mean}`);
  assert.ok(Math.abs(after.mean - 33.36) < 0.6, `idle after the hold ${after.mean}`);
  assert.ok(Math.abs(moving.mean - 1000 / 119.9) < 0.3 && moving.max < 12, `moving ${moving.mean} max ${moving.max}`);
  const first = draws.find(t => t >= 2000);
  assert.ok(first - 2000 < 9.5, `the first moving frame came ${first - 2000} ms after the wake`);
  const last = between(draws, 2000, 3500).filter(t => t < 3010).pop();
  assert.ok(last > 2985 && last < 3012, `the last moving frame was at ${last}: the hold is 1000 ms`);
});

test('pace: the hold is about a second after the last wake, and a later wake with a shorter hold never shortens it', () => {
  const p = createPacer();
  p.due(100);
  p.wake(1000, HOLD_MS);
  p.wake(1100, 250);                                   // ends at 1350, the first hold ends at 2000
  p.due(1900); assert.equal(p.state.moving, true);
  p.due(2010); assert.equal(p.state.moving, false);
  p.wake(5000, 250); p.due(5100); assert.equal(p.state.moving, true);
  p.due(5300); assert.equal(p.state.moving, false, 'a 250 ms wake ends after 250 ms');
});

test('pace: other displays draw every frame while moving; idle is the nearest whole number of display frames, evenly', () => {
  const idleFps = { 60: 30, 75: 25, 90: 30, 100: 25, 144: 28.8, 165: 27.5, 240: 30 };
  for (const hz of [60, 75, 90, 100, 144, 165, 240]) {
    const mv = run({ hz, ms: 3000, events: [{ at: 0, ms: 3000 }] }), id = run({ hz, ms: 3000 });
    const gm = stat(gaps(between(mv.draws, 200, 2900))), gi = stat(gaps(between(id.draws, 200, 2900)));
    assert.ok(Math.abs(gm.mean - 1000 / hz) < 0.4, `${hz} Hz moving: gap ${gm.mean}`);
    assert.ok(Math.abs(1000 / gi.mean - idleFps[hz]) < 0.6, `${hz} Hz idle: ${1000 / gi.mean} fps`);
    assert.ok(gi.sd < 0.6, `${hz} Hz idle is uneven: sd ${gi.sd}`);
  }
});

test('pace: after 60 s of nothing the idle rate is 15 fps, and a wake brings the display rate back at once', () => {
  const { draws } = run({ hz: 120, ms: 70000, events: [{ at: 65000, ms: HOLD_MS }], sigma: 0.2 });
  const a = stat(gaps(between(draws, 1000, 59000))), b = stat(gaps(between(draws, 61000, 64900)));
  assert.ok(Math.abs(a.mean - 1000 / IDLE_FPS) < 0.5, `first minute ${a.mean}`);
  assert.ok(Math.abs(b.mean - 1000 / DEEP_FPS) < 1, `deep idle ${b.mean}`);
  const f = draws.find(t => t >= 65000);
  assert.ok(f - 65000 < 9.5, `wake from deep idle: ${f - 65000} ms`);
  assert.equal(DEEP_AFTER_MS, 60000);
});

test('pace: software GL draws at 8 fps whatever happens, and the decision is still made', () => {
  const { draws, pacer } = run({ hz: 60, ms: 4000, softwareGL: true, events: [{ at: 1000, ms: HOLD_MS }] });
  const g = stat(gaps(draws));
  assert.ok(Math.abs(g.mean - 1000 / SW_FPS) < 17, `software GL ${g.mean}`);
  assert.equal(pacer.state.fps, SW_FPS);
  const p = createPacer({ softwareGL: true });
  p.due(100); p.wake(100); p.due(150);
  assert.equal(p.state.moving, true, 'software GL still reads the decision');
});

test('pace: the cost guard draws every 2nd, 3rd or 4th frame when a frame costs more than 80 percent of a display frame, and does not flap', () => {
  const want = { 1.7: 1, 6: 1, 7.5: 2, 12: 2, 20: 4, 40: 4 };
  for (const [cost, skip] of Object.entries(want)) {
    const { draws, pacer } = run({ hz: 120, ms: 4000, events: [{ at: 0, ms: 4000 }], cost: +cost });
    const g = stat(gaps(between(draws, 1000, 3900)));
    assert.equal(pacer.state.costSkip, skip, `cost ${cost} ms`);
    assert.ok(Math.abs(g.mean - skip * 1000 / 120) < 1.2, `cost ${cost} ms -> gap ${g.mean}`);
  }
  // a frame that costs 7.5 ms and then gets cheap: back to every frame, in one step down each, never more than two changes
  const p = createPacer(); let changes = 0, last = 1;
  for (let k = 0; k < 600; k++) {
    const now = k * 8.33; p.wake(now, 100);
    if (p.due(now)) p.cost(k < 200 ? 7.5 : 1.5);
    if (p.state.costSkip !== last) { changes++; last = p.state.costSkip; }
  }
  assert.ok(changes <= 2, `${changes} changes`);
  assert.equal(p.state.costSkip, 1);
  assert.equal(MAX_SKIP, 4);
});

test('pace: a display that misses 1 percent of its frames keeps drawing every frame that comes, and idles near 30', () => {
  const mv = run({ hz: 120, ms: 5000, events: [{ at: 0, ms: 5000 }], late: 0.01 }), id = run({ hz: 120, ms: 20000, late: 0.01 });
  const gm = stat(gaps(between(mv.draws, 100, 4900))), gi = stat(gaps(between(id.draws, 100, 19900)));
  assert.ok(gm.max <= 17.6, `moving max gap ${gm.max}`);
  assert.ok(gi.max <= 43, `idle max gap ${gi.max}`);
  assert.equal(mv.pacer.state.gapSkip, 1, 'one late frame in a hundred is not a trend');
});

test('pace: a stream that changes its rate is read again after 12 odd gaps (a window on a 60 Hz screen, Energy Saver), and the gap guard starts over', () => {
  // 120 Hz for 3 s, then 60 Hz while moving all the time: no skipping at 60 Hz, one draw per animation frame
  const p = createPacer();
  const a = run({ hz: 120, ms: 3000, events: [{ at: 0, ms: 9000 }], pacer: p });
  assert.ok(Math.abs(p.state.period - 8.33) < 0.3, `period ${p.state.period}`);
  const b = run({ hz: 60, ms: 4000, pre: 3000, events: [{ at: 3000, ms: 5000 }], pacer: p });
  assert.ok(Math.abs(p.state.period - 16.67) < 0.4, `re-seeded to ${p.state.period}`);
  assert.equal(p.state.gapSkip, 1);
  assert.equal(p.state.skip, 1);
  const g = stat(gaps(between(b.draws, 3600, 7000)));
  assert.ok(Math.abs(g.mean - 16.67) < 0.5 && g.max < 20, `60 Hz moving gap ${g.mean} max ${g.max}`);
  assert.ok(p.stats.reseeds >= 1);
  // and idle there is 30 fps (two frames of 60 Hz), not 15
  const c = run({ hz: 60, ms: 4000, pre: 12000, pacer: p });
  const gi = stat(gaps(between(c.draws, 12500, 16000)));
  assert.ok(Math.abs(1000 / gi.mean - 30) < 0.8, `idle ${1000 / gi.mean} fps`);
  // 120 Hz -> 30 Hz (Chrome's Energy Saver)
  const q = createPacer();
  run({ hz: 120, ms: 2000, events: [{ at: 0, ms: 9000 }], pacer: q });
  run({ hz: 30, ms: 3000, pre: 2000, events: [{ at: 2000, ms: 9000 }], pacer: q });
  assert.ok(Math.abs(q.state.period - 33.3) < 0.8, `30 Hz period ${q.state.period}`);
  assert.equal(q.state.skip, 1, 'the 30 Hz stream is not read as late frames of 120 Hz');
  // and the other way: a 60 Hz window that moves to a 120 Hz screen
  const u = createPacer();
  run({ hz: 60, ms: 2000, events: [{ at: 0, ms: 9000 }], pacer: u });
  const w = run({ hz: 120, ms: 3000, pre: 2000, events: [{ at: 2000, ms: 9000 }], pacer: u });
  assert.ok(Math.abs(u.state.period - 8.33) < 0.3, `120 Hz period ${u.state.period}`);
  assert.ok(Math.abs(stat(gaps(between(w.draws, 2400, 4900))).mean - 8.33) < 0.3);
  assert.equal(RESEED_RUN, 12);
});

test('pace: a few odd gaps (one stall, two quick frames) do not change the period', () => {
  const p = createPacer();
  run({ hz: 120, ms: 2000, pacer: p });
  const before = p.state.period;
  let t = 2000;
  for (const g of [8.3, 8.3, 400, 8.3, 3, 14, 8.3, 8.3]) { t += g; p.due(t); }
  assert.ok(Math.abs(p.state.period - before) < 0.3);
  assert.equal(p.stats.reseeds, 0);
});

test('pace: a machine that cannot hold the display rate is drawn at half of it, the guard returns on a clean stretch and never flaps', () => {
  // a GPU that needs 12 ms a frame at 120 Hz (8.3 ms): 60 fps is the most it can do
  const r = gpuRun({ ms: 120000, gpuMs: 12 });
  assert.ok(r.pacer.state.gapSkip >= 2, `the guard stepped down: ${r.pacer.state.gapSkip}`);
  assert.ok(r.pacer.stats.steps >= 1);
  assert.ok(r.pacer.state.gapSkip <= 2, `a 60 fps machine does not need ${r.pacer.state.gapSkip}`);
  // never more than two changes in any 10 s, and the tries get rarer
  for (const c of r.changes) assert.ok(r.changes.filter(d => d.t >= c.t && d.t < c.t + GAP_SPAN_MS).length <= GAP_MAX_CHANGES, `more than ${GAP_MAX_CHANGES} changes within 10 s of ${c.t}`);
  const late = r.changes.filter(c => c.t > 60000).length, early = r.changes.filter(c => c.t <= 60000).length;
  assert.ok(late <= early, `tries get rarer: ${early} in the first minute, ${late} in the second`);
  assert.ok(r.changes.length <= 12, `${r.changes.length} changes in two minutes`);
  // the time spent drawing at the machine's own rate: most of it at level 2
  const share2 = r.levels.filter(l => l === 2).length / r.levels.length;
  assert.ok(share2 > 0.7, `${(share2 * 100).toFixed(0)} percent of the frames at level 2`);
  // a machine that needs 20 ms hands over frames unevenly (16.7 and 25 ms): that is the guard's to answer, not a new display period, and the two do not fight. It ends at 40 fps (level 3),
  // makes few changes, and the tries to go back get rarer
  const u = gpuRun({ ms: 120000, gpuMs: 20 });
  assert.ok(u.pacer.state.gapSkip >= 2 && u.pacer.state.gapSkip <= 3, `a 20 ms machine is at level ${u.pacer.state.gapSkip}`);
  assert.ok(u.changes.length <= 14, `${u.changes.length} changes in two minutes`);
  assert.ok(u.pacer.stats.reseeds <= 2, `${u.pacer.stats.reseeds} re-reads of the period`);
  for (const c of u.changes) assert.ok(u.changes.filter(d => d.t >= c.t && d.t < c.t + GAP_SPAN_MS).length <= GAP_MAX_CHANGES + 2, `changes within 10 s of ${c.t}`);
  // a machine that needs 30 ms (33 fps at most) hands over an animation frame every 4th vsync: that steady rate is read as the display's own (period re-seeded), and the scene draws
  // what it is handed, about 33 fps, never above MAX_SKIP
  const s = gpuRun({ ms: 60000, gpuMs: 30 });
  const tail = s.draws.filter(t => t > 1000 + 30000).length / 30;
  assert.ok(tail >= 25 && tail <= 36, `a 30 ms machine drew ${tail.toFixed(1)} frames a second`);
  assert.ok(s.pacer.state.gapSkip <= MAX_SKIP);
});

test('pace: a machine that keeps up never steps down, and a late frame now and then is not a trend', () => {
  const r = gpuRun({ ms: 60000, gpuMs: 5 });
  assert.equal(r.pacer.stats.steps, 0);
  assert.equal(r.pacer.state.gapSkip, 1);
  for (const seed of [9, 10, 12]) {
    const m = run({ hz: 120, ms: 60000, events: [{ at: 0, ms: 61000 }], late: 0.01, seed });
    assert.equal(m.pacer.stats.steps, 0, `1 percent late frames, seed ${seed}`);
  }
  const n = run({ hz: 120, ms: 20000, events: [{ at: 0, ms: 21000 }], late: 0.3, seed: 3 });
  assert.ok(n.pacer.stats.steps >= 1, '30 percent late frames are a trend');
});

test('pace: a stall (a hidden tab, a rebuild) is not a late frame, and only moving frames count', () => {
  const p = createPacer();
  run({ hz: 120, ms: 2000, pacer: p, events: [{ at: 0, ms: 90000 }] });
  let t = 2000;
  for (let i = 0; i < 40; i++) { t += 1000; p.wake(t, 100); p.due(t); p.due(t + 8.3); p.due(t + 16.6); }       // 40 stalls of a second each, between bursts of three frames
  assert.equal(p.state.gapSkip, 1, 'stalls say nothing about the machine');
  const q = createPacer();
  run({ hz: 120, ms: 3000, pacer: q });                        // idle: no wake, a stream of odd gaps would count if idle frames did
  let u = 3000;
  for (let i = 0; i < 100; i++) { u += i % 2 ? 8.3 : 25; q.due(u); }
  assert.equal(q.state.gapSkip, 1, 'idle gaps are not read');
});

test('pace: the guard steps back when the machine is clean again, one step at a time, after the wait', () => {
  const p = createPacer();
  // 0 to 20 s: a machine that needs 12 ms; then the work gets cheap (the GPU model with 3 ms)
  let t = 1000, gpu = 12, fin = [], lastFin = 0, r = rng(2), changes = [];
  const P = 1000 / 120;
  for (let k = 0; t < 1000 + 80000; k++) {
    t = 1000 + k * P + gauss(r) * 0.2;
    if (t > 1000 + 20000) gpu = 3;
    while (fin.length && fin[0] <= t) fin.shift();
    if (fin.length >= 2) continue;
    p.wake(t, 100);
    const g0 = p.state.gapSkip;
    if (p.due(t)) { lastFin = Math.max(t, lastFin) + gpu; fin.push(lastFin); p.cost(1.5); }
    if (p.state.gapSkip !== g0) changes.push([Math.round(t - 1000), p.state.gapSkip]);
  }
  assert.equal(p.state.gapSkip, 1, `back at the full rate: ${JSON.stringify(changes)}`);
  const back = changes.filter(c => c[0] > 20000 && c[1] === 1);
  assert.ok(back.length === 1, JSON.stringify(changes));
  assert.ok(back[0][0] - 20000 >= 0 && back[0][0] < 20000 + 2 * GAP_BACKOFF_MAX_MS, `came back at ${back[0][0]}`);
  assert.ok(GAP_CLEAN_MS >= 1000);
});

test('pace: the gap guard is off in software GL, and a wake shortens nothing there', () => {
  const r = gpuRun({ ms: 20000, gpuMs: 12, pacer: createPacer({ softwareGL: true }) });
  assert.equal(r.pacer.stats.steps, 0);
  assert.equal(r.pacer.state.gapSkip, 1);
});

test('pace: maxFps caps the moving rate in whole display frames, rounded up; no cap by default', () => {
  const a = run({ hz: 120, ms: 4000, events: [{ at: 0, ms: 4000 }], maxFps: 60 });
  assert.ok(Math.abs(stat(gaps(between(a.draws, 500, 3900))).mean - 16.67) < 0.5);
  assert.ok(Math.abs(a.pacer.state.fps - 60) < 0.6, `${a.pacer.state.fps}`);
  const b = run({ hz: 144, ms: 4000, events: [{ at: 0, ms: 4000 }], maxFps: 60 });
  assert.ok(1000 / stat(gaps(between(b.draws, 500, 3900))).mean <= 60.5, 'never above the cap');
  const c = run({ hz: 60, ms: 3000, events: [{ at: 0, ms: 3000 }], maxFps: 60 });
  assert.ok(Math.abs(stat(gaps(between(c.draws, 500, 2900))).mean - 16.67) < 0.5, 'a 60 Hz display under a cap of 60 draws every frame');
  const d = run({ hz: 120, ms: 3000, events: [{ at: 0, ms: 3000 }] });
  assert.ok(Math.abs(d.pacer.state.fps - 120) < 0.6, `${d.pacer.state.fps}`);
});

test('pace: the shadow map is drawn every 25 ms while a caster moves and every 400 ms otherwise, and fewer with the frames when the machine cannot keep up', () => {
  const p = createPacer();
  const count = (from, to, casters, step = 1000 / 120) => { let n = 0; for (let t = from; t < to; t += step) if (p.shadow(t, casters)) n++; return n; };
  assert.equal(count(0, 1000, true), 40, 'moving: 40 a second');
  const idle = count(1000, 2000, false);
  assert.ok(idle >= 2 && idle <= 3, `idle: one every 400 ms, got ${idle}`);
  // the 4-frame rate of a machine that is held to every 2nd frame: the shadow with it
  const q = createPacer();
  q.due(0); q.due(8);
  for (let k = 0, t = 0; k < 40; k++, t += 8.33) { q.wake(t, 100); q.due(t); q.cost(15); }
  assert.ok(q.skip >= 2);
  let n = 0;
  for (let t = 1000; t < 2000; t += 8.33) if (q.shadow(t, true)) n++;
  assert.ok(n <= 40 / q.skip + 1, `${n} shadow maps a second at skip ${q.skip}`);
  // a refresh somebody else asked for counts as the last one
  const s = createPacer();
  assert.equal(s.shadow(0, false), true);
  s.shadowTaken(380);
  assert.equal(s.shadow(400, false), false);
  assert.equal(s.shadow(780, false), true);
  assert.equal(s.stats.shadowSync, 1);
  assert.equal(SHADOW_MOVING_MS, 25);
  assert.equal(SHADOW_IDLE_MS, 400);
});

test('pace: the counters and the per-second record', () => {
  const { pacer } = run({ hz: 120, ms: 10000, events: [{ at: 2000, ms: HOLD_MS }, { at: 3000, ms: HOLD_MS }] });
  const st = pacer.stats;
  assert.ok(st.raf > 1100 && st.raf < 1300, `raf ${st.raf}`);
  assert.ok(st.movingDrawn > 150, `moving draws ${st.movingDrawn}`);
  assert.equal(st.wakes, 2);
  const sec = pacer.seconds(5);
  assert.equal(sec.length, 5);
  for (const r of sec) assert.ok(r.raf > 100 && r.raf < 130 && r.drawn <= r.raf && r.maxGap > 7 && r.maxGap < 12 && r.late === 0, JSON.stringify(r));
  const slow = run({ hz: 120, ms: 5000, late: 0.1, seed: 4 }).pacer.seconds(3);
  assert.ok(slow.every(r => r.late >= 3 && r.maxGap > 15), `late frames are counted: ${JSON.stringify(slow)}`);
  const sum = pacer.summary(10);
  assert.ok(sum.movingShare > 0.2 && sum.movingShare < 0.3, `moving share ${sum.movingShare}`);
  const idle = run({ hz: 120, ms: 8000 });
  assert.equal(idle.pacer.summary(6).movingShare, 0);
  // the state shape the QA and the page read
  for (const k of ['moving', 'fps', 'period', 'skip', 'costSkip', 'gapSkip', 'cost', 'deep']) assert.ok(k in pacer.state, k);
});

test('pace: due() is cheap and allocates nothing a frame at a time', () => {
  const p = createPacer();
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < 300000; k++) { const now = k * 8.33; if (k % 50 === 0) p.wake(now, 100); p.due(now); p.shadow(now, k % 3 === 0); }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(ms < 1500, `300000 frames took ${ms.toFixed(0)} ms`);
});
