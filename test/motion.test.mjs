import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { DUR, EASE, LOOP, CYCLE, SLIDE, SCALE, SPRING, wave, Spring, springParams, springState, settleTime, springLinear, slideFrom, comesFrom, enter, leave, setShown } from '../public/js/motion.js';
import { block } from '../tools/motion/gen-springs.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// a stand-in for an element whose animations can be finished or cancelled by the test
function fakeEl(hidden = true) {
  const el = { hidden, dataset: {}, calls: [], animate(keyframes, opts) {
    let done, fail;
    const finished = new Promise((res, rej) => { done = res; fail = rej; });
    finished.catch(() => {});                       // as in a browser: a cancelled animation's `finished` only matters to whoever asked for it
    const a = { keyframes, opts, finished, cancelled: false, finish: () => done(), cancel() { this.cancelled = true; fail(new Error('cancelled')); } };
    el.calls.push(a);
    return a;
  } };
  return el;
}
const tick = () => new Promise(r => setTimeout(r, 0));
const fade = el => el.calls.filter(a => 'opacity' in a.keyframes[0]);
const move = el => el.calls.filter(a => 'translate' in a.keyframes[0]);
const numbers = css => css.match(/-?\d*\.?\d+/g).map(Number);

test('motion: the rules hold together (leaving is quicker than arriving, nothing travels far, no wild bounce)', () => {
  assert.ok(DUR.hover < DUR.fast && DUR.fast < DUR.slow);
  assert.ok(SLIDE <= 24, 'no full-width slides');
  assert.ok(SCALE >= 0.9 && SCALE < 1);
  assert.ok(SPRING.leave.ms < SPRING.enter.ms, 'a card leaves faster than it arrives');
  assert.equal(SPRING.leave.bounce, 0, 'leaving does not bounce');
  for (const [name, s] of Object.entries(SPRING)) assert.ok(s.bounce <= 0.4, `${name}: Apple warns that a bounce above about 0.4 feels exaggerated in a UI`);
  for (const name of Object.keys(EASE)) assert.match(EASE[name], /^cubic-bezier\(/);
});

test('motion by kind: bounce follows the trigger and the size (surfaces and the camera never overshoot, a control may hint, a built thing may bounce)', () => {
  for (const name of ['enter', 'leave', 'glide', 'follow']) assert.equal(SPRING[name].bounce, 0, `${name}: a click has no momentum (WWDC18 803: 100% damping), so no overshoot`);
  assert.ok(SPRING.pop.bounce > 0 && SPRING.pop.bounce <= 0.15, 'a small control may hint at a bounce, up to the base bounce of Apple\'s .snappy');
  assert.equal(SPRING.build.bounce, 0.3, 'a built thing bounces like Apple\'s .bouncy');
  assert.equal(SPRING.build.duration, 0.5, 'and has its duration');
  for (const name of ['enter', 'glide', 'follow']) assert.ok(SPRING[name].duration >= SPRING.pop.duration, 'a larger thing is not faster than a small one (Material 3: fast for switches, slower for larger surfaces)');
});

test('loops: indicators follow the clock on two tempos and never flash more than 3 times a second', () => {
  assert.deepEqual(LOOP, { slow: 2400, quick: 1200 });
  assert.ok(1000 / LOOP.quick <= 3, 'WCAG 2.3.1: at most three flashes in any second');
  assert.ok(Math.abs(wave(0, 1000)) < 1e-12 && Math.abs(wave(250, 1000) - 1) < 1e-12 && Math.abs(wave(750, 1000) + 1) < 1e-12, 'a sine: rises from 0 to 1, falls to -1');
  assert.ok(Math.abs(wave(300, 1000) - wave(1300, 1000)) < 1e-9, 'periodic');
  assert.ok(Math.abs(wave(0, 1000, 0.25) - 1) < 1e-12, 'a phase in turns, so two copies need not blink together');
  const css = readFileSync(join(ROOT, 'public/app.css'), 'utf8');
  for (const [k, v] of Object.entries(LOOP)) assert.ok(css.includes(`--loop-${k}: ${v}ms`), `--loop-${k}`);
  const loops = css.split('\n').filter(l => /animation:[^;]*infinite/.test(l));
  assert.ok(loops.length >= 3);
  for (const l of loops) assert.match(l, /var\(--loop-(slow|quick)\)/, `a loop with its own period: ${l.trim().slice(0, 80)}`);
});

test('springs: duration and bounce become stiffness and damping (mass 1, stiffness (2 pi / duration)^2, bounce 0 is critically damped)', () => {
  const p = springParams({ duration: 0.5, bounce: 0 });
  assert.ok(Math.abs(p.stiffness - (2 * Math.PI / 0.5) ** 2) < 1e-9);
  assert.ok(Math.abs(p.damping - 2 * Math.sqrt(p.stiffness)) < 1e-9, 'critical damping at bounce 0');
  assert.equal(p.zeta, 1);
  const b = springParams({ duration: 0.5, bounce: 0.3 });
  assert.ok(Math.abs(b.zeta - 0.7) < 1e-9 && b.damping < p.damping, 'more bounce, less damping');
  assert.equal(b.stiffness, p.stiffness, 'the duration alone sets the stiffness');
});

test('springs: a step starts at rest, ends at the target, and a spring without bounce never overshoots', () => {
  for (const [name, s] of Object.entries(SPRING)) {
    const [x0, v0] = springState(s, 0);
    assert.equal(x0, 0); assert.equal(v0, 0);
    assert.ok(Math.abs(springState(s, s.seconds + 0.5)[0] - 1) < 1e-3, `${name} arrives`);
    let peak = 0;
    for (let t = 0; t <= s.seconds; t += 0.002) peak = Math.max(peak, springState(s, t)[0]);
    if (s.bounce === 0) assert.ok(peak <= 1 + 1e-9, `${name} does not overshoot`);
    else assert.ok(peak > 1.002, `${name} overshoots a little`);
  }
});

test('springs: the overshoot is the textbook value exp(-pi zeta / sqrt(1 - zeta^2))', () => {
  for (const bounce of [0.15, 0.3, 0.4]) {
    const spec = { duration: 0.5, bounce }, zeta = 1 - bounce;
    let peak = 0;
    for (let t = 0; t < 1.5; t += 0.0005) peak = Math.max(peak, springState(spec, t)[0]);
    assert.ok(Math.abs(peak - 1 - Math.exp(-Math.PI * zeta / Math.sqrt(1 - zeta * zeta))) < 5e-4, `bounce ${bounce}`);
  }
});

test('springs: the velocity is the derivative of the position, with or without an initial velocity', () => {
  for (const spec of [{ duration: 0.4, bounce: 0.25 }, { duration: 0.4, bounce: 0 }]) for (const velocity of [0, 3, -2]) {
    for (const t of [0.05, 0.2, 0.5]) {
      const h = 1e-5, [, v] = springState(spec, t, { from: 0, to: 1, velocity });
      const num = (springState(spec, t + h, { from: 0, to: 1, velocity })[0] - springState(spec, t - h, { from: 0, to: 1, velocity })[0]) / (2 * h);
      assert.ok(Math.abs(v - num) < 1e-4, `${JSON.stringify(spec)} v0 ${velocity} t ${t}: ${v} vs ${num}`);
    }
    assert.equal(springState(spec, 0, { from: 0, to: 1, velocity })[1], velocity, 'starts with the velocity it was given');
  }
});

test('springs: Spring keeps its velocity when the target changes (an interrupted move bends, it does not stop and restart)', () => {
  const s = new Spring(SPRING.glide, 0).to(100);
  for (let i = 0; i < 6; i++) s.step(1 / 60);                       // 0.1 s toward 100
  const x = s.value, v = s.velocity;
  assert.ok(v > 50, 'it is moving fast');
  s.to(0);                                                          // the target flips
  assert.equal(s.value, x); assert.equal(s.velocity, v, 'retargeting changes neither position nor velocity');
  s.step(1 / 240);
  assert.ok(s.value > x, 'it carries on a little the old way before it turns: momentum');
  for (let i = 0; i < 600; i++) s.step(1 / 60);
  assert.ok(s.atRest && Math.abs(s.value) < 1e-3);
});

test('springs: stepping is exact at any frame rate', () => {
  const run = fps => { const s = new Spring(SPRING.enter, 0).to(10); for (let i = 0; i < fps / 2; i++) s.step(1 / fps); return s.value; };
  assert.ok(Math.abs(run(30) - run(144)) < 1e-9);
  assert.ok(Math.abs(run(60) - springState(SPRING.enter, 0.5, { from: 0, to: 10 })[0]) < 1e-9);
});

test('springs: the settle time is when the motion is over, and the CSS easing follows the spring', () => {
  for (const [name, s] of Object.entries(SPRING)) {
    for (let t = s.seconds; t < s.seconds + 1; t += 0.01) assert.ok(Math.abs(1 - springState(s, t)[0]) <= 0.003 + 1e-9, `${name} stays settled`);
    const pts = numbers(s.css);
    assert.equal(pts.length, 49);
    assert.equal(pts[0], 0); assert.equal(pts[48], 1);
    assert.match(s.css, /^linear\(0, /);
    for (const i of [6, 12, 24, 36]) assert.ok(Math.abs(pts[i] - springState(s, (s.seconds * i) / 48)[0]) < 6e-5, `${name} point ${i}`);
    assert.ok(pts[12] > 0.25 + 0.05, `${name} is not linear: a quarter of the way through it is already well past a quarter`);
  }
  assert.ok(settleTime({ duration: 0.6, bounce: 0 }) > settleTime({ duration: 0.3, bounce: 0 }), 'a longer spring takes longer');
  assert.equal(springLinear(SPRING.pop), SPRING.pop.css);
});

test('motion: the spring tokens in app.css are what motion.js makes (run tools/motion/gen-springs.mjs --write after changing a spring)', () => {
  const css = readFileSync(join(ROOT, 'public/app.css'), 'utf8');
  const a = css.indexOf('/* springs:start'), end = '/* springs:end */', b = css.indexOf(end);
  assert.ok(a > 0 && b > a);
  assert.equal(css.slice(a, b + end.length), block());
  for (const [k, v] of Object.entries({ hover: DUR.hover, fast: DUR.fast, slow: DUR.slow })) assert.ok(css.includes(`--m-${k}: ${v}ms`), `--m-${k}`);
  for (const lit of ['--m-base', '--m-camera', '--ease-spring']) assert.ok(!css.includes(lit), `${lit} is gone`);
});

test('motion: slide directions say where the element comes from', () => {
  assert.deepEqual(slideFrom('left'), [-SLIDE, 0]);
  assert.deepEqual(slideFrom('right', 10), [10, 0]);
  assert.deepEqual(slideFrom('top'), [0, -SLIDE]);
  assert.deepEqual(slideFrom('bottom'), [0, SLIDE]);
  assert.deepEqual(slideFrom('nowhere'), [0, 0]);
  assert.equal(comesFrom('right'), 'left', 'a card to the right of an agent comes out of the agent, from its left');
  assert.equal(comesFrom('left'), 'right');
  assert.equal(comesFrom('below'), 'top');
  assert.equal(comesFrom('above'), 'bottom');
  assert.equal(comesFrom('dock'), 'bottom');
});

test('motion: enter fades in and, on a spring, travels and grows in from the side; leave fades out and then hides', async () => {
  const el = fakeEl(true);
  const p = enter(el, { from: 'left' });
  assert.equal(el.hidden, false);
  assert.equal(el.dataset.motion, 'in');
  const [f] = fade(el), [m] = move(el);
  assert.equal(f.opts.duration, DUR.fast); assert.equal(f.opts.easing, EASE.out);
  assert.deepEqual(f.keyframes, [{ opacity: 0 }, { opacity: 1 }]);
  assert.equal(m.opts.duration, SPRING.enter.ms); assert.equal(m.opts.easing, SPRING.enter.css);
  assert.deepEqual(m.keyframes[0], { translate: `${-SLIDE}px 0px`, scale: String(SCALE) });
  assert.deepEqual(m.keyframes[1], { translate: '0px 0px', scale: '1' });
  f.finish(); m.finish(); await p;
  assert.equal(el.dataset.motion, undefined);

  const q = leave(el, { to: 'right' });
  assert.equal(el.hidden, false, 'still there while it fades');
  assert.equal(el.dataset.motion, 'out');
  const [f2] = fade(el).slice(1), [m2] = move(el).slice(1);
  assert.equal(f2.opts.duration, DUR.fast); assert.equal(f2.opts.easing, EASE.in);
  assert.equal(m2.opts.duration, SPRING.leave.ms); assert.equal(m2.opts.easing, SPRING.leave.css);
  assert.deepEqual(m2.keyframes[1], { translate: `${SLIDE}px 0px`, scale: String(SCALE) });
  assert.ok(SPRING.leave.ms < SPRING.enter.ms);
  f2.finish(); await q;
  assert.equal(el.hidden, true);
  assert.equal(el.dataset.motion, undefined);
  assert.ok(m2.cancelled, 'what is left of the travel is dropped once it is invisible');
});

test('motion: an enter during a leave wins, and the element is not hidden afterwards', async () => {
  const el = fakeEl(false);
  const q = leave(el);
  const first = el.calls.slice();
  const p = enter(el);
  assert.ok(first.every(a => a.cancelled), 'the leave was cancelled');
  el.calls.slice(first.length).forEach(a => a.finish()); await Promise.all([p, q, tick()]);
  assert.equal(el.hidden, false);
});

test('motion: setShown does nothing when the state is already that state', async () => {
  const el = fakeEl(true);
  await setShown(el, false);
  assert.equal(el.calls.length, 0);
  const p = setShown(el, true, { from: 'right' });
  const n = el.calls.length;
  assert.equal(n, 2);
  setShown(el, true, { from: 'right' });
  assert.equal(el.calls.length, n, 'a second show while showing does not restart it');
  el.calls.forEach(a => a.finish()); await p;
  setShown(el, false);
  const n2 = el.calls.length;
  assert.equal(n2, 2 * n);
  setShown(el, false);
  assert.equal(el.calls.length, n2, 'a second hide while leaving does not restart it');
});

test('motion: with reduced motion there is only a short fade, no travel and no spring', async () => {
  const saved = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  try {
    const el = fakeEl(true);
    const p = enter(el, { from: 'left' });
    assert.equal(el.calls.length, 1);
    assert.equal(el.calls[0].opts.duration, DUR.hover);
    assert.deepEqual(el.calls[0].keyframes, [{ opacity: 0 }, { opacity: 1 }]);
    el.calls[0].finish(); await p;
    const q = leave(el);
    assert.equal(el.calls.length, 2);
    assert.equal(el.calls[1].opts.duration, DUR.hover);
    el.calls[1].finish(); await q;
    assert.equal(el.hidden, true);
  } finally { globalThis.matchMedia = saved; }
});

test('motion: an element without the Web Animations API is shown and hidden at once', async () => {
  const el = { hidden: true, dataset: {} };
  await enter(el);
  assert.equal(el.hidden, false);
  await leave(el);
  assert.equal(el.hidden, true);
});

test('cycle: day and night and the weather move at a pace of their own, slower than every spring', () => {
  for (const s of Object.values(SPRING)) assert.ok(CYCLE.turn > s.ms, 'slower than ' + s.ms);
  assert.ok(CYCLE.turn <= 10000, 'but a change made by hand does not keep the visitor waiting');
});
