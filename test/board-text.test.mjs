import test from 'node:test';
import assert from 'node:assert/strict';
import { boardName, boardProject, boardBadges, clipText, wrapLines, fitName } from '../public/js/board-text.js';

// a font where every character is `size` wide, so widths are easy to reason about
const mono = size => s => [...s].length * size;

test('board text: the chat name is the big text; own name first, then the AI title, then the project folder', () => {
  assert.equal(boardName({ name: 'Valkey migration plan', title: 'Plan the cache move', project: 'infra' }), 'Valkey migration plan');
  assert.equal(boardName({ name: '', title: 'Plan the cache move', project: 'infra' }), 'Plan the cache move');
  assert.equal(boardName({ title: '', project: 'infra' }), 'infra');
  assert.equal(boardName({}), ''); assert.equal(boardName(null), ''); assert.equal(boardName(undefined), '');
  assert.equal(boardName({ name: '  two   lines\nof  text ' }), 'two lines of text', 'white space is squeezed');
  assert.equal(boardName({ name: '🚀 Launch checklist' }), '🚀 Launch checklist');
});

test('board text: the project folder is the small text; it is empty when it would repeat the chat name', () => {
  assert.equal(boardProject({ name: 'Fix flaky test', project: 'nebula-web' }), 'nebula-web');
  assert.equal(boardProject({ name: '', title: '', project: 'nebula-web' }), '', 'the name already fell back to the project');
  assert.equal(boardProject({ name: 'nebula-web', project: 'nebula-web' }), '');
  assert.equal(boardProject({ name: 'x' }), ''); assert.equal(boardProject(null), '');
  assert.equal(boardProject({ name: 'x', project: '  core-infra ' }), 'core-infra');
});

test('board text: the chips are your turn, needs an answer, asleep and "+n"', () => {
  assert.deepEqual(boardBadges('waiting', 0), [{ kind: 'wait', key: 'of.badgeWait' }]);
  assert.deepEqual(boardBadges('ask', 0), [{ kind: 'ask', key: 'of.badgeAsk' }]);
  assert.deepEqual(boardBadges('dormant', 0), [{ kind: 'sleep', key: 'of.badgeSleep' }]);
  assert.deepEqual(boardBadges('working', 0), []);
  assert.deepEqual(boardBadges('working', 3), [{ kind: 'more', text: '+3' }]);
  assert.deepEqual(boardBadges('waiting', 2), [{ kind: 'wait', key: 'of.badgeWait' }, { kind: 'more', text: '+2' }]);
  assert.deepEqual(boardBadges(undefined), []);
});

test('board text: clipText keeps whole characters and ends with an ellipsis', () => {
  assert.equal(clipText('short', 10), 'short');
  assert.equal(clipText('a longer name than that', 10), 'a longer…');
  assert.equal(clipText('exactly10!', 10), 'exactly10!');
  assert.equal(clipText('🚀🚀🚀🚀🚀🚀', 4), '🚀🚀🚀…', 'an emoji is one character, never half of one');
  assert.equal(clipText('abc', 1), ''); assert.equal(clipText('', 5), ''); assert.equal(clipText(null, 5), '');
});

test('board text: wrapLines breaks at spaces, breaks a word that is wider than a line, and cuts the rest with an ellipsis', () => {
  const m = mono(1);
  assert.deepEqual(wrapLines('Fix flaky test', m, 20, 2), { lines: ['Fix flaky test'], truncated: false });
  assert.deepEqual(wrapLines('Fix flaky checkout test', m, 14, 2), { lines: ['Fix flaky', 'checkout test'], truncated: false });
  assert.deepEqual(wrapLines('Fix flaky checkout test', m, 12, 2), { lines: ['Fix flaky', 'checkout te…'], truncated: true });
  assert.deepEqual(wrapLines('Pneumonoultramicroscopic', m, 10, 3), { lines: ['Pneumonoul', 'tramicrosc', 'opic'], truncated: false }, 'a long word is broken between characters');
  assert.deepEqual(wrapLines('日本語のチャット名', m, 4, 2), { lines: ['日本語の', 'チャッ…'], truncated: true }, 'a name with no spaces still wraps');
  assert.deepEqual(wrapLines('abc def', m, 5, 1), { lines: ['abc…'], truncated: true });
  assert.deepEqual(wrapLines('', m, 5, 2), { lines: [], truncated: false });
  assert.deepEqual(wrapLines('   ', m, 5, 2), { lines: [], truncated: false });
  for (const w of [3, 7, 11, 25]) for (const t of ['one two three four five six', 'x'.repeat(40), 'ab cd ef gh ij kl mn']) {
    const r = wrapLines(t, m, w, 2);
    assert.ok(r.lines.length <= 2 && r.lines.every(l => m(l) <= w), `${t} at ${w}: ${JSON.stringify(r)}`);
  }
});

test('board text: fitName takes the biggest size that fits on one line, then two lines, then cuts the second line', () => {
  const box = { w: 160, h: 100, big: 40, oneMin: 20, twoMin: 12, lead: 1.1, step: 4 };
  assert.deepEqual(fitName('Hi', mono, box), { fs: 40, lines: ['Hi'], truncated: false }, 'a short name gets the big size');
  assert.deepEqual(fitName('Hi there', mono, box), { fs: 20, lines: ['Hi there'], truncated: false }, 'it shrinks until it fits on one line');
  assert.deepEqual(fitName('Valkey migration', mono, box), { fs: 16, lines: ['Valkey', 'migration'], truncated: false }, 'then it takes two smaller lines');
  const long = fitName('x'.repeat(100), mono, box);
  assert.equal(long.fs, 12); assert.equal(long.truncated, true); assert.equal(long.lines.length, 2); assert.ok(long.lines[1].endsWith('…'));
  const low = fitName('Valkey migration', mono, { ...box, h: 30 });
  assert.equal(low.lines.length, 2); assert.ok(low.fs * 1.1 * 2 <= 30 + 1e-9, 'two lines never need more height than the box has');
  assert.equal(fitName('Hi', mono, { ...box, h: 30 }).fs, 24, 'a short name is held to the height of the box');
  for (const t of ['Hi', 'Hi there', 'Valkey migration', 'x'.repeat(100), '日本語のチャット名のとても長い名前です']) {
    const r = fitName(t, mono, box);
    assert.ok(r.lines.length >= 1 && r.lines.length <= 2 && r.fs >= box.twoMin && r.fs <= box.big, t);
  }
});
