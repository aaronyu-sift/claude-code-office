import test from 'node:test';
import assert from 'node:assert/strict';
import { flicker, noise, levels, paneColour, createFollower, bezier, createSwitches, SWITCH_MS, AMP, CANDLE_STEPS, DAY_SKY, NIGHT_GLOW } from '../public/js/ofis-light.js';
import { atmosphereAt, lightTarget, lightVector } from '../public/js/office-atmosphere.js';
import { CYCLE, EASE } from '../public/js/motion.js';

const KINDS = ['lamp', 'candle', 'bulb', 'sconce', 'screen', 'led'];
const day = new Date(2026, 5, 15, 13, 0), night = new Date(2026, 5, 15, 22, 30);
const settings = { time: 'auto', season: 'auto', weather: 'off', hemisphere: 'north' };
const vec = date => lightVector(lightTarget(atmosphereAt({ settings, date })));

// ---------------------------------------------------------------- flicker

test('flicker: bounded, under 8 percent of the brightness, for every kind, phase and second', () => {
  for (const kind of KINDS) for (let p = 0; p < 1; p += 0.07) for (let t = 0; t < 120; t += 0.037) {
    const f = flicker(t, { kind, phase: p });
    assert.ok(f >= 0.93 - 1e-9 && f <= 1.07 + 1e-9, `${kind} phase ${p.toFixed(2)} at ${t.toFixed(2)} s: ${f}`);
  }
  assert.ok(AMP.candle < 0.08 && AMP.lamp < 0.08 && AMP.bulb < 0.08, 'docs/motion.md: ambient scenery stays under 8 percent');
});

test('flicker: a candle is stepped random (9 steps a second), every other source a slow sine', () => {
  const steps = new Set();
  for (let t = 0; t < 1; t += 1 / 1000) steps.add(flicker(t, { kind: 'candle', phase: 0.3 }).toFixed(6));
  assert.ok(steps.size >= CANDLE_STEPS - 1 && steps.size <= CANDLE_STEPS + 1, `${steps.size} different values in a second`);
  assert.equal(flicker(5.01, { kind: 'candle', phase: 0.3 }), flicker(5.02, { kind: 'candle', phase: 0.3 }), 'it holds its value between two steps');
  const a = flicker(10, { kind: 'lamp', phase: 0.2 }), b = flicker(10.04, { kind: 'lamp', phase: 0.2 });
  assert.ok(a !== b && Math.abs(a - b) < 0.01, 'a lamp changes smoothly');
  let hi = -1, lo = 2;
  for (let t = 0; t < 30; t += 0.01) { const f = flicker(t, { kind: 'lamp', phase: 0.4 }); hi = Math.max(hi, f); lo = Math.min(lo, f); }
  assert.ok(hi > 1 + AMP.lamp * 0.9 && lo < 1 - AMP.lamp * 0.9, 'the sine really swings');
  assert.ok(Math.abs(flicker(7, { kind: 'candle', phase: 0.3 }) - flicker(7, { kind: 'candle', phase: 0.3 })) === 0, 'the same second and phase always give the same value');
});

test('flicker: every source has a phase of its own (two sources do not pulse together)', () => {
  const at = (t, p, kind) => flicker(t, { kind, phase: p });
  for (const kind of ['lamp', 'candle']) {
    let differ = 0;
    for (let t = 0; t < 20; t += 0.1) if (Math.abs(at(t, 0.1, kind) - at(t, 0.6, kind)) > 1e-9) differ++;
    assert.ok(differ > 150, `${kind}: two phases differ at ${differ} of 200 moments`);
  }
  const periodOf = p => { let n = 0, prev = flicker(0, { kind: 'lamp', phase: p }); for (let t = 0.005; t < 60; t += 0.005) { const f = flicker(t, { kind: 'lamp', phase: p }); if (prev < 1 && f >= 1) n++; prev = f; } return 60 / n; };
  assert.ok(Math.abs(periodOf(0) - periodOf(0.9)) > 0.5, 'two lamps do not share a period');
  assert.ok(noise(3, 0.1) !== noise(3, 0.2) && noise(3, 0.1) !== noise(4, 0.1));
  for (let i = 0; i < 500; i++) assert.ok(Math.abs(noise(i, i * 0.37)) <= 1);
});

test('flicker: none with reduced motion', () => {
  for (const kind of KINDS) for (let t = 0; t < 30; t += 0.3) assert.equal(flicker(t, { kind, phase: 0.77, reduced: true }), 1, kind);
  assert.notEqual(flicker(1.234, { kind: 'candle', phase: 0.5 }), 1);
});

