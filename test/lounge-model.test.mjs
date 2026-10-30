import test from 'node:test';
import assert from 'node:assert/strict';
import en from '../public/js/lang/en.js';
import tr from '../public/js/lang/tr.js';
import { LIMITS, cleanText, clipChars, ageText, splitLines, normalizePayload, buildView, seenAge, chipColour, personColour } from '../public/js/lounge-model.js';

// the message lookup of the page, for one language (i18n.js: a string with {placeholders}, { one, other } picked by n, or a function)
const lookup = lang => (key, p) => {
  let v = lang.messages[key] ?? en.messages[key];
  if (v == null) return key;
  if (typeof v === 'function') return v(p || {});
  if (typeof v === 'object') v = new Intl.PluralRules(lang.locale).select(Number(p && p.n) || 0) === 'one' ? v.one : v.other;
  return p ? v.replace(/\{(\w+)\}/g, (m, k) => (p[k] != null ? String(p[k]) : m)) : v;
};
const t = lookup(en);
const NOW = 1_800_000_000_000;
const post = (o = {}) => ({ seq: 1, ts: NOW - 5000, channel: 'office', from: 'alice', to: ['bob'], text: 'hello', ...o });
const payload = (messages, extra = {}) => ({ state: { state: 'ok', schema: 'v2', reason: '' }, messages, channels: {}, agents: [], ...extra });
const view = (raw, o = {}) => buildView(normalizePayload(raw), { now: NOW, mode: 'text', source: 'live', t, ...o });

// ------------------------------------------------------------ text

test('cleanText: only strings count; control characters and bidi marks go; blanks collapse', () => {
  for (const bad of [null, undefined, 5, true, {}, [], ['a'], () => 'x']) assert.equal(cleanText(bad), '', String(bad));
  assert.equal(cleanText('  a \t b\n\nc\r\nd  '), 'a b c d');
  assert.equal(cleanText('a\u0000b\u0007c\u001bd\u007fe\u0085f\u009fg'), 'abcde fg', 'controls vanish, NEL is a blank');
  // the bidi marks: LRM RLM ALM, the embeddings and overrides, the isolates, and the invisible joiners that can hide text
  const bidi = '‎‏؜‪‫‬‭‮⁦⁧⁨⁩​⁠⁡⁪﻿­';
  assert.equal(cleanText(`ad${bidi}min`), 'admin');
  assert.equal(cleanText('‮evil.txt‬'), 'evil.txt', 'an override cannot reverse the line');
  assert.equal(cleanText('a b c d　e'), 'a b c d e', 'line separators and odd blanks become one blank');
  assert.equal(cleanText('👩‍💻 ok'), '👩‍💻 ok', 'ZWJ stays: an emoji sequence is one character');
});

test('cleanText: clips by characters, never by bytes, never in the middle of a surrogate pair or an emoji', () => {
  assert.equal(cleanText('abcdef', 4), 'abc…', 'the ellipsis counts inside the limit');
  assert.equal(cleanText('abcd', 4), 'abcd');
  assert.equal(cleanText('日本語のテキストです', 5), '日本語の…', 'three bytes a character, five characters');
  assert.equal(Array.from(cleanText('😀'.repeat(10), 4)).length, 4);
  assert.equal(cleanText('😀'.repeat(10), 4), '😀😀😀…');
  assert.equal(cleanText('👍🏽'.repeat(6), 3), '👍🏽👍🏽…', 'an emoji with a skin tone is one character');
  assert.equal(cleanText('👩‍👩‍👧‍👦 family'.repeat(3), 5).length > 0, true);
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(cleanText('x😀y'.repeat(40), 7)), 'no lone half of a surrogate pair');
  assert.equal(cleanText('éééé', 3), 'éé…', 'a letter with its accent is one character');
  assert.equal(cleanText('abc   def', 5), 'abc…', 'a blank before the ellipsis is dropped');
  assert.equal(clipChars('abc', 0), 'abc', 'a limit below 1 is no limit');
});

