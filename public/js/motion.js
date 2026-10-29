// The motion rules of the Office, as code (the rules themselves, and why, are in docs/motion.md; app.css has the same numbers as CSS variables).
// One set of durations and curves for every animation on the page, so a card, a menu, a tooltip and a button all feel the same.
//
//   enter(el, { from })          show an element: fade in while it moves a few pixels in from the side it belongs to, decelerating
//   leave(el, { to })            hide it: a shorter fade out, accelerating, then `hidden`; an `enter` during it wins
//   setShown(el, on, opts)       enter or leave, only when the state really changes
//   ease(name) -> t => y         the same curves for things drawn on a canvas or moved by script
//   damp(a, b, lambda, dt)       frame-rate independent easing toward a target (the camera, a follow)
//   reduced()                    the visitor asked for less motion: slides and moves become short fades or nothing
//
// Only `opacity` and the individual `translate` property are animated (never top, left, width or height), so the browser can run it on the compositor and the
// element's own `transform` (the card's position) is left alone.

export const DUR = { hover: 150, fast: 200, base: 300, slow: 450, camera: 800 };           // ms (Material 3 short3, short4, medium2, long1 and extra long)
export const EASE = {
  out: 'cubic-bezier(0.05, 0.7, 0.1, 1)',       // things that arrive: Material 3 emphasized decelerate (fast start, long soft landing)
  in: 'cubic-bezier(0.3, 0, 1, 1)',              // things that leave: Material 3 accelerate (slow start, fast end)
  inOut: 'cubic-bezier(0.2, 0, 0, 1)',            // things that stay and move: Material 3 standard (a card gliding to a new place)
  spring: 'cubic-bezier(0.34, 1.3, 0.64, 1)',   // a small overshoot (about 6 percent): something that is built or pops up; our own, not from the guidance
};
export const SLIDE = 14;                          // px: how far an element travels while it appears (never a full-width slide)

export const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// the offset an element starts from when it comes in from `side` ('left' | 'right' | 'top' | 'bottom'): it starts there and travels to its place
export function slideFrom(side, dist = SLIDE) {
  return { left: [-dist, 0], right: [dist, 0], top: [0, -dist], bottom: [0, dist] }[side] || [0, 0];
}
// the side an element at `placed` ('left' | 'right' | 'above' | 'below') of what it belongs to comes from: out of that thing
export const comesFrom = placed => ({ right: 'left', left: 'right', below: 'top', above: 'bottom' }[placed] || 'bottom');

// the CSS timing function as a function: solves x(s) = t on the Bezier by Newton steps with a bisection fallback, then returns y(s)
export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = s => ((ax * s + bx) * s + cx) * s, Y = s => ((ay * s + by) * s + cy) * s, dX = s => (3 * ax * s + 2 * bx) * s + cx;
  return t => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) { const e = X(s) - t; if (Math.abs(e) < 1e-6) return Y(s); const d = dX(s); if (Math.abs(d) < 1e-6) break; s -= e / d; }
    let lo = 0, hi = 1; s = t;
    while (hi - lo > 1e-6) { if (X(s) < t) lo = s; else hi = s; s = (lo + hi) / 2; }
    return Y(s);
  };
}
const PARSED = {};
export function ease(name) {
  if (!EASE[name]) throw new Error('unknown easing ' + name);
  return PARSED[name] || (PARSED[name] = cubicBezier(...EASE[name].match(/-?[\d.]+/g).map(Number)));
}

// moves `a` toward `b`: the gap shrinks by a constant share per unit of time, so the result is the same at 30 and at 144 frames per second.
// lambda is how fast (about 1 / the time in seconds the move takes to get most of the way: 6 is 0.17 s per e-fold, 3 is 0.33 s)
export const damp = (a, b, lambda, dt) => b + (a - b) * Math.exp(-lambda * dt);

const running = new WeakMap();                      // el -> the animation in flight
const stop = el => { const a = running.get(el); if (a) { running.delete(el); a.cancel(); } };
const frames = (vec, on) => [{ opacity: on ? 0 : 1, translate: on ? `${vec[0]}px ${vec[1]}px` : '0px 0px' }, { opacity: on ? 1 : 0, translate: on ? '0px 0px' : `${vec[0]}px ${vec[1]}px` }];

export function enter(el, { from = 'bottom', dist = SLIDE, dur = DUR.base, easing = EASE.out } = {}) {
  const o0 = running.has(el) && typeof getComputedStyle === 'function' ? Number(getComputedStyle(el).opacity) || 0 : 0;          // interrupting a leave: start from where it is
  stop(el);
  el.hidden = false;
  el.dataset.motion = 'in';
  if (typeof el.animate !== 'function') { delete el.dataset.motion; return Promise.resolve(); }
  const small = reduced();
  const kf = frames(small ? [0, 0] : slideFrom(from, dist), true);
  kf[0].opacity = o0;
  const a = el.animate(kf, { duration: small ? DUR.hover : dur, easing, fill: 'backwards' });
  running.set(el, a);
  return a.finished.then(() => { if (running.get(el) === a) { running.delete(el); delete el.dataset.motion; } }, () => {});
}

export function leave(el, { to = 'bottom', dist = SLIDE, dur = DUR.fast, easing = EASE.in } = {}) {
  stop(el);
  if (el.hidden || typeof el.animate !== 'function') { el.hidden = true; delete el.dataset.motion; return Promise.resolve(); }
  el.dataset.motion = 'out';                        // app.css: no clicks on something that is leaving
  const small = reduced();
  const a = el.animate(frames(small ? [0, 0] : slideFrom(to, dist), false), { duration: small ? DUR.hover : dur, easing, fill: 'forwards' });
  running.set(el, a);
  return a.finished.then(() => {
    if (running.get(el) !== a) return;
    running.delete(el);
    el.hidden = true; delete el.dataset.motion;
    a.cancel();
  }, () => {});
}

// enter or leave, but only when the state changes (a caller that sets the same state again must not restart the animation)
export function setShown(el, on, opts = {}) {
  const showing = !el.hidden && el.dataset.motion !== 'out';
  if (on === showing) return Promise.resolve();
  return on ? enter(el, opts.in || opts) : leave(el, opts.out || opts);
}
