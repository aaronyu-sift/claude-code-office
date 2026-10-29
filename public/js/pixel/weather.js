// Weather of the pixel scene. Off by default. Everything here is local: the weather is a setting, or it is picked automatically from the date
// and the season by a seeded hash (the same day always gives the same weather), and nothing is ever fetched from anywhere.
//
// The effects live on one overlay canvas above the scene: at most PARTICLE_CAP particles (rain streaks, flakes, fog wisps, cloud shadows and
// the seasonal delights: petals, falling leaves, fireflies, a few flakes in winter) and a rainbow after rain. The overlay is drawn by the
// one scheduler of the scene (anim.js), at most 10 frames per second, never while the page is hidden, and not at all with
// prefers-reduced-motion or with the weather off; this module draws only when it is asked to.
import { addDays } from './season.js';

export const WEATHERS = ['clear', 'cloudy', 'rain', 'snow', 'fog'];
export const WEATHER_SETTINGS = ['off', 'auto', ...WEATHERS];
export const PARTICLE_CAP = 120;
export const parseWeather = text => { const t = String(text || '').trim().toLowerCase(); return WEATHER_SETTINGS.includes(t) ? t : null; };

const hash01 = s => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

// weights of clear, cloudy, rain, snow, fog by season (snow never falls in summer, rain is rare in the cold)
const WEIGHTS = {
  spring: [34, 24, 28, 2, 12],
  summer: [56, 20, 20, 0, 4],
  autumn: [26, 28, 24, 2, 20],
  winter: [28, 24, 6, 32, 10],
};
// The automatic weather of a day ("2026-10-28") in a season: a pure function of the two, so the same date and season always agree.
export function weatherFor(key, season) {
  const w = WEIGHTS[season] || WEIGHTS.summer, total = w.reduce((a, b) => a + b, 0);
  let r = hash01(`${key}|${season}|weather`) * total;
  for (let i = 0; i < WEATHERS.length; i++) { r -= w[i]; if (r < 0) return WEATHERS[i]; }
  return 'clear';
}
// A rainbow is rare: only on a clear day that follows a rainy one, and then on about half of them.
export function rainbowFor(key, season) {
  return weatherFor(key, season) === 'clear' && weatherFor(addDays(key, -1), season) === 'rain' && hash01(`${key}|rainbow`) < 0.5;
}
// the weather that is shown for a setting ('off', 'auto' or a weather): null = nothing runs
export const resolveWeather = (setting, key, season) => (setting === 'off' || !setting ? null : setting === 'auto' ? weatherFor(key, season) : setting);

// What the overlay shows for a weather, a season and a phase of the day (time.js): the kind of particle, how many, and a tint over the scene.
// With clear weather the season's delights fall: petals in spring, leaves in autumn, a few flakes in winter, fireflies on summer nights.
export function planFor({ weather, season, phase = 'day' }) {
  const dark = phase === 'night' || phase === 'dusk';
  switch (weather) {
    case 'rain': return { kind: 'rain', count: 110, tint: [66, 82, 110, 0.15] };
    case 'snow': return { kind: 'snow', count: 100, tint: [225, 235, 250, 0.07] };
    case 'fog': return { kind: 'fog', count: 14, tint: null, veil: [226, 232, 240, 0.34] };
    case 'cloudy': return { kind: 'cloud', count: 7, tint: [90, 100, 122, 0.08] };
    case 'clear':
      if (season === 'spring' && !dark) return { kind: 'petal', count: 28, tint: null };
      if (season === 'autumn' && !dark) return { kind: 'leaf', count: 30, tint: null };
      if (season === 'winter') return { kind: 'flake', count: 30, tint: null };
      if (season === 'summer' && dark) return { kind: 'firefly', count: 22, tint: null };
      return { kind: null, count: 0, tint: null };
    default: return { kind: null, count: 0, tint: null };
  }
}

// The sky behind the scene in this weather: grey and dimmer, no sun, moon or stars (a few stars through thin cloud). `amb` is time.js `ambient()`.
const SKY = { rain: { grey: 0.6, dim: 0.78 }, snow: { grey: 0.45, dim: 0.95 }, fog: { grey: 0.7, dim: 1.05 }, cloudy: { grey: 0.35, dim: 0.92 } };
export function skyFor(amb, weather) {
  const k = SKY[weather];
  if (!k || !amb) return amb;
  const toGrey = c => { const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return c.map(v => Math.max(0, Math.min(255, Math.round((v + (l - v) * k.grey) * k.dim)))); };
  return { ...amb, top: toGrey(amb.top), bottom: toGrey(amb.bottom), stars: weather === 'cloudy' ? +(amb.stars * 0.3).toFixed(3) : 0, sun: null, moon: null };
}

