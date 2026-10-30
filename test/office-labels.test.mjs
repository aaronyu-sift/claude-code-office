import test from 'node:test';
import assert from 'node:assert/strict';
import { labelParts, labelHtml, shortDesc, clipTxt, unticked, DESC_MAX, DOING_MAX, SAY_MAX } from '../public/js/office-labels.js';
import { fmtShort } from '../public/js/util.js';
import { t } from '../public/js/i18n.js';

const NOW = 1_000_000;
const main = (o = {}) => ({ id: 'm1', kind: 'main', status: 'working', color: '#4aa3ff', project: 'atlas-api', name: 'Review auth middleware', title: 'old title', since: NOW - 125_000, doing: null, say: null, ...o });
const sub = (o = {}) => ({ id: 's1', kind: 'sub', parent: 'm1', status: 'working', color: '#4aa3ff', project: 'atlas-api', desc: 'E2E tests for the checkout flow', atype: 'general-purpose', since: NOW - 5000, doing: null, say: null, ...o });
const html = (a, o = {}, h = {}) => labelHtml(labelParts(a, o), { now: NOW, ...h });

// the golden strings below are what the pixel scene's own label code built before the texts moved here: the pixel scene must not change
test('a main agent label is the markup the pixel scene built itself', () => {
  assert.equal(html(main(), { main: true }),
    '<div class="px-top"><span class="sw" style="background:#4aa3ff"></span><span class="px-proj">atlas-api</span></div><div class="px-name">Review auth middleware</div>');
  assert.equal(html(main({ doing: { n: 'Bash', l: 'Run unit tests' }, say: { dir: 'out', text: 'on it' } }), { main: true, overflow: 2 }),
    '<div class="px-top"><span class="sw" style="background:#4aa3ff"></span><span class="px-proj">atlas-api</span><span class="of-chip">+2</span></div><div class="px-name">Review auth middleware</div>' +
    '<span class="px-doing">Bash · Run unit tests</span><span class="px-say out">→ on it</span>');
  const wait = html(main({ status: 'waiting' }), { main: true });
  assert.ok(wait.includes(`<span class="of-chip w">${t('of.chipWait')} · <span data-since="${NOW - 125_000}" data-fmt="short">${fmtShort(125_000)}</span></span>`), wait);
  assert.ok(html(main({ status: 'ask' }), { main: true }).includes(`<span class="of-chip w">${t('of.chipAsk')} · `));
});

test('the name falls back to the title, then the project; a say line points the way it was said', () => {
  assert.ok(html(main({ name: '' }), {}).includes('<div class="px-name">old title</div>'));
  assert.ok(html(main({ name: '', title: '' }), {}).includes('<div class="px-name">atlas-api</div>'));
  assert.ok(html(main({ say: { dir: 'in', text: 'ok?' } }), {}).includes('<span class="px-say in">← ok?</span>'));
});

test('the doing line shows only while the agent works; it is cut at 46 characters, the say line at 56', () => {
  const long = 'x'.repeat(80);
  const p = labelParts(main({ doing: { n: 'Read', l: long }, say: { dir: 'out', text: long } }));
  assert.equal(p.doing, `Read · ${'x'.repeat(DOING_MAX - 1)}…`);
  assert.equal(p.say.text, `${'x'.repeat(SAY_MAX - 1)}…`);
  assert.equal(labelParts(main({ status: 'waiting', doing: { n: 'Read', l: 'a' } })).doing, '');
  assert.equal(labelParts(main({ status: 'dormant', doing: { n: 'Read', l: 'a' } })).doing, '');
  assert.equal(clipTxt('abc', 3), 'abc');
  assert.equal(clipTxt(undefined, 3), '');
});

test('text from the transcript is escaped', () => {
  const h = html(main({ project: '<b>p</b>', name: 'a & b', doing: { n: 'Bash', l: '<img src=x>' } }));
  assert.ok(!h.includes('<b>p</b>') && !h.includes('<img'), h);
  assert.ok(h.includes('a &amp; b') && h.includes('&lt;img src=x&gt;'));
});

test('a sub-agent label is its swatch and a short description, as in the pixel scene', () => {
  assert.equal(html(sub(), { main: false }), '<span class="sw" style="background:#4aa3ff"></span>E2E tests for the');
  // no chip, no say line and no doing line, whatever the agent does, unless the scene asks for `activity`
  const busy = sub({ doing: { n: 'Bash', l: 'npm test' }, say: { dir: 'out', text: 'hi' }, status: 'waiting' });
  assert.equal(html(busy, { main: false }), '<span class="sw" style="background:#4aa3ff"></span>E2E tests for the');
});