test('cleanText: a huge string costs what a short one does', () => {
  const big = 'word '.repeat(2_000_000);
  const t0 = performance.now();
  const out = cleanText(big, 90);
  assert.equal(Array.from(out).length, 90);
  assert.ok(out.endsWith('…'));
  assert.ok(performance.now() - t0 < 200, 'under 200 ms for ten megabytes');
  assert.equal(cleanText('́'.repeat(100000), 5).length <= 8, true, 'a stack of combining marks is one character, and is cut');
});

test('ageText: now under a minute, then one unit', () => {
  assert.equal(ageText(0), 'now'); assert.equal(ageText(59_999), 'now'); assert.equal(ageText(60_000), '1m'); assert.equal(ageText(120_000), '2m');
  assert.equal(ageText(59 * 60e3 + 59e3), '59m'); assert.equal(ageText(3600e3), '1h'); assert.equal(ageText(23 * 3600e3), '23h'); assert.equal(ageText(24 * 3600e3), '1d'); assert.equal(ageText(5 * 86400e3), '5d');
  assert.equal(ageText(-1000), 'now', 'a clock a little ahead is now'); assert.equal(ageText(NaN), ''); assert.equal(ageText('3'), ''); assert.equal(ageText(undefined), '');
  assert.equal(ageText(1000, 'şimdi'), 'şimdi');
});

test('splitLines: one line when it fits, else two of at most 46 characters, cut at a blank', () => {
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines('short text'), ['short text']);
  const forty6 = 'a'.repeat(46);
  assert.deepEqual(splitLines(forty6), [forty6]);
  const sentence = 'The reviewer found a race in the cache layer and wants a second pair of eyes soon';      // 85 characters
  const two = splitLines(sentence);
  assert.equal(two.length, 2); assert.ok(two.every(l => l.length <= 46), two.join('|'));
  assert.equal(two.join(' '), sentence, 'cut at a blank: nothing lost, nothing added');
  const noBlank = splitLines('x'.repeat(90));
  assert.deepEqual(noBlank.map(l => l.length), [46, 44], 'a word longer than a line is cut in the middle');
  // any text of up to 90 characters fits two lines
  for (const n of [47, 60, 80, 90]) for (const w of [3, 7, 20, 45]) {
    const text = clipChars(Array.from({ length: 40 }, (_, i) => 'w'.repeat(1 + ((i * 7) % w))).join(' '), n);
    const lines = splitLines(text);
    assert.ok(lines.length <= 2 && lines.every(l => Array.from(l).length <= 46), `${n}/${w}: ${JSON.stringify(lines)}`);
  }
});