// ---- the particles: fixed typed arrays (no allocation per frame), positions in canvas pixels ------------------------------------------------
const rnd = (i, s) => { let h = Math.imul(i * 374761393 + s * 668265263, 1274126177); h ^= h >>> 15; return ((h >>> 0) % 100000) / 100000; };
const PETAL = ['#ffb8d6', '#fff0f6', '#ffd3e4'], LEAF = ['#eb8a3b', '#c4492f', '#ffd45e', '#d9701f'];
const rgba = c => `rgba(${c[0]},${c[1]},${c[2]},${c[3]})`;

export function createField() {
  const x = new Float32Array(PARTICLE_CAP), y = new Float32Array(PARTICLE_CAP), ph = new Float32Array(PARTICLE_CAP), sp = new Float32Array(PARTICLE_CAP);
  let plan = { kind: null, count: 0, tint: null }, w = 1, h = 1, u = 1, veil = null, veilH = 0, seed = 1;
  const field = {
    // set what falls and where the canvas is (w, h in canvas pixels, u = the size of one scene pixel in canvas pixels)
    configure(p, cw, ch, unit) {
      plan = { ...p, count: Math.min(PARTICLE_CAP, p.count | 0) };
      w = Math.max(1, cw); h = Math.max(1, ch); u = Math.max(1, unit | 0); seed++;
      for (let i = 0; i < plan.count; i++) { x[i] = rnd(i, seed) * w; y[i] = rnd(i, seed + 101) * h; ph[i] = rnd(i, seed + 202) * 6.283; sp[i] = 0.6 + rnd(i, seed + 303) * 0.8; }
      return plan.count;
    },
    get count() { return plan.count; },
    get kind() { return plan.kind; },
    // move everything by dt ms (never more than 100)
    step(dt) {
      dt = Math.min(100, dt) / 1000;
      const n = plan.count;
      switch (plan.kind) {
        case 'rain': for (let i = 0; i < n; i++) { y[i] += 620 * sp[i] * dt * u / 2; x[i] -= 90 * sp[i] * dt * u / 2; if (y[i] > h) { y[i] -= h + 20 * u; x[i] = rnd(i, seed + (y[i] | 0)) * (w + 60 * u); } if (x[i] < -10 * u) x[i] += w + 20 * u; } break;
        case 'snow': case 'flake': { const fall = plan.kind === 'snow' ? 46 : 26; for (let i = 0; i < n; i++) { y[i] += fall * sp[i] * dt * u / 2; ph[i] += dt * (0.8 + sp[i]); x[i] += Math.sin(ph[i]) * 14 * dt * u / 2; if (y[i] > h) { y[i] -= h + 6 * u; x[i] = rnd(i, seed + (y[i] | 0)) * w; } } break; }
        case 'petal': case 'leaf': for (let i = 0; i < n; i++) { y[i] += (plan.kind === 'leaf' ? 30 : 22) * sp[i] * dt * u / 2; ph[i] += dt * (1.2 + sp[i]); x[i] += (14 + Math.sin(ph[i]) * 18) * dt * u / 2; if (y[i] > h) { y[i] -= h + 8 * u; x[i] = rnd(i, seed + (y[i] | 0)) * w; } if (x[i] > w + 10 * u) x[i] -= w + 20 * u; } break;
        case 'fog': for (let i = 0; i < n; i++) { x[i] += 9 * sp[i] * dt * u / 2; if (x[i] > w + 40 * u) x[i] = -80 * u; } break;
        case 'cloud': for (let i = 0; i < n; i++) { x[i] += 6 * sp[i] * dt * u / 2; if (x[i] > w + 60 * u) x[i] = -140 * u; } break;
        case 'firefly': for (let i = 0; i < n; i++) { ph[i] += dt * (0.7 + sp[i] * 0.5); x[i] += Math.cos(ph[i] * 0.8) * 10 * dt * u / 2; y[i] += Math.sin(ph[i]) * 7 * dt * u / 2; } break;
        default: break;
      }
    },
    // draw with fillRect only; `t` (ms) drives the blinking
    draw(g, t) {
      const n = plan.count;
      if (plan.tint) { g.fillStyle = rgba(plan.tint); g.fillRect(0, 0, w, h); }
      switch (plan.kind) {
        case 'rain':
          g.fillStyle = 'rgba(190,215,245,0.62)';
          for (let i = 0; i < n; i++) { const px = x[i] | 0, py = y[i] | 0; g.fillRect(px, py, u, 3 * u); g.fillRect(px - u, py + 3 * u, u, 2 * u); }
          break;
        case 'snow': case 'flake':
          g.fillStyle = 'rgba(255,255,255,0.9)';
          for (let i = 0; i < n; i++) { const s = i % 3 === 0 ? 2 * u : u; g.fillRect(x[i] | 0, y[i] | 0, s, s); }
          break;
        case 'petal':
          for (let i = 0; i < n; i++) { g.fillStyle = PETAL[i % 3]; const flip = Math.floor(t / 260 + ph[i]) % 2; g.fillRect(x[i] | 0, y[i] | 0, flip ? 2 * u : u, flip ? u : 2 * u); }
          break;
        case 'leaf':
          for (let i = 0; i < n; i++) { g.fillStyle = LEAF[i % 4]; const flip = Math.floor(t / 300 + ph[i]) % 2; g.fillRect(x[i] | 0, y[i] | 0, flip ? 3 * u : 2 * u, flip ? 2 * u : 3 * u); }
          break;
        case 'firefly':
          for (let i = 0; i < n; i++) {
            const a = 0.5 + 0.5 * Math.sin(t / (380 + ph[i] * 60) + ph[i]);
            if (a < 0.25) continue;
            g.fillStyle = `rgba(255,236,120,${(0.22 * a).toFixed(2)})`; g.fillRect((x[i] | 0) - u, (y[i] | 0) - u, 3 * u, 3 * u);
            g.fillStyle = `rgba(255,250,170,${a.toFixed(2)})`; g.fillRect(x[i] | 0, y[i] | 0, u, u);
          }
          break;
        case 'fog': {
          if (!veil || veilH !== h) { veilH = h; veil = g.createLinearGradient(0, 0, 0, h); const v = plan.veil; veil.addColorStop(0, rgba([v[0], v[1], v[2], +(v[3] * 0.35).toFixed(3)])); veil.addColorStop(1, rgba(v)); }
          g.fillStyle = veil; g.fillRect(0, 0, w, h);
          g.fillStyle = 'rgba(236,240,246,0.045)';                                    // a wisp is three nested bars: soft edges from flat colours
          for (let i = 0; i < n; i++) {
            const fw = (50 + (i % 4) * 14) * u, fh = (7 + (i % 3) * 3) * u, fx = x[i] | 0, fy = y[i] | 0;
            g.fillRect(fx, fy, fw, fh); g.fillRect(fx + 6 * u, fy - 2 * u, fw - 12 * u, fh + 4 * u); g.fillRect(fx + 14 * u, fy - 4 * u, fw - 28 * u, fh + 8 * u);
          }
          break;
        }
        case 'cloud':
          for (let i = 0; i < n; i++) {
            const cw = (70 + (i % 3) * 28) * u, ch = (18 + (i % 2) * 8) * u, cx = x[i] | 0, cy = y[i] | 0;
            g.fillStyle = 'rgba(40,52,80,0.045)'; g.fillRect(cx, cy, cw, ch);
            g.fillRect(cx + 5 * u, cy - 3 * u, cw - 10 * u, ch + 6 * u); g.fillRect(cx + 12 * u, cy - 6 * u, cw - 24 * u, ch + 12 * u);
          }
          break;
        default: break;
      }
    },
  };
  return field;
}

// A rainbow: seven bands of an arc, drawn once into a canvas of its own (the caller caches it) so a frame only has to copy it.
export function drawRainbow(g, w, h, u) {
  const cx = Math.round(w * 0.64), cy = Math.round(h * 0.7), r0 = Math.round(Math.min(w, h) * 0.5), band = 3 * u;
  const COLORS = ['#ff6b6b', '#ff9f5a', '#ffe066', '#7ddf7a', '#5ccbf0', '#6a8dff', '#a77bf2'];
  COLORS.forEach((c, k) => {
    const r = r0 - k * band;
    g.fillStyle = c;
    for (let dx = -r; dx <= r; dx += u) {
      const yy = cy - Math.sqrt(Math.max(0, r * r - dx * dx));
      g.fillRect(cx + dx, Math.round(yy), u, band);
    }
  });
}
