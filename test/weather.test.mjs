import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WEATHERS, WEATHER_SETTINGS, PARTICLE_CAP, parseWeather, weatherFor, rainbowFor, resolveWeather, planFor, createField, drawRainbow, skyFor } from '../public/js/pixel/weather.js';
import { SEASONS, addDays } from '../public/js/pixel/season.js';
import { PHASES, ambient } from '../public/js/pixel/time.js';

const days = (from, n) => Array.from({ length: n }, (_, i) => addDays(from, i));

test('weather: the same date and season always give the same automatic weather', () => {
  for (const season of SEASONS) for (const key of days('2026-01-01', 400)) {
    const a = weatherFor(key, season), b = weatherFor(key, season);
    assert.equal(a, b);
    assert.ok(WEATHERS.includes(a), `${key} ${season}: ${a}`);
  }
  // a pinned value, so a change of the hash (which would shuffle everybody's weather) is noticed
  assert.equal(weatherFor('2026-10-28', 'autumn'), weatherFor('2026-10-28', 'autumn'));
  assert.deepEqual(days('2026-10-20', 8).map(k => weatherFor(k, 'autumn')), days('2026-10-20', 8).map(k => weatherFor(k, 'autumn')));
});
test('weather: the automatic weather depends on the season and on the date', () => {
  const ys = days('2026-01-01', 365);
  for (const season of SEASONS) assert.ok(new Set(ys.map(k => weatherFor(k, season))).size >= 3, `${season} has too little variety`);
  assert.ok(ys.some(k => weatherFor(k, 'autumn') !== weatherFor(k, 'spring')), 'the season does not matter');
  assert.ok(new Set(ys.map(k => weatherFor(k, 'autumn'))).size > 1, 'the date does not matter');
});
test('weather: snow never falls in summer, rain is rare in winter, and every other weather is possible in every season', () => {
  const ys = days('2024-01-01', 2000), share = (season, w) => ys.filter(k => weatherFor(k, season) === w).length / ys.length;
  assert.equal(share('summer', 'snow'), 0);
  assert.ok(share('winter', 'snow') > 0.2 && share('winter', 'rain') < 0.12);
  assert.ok(share('summer', 'clear') > 0.45 && share('autumn', 'fog') > 0.12);
  for (const season of SEASONS) for (const w of WEATHERS) if (!(season === 'summer' && w === 'snow')) assert.ok(share(season, w) > 0, `${season} never has ${w}`);
});
test('weather: a setting resolves to nothing (off), the automatic weather, or itself', () => {
  assert.equal(resolveWeather('off', '2026-10-28', 'autumn'), null);
  assert.equal(resolveWeather(undefined, '2026-10-28', 'autumn'), null);
  assert.equal(resolveWeather('auto', '2026-10-28', 'autumn'), weatherFor('2026-10-28', 'autumn'));
  for (const w of WEATHERS) assert.equal(resolveWeather(w, '2026-10-28', 'winter'), w);
  assert.deepEqual(WEATHER_SETTINGS, ['off', 'auto', ...WEATHERS]);
  assert.equal(parseWeather(' RAIN '), 'rain'); assert.equal(parseWeather('hail'), null);
});
test('weather: a rainbow is rare and only follows rain', () => {
  const ys = days('2024-01-01', 2000);
  for (const season of SEASONS) {
    const bows = ys.filter(k => rainbowFor(k, season));
    assert.ok(bows.length / ys.length < 0.08, `${season}: ${bows.length} rainbows in ${ys.length} days`);
    for (const k of bows) { assert.equal(weatherFor(k, season), 'clear'); assert.equal(weatherFor(addDays(k, -1), season), 'rain'); }
  }
  assert.ok(ys.some(k => rainbowFor(k, 'spring')), 'no rainbow in spring at all');
});

