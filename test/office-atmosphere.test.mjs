import test from 'node:test';
import assert from 'node:assert/strict';
import { atmosphereAt, lightTarget, lightVector, approach, lightOfPlan, WEATHER_LIGHT, createAtmosphere } from '../public/js/office-atmosphere.js';
import { createOfficeSettings } from '../public/js/office-settings.js';
import { sunTimes } from '../public/js/pixel/time.js';
import { weatherFor } from '../public/js/pixel/weather.js';
import { CYCLE } from '../public/js/motion.js';

const S = (o = {}) => ({ time: 'auto', season: 'auto', weather: 'off', hemisphere: 'north', shelf: 10, ...o });
const at = (y, m, d, hh = 12, mm = 0) => new Date(y, m - 1, d, hh, mm, 0);

test('atmosphere: a fixed time wins over the clock, and the lights are fully on at 03:00 and off at 13:00', () => {
  const night = atmosphereAt({ settings: S({ time: '03:00' }), date: at(2026, 6, 15, 13, 5) }), day = atmosphereAt({ settings: S({ time: '13:00' }), date: at(2026, 6, 15, 3, 5) });
  assert.equal(night.minute, 180); assert.equal(night.fixed, true); assert.equal(night.lights, 1); assert.equal(night.phase, 'night');
  assert.equal(day.minute, 780); assert.equal(day.lights, 0); assert.equal(day.phase, 'day');
  const live = atmosphereAt({ settings: S(), date: at(2026, 6, 15, 21, 40) });
  assert.equal(live.minute, 21 * 60 + 40); assert.equal(live.fixed, false); assert.ok(live.lights > 0.9);
});

test('atmosphere: the month moves sunrise and sunset, and the southern hemisphere has the other half of the year', () => {
  // 06:00: after sunrise in June (04:35), before it in January (07:20)
  const june = atmosphereAt({ settings: S({ time: '06:00' }), date: at(2026, 6, 15) }), jan = atmosphereAt({ settings: S({ time: '06:00' }), date: at(2026, 1, 15) });
  assert.equal(june.month, 6); assert.equal(jan.month, 1);
  assert.ok(june.lights < 0.01 && jan.lights > 0.7, `lights ${june.lights} in June, ${jan.lights} in January`);
  assert.notEqual(june.phase, jan.phase);
  // south: June has the days of December
  const southJune = atmosphereAt({ settings: S({ time: '06:00', hemisphere: 'south' }), date: at(2026, 6, 15) });
  assert.equal(southJune.month, 12); assert.ok(southJune.lights > 0.7);
  assert.ok(sunTimes(1)[0] > sunTimes(6)[0], 'sunrise is later in January than in June');
  // dusk: 17:15 is still the golden hour in October (sunset 17:25), already dusk in December (16:40)
  const oct = atmosphereAt({ settings: S({ time: '17:15' }), date: at(2026, 10, 15) }), dec = atmosphereAt({ settings: S({ time: '17:15' }), date: at(2026, 12, 15) });
  assert.ok(oct.lights < 0.6 && dec.lights > 0.8, `${oct.lights} in October, ${dec.lights} in December`);
});

test('atmosphere: the season is the setting, or follows the date and the hemisphere', () => {
  assert.equal(atmosphereAt({ settings: S(), date: at(2026, 10, 29) }).season, 'autumn');
  assert.equal(atmosphereAt({ settings: S({ hemisphere: 'south' }), date: at(2026, 10, 29) }).season, 'spring');
  assert.equal(atmosphereAt({ settings: S({ season: 'winter' }), date: at(2026, 7, 4) }).season, 'winter');
  assert.equal(atmosphereAt({ settings: S(), date: at(2026, 1, 10) }).season, 'winter');
});

