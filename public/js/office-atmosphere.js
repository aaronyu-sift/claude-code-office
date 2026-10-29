// What the clock, the date, the hemisphere and the settings say about the light and the weather of the 3D scene. The scene has no sky, so this is all there is of one:
// how far the lights are on, the colour of dawn and dusk, the season and the weather of the day. The rules come from the pixel scene's pure modules (time.js, season.js,
// weather.js, used as they are); this module only puts them together for a scene that draws with lights instead of a tint.
//
//   atmosphereAt({ settings, date, reducedMotion })   one moment: minute, month (the light month: the sunrise table is the northern hemisphere's), phase, lights, season, weather
//   lightTarget(state)                                 what that moment asks of the scene's lights, as numbers 0..1 (the scene eases toward them, see motion.js CYCLE)
//   createAtmosphere({ settings, now, ... })           the same, kept up to date: it follows the settings, the minute, a new day and prefers-reduced-motion
import { ambient, createMinuteTicker } from './pixel/time.js';
import { seasonOfDate, lightMonth, dateKey } from './pixel/season.js';
import { resolveWeather, planFor, rainbowFor } from './pixel/weather.js';
import { timeMinutes } from './pixel/settings.js';

const NO_PLAN = Object.freeze({ kind: null, count: 0, tint: null });

// The moment for a date. `settings` has { time, season, weather, hemisphere } (the minute is the setting's when it is fixed, else the date's own); with reduced motion no
// weather runs (nothing falls, nothing drifts).
export function atmosphereAt({ settings, date, reducedMotion = false }) {
  const fixed = timeMinutes(settings.time);
  const minute = fixed == null ? date.getHours() * 60 + date.getMinutes() : fixed;
  const month = lightMonth(date.getMonth() + 1, settings.hemisphere);
  const amb = ambient(minute, month);
  const season = settings.season === 'auto' ? seasonOfDate(date, settings.hemisphere) : settings.season;
  const day = dateKey(date);
  const weather = reducedMotion ? null : resolveWeather(settings.weather, day, season);
  const plan = weather ? planFor({ weather, season, phase: amb.phase }) : NO_PLAN;
  const rainbow = !!weather && settings.weather === 'auto' && rainbowFor(day, season) && (amb.phase === 'day' || amb.phase === 'golden');
  return Object.freeze({ minute, month, fixed: fixed != null, hemisphere: settings.hemisphere, phase: amb.phase, lights: amb.lights,
    room: amb.room, season, day, weather, plan, rainbow, reducedMotion });
}

// How a weather takes the light down: the share of the sun's and of the sky's light that is lost when it is fully there, and the colour the light is pulled toward. The
// overlay (ofis-weather.js) draws the rain and the fog itself; these numbers are what the lights of the scene add to it. Flat light has little sun: fog and cloud take the
// sun more than the sky.
export const WEATHER_LIGHT = Object.freeze({
  rain: { sun: 0.45, sky: 0.2, mix: 0.4, rgb: [66, 82, 110] },
  snow: { sun: 0.3, sky: 0.05, mix: 0.25, rgb: [225, 235, 250] },
  fog: { sun: 0.5, sky: 0.1, mix: 0.35, rgb: [226, 232, 240] },
  cloud: { sun: 0.3, sky: 0.08, mix: 0.25, rgb: [90, 100, 122] },
});
const NO_LIGHT = Object.freeze({ sun: 0, sky: 0, mix: 0, rgb: [255, 255, 255] });
export const lightOfPlan = plan => (plan && WEATHER_LIGHT[plan.kind]) || NO_LIGHT;

const ch = c => c / 255;
// What a moment asks of the lights, every number 0..1:
//   k          how far the night is on (lit windows, lamps, glow, a cooler and dimmer sun and sky): the `lights` of time.js
//   sunDim, skyDim, wmix, wrgb   the weather: the lost share of the sun's and the sky's light, how far the colour of the light turns toward wrgb
//   amix, argb   the warm or purple light of dawn and dusk: the tint of time.js turned into how far the sun's colour moves toward it. Only while the lights are not all on,
//                where the night's own colour takes over
export function lightTarget(state) {
  const w = lightOfPlan(state.plan), k = state.lights, a = state.room;
  return {
    k, sunDim: w.sun, skyDim: w.sky, wmix: w.mix, wrgb: w.rgb.map(ch),
    amix: Math.min(0.7, a[3] * 4) * (1 - k), argb: [ch(a[0]), ch(a[1]), ch(a[2])],
  };
}
// the light as one list of numbers, so that the scene can move all of it toward a target by one rule
export const lightVector = t => [t.k, t.sunDim, t.skyDim, t.wmix, ...t.wrgb, t.amix, ...t.argb];
// move `cur` toward `to` by at most `step` in each number (a constant rate, no easing: the cycle kind of docs/motion.md); returns whether anything moved
export function approach(cur, to, step) {
  let moved = false;
  for (let i = 0; i < cur.length; i++) {
    const d = to[i] - cur[i];
    if (d === 0) continue;
    cur[i] = Math.abs(d) <= step ? to[i] : cur[i] + Math.sign(d) * step;
    moved = true;
  }
  return moved;
}

// opts: { settings (office-settings.js), now () => Date, reduced () => boolean, setTimer, clearTimer (for tests) }. `version` counts the changes, so a frame loop can ask
// "has anything changed" with one comparison; `on(fn)` is called after every change.
export function createAtmosphere({ settings, now = () => new Date(), reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches, setTimer, clearTimer }) {
  let dateOverride = null, state = null, version = 0;
  const subs = new Set();
  const today = () => {
    const d = now();
    if (!dateOverride) return d;
    const o = new Date(dateOverride.y, dateOverride.m - 1, dateOverride.d, d.getHours(), d.getMinutes(), d.getSeconds());
    return o;
  };
  const sigOf = s => [s.minute, s.month, s.phase, s.lights, s.season, s.weather, s.plan.kind, s.rainbow, s.fixed, s.hemisphere, s.reducedMotion].join('|');
  function compute() {
    const next = atmosphereAt({ settings: settings.get(), date: today(), reducedMotion: reduced() });
    if (state && sigOf(next) === sigOf(state)) return false;
    const first = !state;
    state = next;
    if (!first) { version++; for (const fn of [...subs]) fn(state); }
    return true;
  }
  compute();
  const stopSettings = settings.on('*', key => { if (key !== 'shelf') compute(); });
  const ticker = createMinuteTicker({ onChange: compute, now, ...(setTimer ? { setTimer, clearTimer } : {}) });
  const mq = typeof matchMedia === 'function' && !setTimer ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  if (mq) mq.addEventListener('change', compute);
  return {
    get state() { return state; },
    get version() { return version; },
    on(fn) { subs.add(fn); return () => subs.delete(fn); },
    refresh: compute,
    // QA only: pretend it is another day ("2026-01-15", the time of day stays the real one)
    setDate(key) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
      dateOverride = m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
      compute();
    },
    destroy() { stopSettings(); ticker.stop(); if (mq) mq.removeEventListener('change', compute); subs.clear(); },
  };
}
