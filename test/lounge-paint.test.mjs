import test from 'node:test';
import assert from 'node:assert/strict';
import { paintWall, CANVAS } from '../public/js/lounge-paint.js';
import { buildView, normalizePayload, LIMITS } from '../public/js/lounge-model.js';
import { createDemoSource } from '../public/js/lounge-source.js';

// a 2D context that remembers what was drawn: the width of a text is half its font size per character
function recorder() {
  const log = { texts: [], fills: 0, clips: 0, alpha: [] };
  const g = {
    font: '10px sans-serif', fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, textAlign: 'left', textBaseline: 'alphabetic', letterSpacing: '0px',
    save() {}, restore() {}, clearRect() {}, beginPath() {}, moveTo() {}, arcTo() {}, closePath() {}, rect() {}, clip() { log.clips++; }, stroke() {}, fill() { log.fills++; }, fillRect() {},
    roundRect() {}, createLinearGradient() { return { addColorStop() {} }; },
    measureText(s) { const px = parseFloat((this.font.match(/(\d+(\.\d+)?)px/) || [0, 10])[1]); return { width: Array.from(String(s)).length * px * 0.5 }; },
    fillText(s) { log.texts.push(String(s)); log.alpha.push(this.globalAlpha); },
  };
  return { g, log };
}
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const demoView = (opts = {}) => {
  const read = createDemoSource({ now: () => NOW, start: NOW - 20e3 });
  const data = normalizePayload({ state: { state: 'ok' }, messages: read.messagesAt(NOW + 100e3), channels: {}, agents: [] });
  return buildView(data, { now: NOW + 100e3, mode: 'text', source: 'demo', ...opts });
};

test('paint: a wall of posts draws exactly the strings of the view, in the cleaned form the model made', () => {
  const view = demoView(), { g, log } = recorder();
  const out = paintWall(g, view);
  assert.deepEqual(out.texts, log.texts, 'what it reports is what it drew');
  assert.ok(view.wall.rows.length >= 6);
  for (const r of view.wall.rows) {
    assert.ok(log.texts.includes(r.who) || log.texts.some(t => t.startsWith(r.who.slice(0, 8))), 'who: ' + r.who);
    for (const ln of r.lines) assert.ok(log.texts.includes(ln), 'line: ' + ln);
    assert.ok(log.texts.includes(r.age), 'age: ' + r.age);
  }
  assert.ok(log.texts.includes(view.sign.title.toUpperCase()), 'the header');
  assert.equal(out.rows.length, view.wall.rows.length);
});

test('paint: the rows are bottom-aligned with the newest at the bottom, inside the panel, and eight posts of two lines fit', () => {
  const long = Array.from({ length: 12 }, (_, i) => ({ seq: i + 1, ts: NOW - (12 - i) * 5e3, channel: 'ops', from: 'builder', to: ['reviewer'], text: ('word '.repeat(30)).trim() + ' ' + i }));
  const view = buildView({ state: { state: 'ok' }, messages: long }, { now: NOW, mode: 'text' });
  assert.equal(view.wall.rows.length, LIMITS.wallRows);
  assert.ok(view.wall.rows.every(r => r.lines.length === 2));
  const { g } = recorder(), out = paintWall(g, view);
  assert.ok(out.scale < 1 && out.scale >= 0.55, 'the text shrank to fit: ' + out.scale);
  const ys = out.rows.map(r => r.y);
  assert.deepEqual(ys, [...ys].sort((a, b) => a - b), 'newest last, further down');
  const bottom = out.rows.at(-1).y + out.rows.at(-1).h;
  assert.ok(bottom <= CANVAS.h && bottom > CANVAS.h - 40, 'the newest post rests on the bottom edge: ' + bottom);
  assert.ok(ys[0] >= 70, 'under the header: ' + ys[0]);
  const few = buildView({ state: { state: 'ok' }, messages: long.slice(-2) }, { now: NOW, mode: 'text' });
  const f = paintWall(recorder().g, few);
  assert.equal(f.scale, 1, 'two posts need no shrinking');
  assert.ok(f.rows[0].y > ys[0] + 200, 'a short list starts lower: the blank is above');
});

