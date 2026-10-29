import test from 'node:test';
import assert from 'node:assert/strict';
import { shelfEntries, isShelved, poseOf } from '../public/js/pixel/shelf.js';

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
