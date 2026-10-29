import test from 'node:test';
import assert from 'node:assert/strict';
import { shelfEntries, isShelved, poseOf, capEntries, DEFAULT_CAP, MIN_CAP, MAX_CAP } from '../public/js/pixel/shelf.js';

const main = (id, status, over = {}) => ({ id, kind: 'main', status, name: 'Chat ' + id, project: 'p-' + id, color: '#abc', since: 1000, updated: 2000, ...over });
const closed = (id, at, over = {}) => ({ id, name: 'Closed ' + id, project: 'q-' + id, color: '#def', closedAt: at, observed: false, ...over });

test('shelf: only asleep chats leave their rooms; a chat that waits for you, works or finished never goes on the shelf', () => {
  const agents = ['working', 'waiting', 'ask', 'done', 'stale', 'dormant'].map(s => main(s, s));
  assert.deepEqual(shelfEntries({ agents }).map(e => e.id), ['dormant']);
  assert.ok(isShelved(main('x', 'dormant')));
  for (const s of ['working', 'waiting', 'ask', 'done', 'stale']) assert.ok(!isShelved(main('x', s)), s);
  assert.ok(!isShelved({ id: 's', kind: 'sub', status: 'dormant' }), 'a subagent is never on the shelf');
});

test('shelf: asleep and closed chats are one list, newest first, ties by id', () => {
  const agents = [main('d1', 'dormant', { updated: 5000 }), main('d2', 'dormant', { updated: 9000 })];
  const list = shelfEntries({ agents, closed: [closed('c1', 7000), closed('c2', 1000), closed('c3', 9000), closed('c0', 9000)] });
  assert.deepEqual(list.map(e => e.id), ['c0', 'c3', 'd2', 'c1', 'd1', 'c2']);
  assert.deepEqual(list.map(e => e.kind), ['closed', 'closed', 'dormant', 'closed', 'dormant', 'closed']);
});

test('shelf: the same data gives the same list, whatever the order it arrives in', () => {
  const agents = [main('a', 'dormant', { updated: 3 }), main('b', 'dormant', { updated: 8 }), main('w', 'waiting')];
  const cl = [closed('x', 5), closed('y', 8), closed('z', 1)];
  const one = shelfEntries({ agents, closed: cl }), two = shelfEntries({ agents: [...agents].reverse(), closed: [...cl].reverse() });
  assert.deepEqual(one, two);
  assert.deepEqual(shelfEntries({ agents, closed: cl }), one, 'and again');
});

test('shelf: a closed chat that is live again is not listed twice; a closed chat without a name falls back to its title, then its project', () => {
  const list = shelfEntries({ agents: [main('r', 'working')], closed: [closed('r', 10), closed('t', 9, { name: '', title: 'A title' }), closed('u', 8, { name: '', title: '' })] });
  assert.deepEqual(list.map(e => [e.id, e.name]), [['t', 'A title'], ['u', 'q-u']]);
});

test('shelf: an asleep chat is dated by its last activity, a closed one by when it closed; the server saying it saw the close is kept', () => {
  const [d] = shelfEntries({ agents: [main('d', 'dormant', { updated: 4200, since: 100 })] });
  assert.equal(d.at, 4200);
  const [c] = shelfEntries({ agents: [], closed: [closed('c', 777, { observed: true })] });
  assert.equal(c.at, 777); assert.equal(c.observed, true);
  assert.equal(shelfEntries({ agents: [main('e', 'dormant', { updated: 0, since: 55 })] })[0].at, 55, 'without a last activity the idle time stands in');
});

test('shelf: the sleeping pose for an idle chat, the leaning one for a closed chat; nothing breaks on no data', () => {
  assert.equal(poseOf({ kind: 'dormant' }), 'sleep');
  assert.equal(poseOf({ kind: 'closed' }), 'relax');
  assert.deepEqual(shelfEntries({ agents: [] }), []);
  assert.deepEqual(shelfEntries({ agents: [], closed: [null, {}, undefined] }), []);
});

const many = n => Array.from({ length: n }, (_, i) => ({ id: 'e' + String(i).padStart(2, '0'), at: 1000 - i }));          // newest first, as shelfEntries returns them

test('shelf cap: the newest chats are kept, in their order, and the rest is counted', () => {
  const list = many(37), { shown, hidden, total } = capEntries(list, 10);
  assert.deepEqual(shown.map(e => e.id), list.slice(0, 10).map(e => e.id));
  assert.equal(hidden, 27); assert.equal(total, 37);
  assert.ok(shown.every((e, i) => i === 0 || shown[i - 1].at >= e.at), 'still newest first');
  assert.equal(list.length, 37, 'the list given is not changed');
});

test('shelf cap: a cap larger than the list (or equal to it) shows everything and hides nothing', () => {
  const list = many(7);
  for (const max of [7, 8, 200, 1e9]) assert.deepEqual(capEntries(list, max), { shown: list, hidden: 0, total: 7 });
  assert.deepEqual(capEntries([], 5), { shown: [], hidden: 0, total: 0 });
});

test('shelf cap: a cap that is not a whole number of at least 1 is the default; a fraction counts down', () => {
  const list = many(30);
  for (const max of [0, -3, NaN, undefined, null, '5', Infinity, {}]) assert.equal(capEntries(list, max).shown.length, DEFAULT_CAP, String(max));
  assert.equal(capEntries(list, 4.9).shown.length, 4);
  assert.equal(capEntries(list, 1).shown.length, 1);
  assert.ok(MIN_CAP < DEFAULT_CAP && DEFAULT_CAP < MAX_CAP);
  assert.deepEqual(capEntries(null, 5), { shown: [], hidden: 0, total: 0 }, 'no list is an empty list');
});

test('shelf cap: chats with the same time keep the order they were given (the id order of shelfEntries), whichever side of the cut they fall on', () => {
  const list = shelfEntries({ agents: [], closed: ['d', 'a', 'c', 'b'].map(id => closed(id, 5000)).concat(closed('z', 9000), closed('y', 1000)) });
  assert.deepEqual(list.map(e => e.id), ['z', 'a', 'b', 'c', 'd', 'y']);
  assert.deepEqual(capEntries(list, 3).shown.map(e => e.id), ['z', 'a', 'b']);
  assert.deepEqual(capEntries(list, 4).shown.map(e => e.id), ['z', 'a', 'b', 'c']);
  assert.equal(capEntries(list, 3).hidden, 3);
});

test('shelf cap: asleep and closed chats are cut together, by time and not by kind', () => {
  const agents = [main('d1', 'dormant', { updated: 9000 }), main('d2', 'dormant', { updated: 100 })];
  const list = shelfEntries({ agents, closed: [closed('c1', 8000), closed('c2', 7000), closed('c3', 200)] });
  assert.deepEqual(list.map(e => e.id), ['d1', 'c1', 'c2', 'c3', 'd2']);
  const { shown, hidden } = capEntries(list, 3);
  assert.deepEqual(shown.map(e => e.kind), ['dormant', 'closed', 'closed']);
  assert.equal(hidden, 2);
});