// ---------------------------------------------------------------- how bright, by the time of day

test('levels: a lamp is dim by day and glows at night; a candle is out by day; a screen is on all day', () => {
  for (const kind of KINDS) {
    const d = levels(kind, 0), n = levels(kind, 1);
    for (const key of ['bulb', 'glow', 'pool']) {
      assert.ok(d[key] >= 0 && d[key] <= 1 && n[key] >= 0 && n[key] <= 1, `${kind} ${key} stays in 0..1`);
      assert.ok(n[key] >= d[key], `${kind} ${key}: not dimmer at night`);
    }
    assert.ok(n.bulb === 1, `${kind}: full at night`);
  }
  assert.ok(levels('lamp', 0).bulb < 0.2 && levels('lamp', 0).glow === 0 && levels('lamp', 0).pool === 0, 'a lamp has no glow in the daytime');
  assert.equal(levels('candle', 0).bulb, 0, 'a candle is not lit at noon');
  assert.ok(levels('screen', 0).bulb > 0.4, 'a screen shows by day');
  assert.ok(levels('lamp', 1).glow > 0.99 && levels('lamp', 1).pool > 0.99);
  let prev = -1;
  for (let k = 0; k <= 1.0001; k += 0.05) { const g = levels('lamp', k).glow; assert.ok(g >= prev - 1e-9, 'the glow only grows with the night'); prev = g; }
  assert.ok(levels('lamp', 0.3).glow < 0.2, 'a faint hint at dusk, not full light');
  assert.equal(levels('nonsense', 1).bulb, 1, 'an unknown kind is a lamp');
});

test('levels: the real clock: lamps glow at 22:00 and do not at 13:00', () => {
  const k13 = atmosphereAt({ settings, date: day }).lights, k22 = atmosphereAt({ settings, date: night }).lights;
  assert.ok(k13 < 0.05 && k22 > 0.95, `the night factor is ${k13} at 13:00 and ${k22} at 22:30`);
  assert.equal(levels('lamp', k13).glow, 0);
  assert.ok(levels('lamp', k22).glow > 0.9);
});

// ---------------------------------------------------------------- the pane of a window

test('pane: the sky by day, a warm glow at night, the weather and the dusk in between', () => {
  const noon = paneColour(vec(day)), dark = paneColour(vec(night));
  assert.ok(noon[2] > noon[0], 'blue sky by day');
  assert.ok(dark[0] > dark[2] && dark[0] > 0.85, 'a warm glow at night: red high, blue low');
  assert.deepEqual(noon.map(v => +v.toFixed(2)), DAY_SKY.map(v => +v.toFixed(2)), 'a clear noon is the sky colour');
  assert.ok(Math.abs(dark[0] - NIGHT_GLOW[0]) < 0.06 && Math.abs(dark[2] - NIGHT_GLOW[2]) < 0.06);
  const rainy = paneColour(lightVector(lightTarget(atmosphereAt({ settings: { ...settings, weather: 'rain' }, date: day }))));
  assert.ok(rainy[0] + rainy[1] + rainy[2] < noon[0] + noon[1] + noon[2], 'rain darkens the pane');
  const dusk = paneColour(vec(new Date(2026, 5, 15, 21, 5)));
  assert.ok(dusk[2] < noon[2], 'the blue goes out of the sky toward evening');
  const bluer = paneColour(vec(day), [0.5, 0.7, 1]);
  assert.ok(bluer[2] > noon[2] - 1e-9 && bluer[0] < noon[0], 'a style can tint its sky');
  for (const c of [noon, dark, rainy, dusk]) c.forEach(v => assert.ok(v >= 0 && v <= 1));
  let prev = null;
  for (let k = 0; k <= 1.0001; k += 0.02) {
    const c = paneColour([k, 0, 0, 0, 1, 1, 1, 0, 1, 1, 1]);
    if (prev) c.forEach((v, i) => assert.ok(Math.abs(v - prev[i]) < 0.12, 'the pane never jumps between two steps of the night'));
    prev = c;
  }
});

// ---------------------------------------------------------------- the light moves at a constant rate