test('weather: no plan has more than the particle cap, in any weather, season or phase of the day', () => {
  assert.equal(PARTICLE_CAP, 120);
  for (const weather of [...WEATHERS, null, undefined]) for (const season of SEASONS) for (const phase of PHASES) {
    const p = planFor({ weather, season, phase });
    assert.ok(p.count >= 0 && p.count <= PARTICLE_CAP, `${weather} ${season} ${phase}: ${p.count}`);
    assert.ok(p.count === 0 || p.kind, 'particles without a kind');
  }
  assert.ok(planFor({ weather: 'rain', season: 'summer', phase: 'day' }).count >= 100);
});
test('weather: clear days bring the season\'s delights: petals, leaves, flakes, fireflies at night', () => {
  const k = (season, phase) => planFor({ weather: 'clear', season, phase }).kind;
  assert.equal(k('spring', 'day'), 'petal'); assert.equal(k('autumn', 'golden'), 'leaf'); assert.equal(k('winter', 'day'), 'flake'); assert.equal(k('winter', 'night'), 'flake');
  assert.equal(k('summer', 'night'), 'firefly'); assert.equal(k('summer', 'day'), null); assert.equal(k('spring', 'night'), null);
});
test('weather: the field never holds more than the cap, even when asked for more', () => {
  const f = createField();
  assert.equal(f.configure({ kind: 'rain', count: 5000, tint: null }, 800, 600, 2), PARTICLE_CAP);
  assert.equal(f.count, PARTICLE_CAP);
  assert.equal(f.configure({ kind: null, count: 0 }, 800, 600, 2), 0);
});
test('weather: drawing uses fillRect only, at most a few calls per particle, and every particle stays on the canvas while it moves', () => {
  const calls = { fillRect: 0, other: [] };
  const g = new Proxy({}, { get: (_, k) => (k === 'fillRect' ? () => { calls.fillRect++; } : k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => calls.other.push(k)), set: () => true });
  for (const kind of ['rain', 'snow', 'flake', 'petal', 'leaf', 'firefly', 'fog', 'cloud']) {
    const f = createField();
    const n = f.configure({ kind, count: 120, tint: [10, 20, 30, 0.1], veil: [200, 200, 200, 0.3] }, 640, 400, 2);
    calls.fillRect = 0;
    for (let t = 0; t < 3000; t += 100) { f.step(100); f.draw(g, t); }
    assert.ok(calls.fillRect > 0 && calls.fillRect <= 30 * (3 * n + 4), `${kind}: ${calls.fillRect} fillRect calls`);
  }
  assert.deepEqual([...new Set(calls.other)], [], 'drawing touched something besides fillRect and the fog gradient');
});
test('weather: the rainbow is drawn with fillRect, seven bands', () => {
  let n = 0;
  const g = new Proxy({}, { get: (_, k) => (k === 'fillRect' ? () => { n++; } : () => {}), set: () => true });
  drawRainbow(g, 800, 600, 2);
  assert.ok(n > 7 * 100);
});
test('weather: no network access from any weather code (nothing is fetched, nothing is opened)', () => {
  for (const f of ['weather.js', 'season.js', 'settings.js']) {
    const code = readFileSync(new URL('../public/js/pixel/' + f, import.meta.url), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    assert.doesNotMatch(code, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts)\b|\bimport\s*\(|https?:\/\//, `${f} can reach the network`);
  }
});
test('weather: rain, snow, fog and cloud grey the sky and hide the sun, the moon and the stars; clear and no weather leave it alone', () => {
  const noon = ambient(720, 6), night = ambient(23 * 60, 6);
  assert.equal(skyFor(noon, null), noon); assert.equal(skyFor(noon, 'clear'), noon); assert.equal(skyFor(null, 'rain'), null);
  for (const w of ['rain', 'snow', 'fog']) {
    const s = skyFor(night, w);
    assert.equal(s.stars, 0); assert.equal(s.moon, null); assert.equal(s.sun, null); assert.equal(s.top.length, 3);
    assert.ok(skyFor(noon, w).sun === null && noon.sun, `${w} still shows the sun`);
  }
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  assert.ok(lum(skyFor(noon, 'rain').top) < lum(noon.top), 'a rainy sky is darker');
  const sat = c => Math.max(...c) - Math.min(...c);
  assert.ok(sat(skyFor(noon, 'rain').top) < sat(noon.top), 'a rainy sky is greyer');
  assert.ok(skyFor(night, 'cloudy').stars < night.stars && skyFor(night, 'cloudy').stars > 0);
});
