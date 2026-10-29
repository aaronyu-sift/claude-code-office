// The weather of the 3D scene: one 2D canvas (`.of-wx`) laid over the 3D canvas, drawing the pixel scene's weather (pixel/weather.js, used as it is: at most PARTICLE_CAP
// particles, rain, snow, fog, cloud shadows, petals, leaves, flakes, fireflies and a rainbow after rain). It does not touch the WebGL scene, so the draw calls and the
// frame rate of the 3D loop stay what they were; the light the weather takes from the sun and the sky is the env's (ofis-env.js, from the same atmosphere).
//
// One weather "pixel" is UNIT CSS pixels. The overlay is drawn by its own scheduler (pixel/anim.js): at most 10 frames a second, nothing while the page or the Office
// view is hidden, nothing at all with the weather off or with prefers-reduced-motion (the atmosphere then has no weather). It never draws outside its canvas, never
// takes a pointer event and fetches nothing.
import { createScheduler } from './pixel/anim.js';
import { createField, drawRainbow, PARTICLE_CAP } from './pixel/weather.js';

export const UNIT = 2;                       // CSS px of one weather pixel
export const TINT_SHARE = 0.5;               // the canvas keeps half of the weather's tint over the picture: the env's lights take the other half

// the plan the field draws: the same as the pixel scene's, with less tint over the picture (the lights of the scene are dimmer and colder in rain already)
export function overlayPlan(plan) {
  return plan && plan.tint ? { ...plan, tint: [plan.tint[0], plan.tint[1], plan.tint[2], +(plan.tint[3] * TINT_SHARE).toFixed(3)] } : plan;
}

const offscreen = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));

// opts: { stage (the element the canvas goes into, over the 3D canvas), atmosphere (office-atmosphere.js), visible (is the Office view shown now) }
export function createOfisWeather({ stage, atmosphere, visible = false }) {
  const canvas = document.createElement('canvas'), g = canvas.getContext('2d');
  canvas.className = 'of-wx';
  canvas.setAttribute('aria-hidden', 'true');
  stage.appendChild(canvas);
  const field = createField();
  let shown = visible, rainbow = null, last = 0, unitPx = UNIT, snap = { weather: null, kind: null, rainbow: false };
  const stats = { frames: 0, times: [] };
  const sched = createScheduler({ draw: t => drawFrame(t), isHidden: () => document.hidden || !shown });

  const size = () => {
    const scale = Math.min(window.devicePixelRatio || 1, 2), w = Math.max(1, Math.round(stage.clientWidth * scale)), h = Math.max(1, Math.round(stage.clientHeight * scale));
    return { w, h, u: Math.max(1, Math.round(UNIT * scale)) };
  };
  function drawFrame(t) {
    const s = size();
    if (s.w !== canvas.width || s.h !== canvas.height || s.u !== unitPx) { update(); return; }       // the view was resized: reconfigure (and draw once)
    const t0 = performance.now();
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (snap.rainbow && rainbow) { g.globalAlpha = 0.34; g.drawImage(rainbow, 0, 0); g.globalAlpha = 1; }
    field.step(last ? t - last : 0); last = t;
    field.draw(g, t);
    stats.frames++;
    stats.times.push(performance.now() - t0);
    if (stats.times.length > 400) stats.times.shift();
  }
  // take the atmosphere's weather: the canvas is cleared once when it stops, and nothing is scheduled while there is nothing to draw
  function update() {
    const a = atmosphere.state, plan = overlayPlan(a.plan), s = size();
    canvas.width = s.w; canvas.height = s.h; unitPx = s.u;               // (setting the size clears the canvas)
    field.configure(plan, s.w, s.h, s.u);
    rainbow = null;
    if (a.rainbow && s.w > 1 && s.h > 1) { rainbow = offscreen(s.w, s.h); drawRainbow(rainbow.getContext('2d'), s.w, s.h, s.u); }
    snap = { weather: a.weather, kind: plan.kind, rainbow: !!rainbow };
    stage.dataset.weather = a.weather || 'off';
    sched.setActive('weather', field.count > 0);
    last = 0;
    if (a.weather) sched.requestFrame();
  }
  const off = atmosphere.on(update);
  const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (snap.kind || snap.rainbow) sched.requestFrame(); }) : null;
  if (watch) watch.observe(stage);
  const wake = () => sched.wake();
  document.addEventListener('visibilitychange', wake);
  update();

  return {
    setVisible(on) { shown = !!on; sched.wake(); },
    get canvas() { return canvas; },
    // read-only state for QA (tools/qa/office3d-env-qa.mjs)
    get stats() {
      const t = [...stats.times].sort((x, y) => x - y);
      return { frames: stats.frames, p95: t.length ? +t[Math.min(t.length - 1, Math.floor(t.length * 0.95))].toFixed(2) : 0, count: field.count, kind: field.kind, cap: PARTICLE_CAP, weather: snap.weather,
        rainbow: snap.rainbow, active: sched.activeSources, callbacks: sched.stats.callbacks, u: unitPx, w: canvas.width, h: canvas.height };
    },
    resetStats() { stats.frames = 0; stats.times.length = 0; sched.resetStats(); },
    // QA: how many pixels of the overlay are not transparent
    pixels() {
      const d = g.getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
      return n;
    },
    destroy() { off(); if (watch) watch.disconnect(); document.removeEventListener('visibilitychange', wake); sched.destroy(); canvas.remove(); },
  };
}
