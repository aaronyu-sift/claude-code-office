// The motion rules of the Office, as code (the rules and their reasons are in docs/motion.md; app.css has the same numbers as CSS variables).
// The rules differ by kind of thing and agree within a kind. Things that move because of a click or a change in the scene (cards, menus, the camera, built
// things) move on a spring, not a Bezier curve: they accelerate and settle as a real object on a spring does, and the time it takes is a result of the spring,
// not a number picked by hand. Opacity and colour only ease, because they have no mass. Things that never stop (an indicator's pulse, a flicker, a drift) are
// not springs: they follow the clock (LOOP, wave).
//
//   SPRING.enter / leave / glide / pop / build / follow    the springs, each with its duration in ms and as a CSS `linear()` easing
//   enter(el, { from })          show an element: it travels a little in from the side it belongs to and grows from a slightly smaller size, on a spring, while it fades in
//   leave(el, { to })            hide it: a quicker spring back toward that side while it fades out, then `hidden`; an `enter` during it wins
//   setShown(el, on, opts)       enter or leave, only when the state really changes
//   Spring                       the same physics for script: a value that moves toward a target and keeps its velocity when the target changes
//   LOOP, wave                   the two tempos of an indicator that loops, and the sine they follow
//   CYCLE                        the pace of a cycle (day and night, the weather): the time a full change of the light takes, at a constant rate
//   springState / springLinear   the closed-form motion, and the CSS easing made from it
//   reduced()                    the visitor asked for less motion: the travel is dropped and what is left is a short fade
//
// Only `opacity` and the individual `translate` and `scale` properties are animated (never top, left, width or height), so the browser can run it on the
// compositor and the element's own `transform` (the card's position) is left alone.

export const DUR = { hover: 150, fast: 200, slow: 450 };           // ms: fades, colour and the fill of a bar (Material 3 short3, short4 and long1)
export const EASE = {
  out: 'cubic-bezier(0.05, 0.7, 0.1, 1)',       // a fade that arrives: Material 3 emphasized decelerate
  in: 'cubic-bezier(0.3, 0, 1, 1)',              // a fade that leaves: Material 3 accelerate
  inOut: 'cubic-bezier(0.2, 0, 0, 1)',            // a change that stays on screen: Material 3 standard
};
export const LOOP = { slow: 2400, quick: 1200 };  // ms: an indicator that loops: a state that continues pulses slowly, something that wants a look moves quickly (WCAG 2.3.1: at most 3 flashes a second)
// A cycle follows the clock: a day that turns into night is not pushed by anything and has no easing. The light moves at a constant rate, so a change that is made by hand
// (a time or a weather chosen in the popover) is slow and never a step; the real clock moves it a little every minute. `turn` is the time a full change of the light (0 to 1) takes.
export const CYCLE = { turn: 4000 };               // ms
export const SLIDE = 20;                          // px: how far an element travels while it appears (never a full-width slide)
export const SCALE = 0.94;                        // an arriving card also grows from this size, out of the point it belongs to (its tail), so it opens like something unfolding

export const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- springs -------------------------------------------------------------------------------------------------------------------------------------------
// A unit mass on a spring with damping, pulled toward a target. A spring is given the way Apple's SwiftUI gives it, `Spring(duration:bounce:)`: the perceptual
// duration in seconds (the time of one natural period) and the bounce, 0 for none up to 1 (Apple advises against more than about 0.4 in a UI). The physical
// values follow: mass 1 and stiffness = (2 pi / duration)^2 (both from the WWDC23 session "Animate with springs", checked), and a damping that makes bounce 0
// critically damped (no overshoot) and bounce 1 undamped: damping = 4 pi (1 - bounce) / duration. The session text as fetched gives another damping formula,
// which the Apple developer forums call wrong; this is the physically consistent one, and which is Apple's final is not settled.
export function springParams({ duration, bounce = 0 }) {
  const w0 = (2 * Math.PI) / duration, zeta = 1 - Math.min(Math.max(bounce, 0), 0.999);
  return { w0, zeta, stiffness: w0 * w0, damping: 2 * zeta * w0 };
}