test('follower: the light moves toward the atmosphere at the scene\'s constant rate and never jumps', () => {
  let state = atmosphereAt({ settings, date: day }), version = 0;
  const atm = { get state() { return state; }, get version() { return version; } };
  const f = createFollower({ atmosphere: atm, turnMs: CYCLE.turn });
  f.step(0.016);
  assert.ok(f.k < 0.05, 'starts at the clock\'s own value');
  state = atmosphereAt({ settings, date: night }); version++;
  const ks = [];
  for (let i = 0; i < 400; i++) { f.step(0.01); ks.push(f.k); }
  assert.ok(ks.every((k, i) => i === 0 || k >= ks[i - 1] - 1e-12), 'rises monotonically');
  assert.ok(ks.every((k, i) => i === 0 || k - ks[i - 1] <= (0.01 * 1000) / CYCLE.turn + 1e-9), 'at most one full change per CYCLE.turn');
  assert.ok(Math.abs(ks[ks.length - 1] - 1) < 0.02 || ks[ks.length - 1] > 0.99, `4 s later it is there: ${ks[ks.length - 1]}`);
  const half = ks[Math.round(CYCLE.turn / 10 / 2) - 1];
  assert.ok(half > 0.4 && half < 0.6, `half the time, half the way: ${half}`);
  assert.equal(f.reduced, false);
  state = atmosphereAt({ settings, date: night, reducedMotion: true }); version++;
  assert.equal(f.reduced, true);
});

// ---------------------------------------------------------------- a room's lights: the switch and the window

test('pane: the same by day whether the room is lit or not; at night a lit window glows warm and an unlit one is the dark night sky', () => {
  const dv = vec(day), nv = vec(night);
  assert.deepEqual(paneColour(dv, DAY_SKY, 1), paneColour(dv, DAY_SKY, 0), 'daylight comes from outside');
  const lit = paneColour(nv, DAY_SKY, 1), dark = paneColour(nv, DAY_SKY, 0), half = paneColour(nv, DAY_SKY, 0.5);
  assert.ok(lit[0] > 0.8 && lit[0] > lit[2] + 0.3, 'a lit window is warm');
  assert.ok(dark[0] < 0.15 && dark[2] < 0.25 && dark[2] > dark[0], 'an unlit window is a dark blue');
  assert.ok(half[0] > dark[0] && half[0] < lit[0], 'in between while the switch moves');
  assert.deepEqual(paneColour(nv, DAY_SKY), lit, 'lit is the default');
});

test('bezier: the CSS curves as functions: they start at 0, end at 1, never go back, and out arrives early while in leaves late', () => {
  const out = bezier(EASE.out), inn = bezier(EASE.in);
  for (const f of [out, inn]) {
    assert.equal(f(0), 0); assert.equal(f(1), 1);
    let last = 0;
    for (let i = 1; i <= 100; i++) { const v = f(i / 100); assert.ok(v >= last - 1e-9, 'monotonic'); last = v; }
  }
  assert.ok(out(0.2) > 0.5, `decelerate: ${out(0.2)}`);
  assert.ok(inn(0.5) < 0.5, `accelerate: ${inn(0.5)}`);
  assert.ok(Math.abs(bezier('cubic-bezier(0.5, 0.5, 0.5, 0.5)')(0.3) - 0.3) < 1e-5, 'a straight line is the identity');
});

test('switches: a room comes on over SWITCH_MS and arrives early, goes off and leaves late, and the first time a slot is seen it is at its state at once', () => {
  const s = createSwitches();
  s.set(3, true, 0); s.set(4, false, 0);
  assert.equal(s.get(3), 1, 'first seen: at its state at once');
  assert.equal(s.get(4), 0);
  assert.equal(s.get(9), 0, 'an unknown slot is dark');
  s.set(4, true, 1000);
  assert.equal(s.get(4), 0, 'nothing moves until time does');
  assert.ok(s.step(1000 + SWITCH_MS / 4)); const early = s.get(4);
  assert.ok(early > 0.4 && early < 1, `ease-out is well on its way a quarter in: ${early}`);
  s.step(1000 + SWITCH_MS * 2);
  assert.equal(s.get(4), 1); assert.ok(!s.step(1000 + SWITCH_MS * 3), 'nothing changes once it is there');
  s.set(4, false, 5000);
  s.step(5000 + SWITCH_MS / 4);
  assert.ok(s.get(4) > 0.8, `ease-out going off: ${s.get(4)} is still bright a quarter in`);
  s.step(5000 + SWITCH_MS);
  assert.equal(s.get(4), 0);
  s.set(7, true, 6000); s.set(7, false, 6050); s.step(6060);
  assert.ok(s.get(7) >= 0 && s.get(7) <= 1);
  s.set(5, false, 7000); s.set(5, true, 7000, true);
  assert.equal(s.get(5), 1, 'instant: reduced motion');
  assert.ok(s.key().includes('3:1.000'));
});
