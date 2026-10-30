// The light of the rooms of the 3D office, as numbers: how bright a lamp, a candle or a string of lights is at this time of day, how much it flickers, and what colour a
// window shows. Pure (no three.js, no DOM): ofis-decor.js turns these into the colours of its instanced meshes, test/ofis-light.test.mjs checks the rules.
//
//   flicker(t, { kind, phase, reduced })     a multiplier near 1 for a source at second t: a candle is stepped random (9 steps a second, plus or minus 7 percent), every
//                                            other source is a slow sine (plus or minus 2.5 to 3.5 percent, a period of its own); 1 with reduced motion. Ambient scenery
//                                            of docs/motion.md: it follows the clock, never a spring, never started by a click, under 8 percent, one phase per source
//   levels(kind, k)                          { bulb, glow, pool } 0..1 for how far the night is on (k, the `lights` of time.js as the scene eases it): a lamp is dim by
//                                            day and glows at dusk and night, a candle is out by day, a screen is on all day
//   paneColour(v, sky)                       the colour of a window pane (sRGB 0..1): the sky's tint by day, the weather's and the dusk's colour in between, a warm glow at night
//   createFollower({ atmosphere, turnMs })   the light of the atmosphere moving at a constant rate, like the surroundings do (ofis-env.js), so the lamps and the windows come on
//                                            together with the street lamps
import { lightTarget, lightVector, approach } from './office-atmosphere.js';

export const AMP = { candle: 0.07, lamp: 0.025, bulb: 0.035 };
export const CANDLE_STEPS = 9;                                  // flicker steps a second (Quake and Doom's light styles run at 8 to 10)
const TAU = Math.PI * 2;

// a number in [-1, 1] for a whole step and a seed: the same inputs always give the same value (a flicker that can be tested)
export function noise(step, seed) {
  let h = Math.imul(step | 0, 0x27d4eb2d) ^ Math.imul(Math.round(seed * 4096) | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (((h ^ (h >>> 16)) >>> 0) / 4294967296) * 2 - 1;
}
export function flicker(t, { kind = 'lamp', phase = 0, reduced = false } = {}) {
  if (reduced) return 1;
  if (kind === 'candle') return 1 + AMP.candle * noise(Math.floor(t * CANDLE_STEPS + phase * 97), phase);
  const amp = kind === 'bulb' || kind === 'led' ? AMP.bulb : AMP.lamp, period = 2.3 + phase * 1.9;
  return 1 + amp * Math.sin(TAU * (t / period + phase));
}

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// by kind: [what it shows by day, what it shows at night] for the source itself (the bulb or flame), its glow and the pool of light on the floor
const LEVEL = {
  lamp: { bulb: [0.14, 1], glow: [0.0, 1], pool: [0.0, 1] },
  sconce: { bulb: [0.12, 1], glow: [0.0, 1], pool: [0.0, 1] },
  candle: { bulb: [0.0, 1], glow: [0.0, 1], pool: [0.0, 1] },
  bulb: { bulb: [0.1, 1], glow: [0.0, 0.9], pool: [0.0, 0.0] },
  screen: { bulb: [0.55, 1], glow: [0.1, 1], pool: [0.0, 0.0] },
  led: { bulb: [0.5, 1], glow: [0.0, 0.8], pool: [0.0, 0.0] },
};
export function levels(kind, k) {
  const L = LEVEL[kind] || LEVEL.lamp;
  // a candle is lit once it is getting dark; the others follow the night itself
  const s = kind === 'candle' ? smooth(0.12, 0.7, k) : smooth(0, 1, k);
  const at = ([d, n]) => d + (n - d) * s;
  // the glow and the pool grow with the square of the night: a faint hint at dusk, full when it is dark
  const g = ([d, n]) => d + (n - d) * s * s;
  return { bulb: at(L.bulb), glow: g(L.glow), pool: g(L.pool) };
}

// v = the eased light vector [k, sunDim, skyDim, wmix, wr, wg, wb, amix, ar, ag, ab] (office-atmosphere.js lightVector)
export const DAY_SKY = [0.62, 0.83, 0.96], NIGHT_GLOW = [1, 0.76, 0.42];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export function paneColour(v, sky = DAY_SKY) {
  const [k, , skyDim, wmix, wr, wg, wb, amix, ar, ag, ab] = v;
  let c = sky.map(x => x * (1 - 0.35 * skyDim));                          // a darker sky under cloud
  c = mix3(c, [wr, wg, wb], 0.7 * wmix);                                  // rain and fog pull it toward their colour
  c = mix3(c, [ar, ag, ab], 0.8 * amix);                                  // dawn and dusk
  const s = smooth(0.15, 0.9, k);
  c = mix3(c, NIGHT_GLOW, s);                                             // a warm glow at night
  const dim = 1 - 0.25 * (1 - s) * smooth(0, 0.3, k);                     // a touch dimmer while it darkens
  return c.map(x => Math.max(0, Math.min(1, x * dim)));
}

// the light moving toward what the atmosphere asks for at the scene's own constant rate (motion.js CYCLE.turn); `v` is the eased vector, `reduced` the reduced-motion flag
export function createFollower({ atmosphere, turnMs = 4000 }) {
  let want = null, shown = null, seen = -1;
  return {
    step(dt) {
      if (atmosphere.version !== seen || !want) { seen = atmosphere.version; want = lightVector(lightTarget(atmosphere.state)); }
      if (!shown) shown = want.slice();
      return approach(shown, want, (dt * 1000) / turnMs);
    },
    get v() { return shown || (want = lightVector(lightTarget(atmosphere.state))); },
    get k() { return (shown || this.v)[0]; },
    get reduced() { return !!atmosphere.state.reducedMotion; },
  };
}
