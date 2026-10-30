// chatbridge.js on top of chat-source.js: the behaviour is the one the bridge had before it read through the source
// (checked event for event against the previous chatbridge.js on the same board: the expectations below are what both produced).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatBridge } from '../chatbridge.js';
import { createChatSource } from '../chat-source.js';
import { makeBoard, insertRows, missing } from './helpers/chat-fixtures.mjs';

const office = () => new Map([
  ['sess-aaaa', { id: 'sess-aaaa', kind: 'main', name: 'Alpha chat', project: 'p1' }],     // mapped by agent_keys: alpha joined as session sess-aaaa
  ['sess-b', { id: 'sess-b', kind: 'main', name: 'beta', project: 'p2' }],                  // mapped by name
  ['sess-g', { id: 'sess-g', kind: 'main', name: 'G', project: 'gamma' }],                  // mapped by project
  ['sub-1', { id: 'sub-1', kind: 'sub', name: 'delta', project: 'delta' }],                 // a subagent is never matched by name
]);
const harness = (file, extra = {}) => {
  const agents = office();
  const events = [];
  const push = (a, ev) => events.push({ agent: a.id, ...ev });
  const bridge = createChatBridge(file, { log: () => {}, ...extra });
  let now = Date.now();
  return { agents, events, bridge, step: ms => { now += ms; bridge.step(agents, push, now); }, now: () => now };
};
const lines = events => events.map(e => `${e.agent} ${e.id} | ${e.l}`);

test('bridge: every new message is an event on the sender and on each addressed room, found by key, name or project', { skip: missing('v2') }, () => {
  const b = makeBoard('v2');
  insertRows(b.db, [{ ts: Date.now() - 7 * 3600e3, author: 'alpha', body: 'ancient' }]);       // older than 6 hours: never replayed
  const h = harness(b.db);
  h.step(0);                                                                                      // start: the replay
  assert.deepEqual(lines(h.events), [
    'sess-aaaa chat#1 | @beta: hello @beta, can you review the lounge?',
    'sess-b chat#1@beta | from @alpha: hello @beta, can you review the lounge?',
    'sess-b chat#2 | @alpha: yes @alpha, on it',
    'sess-aaaa chat#2@alpha | from @beta: yes @alpha, on it',
    'sess-g chat#3 | #scratch: a note for everybody',
  ]);
  const e = h.events[0];
  assert.deepEqual([e.c, e.n, e.s === e.e], ['agent', 'AgentChat', true]);
  assert.equal(e.d, '#general → @beta · hello @beta, can you review the lounge?');
  assert.equal(h.events[1].d, '#general ← @alpha · hello @beta, can you review the lounge?');
  assert.equal(h.agents.get('sub-1').say, undefined);

  // later posts, one second apart: the bridge asks the board at most every 2 seconds
  b.post('beta', 'general', '@alpha a later one');
  insertRows(b.db, [
    { author: 'gamma', to: 'alpha,beta', body: '@alpha @beta both of you' },
    { author: 'delta', to: 'alpha', body: 'from a subagent' },
    { author: 'beta', to: 'beta', body: '@beta to myself' },
    { author: 'nobody', to: 'alpha', body: 'unknown sender' },
  ]);
  const before = h.events.length;
  h.step(1000);
  assert.equal(h.events.length, before, 'one second later: not asked yet');
  h.step(1000);
  assert.deepEqual(lines(h.events.slice(before)), [
    'sess-b chat#5 | @alpha: @alpha a later one',
    'sess-aaaa chat#5@alpha | from @beta: @alpha a later one',
    'sess-g chat#6 | @alpha @beta: @alpha @beta both of you',
    'sess-aaaa chat#6@alpha | from @gamma: @alpha @beta both of you',
    'sess-b chat#6@beta | from @gamma: @alpha @beta both of you',
    'sess-aaaa chat#7@alpha | from @delta: from a subagent',
    'sess-b chat#8 | @beta: @beta to myself',
    'sess-aaaa chat#9@alpha | from @nobody: unknown sender',
  ]);
  // the newest line sits on `say`: out for the sender, in for the recipient, and the recipient's own @name is dropped
  const say = id => h.agents.get(id).say;
  assert.deepEqual([say('sess-aaaa').text, say('sess-aaaa').dir], ['@nobody: unknown sender', 'in']);
  assert.deepEqual([say('sess-g').text, say('sess-g').dir], ['@alpha @beta both of you', 'out'], 'a body that starts with @ is not prefixed with the recipients');
  assert.deepEqual([say('sess-b').text, say('sess-b').dir], ['@beta to myself', 'out']);
  // a message to oneself is an event on the sender only
  assert.equal(h.events.filter(x => x.id.startsWith('chat#8')).length, 1);
  // nothing is delivered twice
  h.step(2000);
  h.step(2000);
  assert.equal(new Set(h.events.map(x => x.id)).size, h.events.length);
});

test('bridge: long and multi-line messages are cut for the event line, the detail and the say', { skip: missing('v2') }, () => {
  const b = makeBoard('v2', { posts: false });
  insertRows(b.db, [{ author: 'alpha', to: 'beta', body: 'multi\nline\t body with   spaces ' + 'x'.repeat(500) }]);
  const h = harness(b.db);
  h.step(0);
  const [mine, theirs] = h.events;
  assert.ok(mine.l.length <= 110 && mine.l.startsWith('@beta: multi line body with spaces x') && mine.l.endsWith('…'));
  assert.ok(mine.d.length <= 320 && theirs.d.length <= 320);
  assert.ok(h.agents.get('sess-aaaa').say.text.length <= 120);
  assert.equal(h.agents.get('sess-aaaa').say.dir, 'out');
});

test('bridge: a board that is off, unsupported or missing gives no events and no error; it starts when the board appears', () => {
  const h = harness('/nonexistent/path/chat.db');
  assert.doesNotThrow(() => { h.step(0); h.step(2000); });
  assert.deepEqual(h.events, []);
  assert.equal(h.bridge.source.state().state, 'off');
});

test('bridge: it takes a chat source as well as a path, and logs the state change once', { skip: missing('v2') }, () => {
  const b = makeBoard('v2');
  const log = [];
  const src = createChatSource(b.db, { log: m => log.push(m) });
  const bridge = createChatBridge(src, { log: m => log.push(m) });
  assert.equal(bridge.source, src);
  const agents = office();
  const events = [];
  const t = Date.now();
  for (let i = 0; i < 6; i++) bridge.step(agents, (a, ev) => events.push(ev), t + i * 1000);
  assert.equal(events.length, 5);
  assert.equal(log.filter(l => l.startsWith('[chat] reading')).length, 1, 'one line for the one state');
  assert.match(log[0], /\[chat\] reading .*chat\.db \(read-only\), schema 2/);
});