test('atmosphere: no weather unless asked for; the automatic weather is the pixel scene\'s (same day, same weather); reduced motion switches it off', () => {
  const off = atmosphereAt({ settings: S(), date: at(2026, 10, 29) });
  assert.equal(off.weather, null); assert.equal(off.plan.kind, null); assert.equal(off.plan.count, 0);
  const rain = atmosphereAt({ settings: S({ weather: 'rain' }), date: at(2026, 10, 29) });
  assert.equal(rain.weather, 'rain'); assert.equal(rain.plan.kind, 'rain'); assert.ok(rain.plan.count > 0 && rain.plan.count <= 120);
  const auto = atmosphereAt({ settings: S({ weather: 'auto' }), date: at(2026, 10, 29) });
  assert.equal(auto.weather, weatherFor('2026-10-29', 'autumn'));
  assert.equal(atmosphereAt({ settings: S({ weather: 'auto' }), date: at(2026, 10, 29) }).weather, auto.weather);
  const reduced = atmosphereAt({ settings: S({ weather: 'rain' }), date: at(2026, 10, 29), reducedMotion: true });
  assert.equal(reduced.weather, null); assert.equal(reduced.plan.count, 0); assert.equal(reduced.reducedMotion, true);
  // the seasonal delights fall on a clear day: petals in spring, leaves in autumn by day
  assert.equal(atmosphereAt({ settings: S({ weather: 'clear', season: 'spring', time: '12:00' }), date: at(2026, 4, 1) }).plan.kind, 'petal');
  assert.equal(atmosphereAt({ settings: S({ weather: 'clear', season: 'autumn', time: '23:00' }), date: at(2026, 4, 1) }).plan.kind, null, 'not at night');
});

test('atmosphere: a rainbow only follows rain, only with the automatic weather, only by day', () => {
  let found = null;
  for (let d = 1; d <= 28 && !found; d++) { const a = atmosphereAt({ settings: S({ weather: 'auto', time: '12:00' }), date: at(2026, 4, d) }); if (a.rainbow) found = d; }
  assert.ok(found, 'some day in April has a rainbow');
  const date = at(2026, 4, found);
  assert.equal(atmosphereAt({ settings: S({ weather: 'auto', time: '12:00' }), date }).rainbow, true);
  assert.equal(atmosphereAt({ settings: S({ weather: 'auto', time: '23:30' }), date }).rainbow, false, 'not at night');
  assert.equal(atmosphereAt({ settings: S({ weather: 'clear', time: '12:00' }), date }).rainbow, false, 'a chosen weather has no rainbow');
});

test('light target: the lights follow the clock, the weather takes light from the sun more than from the sky, dawn and dusk warm the sun', () => {
  const day = lightTarget(atmosphereAt({ settings: S({ time: '13:00' }), date: at(2026, 6, 15) }));
  assert.equal(day.k, 0); assert.equal(day.sunDim, 0); assert.equal(day.skyDim, 0); assert.equal(day.wmix, 0); assert.equal(day.amix, 0);
  const night = lightTarget(atmosphereAt({ settings: S({ time: '03:00' }), date: at(2026, 6, 15) }));
  assert.equal(night.k, 1); assert.equal(night.amix, 0, 'at night the night\'s own colour takes over');
  const golden = lightTarget(atmosphereAt({ settings: S({ time: '18:30' }), date: at(2026, 6, 15) }));
  assert.ok(golden.amix > 0.1 && golden.amix <= 0.7, `golden hour warms the sun: ${golden.amix}`);
  assert.ok(golden.argb[0] > golden.argb[2], 'warm: more red than blue');
  for (const kind of ['rain', 'snow', 'fog', 'cloud']) { const w = WEATHER_LIGHT[kind]; assert.ok(w.sun > w.sky && w.sun > 0 && w.sun < 1 && w.sky < 1 && w.mix > 0 && w.mix < 1, kind); }
  const rain = lightTarget(atmosphereAt({ settings: S({ time: '13:00', weather: 'rain' }), date: at(2026, 6, 15) }));
  assert.equal(rain.sunDim, WEATHER_LIGHT.rain.sun); assert.ok(rain.wrgb.every(v => v >= 0 && v <= 1));
  assert.deepEqual(lightOfPlan({ kind: 'petal' }), lightOfPlan(null), 'a petal or a leaf does not change the light');
  const v = lightVector(rain);
  assert.equal(v.length, 11); assert.ok(v.every(x => Number.isFinite(x) && x >= 0 && x <= 1));
});