// position and velocity `t` seconds after the spring is released from `from` with `velocity`, toward `to` (the exact solution, so any t is stable)
export function springState(spec, t, { from = 0, to = 1, velocity = 0 } = {}) {
  const { w0, zeta } = springParams(spec), d0 = from - to;
  if (zeta >= 1) {
    const e = Math.exp(-w0 * t), c = velocity + w0 * d0;
    return [to + e * (d0 + c * t), e * (c - w0 * (d0 + c * t))];
  }
  const a = zeta * w0, wd = w0 * Math.sqrt(1 - zeta * zeta), e = Math.exp(-a * t), cs = Math.cos(wd * t), sn = Math.sin(wd * t), b = (velocity + a * d0) / wd;
  return [to + e * (d0 * cs + b * sn), e * (-a * (d0 * cs + b * sn) + wd * (b * cs - d0 * sn))];
}

// seconds until a unit step stays within `eps` of its target and has all but stopped
export function settleTime(spec, eps = 0.003) {
  let last = 0;
  for (let t = 0; t <= 4; t += 0.002) { const [x, v] = springState(spec, t); if (Math.abs(1 - x) > eps || Math.abs(v) > eps * 4) last = t; }
  return +(last + 0.002).toFixed(3);
}

// the CSS easing function `linear(...)` through points of the unit step response, so a CSS or Web Animations animation moves exactly like the spring
// (the animation's duration is settleTime)
export function springLinear(spec, { points = 48, eps } = {}) {
  const T = settleTime(spec, eps), out = [];
  for (let i = 0; i <= points; i++) out.push(i === points ? 1 : +springState(spec, (T * i) / points)[0].toFixed(4));
  return `linear(${out.join(', ')})`;
}

const make = (duration, bounce) => {
  const spec = { duration, bounce }, seconds = settleTime(spec);
  return Object.freeze({ ...spec, seconds, ms: Math.round(seconds * 1000), css: springLinear(spec) });
};
// the springs by what they move. Bounce follows the size and the trigger: a click has no momentum, so a surface that a click opens does not overshoot (WWDC18
// "Designing Fluid Interfaces": "Because the tap doesn't have any momentum ... we use 100% damping"); a small control may show a hint of bounce (Apple's
// .snappy has a base bounce of 0.15); something built may bounce more (.bouncy: 0.3). Apple's presets are duration 0.5 s with bounce 0 (.smooth), 0.15 (.snappy)
// and 0.3 (.bouncy), read in its API documentation on 2026-10-29; the other durations are ours.
export const SPRING = Object.freeze({
  enter: make(0.45, 0),          // a card or panel arriving after a click: no overshoot
  leave: make(0.25, 0),          // going away: quick, no bounce, back along the way it came
  glide: make(0.4, 0),           // a card moving from one agent to another: smooth, no bounce
  pop: make(0.3, 0.15),          // a menu, a tooltip, a switch knob: Apple's .snappy bounce
  build: make(0.5, 0.3),         // something built or placed: Apple's .bouncy
  follow: make(0.6, 0),          // the camera following a change of frame: smooth, no bounce
});

// an indicator's loop: a sine of the clock (t and period in ms), from -1 to 1, `phase` in turns. It is not a spring: nothing triggers it and nothing pushes it.
export const wave = (t, period, phase = 0) => Math.sin(2 * Math.PI * (t / period + phase));

// the same physics for script (the camera, a follower): `value` moves toward `target`; changing the target keeps the velocity, so a move that is
// interrupted bends instead of stopping and restarting
export class Spring {
  constructor(spec, value = 0) { this.spec = spec; this.value = value; this.velocity = 0; this.target = value; }
  to(target) { this.target = target; return this; }
  jump(value) { this.value = this.target = value; this.velocity = 0; return this; }
  step(dt) {
    const [x, v] = springState(this.spec, dt, { from: this.value, to: this.target, velocity: this.velocity });
    this.value = x; this.velocity = v;
    return x;
  }
  get atRest() { return Math.abs(this.value - this.target) < 1e-3 && Math.abs(this.velocity) < 1e-2; }
}