test('colours: the same name always has the same colour, a hex triple', () => {
  assert.equal(chipColour('office'), chipColour('OFFICE')); assert.notEqual(chipColour('office'), chipColour('tasks'));
  assert.match(chipColour('x'), /^#[0-9a-f]{6}$/); assert.match(personColour('alice'), /^#[0-9a-f]{6}$/); assert.match(chipColour(''), /^#[0-9a-f]{6}$/);
});

// ------------------------------------------------------------ the answer of the endpoint

test('normalizePayload: a malformed answer is an answer that says off, never a throw', () => {
  for (const raw of [null, undefined, 5, 'ok', true, [], [1, 2], () => 1]) {
    const n = normalizePayload(raw);
    assert.equal(n.state.state, 'off'); assert.deepEqual(n.messages, []); assert.deepEqual(n.channels, {}); assert.deepEqual(n.agents, []);
  }
  assert.equal(normalizePayload({}).state.state, 'off', 'nothing in it: off');
  assert.equal(normalizePayload({ messages: [] }).state.state, 'ok', 'no state but a list of posts: it works');
  assert.equal(normalizePayload({ state: 'ok' }).state.state, 'ok', 'the state as a plain word');
  assert.equal(normalizePayload({ state: { state: 'OK ' }, messages: [] }).state.state, 'ok');
  assert.equal(normalizePayload({ state: { state: 'broken' }, messages: [] }).state.state, 'ok', 'a state that is not one of the three: judged by the posts');
  assert.equal(normalizePayload({ state: { state: 'broken' } }).state.state, 'off');
  assert.equal(normalizePayload({ state: 7, messages: 'nope', channels: 'x', agents: 4 }).state.state, 'off');
  assert.equal(normalizePayload({ state: { state: 'unsupported', schema: 'weird', reason: 'no messages table' } }).state.reason, 'no messages table');
});

test('normalizePayload: a field of the wrong type is ignored, the rest of the post is kept', () => {
  const n = normalizePayload(payload([
    { seq: '7', ts: '123', channel: 4, from: null, to: 'bob', text: 9 },
    { seq: 8, ts: NOW, channel: 'c', from: 'a', to: ['b', 7, null, '', { x: 1 }, 'c'], text: 'ok' },
    null, 5, 'string', [], { ts: -5 },
  ]));
  assert.equal(n.messages.length, 3);
  const [a, b, c] = n.messages;
  assert.deepEqual([a.ts, a.channel, a.from, a.to, a.text], [0, '', '?', [], ''], 'every field wrong: blank, not thrown');
  assert.deepEqual([b.channel, b.from, b.to, b.text], ['c', 'a', ['b', 'c'], 'ok']);
  assert.equal(c.ts, 0);
  assert.equal(normalizePayload(payload([{ ts: NaN }, { ts: Infinity }])).messages.every(m => m.ts === 0), true);
  const g = normalizePayload(payload([], { channels: { a: 3, b: -1, c: 'x', '': 5, d: NaN }, agents: [{ name: 'x', lastSeenMs: '5', session: 7 }, { name: '' }, null, { name: 'y', lastSeenMs: 9, session: 's' }] }));
  assert.deepEqual(g.channels, { a: 3 });
  assert.deepEqual(g.agents, [{ name: 'x', lastSeenMs: null, session: '' }, { name: 'y', lastSeenMs: 9, session: 's' }]);
});

test('normalizePayload: messages are in time order, newest last, and a very long list is cut to the newest', () => {
  const n = normalizePayload(payload([post({ seq: 3, ts: NOW - 1000 }), post({ seq: 1, ts: NOW - 3000 }), post({ seq: 2, ts: NOW - 2000 })]));
  assert.deepEqual(n.messages.map(m => m.seq), [1, 2, 3]);
  const big = Array.from({ length: 100_000 }, (_, i) => post({ seq: i, ts: NOW - (100_000 - i) * 10, text: 'x'.repeat(1000) }));
  const t0 = performance.now();
  const h = normalizePayload(payload(big));
  assert.equal(h.messages.length, LIMITS.inMessages);
  assert.equal(h.messages.at(-1).seq, 99_999, 'the newest are the ones kept');
  assert.ok(h.messages.every(m => Array.from(m.text).length <= LIMITS.cardText));
  assert.ok(performance.now() - t0 < 300, 'a long answer costs only its tail');
  assert.equal(normalizePayload(payload([])).messages.length, 0);
});

test('normalizePayload: names, channels and reasons are cleaned like every text', () => {
  const n = normalizePayload(payload([post({ from: '‮alice‬', channel: 'of​fice', to: ['bo\u0007b'], text: 'a‮b' })], { channels: { 'x​y': 2 } }));
  assert.deepEqual([n.messages[0].from, n.messages[0].channel, n.messages[0].to, n.messages[0].text], ['alice', 'office', ['bob'], 'ab']);
  assert.deepEqual(n.channels, { xy: 2 });
  assert.equal(normalizePayload({ state: { state: 'unsupported', reason: 'r'.repeat(1000) } }).state.reason.length, LIMITS.reason);
});

// ------------------------------------------------------------ the view: states and signs

test('the sign of each state', () => {
  const off = buildView(null, { now: NOW, mode: 'text', t });
  assert.equal(off.state, 'off'); assert.equal(off.sign.text, 'Agent message board is off'); assert.match(off.sign.hint, /--chat-db/); assert.deepEqual(off.wall.rows, []); assert.deepEqual(off.people, []);
  const uns = view({ state: { state: 'unsupported', schema: 'abc' } });
  assert.equal(uns.state, 'unsupported'); assert.equal(uns.sign.text, 'Message board format not recognised'); assert.equal(uns.sign.hint, 'Schema: abc'); assert.deepEqual(uns.wall.rows, []);
  assert.equal(view({ state: { state: 'unsupported', schema: 'abc', reason: 'no table' } }).sign.hint, 'no table', 'a reason beats the schema');
  const quiet = view(payload([post({ ts: NOW - 2 * 3600e3 })]));
  assert.equal(quiet.state, 'ok'); assert.equal(quiet.quiet, true); assert.equal(quiet.sign.text, 'No posts in the last hour'); assert.deepEqual(quiet.wall.rows, [], 'the sign instead of old posts');
  assert.equal(view(payload([])).sign.text, 'No posts in the last hour');
  const busy = view(payload([post(), post({ seq: 2 })]));
  assert.equal(busy.quiet, false); assert.equal(busy.sign.text, '2 posts in the last hour'); assert.equal(view(payload([post()])).sign.text, '1 post in the last hour');
  const hidden = view(payload([post()]), { mode: 'off' });
  assert.equal(hidden.state, 'hidden'); assert.equal(hidden.sign.show, false); assert.deepEqual(hidden.wall.rows, []); assert.deepEqual(hidden.people, []); assert.deepEqual(hidden.card.rows, []);
  assert.match(hidden.card.source, /switched off/);
});

test('the signs have a Turkish text too, and the placeholders survive', () => {
  const tt = lookup(tr);
  assert.equal(buildView(null, { now: NOW, t: tt }).sign.text, 'Ajan mesaj panosu kapalı');
  assert.equal(buildView(normalizePayload(payload([])), { now: NOW, t: tt }).sign.text, 'Son bir saatte mesaj yok');
  const v = buildView(normalizePayload(payload([post({ ts: NOW - 120e3 })])), { now: NOW, t: tt });
  assert.equal(v.wall.rows[0].who, 'alice → bob'); assert.equal(v.wall.rows[0].age, '2m');
  assert.equal(buildView(normalizePayload(payload([post({ ts: NOW - 5e3 })])), { now: NOW, t: tt }).wall.rows[0].age, 'şimdi');
});

test('without a message lookup the signs still read in English', () => {
  const v = buildView(null, { now: NOW });
  assert.equal(v.sign.text, 'Agent message board is off');
  assert.equal(buildView(normalizePayload(payload([post()])), { now: NOW }).wall.rows[0].who, 'alice to bob');
});

// ------------------------------------------------------------ the wall

test('the wall: the last 8 posts, newest at the bottom, a chip, "from to to", the text in 90 characters, an age', () => {
  const posts = Array.from({ length: 12 }, (_, i) => post({ seq: i + 1, ts: NOW - (12 - i) * 90e3, channel: i % 2 ? 'tasks' : 'office', from: 'alice', to: i % 3 ? ['bob', 'carol'] : [], text: `post ${i + 1} ` + 'word '.repeat(40) }));
  const v = view(payload(posts));
  assert.equal(v.wall.rows.length, 8);
  assert.deepEqual(v.wall.rows.map(r => r.seq), [5, 6, 7, 8, 9, 10, 11, 12], 'the newest eight, the newest last');
  const r = v.wall.rows[7];
  assert.equal(r.chip, 'tasks'); assert.equal(r.who, 'alice to bob, carol'); assert.equal(r.age, '1m'); assert.equal(v.wall.rows[0].age, '12m');
  assert.ok(Array.from(r.text).length <= LIMITS.wallText && r.text.endsWith('…'), r.text);
  assert.ok(r.lines.length >= 1 && r.lines.length <= 2 && r.lines.every(l => Array.from(l).length <= LIMITS.lineChars), JSON.stringify(r.lines));
  assert.equal(v.wall.rows[5].who, 'alice', 'a post to a channel has no recipients: the sender alone');
  assert.equal(r.chipColour, chipColour('tasks'));
  assert.equal(view(payload([post({ to: ['a', 'b', 'c', 'd', 'e'] })])).wall.rows[0].who, 'alice to a, b, c +2');
});

test('the wall: the modes. text shows the text, names only who and where, off nothing', () => {
  const raw = payload([post({ text: 'secret plan' })]);
  const text = view(raw), names = view(raw, { mode: 'names' }), off = view(raw, { mode: 'off' });
  assert.equal(text.wall.rows[0].text, 'secret plan'); assert.equal(text.wall.showText, true);
  assert.equal(names.wall.rows[0].text, ''); assert.deepEqual(names.wall.rows[0].lines, []); assert.equal(names.wall.rows[0].who, 'alice to bob'); assert.equal(names.wall.rows[0].chip, 'office'); assert.equal(names.wall.showText, false);
  assert.equal(names.card.rows[0].text, '', 'the card keeps the secret too'); assert.equal(names.card.namesOnly, true);
  assert.deepEqual(off.wall.rows, []);
  assert.ok(!names.key.includes('secret') && text.key.includes('secret plan'), 'the paint key carries no text in the mode names');
  assert.notEqual(text.key, names.key); assert.notEqual(names.key, off.key);
  assert.equal(view(raw, { mode: 'bogus' }).mode, 'text', 'a mode that is not one is the default');
});

test('the wall: bidi marks, control characters and a huge text never reach it', () => {
  const v = view(payload([post({ from: '‮bob', to: ['⁧al\u0000ice'], channel: '‎office', text: 'run‮ txt.exe‬ now\u0007' + 'x'.repeat(5000) })]));
  const r = v.wall.rows[0];
  const all = [r.chip, r.who, r.text, ...r.lines].join('');
  assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/.test(all), JSON.stringify(all));
  assert.equal(r.who, 'bob to alice'); assert.equal(r.chip, 'office');
  assert.ok(Array.from(r.text).length <= LIMITS.wallText);
});

