import test from 'node:test';
import assert from 'node:assert/strict';
import { DUR, EASE, SLIDE, cubicBezier, ease, damp, slideFrom, comesFrom, enter, leave, setShown } from '../public/js/motion.js';

// a stand-in for an element whose animation can be finished or cancelled by the test
function fakeEl(hidden = true) {
  const el = { hidden, dataset: {}, calls: [], animate(keyframes, opts) {
    let done, fail;
    const finished = new Promise((res, rej) => { done = res; fail = rej; });
    const a = { keyframes, opts, finished, cancelled: false, finish: () => done(), cancel() { this.cancelled = true; fail(new Error('cancelled')); } };
    el.calls.push(a);
    return a;
  } };
  return el;
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('motion: the rules hold together (leaving is quicker than arriving, nothing travels far)', () => {
  assert.ok(DUR.hover < DUR.fast && DUR.fast < DUR.base && DUR.base < DUR.slow && DUR.slow < DUR.camera);
  assert.ok(DUR.fast < DUR.base, 'a card leaves faster than it arrives');
  assert.ok(SLIDE <= 24, 'no full-width slides');
  for (const name of Object.keys(EASE)) assert.match(EASE[name], /^cubic-bezier\(/);
});

test('motion: a Bezier easing runs from 0 to 1, decelerates when it arrives and accelerates when it leaves', () => {
  const out = ease('out'), inn = ease('in'), io = ease('inOut');
  for (const f of [out, inn, io]) { assert.equal(f(0), 0); assert.equal(f(1), 1); }
  assert.ok(out(0.2) > 0.2 && out(0.5) > 0.5, 'out is ahead of linear');
  assert.ok(inn(0.5) < 0.5, 'in is behind linear');
  assert.ok(io(0.5) > 0.7, 'standard starts fast and lands softly');
  assert.ok(io(0.1) > 0.1 && io(0.9) > 0.9);
  let prev = 0;
  for (let t = 0; t <= 1.0001; t += 0.02) { const y = out(Math.min(t, 1)); assert.ok(y >= prev - 1e-9, `out is monotonic at ${t}`); prev = y; }
  assert.ok(Math.max(...Array.from({ length: 51 }, (_, i) => ease('spring')(i / 50))) > 1.01, 'spring overshoots a little');
});

test('motion: cubicBezier matches the CSS ease-out value (0.25, 0.1, 0.25, 1) at its midpoint', () => {
  assert.ok(Math.abs(cubicBezier(0.25, 0.1, 0.25, 1)(0.5) - 0.8024) < 0.002);
  assert.equal(cubicBezier(0, 0, 1, 1)(0.3).toFixed(4), '0.3000');
});

test('motion: damp gives the same result at any frame rate and never overshoots', () => {
  const run = fps => { let v = 0; for (let i = 0; i < fps * 0.5; i++) v = damp(v, 100, 6, 1 / fps); return v; };
  assert.ok(Math.abs(run(30) - run(144)) < 1e-6, 'frame-rate independent');
  assert.ok(run(60) < 100 && run(60) > 90);
  assert.equal(damp(100, 100, 6, 0.016), 100);
  let v = 0; for (let i = 0; i < 600; i++) { v = damp(v, 50, 8, 1 / 60); assert.ok(v <= 50 + 1e-9); }
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

test('motion: enter shows the element and fades it in from the side; leave fades out and then hides', async () => {
  const el = fakeEl(true);
  const p = enter(el, { from: 'left' });
  assert.equal(el.hidden, false);
  assert.equal(el.dataset.motion, 'in');
  const a = el.calls[0];
  assert.equal(a.opts.duration, DUR.base);
  assert.equal(DUR.base, 300);
  assert.equal(a.opts.easing, EASE.out);
  assert.deepEqual(a.keyframes[0], { opacity: 0, translate: `${-SLIDE}px 0px` });
  assert.deepEqual(a.keyframes[1], { opacity: 1, translate: '0px 0px' });
  a.finish(); await p;
  assert.equal(el.dataset.motion, undefined);

  const q = leave(el, { to: 'right' });
  assert.equal(el.hidden, false, 'still there while it fades');
  assert.equal(el.dataset.motion, 'out');
  const b = el.calls[1];
  assert.equal(b.opts.duration, DUR.fast);
  assert.equal(b.opts.easing, EASE.in);
  assert.ok(b.opts.duration < a.opts.duration);
  b.finish(); await q;
  assert.equal(el.hidden, true);
  assert.equal(el.dataset.motion, undefined);
});

test('motion: an enter during a leave wins, and the element is not hidden afterwards', async () => {
  const el = fakeEl(false);
  const q = leave(el);
  const b = el.calls[0];
  const p = enter(el);
  assert.ok(b.cancelled, 'the leave was cancelled');
  el.calls[1].finish(); await Promise.all([p, q, tick()]);
  assert.equal(el.hidden, false);
});

test('motion: setShown does nothing when the state is already that state', async () => {
  const el = fakeEl(true);
  await setShown(el, false);
  assert.equal(el.calls.length, 0);
  const p = setShown(el, true, { from: 'right' });
  assert.equal(el.calls.length, 1);
  setShown(el, true, { from: 'right' });
  assert.equal(el.calls.length, 1, 'a second show while showing does not restart it');
  el.calls[0].finish(); await p;
  setShown(el, false);
  assert.equal(el.calls.length, 2);
  setShown(el, false);
  assert.equal(el.calls.length, 2, 'a second hide while leaving does not restart it');
});

test('motion: an element without the Web Animations API is shown and hidden at once', async () => {
  const el = { hidden: true, dataset: {} };
  await enter(el);
  assert.equal(el.hidden, false);
  await leave(el);
  assert.equal(el.hidden, true);
});