test('approach: the light moves at a constant rate, never in a step, never past the target, and a change of mind turns it round', () => {
  const cur = [0, 0.5, 1], to = [1, 0.5, 0];
  assert.equal(approach(cur, to, 0.25), true);
  assert.deepEqual(cur, [0.25, 0.5, 0.75], 'every number moves by the same step, the one that is there stays');
  approach(cur, to, 0.25); approach(cur, to, 0.25);
  assert.deepEqual(cur, [0.75, 0.5, 0.25]);
  approach(cur, to, 0.25);
  assert.deepEqual(cur, [1, 0.5, 0], 'it arrives exactly');
  assert.equal(approach(cur, to, 0.25), false, 'nothing moves any more');
  approach(cur, [0, 0.5, 0], 0.1);
  assert.ok(Math.abs(cur[0] - 0.9) < 1e-12, 'a new target turns it round at once');
  // a whole change takes CYCLE.turn at any frame rate, and is linear (halfway at half the time)
  for (const fps of [8, 30, 60]) {
    const v = [0], dt = 1000 / fps;
    let t = 0, half = null;
    while (approach(v, [1], dt / CYCLE.turn)) { t += dt; if (half == null && v[0] >= 0.5) half = t; }
    assert.ok(Math.abs(t - CYCLE.turn) <= dt + 1e-9, `${fps} fps: ${t} ms`);
    assert.ok(Math.abs(half - CYCLE.turn / 2) <= dt + 1e-9, `${fps} fps: halfway at ${half} ms`);
  }
});

// ---- the kept-up-to-date version, with a fake clock and fake timers
function rig(settingsOverrides = {}, start = at(2026, 10, 29, 21, 59)) {
  let now = start; const timers = [];
  const settings = createOfficeSettings({ storage: null, overrides: settingsOverrides });
  let reduced = false;
  const atm = createAtmosphere({ settings, now: () => new Date(now), reduced: () => reduced, setTimer: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimer: () => {} });
  return { settings, atm, timers, setNow: d => { now = d; }, setReduced: v => { reduced = v; atm.refresh(); } };
}

test('atmosphere kept up to date: a setting or a new minute changes it and bumps the version once; nothing else does', () => {
  const r = rig({ season: 'summer' });
  const seen = [];
  r.atm.on(s => seen.push(s.minute + '/' + s.season + '/' + s.weather));
  const v0 = r.atm.version;
  assert.equal(r.atm.state.minute, 21 * 60 + 59);
  r.settings.set('shelf', 20);
  assert.equal(r.atm.version, v0, 'the shelf is not part of the sky');
  r.settings.set('weather', 'rain');
  assert.equal(r.atm.version, v0 + 1); assert.equal(r.atm.state.weather, 'rain');
  r.settings.set('weather', 'rain');
  assert.equal(r.atm.version, v0 + 1, 'the same value again changes nothing');
  r.settings.set('time', '03:00');
  assert.equal(r.atm.state.minute, 180); assert.equal(r.atm.state.lights, 1);
  r.settings.set('time', 'auto');
  assert.equal(r.atm.state.minute, 21 * 60 + 59);
  // the minute ticker: the timer is set for the next minute boundary and fires a change
  assert.equal(r.timers.length, 1);
  r.setNow(at(2026, 10, 29, 22, 0));
  r.timers[0].f();
  assert.equal(r.atm.state.minute, 22 * 60); assert.ok(r.timers.length >= 2, 'it arms the next minute');
  assert.deepEqual(seen.slice(-1), ['1320/summer/rain']);
});

test('atmosphere kept up to date: a new day moves the season, a chosen season stays, reduced motion stops the weather and gives it back', () => {
  const r = rig({ weather: 'rain' }, at(2026, 11, 30, 23, 59));
  assert.equal(r.atm.state.season, 'autumn');
  r.setNow(at(2026, 12, 1, 0, 0)); r.timers[0].f();
  assert.equal(r.atm.state.season, 'winter', 'December is winter');
  r.settings.set('season', 'spring');
  r.setNow(at(2026, 12, 1, 0, 1)); r.timers[r.timers.length - 1].f();
  assert.equal(r.atm.state.season, 'spring');
  assert.equal(r.atm.state.weather, 'rain');
  r.setReduced(true);
  assert.equal(r.atm.state.weather, null); assert.equal(r.atm.state.reducedMotion, true);
  r.setReduced(false);
  assert.equal(r.atm.state.weather, 'rain');
  r.atm.setDate('2026-07-04');
  assert.equal(r.atm.state.month, 7); assert.equal(r.atm.state.day, '2026-07-04');
  r.atm.setDate(null);
  assert.equal(r.atm.state.month, 12);
});

test('atmosphere kept up to date: after destroy it no longer follows the settings', () => {
  const r = rig();
  const v = r.atm.version;
  r.atm.destroy();
  r.settings.set('weather', 'snow');
  assert.equal(r.atm.version, v);
});
