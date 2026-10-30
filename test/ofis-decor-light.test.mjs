// The switch of an office's lights as the decor wires it: decor.setLit throws it, decor.update moves it, both read performance.now(). The clock is the test's own, so the ease is
// read at exact moments: this is where "the lights ease over SWITCH_MS" is proven (the page check 3d-cowork-slot only reads the direction and the end state, because the frame at
// which a rebuilt building first draws is not under its control on a loaded machine). Breaking decor.setLit into an instant switch, or decor.update into one that never steps
// the switches, fails this file (office3d-cowork-qa.mjs --mutations runs it for those two lines).
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import { SWITCH_MS } from '../public/js/ofis-light.js';
import { atmosphereAt } from '../public/js/office-atmosphere.js';

// ofis-decor.js imports 'three' by its bare name (the page maps it to the vendored bundle with an import map); node has no node_modules here, so the same bundle answers to that name
const THREE_URL = new URL('../public/vendor/three/three.module.min.js', import.meta.url).href;
if (nodeModule.registerHooks) nodeModule.registerHooks({ resolve: (spec, ctx, next) => spec === 'three' ? { url: THREE_URL, shortCircuit: true } : next(spec, ctx) });
else nodeModule.register('data:text/javascript,' + encodeURIComponent(`export async function resolve(spec, ctx, next) { return spec === 'three' ? { url: ${JSON.stringify(THREE_URL)}, shortCircuit: true } : next(spec, ctx); }`));
const { createDecor } = await import('../public/js/ofis-decor.js');

const settings = { time: 'auto', season: 'auto', weather: 'off', hemisphere: 'north' };
const night = new Date(2026, 5, 15, 22, 30);

// a decor with nothing furnished (no document, no canvas: three instanced meshes are only made for what a plan has) on a clock the test sets
function setup({ reducedMotion = false } = {}) {
  let now = 1000;
  mock.method(performance, 'now', () => now);
  const state = atmosphereAt({ settings, date: night, reducedMotion });
  const decor = createDecor({ atmosphere: { state, version: 0 } });
  decor.beginBuild();
  decor.finish({ add() {} });
  return {
    decor,
    at(ms) { now = ms; },
    frame(ms) { now = ms; decor.update(ms / 1000, 0); },
  };
}

test('decor: a room comes on over SWITCH_MS, eased, strictly between 0 and 1 on the way and exactly 1 at the end', () => {
  const t = setup();
  try {
    t.decor.setLit(3, false); t.decor.setLit(4, true);
    assert.equal(t.decor.litOf(3), 0, 'the first time a slot is seen it is at its state at once');
    assert.equal(t.decor.litOf(4), 1);
    t.at(2000); t.decor.setLit(3, true);
    assert.equal(t.decor.litOf(3), 0, 'throwing the switch moves nothing until time does');
    t.frame(2000);
    assert.equal(t.decor.litOf(3), 0, 'a frame at the same moment moves nothing');
    const seen = [];
    for (const f of [0.1, 0.25, 0.5, 0.75, 0.9]) { t.frame(2000 + SWITCH_MS * f); seen.push(t.decor.litOf(3)); }
    assert.ok(seen.every(v => v > 0 && v < 1), `every reading on the way is strictly between 0 and 1: ${seen.map(v => v.toFixed(3)).join(' ')}`);
    assert.ok(seen.every((v, i) => i === 0 || v > seen[i - 1]), `and it only rises: ${seen.map(v => v.toFixed(3)).join(' ')}`);
    assert.ok(seen[1] > 0.5, `ease-out arrives early (a quarter in it is past half): ${seen[1]}`);
    t.frame(2000 + SWITCH_MS);
    assert.equal(t.decor.litOf(3), 1, 'at SWITCH_MS it is 1 exactly');
    t.frame(2000 + SWITCH_MS * 3);
    assert.equal(t.decor.litOf(3), 1);
    assert.equal(t.decor.litOf(4), 1, 'no other slot moved');
  } finally { mock.restoreAll(); }
});

test('decor: a room goes off over SWITCH_MS, eased, and leaves late (ease-in)', () => {
  const t = setup();
  try {
    t.decor.setLit(5, true);
    t.at(5000); t.decor.setLit(5, false);
    assert.equal(t.decor.litOf(5), 1);
    const seen = [];
    for (const f of [0.1, 0.25, 0.5, 0.75, 0.9]) { t.frame(5000 + SWITCH_MS * f); seen.push(t.decor.litOf(5)); }
    assert.ok(seen.every(v => v > 0 && v < 1), `strictly between 1 and 0 on the way: ${seen.map(v => v.toFixed(3)).join(' ')}`);
    assert.ok(seen.every((v, i) => i === 0 || v < seen[i - 1]), `and it only falls: ${seen.map(v => v.toFixed(3)).join(' ')}`);
    assert.ok(seen[1] > 0.8, `ease-in leaves late (a quarter in it is still bright): ${seen[1]}`);
    t.frame(5000 + SWITCH_MS);
    assert.equal(t.decor.litOf(5), 0);
  } finally { mock.restoreAll(); }
});

test('decor: a slow frame still lands on the right number (the ease follows the clock, not the frame count)', () => {
  const t = setup();
  try {
    t.decor.setLit(6, false);
    t.at(3000); t.decor.setLit(6, true);
    t.frame(3000 + 968);                                   // one frame that blocked for almost a second, as the first frame after a rebuild does in software GL
    assert.equal(t.decor.litOf(6), 1);
    t.at(9000); t.decor.setLit(6, false);
    t.frame(9000 + SWITCH_MS / 2);
    const mid = t.decor.litOf(6);
    assert.ok(mid > 0 && mid < 1, `half-way: ${mid}`);
    t.at(9000 + SWITCH_MS / 2 + 10); t.decor.setLit(6, true);   // the chat is back before the light is out: it turns round from where it is
    const from = t.decor.litOf(6);
    assert.ok(Math.abs(from - mid) < 1e-9, 'throwing the switch back keeps the number it had');
    t.frame(9000 + SWITCH_MS / 2 + 10 + SWITCH_MS * 2);
    assert.equal(t.decor.litOf(6), 1);
  } finally { mock.restoreAll(); }
});

test('decor: with prefers-reduced-motion the switch is a step', () => {
  const t = setup({ reducedMotion: true });
  try {
    t.decor.setLit(7, false);
    t.at(4000); t.decor.setLit(7, true);
    assert.equal(t.decor.litOf(7), 1, 'at once, no ease');
    t.at(8000); t.decor.setLit(7, false);
    assert.equal(t.decor.litOf(7), 0);
  } finally { mock.restoreAll(); }
});