test('paint: the mode names draws no message text; the mode off draws a dark panel with no text at all', () => {
  const text = demoView(), names = demoView({ mode: 'names' }), off = demoView({ mode: 'off' });
  const a = recorder(); paintWall(a.g, names);
  for (const r of text.wall.rows) for (const ln of r.lines) assert.ok(!a.log.texts.includes(ln), 'no text in names: ' + ln);
  assert.ok(a.log.texts.length > 8, 'but the names and ages are there');
  const b = recorder(); const out = paintWall(b.g, off);
  assert.deepEqual(b.log.texts, []);
  assert.deepEqual(out.rows, []);
});

test('paint: a board without posts says its sign: off with its hint, unsupported with its reason, quiet', () => {
  const t = (key, p) => ({ 'lounge.off': 'Agent message board is off', 'lounge.offHint': 'Start the server with --chat-db <file> to show it.', 'lounge.unsupported': 'Message board format not recognised', 'lounge.quiet': 'No posts in the last hour', 'lounge.title': 'Agent lounge' }[key] || key);
  const cases = [
    [null, ['Agent message board is off', 'Start the server with --chat-db <file> to show it.']],
    [{ state: { state: 'unsupported', schema: 'v9', reason: 'unknown table layout' } }, ['Message board format not recognised', 'unknown table layout']],
    [{ state: { state: 'ok' }, messages: [{ seq: 1, ts: NOW - 5 * 3600e3, channel: 'x', from: 'a', text: 'old' }] }, ['No posts in the last hour']],
  ];
  for (const [data, want] of cases) {
    const { g, log } = recorder();
    paintWall(g, buildView(data, { now: NOW, mode: 'text', t }));
    for (const s of want) assert.ok(log.texts.includes(s), s + ' in ' + JSON.stringify(log.texts));
    assert.ok(!log.texts.some(s => /\d+ posts/.test(s)));
  }
});

test('paint: a post that arrives fades in while the others move up, and at rest everything is drawn at full strength', () => {
  const view = demoView(), seq = view.wall.rows.at(-1).seq;
  const rest = recorder(), start = recorder(), mid = recorder();
  const a = paintWall(rest.g, view, { progress: 1, added: new Set([seq]) });
  const b = paintWall(start.g, view, { progress: 0, added: new Set([seq]) });
  const c = paintWall(mid.g, view, { progress: 0.5, added: new Set([seq]) });
  assert.ok(rest.log.alpha.every(v => v === 1));
  const newest = view.wall.rows.at(-1);
  const idx = start.log.texts.indexOf(newest.who);
  assert.equal(start.log.alpha[idx], 0, 'the new post is not there yet');
  assert.ok(b.rows[0].y > a.rows[0].y + 20, 'the old posts are lower at the start');
  assert.ok(b.rows[0].y > c.rows[0].y && c.rows[0].y > a.rows[0].y, 'and move up as it arrives');
  assert.equal(b.rows.at(-1).seq, seq);
});

test('paint: a hostile post cannot put more on the wall than the model allowed', () => {
  const evil = { seq: 1, ts: NOW - 1000, channel: 'c'.repeat(400), from: 'x'.repeat(400), to: ['y'.repeat(400)], text: 'Z'.repeat(5000) };
  const view = buildView({ state: { state: 'ok' }, messages: [evil] }, { now: NOW, mode: 'text' });
  const { g, log } = recorder();
  paintWall(g, view);
  const widest = Math.max(...log.texts.map(s => Array.from(s).length));
  assert.ok(widest <= 2 * LIMITS.lineChars, 'no drawn string is longer than a line: ' + widest);
  assert.ok(log.texts.join('').length < 600);
});
