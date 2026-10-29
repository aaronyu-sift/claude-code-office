// Time of day for the pixel scene: pure functions, no DOM, no clock of their own (the caller passes minutes and a month), so every rule
// can be tested with fake times.
//
// Sunrise and sunset come from a small table by month (a mid-latitude northern hemisphere, local clock, no daylight saving): the point is
// a believable light, not astronomy. `ambient()` returns everything the scene needs for one minute of the day: the tint of the rooms and
// of the garden and how bright the lights (windows, lamps, monitors) are. There is no sky in the scene, so no sun, moon or stars either:
// the tint alone says what time it is.

const H = 60;
// [sunrise, sunset] in minutes after midnight, January to December
export const SUN = [
  [7 * H + 20, 16 * H + 50], [6 * H + 55, 17 * H + 30], [6 * H + 15, 18 * H + 5], [5 * H + 30, 18 * H + 40], [4 * H + 55, 19 * H + 10], [4 * H + 35, 19 * H + 30],
  [4 * H + 50, 19 * H + 25], [5 * H + 20, 18 * H + 55], [5 * H + 55, 18 * H + 10], [6 * H + 25, 17 * H + 25], [6 * H + 55, 16 * H + 50], [7 * H + 20, 16 * H + 40],
];
export const sunTimes = month => SUN[(((month | 0) - 1) % 12 + 12) % 12];             // month 1..12

export const PHASES = ['night', 'dawn', 'day', 'golden', 'dusk'];
// night until 45 min before sunrise, dawn until an hour after it, day until 90 min before sunset, the golden hour, dusk for an hour after sunset
export function phaseAt(min, month) {
  const [sr, ss] = sunTimes(month), m = ((min % 1440) + 1440) % 1440;
  if (m < sr - 45 || m >= ss + 60) return 'night';
  if (m < sr + 60) return 'dawn';
  if (m < ss - 90) return 'day';
  if (m < ss) return 'golden';
  return 'dusk';
}

// "HH:MM" (also "H:MM", "HHMM") to minutes, or null
export function parseClock(text) {
  const m = /^\s*(\d{1,2}):?(\d{2})\s*$/.exec(String(text || ''));
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
export const fmtClock = min => { const m = ((Math.round(min) % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

// colour keyframes: indoor tint (source-atop overlay r, g, b, a), extra tint for the garden, lights (0..1)
const KEY = {
  night: { room: [14, 24, 64, 0.34], out: [8, 16, 56, 0.34], lights: 1 },
  predawn: { room: [60, 44, 100, 0.24], out: [40, 34, 90, 0.26], lights: 0.8 },
  dawn: { room: [255, 168, 120, 0.14], out: [255, 150, 110, 0.12], lights: 0.35 },
  day: { room: [255, 255, 255, 0], out: [255, 255, 255, 0], lights: 0 },
  golden: { room: [255, 150, 60, 0.15], out: [255, 140, 50, 0.16], lights: 0.25 },
  dusk: { room: [70, 40, 110, 0.26], out: [50, 30, 100, 0.3], lights: 0.85 },
};
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const lerpKey = (a, b, t) => ({ room: mix(a.room, b.room, t), out: mix(a.out, b.out, t), lights: a.lights + (b.lights - a.lights) * t });

// keyframes of one day, as [minute, key], covering 0 to 1440 (the first and last repeat the night so the day wraps)
export function keyframes(month) {
  const [sr, ss] = sunTimes(month);
  return [
    [0, KEY.night], [sr - 90, KEY.night], [sr - 40, KEY.predawn], [sr + 5, KEY.dawn], [sr + 70, KEY.day], [ss - 110, KEY.day], [ss - 25, KEY.golden],
    [ss + 12, KEY.dusk], [ss + 70, KEY.night], [1440, KEY.night],
  ];
}

// Everything for one minute of the day. `min` is minutes after midnight on the local clock.
export function ambient(min, month) {
  const m = ((min % 1440) + 1440) % 1440, K = keyframes(month);
  let i = 0;
  while (i < K.length - 2 && m >= K[i + 1][0]) i++;
  const [t0, a] = K[i], [t1, b] = K[i + 1], t = t1 > t0 ? Math.min(1, Math.max(0, (m - t0) / (t1 - t0))) : 0;
  const k = lerpKey(a, b, t);
  return {
    minute: Math.floor(m), month, phase: phaseAt(m, month),
    room: k.room.map((v, j) => (j < 3 ? Math.round(v) : +v.toFixed(3))),          // [r, g, b, alpha] laid over the rooms and everything in them
    out: k.out.map((v, j) => (j < 3 ? Math.round(v) : +v.toFixed(3))),            // [r, g, b, alpha] laid over the garden's ground as well
    lights: +k.lights.toFixed(3),
  };
}
export const rgba = c => `rgba(${c[0]},${c[1]},${c[2]},${c[3]})`;
export const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

// Fires `onChange` once at every minute boundary of the local clock. The clock and the timer are injected so the rule can be tested.
// Returns { stop }. With a fixed time (the ?time= override) nothing is ever scheduled.
export function createMinuteTicker({ onChange, fixed = null, now = () => new Date(), setTimer = (f, ms) => setTimeout(f, ms), clearTimer = id => clearTimeout(id) }) {
  let id = 0, stopped = false;
  const clock = () => { const d = now(); return { minute: d.getHours() * 60 + d.getMinutes(), month: d.getMonth() + 1 }; };
  const arm = () => {
    if (stopped || fixed != null) return;
    const d = now();
    id = setTimer(() => { id = 0; if (stopped) return; onChange(clock()); arm(); }, (60 - d.getSeconds()) * 1000 - d.getMilliseconds() + 20);
  };
  arm();
  return { clock, stop() { stopped = true; if (id) clearTimer(id); id = 0; } };
}