// ---- helpers for the side an element comes from -----------------------------------------------------------------------------------------------------
// the offset an element starts from when it comes in from `side` ('left' | 'right' | 'top' | 'bottom'): it starts there and travels to its place
export function slideFrom(side, dist = SLIDE) {
  return { left: [-dist, 0], right: [dist, 0], top: [0, -dist], bottom: [0, dist] }[side] || [0, 0];
}
// the side an element at `placed` ('left' | 'right' | 'above' | 'below') of what it belongs to comes from: out of that thing
export const comesFrom = placed => ({ right: 'left', left: 'right', below: 'top', above: 'bottom' }[placed] || 'bottom');

// ---- enter and leave --------------------------------------------------------------------------------------------------------------------------------
const running = new WeakMap();                      // el -> the animations in flight
const stop = el => { const set = running.get(el); if (set) { running.delete(el); set.forEach(a => a.cancel()); } };
const hasStyle = typeof getComputedStyle === 'function';
const nowOf = el => {                                // where an element is right now (opacity and travel), so an interrupted move continues from there
  if (!hasStyle || !running.has(el)) return null;
  const cs = getComputedStyle(el), t = cs.translate && cs.translate !== 'none' ? cs.translate.split(' ') : [];
  return { o: Number(cs.opacity) || 0, t: [parseFloat(t[0]) || 0, parseFloat(t[1]) || 0], s: cs.scale && cs.scale !== 'none' ? parseFloat(cs.scale) || 1 : 1 };
};
const pose = (t, s) => ({ translate: `${t[0]}px ${t[1]}px`, scale: String(s) });

export function enter(el, { from = 'bottom', dist = SLIDE, scale = SCALE, spring = SPRING.enter } = {}) {
  const cur = nowOf(el);
  stop(el);
  el.hidden = false;
  el.dataset.motion = 'in';
  if (typeof el.animate !== 'function') { delete el.dataset.motion; return Promise.resolve(); }
  const small = reduced(), vec = small ? [0, 0] : slideFrom(from, dist), start = cur || { o: 0, t: vec, s: scale };
  const set = [el.animate([{ opacity: start.o }, { opacity: 1 }], { duration: small ? DUR.hover : DUR.fast, easing: EASE.out, fill: 'backwards' })];
  if (!small) set.push(el.animate([pose(start.t, start.s), pose([0, 0], 1)], { duration: spring.ms, easing: spring.css, fill: 'backwards' }));
  running.set(el, set);
  return Promise.all(set.map(a => a.finished)).then(() => { if (running.get(el) === set) { running.delete(el); delete el.dataset.motion; } }, () => {});
}

export function leave(el, { to = 'bottom', dist = SLIDE, scale = SCALE, spring = SPRING.leave } = {}) {
  const cur = nowOf(el);
  stop(el);
  if (el.hidden || typeof el.animate !== 'function') { el.hidden = true; delete el.dataset.motion; return Promise.resolve(); }
  el.dataset.motion = 'out';                        // app.css: no clicks on something that is leaving
  const small = reduced(), vec = small ? [0, 0] : slideFrom(to, dist), start = cur || { o: 1, t: [0, 0], s: 1 };
  const fade = el.animate([{ opacity: start.o }, { opacity: 0 }], { duration: small ? DUR.hover : DUR.fast, easing: EASE.in, fill: 'forwards' });
  const set = [fade];
  if (!small) set.push(el.animate([pose(start.t, start.s), pose(vec, scale)], { duration: spring.ms, easing: spring.css, fill: 'forwards' }));
  running.set(el, set);
  return fade.finished.then(() => {                 // gone once it has faded; what is left of the travel cannot be seen
    if (running.get(el) !== set) return;
    running.delete(el);
    el.hidden = true; delete el.dataset.motion;
    set.forEach(a => a.cancel());
  }, () => {});
}

// enter or leave, but only when the state changes (a caller that sets the same state again must not restart the animation)
export function setShown(el, on, opts = {}) {
  const showing = !el.hidden && el.dataset.motion !== 'out';
  if (on === showing) return Promise.resolve();
  return on ? enter(el, opts) : leave(el, opts);
}