test('shortDesc cuts at a word, falls back to the type and then to "subagent"', () => {
  assert.equal(shortDesc({ desc: 'Draft' }), 'Draft');
  assert.equal(shortDesc({ desc: 'E2E tests for the checkout flow' }), 'E2E tests for the');
  assert.equal(shortDesc({ desc: 'Audit: bundle size of everything' }), 'Audit: bundle size');
  assert.equal(shortDesc({ desc: '', atype: 'Explore' }), 'Explore');
  assert.equal(shortDesc({}), t('agent.sub'));
  assert.equal(shortDesc({ desc: 'a'.repeat(40) }), `${'a'.repeat(DESC_MAX - 2)}…`);
  assert.equal(shortDesc({ desc: 'E2E tests for the checkout flow' }, 'Subagent', 14), 'E2E tests for');
  assert.equal(shortDesc({ desc: '  spaced \n out   words  ' }), 'spaced out words');
});

test('with `activity` a sub-agent shows what it does, and a thinking agent shows what it thinks', () => {
  const doing = html(sub({ doing: { n: 'Bash', l: 'npm test' } }), { main: false, activity: true });
  assert.equal(doing, '<span class="sw" style="background:#4aa3ff"></span>E2E tests for the<span class="px-doing">Bash · npm test</span>');
  const thinking = sub({ act: { c: 'think', code: 'thinking', l: 'x' }, thought: 'Compare the two session stores before picking one' });
  assert.equal(labelParts(thinking, { main: false, activity: true }).doing, `${t('act.thinking')} · ${clipTxt('Compare the two session stores before picking one', DOING_MAX)}`);
  assert.equal(labelParts(sub({ act: { code: 'thinking' } }), { main: false, activity: true }).doing, t('act.thinking'));
  // a tool call wins over the thought; a waiting or finished agent shows neither; without `activity` nothing changes
  assert.equal(labelParts(sub({ doing: { n: 'Read', l: 'a.js' }, thought: 'hm', act: { code: 'thinking' } }), { main: false, activity: true }).doing, 'Read · a.js');
  assert.equal(labelParts(sub({ status: 'done', thought: 'hm', act: { code: 'thinking' } }), { main: false, activity: true }).doing, '');
  assert.equal(labelParts(sub({ thought: 'hm', act: { code: 'thinking' } }), { main: false }).doing, '');
  assert.equal(labelParts(main({ thought: 'hm', act: { code: 'thinking' } }), { main: true }).doing, '');
  assert.equal(labelParts(main({ thought: 'hm', act: { code: 'thinking' } }), { main: true, activity: true }).doing, `${t('act.thinking')} · hm`);
});

test('the parts name the state that the scene styles', () => {
  assert.equal(labelParts(main({ status: 'waiting' })).wait, 'waiting');
  assert.equal(labelParts(main({ status: 'ask' })).wait, 'ask');
  assert.equal(labelParts(main()).wait, null);
  assert.equal(labelParts(sub({ status: 'waiting' }), { main: false }).wait, null);
  assert.equal(labelParts(sub(), { main: false, overflow: 3 }).overflow, 0);
});

test('unticked: two markups that differ only in a running clock are the same label, anything else is not', () => {
  const at = ms => html(main({ status: 'waiting', since: NOW - 5000 }), {}, { now: NOW + ms });      // the same chat, a later clock
  assert.notEqual(at(0), at(1000), 'the seconds are in the markup');
  assert.equal(unticked(at(0)), unticked(at(1000)));
  assert.equal(unticked(at(0)), unticked(at(120_000)), 'also across a change of unit');
  assert.notEqual(unticked(at(0)), unticked(html(main({ status: 'ask', since: NOW - 5000 }))), 'another state is another label');
  assert.notEqual(unticked(at(0)), unticked(html(main({ status: 'waiting', since: NOW - 9000 }))), 'another since is another label');
  assert.notEqual(unticked(html(main({ name: 'one' }))), unticked(html(main({ name: 'two' }))));
  assert.equal(unticked('<b>no clock</b>'), '<b>no clock</b>');
  assert.match(unticked(at(0)), /<span data-since="\d+" data-fmt="short"><\/span>/, 'the clock element stays, its text goes');
});
