import test from 'node:test';
import assert from 'node:assert/strict';
import { openUrl, cliCommand, shq, sessionOf, loadChoice, saveChoice, effectiveChoice, CHOICES, CHOICE_KEY } from '../public/js/pixel/openers.js';

const ID = '1dbe2070-ad13-4834-890e-6b1388ee65b2';
const mem = (init = {}) => { const m = { ...init }; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, m }; };

test('openers: the three links', () => {
  assert.equal(openUrl('vscode', { id: ID }), `vscode://anthropic.claude-code/open?session=${ID}`);
  assert.equal(openUrl('desktop', { id: ID }), `claude://resume?session=${ID}`);
  assert.equal(openUrl('terminal', { id: ID, cwd: '/Users/ayu/My Project' }), `claude-cli://open?cwd=%2FUsers%2Fayu%2FMy%20Project&q=%2Fresume%20${ID}`);
  assert.equal(decodeURIComponent(new URL(openUrl('terminal', { id: ID, cwd: '/a/b' })).searchParams.get('q')), `/resume ${ID}`);
});

test('openers: a link is made only from a safe id, and the terminal one needs an absolute folder', () => {
  for (const bad of ['', undefined, 'a b', 'x;rm -rf', `${ID}:a27c6aa`, '../etc', "a'b"]) for (const k of CHOICES) assert.equal(openUrl(k, { id: bad, cwd: '/x' }), null, `${k} ${bad}`);
  assert.equal(openUrl('terminal', { id: ID }), null);
  assert.equal(openUrl('terminal', { id: ID, cwd: '' }), null);
  assert.equal(openUrl('terminal', { id: ID, cwd: 'relative/dir' }), null);
  assert.equal(openUrl('nope', { id: ID }), null);
});

test('openers: the command line is quoted for a shell, and has no folder part without a folder', () => {
  assert.equal(cliCommand({ id: ID, cwd: '/Users/ayu' }), `cd '/Users/ayu' && claude --resume ${ID}`);
  assert.equal(cliCommand({ id: ID, cwd: "/tmp/it's here" }), `cd '/tmp/it'\\''s here' && claude --resume ${ID}`);
  assert.equal(cliCommand({ id: ID }), `claude --resume ${ID}`);
  assert.equal(cliCommand({ id: 'x; echo hi', cwd: '/x' }), '');
  assert.equal(shq('a b'), `'a b'`);
});

test('openers: a subagent opens its parent chat', () => {
  assert.equal(sessionOf({ kind: 'main', id: ID }), ID);
  assert.equal(sessionOf({ kind: 'sub', id: `${ID}:a27c6aa`, parent: ID }), ID);
  assert.equal(sessionOf({ kind: 'sub', id: 'x:y', parent: null }), '');
  assert.equal(sessionOf(null), '');
});

test('openers: the last choice is remembered, junk and a broken store fall back to VS Code', () => {
  const s = mem();
  assert.equal(loadChoice(s), 'vscode');
  assert.ok(saveChoice(s, 'terminal'));
  assert.equal(s.m[CHOICE_KEY], 'terminal');
  assert.equal(loadChoice(s), 'terminal');
  assert.ok(!saveChoice(s, 'emacs'));
  assert.equal(loadChoice(mem({ [CHOICE_KEY]: 'emacs' })), 'vscode');
  assert.equal(loadChoice(null), 'vscode');
  assert.equal(loadChoice({ getItem() { throw new Error('denied'); } }), 'vscode');
  assert.ok(saveChoice({ setItem() { throw new Error('denied'); } }, 'desktop'), 'a store that refuses is not an error');
});

test('openers: a remembered terminal choice falls back to VS Code for a chat with no folder', () => {
  assert.equal(effectiveChoice('terminal', { id: ID, cwd: '/x' }), 'terminal');
  assert.equal(effectiveChoice('terminal', { id: ID, cwd: '' }), 'vscode');
  assert.equal(effectiveChoice('desktop', { id: ID }), 'desktop');
});
