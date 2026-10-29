import test from 'node:test';
import assert from 'node:assert/strict';
import { createOfisWeather, overlayPlan, UNIT, TINT_SHARE } from '../public/js/ofis-weather.js';
import { createAtmosphere } from '../public/js/office-atmosphere.js';
import { createOfficeSettings } from '../public/js/office-settings.js';
import { planFor, PARTICLE_CAP } from '../public/js/pixel/weather.js';

test('overlay plan: the canvas keeps a share of the weather\'s tint (the scene\'s lights take the rest), everything else is the pixel scene\'s plan', () => {
  const rain = planFor({ weather: 'rain', season: 'summer', phase: 'day' });
  const o = overlayPlan(rain);
  assert.deepEqual(o.tint.slice(0, 3), rain.tint.slice(0, 3));
  assert.ok(Math.abs(o.tint[3] - rain.tint[3] * TINT_SHARE) < 0.001);
  assert.equal(o.kind, 'rain'); assert.equal(o.count, rain.count);
  assert.equal(overlayPlan(planFor({ weather: 'fog', season: 'summer' })).veil[3], planFor({ weather: 'fog', season: 'summer' }).veil[3], 'the fog\'s veil is not touched');
  const none = planFor({ weather: 'clear', season: 'summer', phase: 'day' });
  assert.deepEqual(overlayPlan(none), none); assert.equal(overlayPlan(null), null);
  assert.ok(rain.tint[3] > 0, 'the input is not changed'); assert.equal(rain.tint.length, 4);
});

// ---- the overlay with a fake page: a canvas that records what is drawn, and a frame loop that the test turns by hand
function fakePage() {
  const calls = { fillRect: 0, clearRect: 0, drawImage: 0 };
  const g = { fillStyle: '', globalAlpha: 1, fillRect() { calls.fillRect++; }, clearRect() { calls.clearRect++; }, drawImage() { calls.drawImage++; }, createLinearGradient: () => ({ addColorStop() {} }) };
  const canvases = [];
  const raf = [];
  globalThis.document = { hidden: false, createElement: () => { const c = { width: 0, height: 0, className: '', setAttribute() {}, remove() { c.removed = true; }, getContext: () => g }; canvases.push(c); return c; }, addEventListener() {}, removeEventListener() {} };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.requestAnimationFrame = f => { raf.push(f); return raf.length; };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const stage = { clientWidth: 600, clientHeight: 400, dataset: {}, appended: [], appendChild(c) { this.appended.push(c); } };
  // run the frame callbacks that are waiting, one frame every `step` ms, `n` times
  let t = 1000;
  const run = (n, step = 100) => { for (let i = 0; i < n; i++) { t += step; const pending = raf.splice(0); for (const f of pending) f(t); } };
  return { g, calls, canvases, stage, run, raf, restore() { for (const k of ['document', 'window', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia']) delete globalThis[k]; } };
}
const atmosphereFor = (overrides, reduced = false) => createAtmosphere({ settings: createOfficeSettings({ storage: null, overrides }), now: () => new Date(2026, 9, 29, 12, 0), reduced: () => reduced, setTimer: () => 0, clearTimer: () => {} });

test('weather overlay: off draws nothing and schedules nothing; a weather draws through the scheduler, at most 10 frames a second, only while shown', () => {
  const P = fakePage();
  try {
    const atm = atmosphereFor({ time: '12:00' });
    const w = createOfisWeather({ stage: P.stage, atmosphere: atm, visible: true });
    assert.equal(P.stage.appended.length, 1); assert.equal(P.canvases[0].className, 'of-wx'); assert.equal(P.stage.dataset.weather, 'off');
    assert.equal(w.stats.count, 0); assert.deepEqual(w.stats.active, []);
    P.run(10);
    assert.equal(w.stats.frames, 0, 'off: no frame is drawn');
    assert.equal(P.canvases[0].width, 600); assert.equal(P.canvases[0].height, 400);
    // rain
    const settings = createOfficeSettings({ storage: null, overrides: { time: '12:00' } });
    const atm2 = createAtmosphere({ settings, now: () => new Date(2026, 9, 29, 12, 0), reduced: () => false, setTimer: () => 0, clearTimer: () => {} });
    const w2 = createOfisWeather({ stage: P.stage, atmosphere: atm2, visible: false });
    settings.set('weather', 'rain');
    assert.equal(w2.stats.kind, 'rain'); assert.ok(w2.stats.count > 0 && w2.stats.count <= PARTICLE_CAP); assert.deepEqual(w2.stats.active, ['weather']); assert.equal(P.stage.dataset.weather, 'rain');
    assert.equal(w2.stats.u, UNIT, 'one weather pixel is UNIT css pixels at a pixel ratio of 1');
    P.run(10);
    assert.equal(w2.stats.frames, 0, 'not while the Office view is hidden');
    w2.setVisible(true);
    w2.resetStats();
    P.run(20, 100);                                                       // two seconds of 100 ms frames
    assert.ok(w2.stats.frames > 0 && w2.stats.frames <= 21, `${w2.stats.frames} frames in 2 s`);
    P.run(40, 16);                                                        // fast browser frames: the scheduler still draws at most every 100 ms
    assert.ok(w2.stats.frames <= 21 + 7, `${w2.stats.frames} frames after 0.64 s more`);
    w2.setVisible(false);
    const before = w2.stats.frames;
    P.run(10);
    assert.equal(w2.stats.frames, before, 'hidden again: nothing more');
    // the weather goes off: the canvas is cleared and nothing is scheduled any more
    w2.setVisible(true);
    settings.set('weather', 'off');
    assert.equal(w2.stats.count, 0); assert.deepEqual(w2.stats.active, []);
    const f1 = w2.stats.frames; P.run(10);
    assert.equal(w2.stats.frames, f1);
    w2.destroy(); w.destroy();
    assert.equal(P.canvases[0].removed, true);
  } finally { P.restore(); }
});

test('weather overlay: with reduced motion there is no weather, the setting stays; a resize reconfigures the field to the new size', () => {
  const P = fakePage();
  try {
    const w = createOfisWeather({ stage: P.stage, atmosphere: atmosphereFor({ time: '12:00', weather: 'rain' }, true), visible: true });
    assert.equal(w.stats.count, 0); assert.equal(w.stats.weather, null); assert.deepEqual(w.stats.active, []);
    P.run(10); assert.equal(w.stats.frames, 0);
    w.destroy();
    const w2 = createOfisWeather({ stage: P.stage, atmosphere: atmosphereFor({ time: '12:00', weather: 'snow' }), visible: true });
    assert.equal(w2.stats.kind, 'snow'); assert.equal(w2.stats.w, 600);
    P.stage.clientWidth = 900; P.stage.clientHeight = 500;
    P.run(3);
    assert.equal(w2.stats.w, 900); assert.equal(w2.stats.h, 500);
    assert.ok(w2.stats.frames >= 1, 'it draws on the new size');
    w2.destroy();
  } finally { P.restore(); }
});