test('the wall: an empty list, no posts at all', () => {
  const v = view(payload([]));
  assert.deepEqual(v.wall.rows, []); assert.deepEqual(v.card.rows, []); assert.deepEqual(v.people, []); assert.equal(v.activity.level, 0);
});

test('the wall key changes when what is painted changes, and only then', () => {
  const a = view(payload([post({ seq: 1, ts: NOW - 5e3 })]));
  assert.equal(view(payload([post({ seq: 1, ts: NOW - 5e3 })]), { now: NOW + 30e3 }).key, a.key, 'ages in the first minute do not repaint');
  assert.notEqual(view(payload([post({ seq: 1, ts: NOW - 5e3 })]), { now: NOW + 70e3 }).key, a.key, 'a minute later the age says 1m');
  assert.notEqual(view(payload([post({ seq: 1, ts: NOW - 5e3 }), post({ seq: 2 })])).key, a.key, 'a new post');
  assert.notEqual(view(payload([post({ seq: 1, ts: NOW - 5e3, text: 'edited' })])).key, a.key);
});

// ------------------------------------------------------------ people

test('the people: who has posted in the last ten minutes, the freshest first, at most six, each tied to its chat when it has one', () => {
  const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const posts = names.map((n, i) => post({ seq: i + 1, from: n, ts: NOW - (i + 1) * 30e3 }));
  posts.push(post({ seq: 99, from: 'old', ts: NOW - 11 * 60e3 }));
  const v = view(payload(posts, { agents: [{ name: 'a', lastSeenMs: NOW - 30e3, session: 's-a' }, { name: 'b', lastSeenMs: NOW - 60e3, session: 'gone' }, { name: 'old', lastSeenMs: NOW - 11 * 60e3, session: 's-old' }] }),
    { sessionInfo: id => (id === 's-a' ? { name: 'Fix the cache', color: '#ff0000' } : null) });
  assert.equal(v.people.length, LIMITS.people);
  assert.deepEqual(v.people.map(p => p.name), ['a', 'b', 'c', 'd', 'e', 'f'], 'the freshest six; "old" posted 11 minutes ago');
  const a = v.people[0], b = v.people[1];
  assert.deepEqual([a.tied, a.session, a.color, a.sessionName], [true, 's-a', '#ff0000', 'Fix the cache']);
  assert.deepEqual([b.tied, b.session], [false, ''], 'a session the Office does not have: a person with a name and nothing else');
  assert.match(b.color, /^#[0-9a-f]{6}$/); assert.equal(b.color, personColour('b'));
  assert.ok(!v.people.some(p => p.name === 'old'));
});

test('the people: a name written in two ways is one person; an agent seen lately counts; a poster keeps the session the list gives', () => {
  const v = view(payload([post({ from: 'Alice', ts: NOW - 20e3 }), post({ seq: 2, from: 'alice', ts: NOW - 10e3 })], { agents: [{ name: 'ALICE', lastSeenMs: NOW - 5e3, session: 's1' }, { name: 'carol', lastSeenMs: 90e3, session: '' }] }),
    { sessionInfo: id => (id === 's1' ? { name: 'chat', color: '#00ff00' } : null) });
  assert.deepEqual(v.people.map(p => p.name), ['alice', 'carol'].map(n => v.people.find(p => p.key === n).name));
  assert.equal(v.people.length, 2);
  assert.equal(v.people.find(p => p.key === 'alice').session, 's1');
  assert.equal(v.people.find(p => p.key === 'carol').seenMs, 90e3, 'a small lastSeenMs is an age');
  assert.equal(seenAge(NOW - 4000, NOW), 4000); assert.equal(seenAge(7000, NOW), 7000); assert.equal(seenAge(null, NOW), Infinity); assert.equal(seenAge(NOW + 9999, NOW), 0);
});

test('the people: nobody when the board is not ok or the lounge is off; no sessionInfo means nobody is tied', () => {
  assert.deepEqual(view({ state: { state: 'off' }, messages: [post()] }).people, []);
  assert.deepEqual(view(payload([post()]), { mode: 'off' }).people, []);
  assert.equal(view(payload([post()], { agents: [{ name: 'alice', lastSeenMs: NOW, session: 's' }] })).people[0].tied, false);
});

// ------------------------------------------------------------ activity and the card

test('activity: the posts of the last minute, full at six', () => {
  const n = k => view(payload(Array.from({ length: k }, (_, i) => post({ seq: i, ts: NOW - 1000 - i * 5000 })))).activity;
  assert.deepEqual(n(0), { posts: 0, level: 0 }); assert.equal(n(3).level, 0.5); assert.equal(n(6).level, 1); assert.equal(n(12).level, 1);
  assert.equal(view(payload([post({ ts: NOW - 61e3 })])).activity.posts, 0);
});

test('the card: the last 20 posts, newest first, the long text up to 400 characters, where the data comes from, the channels', () => {
  const posts = Array.from({ length: 30 }, (_, i) => post({ seq: i + 1, ts: NOW - (30 - i) * 1000, text: 'y'.repeat(900) }));
  const v = view(payload(posts, { channels: { office: 20, tasks: 10, misc: 1 } }));
  assert.equal(v.card.rows.length, 20); assert.equal(v.card.rows[0].seq, 30); assert.equal(v.card.rows[19].seq, 11);
  assert.ok(Array.from(v.card.rows[0].text).length <= LIMITS.cardText && v.card.rows[0].text.endsWith('…'));
  assert.deepEqual(v.card.channels.map(c => c.name), ['office', 'tasks', 'misc']);
  assert.match(v.card.source, /GET \/api\/lounge/);
  assert.match(view(payload([]), { source: 'demo' }).card.source, /demo script/);
  assert.match(buildView(null, { now: NOW, t, status: 'nofile' }).card.source, /no \/api\/lounge endpoint/);
  assert.deepEqual(v.card.people, ['alice'], 'the card names who is in the lounge');
});

test('buildView never throws on anything', () => {
  for (const data of [null, undefined, {}, { state: null }, { state: { state: 'ok' }, messages: null, channels: null, agents: null }, normalizePayload(5)]) {
    for (const mode of ['text', 'names', 'off', undefined, 5]) assert.doesNotThrow(() => buildView(data, { now: NOW, mode, t }));
  }
  assert.doesNotThrow(() => buildView(null));
  assert.doesNotThrow(() => buildView(normalizePayload(payload([post()])), { now: 'later', t: () => { throw new Error('boom'); }, sessionInfo: () => { throw new Error('x'); } }) || 0);
});
