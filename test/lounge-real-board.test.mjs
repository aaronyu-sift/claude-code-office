// The lounge reads what the server really sends: a board made by the REAL chat.py (schema 2 and 3, in a throw-away home; the live board is never touched),
// read by chat-source.js, sent as JSON like GET /api/lounge does, and turned into the wall by lounge-model.js. The shapes were agreed on paper by two agents;
// this test is where they meet (the chat source sends channels as a list and names the Office chat of a board agent `office`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatSource } from '../chat-source.js';
import { normalizePayload, buildView } from '../public/js/lounge-model.js';
import { makeBoard, missing } from './helpers/chat-fixtures.mjs';

const quiet = () => {};

for (const variant of ['v2', 'v3']) {
  test(`${variant}: a board made by the real chat.py shows on the lounge's wall, with its channels, recipients and the Office chat of its agents`, { skip: missing(variant) }, () => {
    const b = makeBoard(variant);
    const now = Date.now();
    const src = createChatSource(b.db, { now: () => now, log: quiet, busyMs: 40 });
    const office = new Map([['sess-aaaa', { id: 'sess-aaaa', kind: 'main', name: 'Alpha chat', project: 'p1' }]]);
    const wire = JSON.parse(JSON.stringify(src.snapshot({ sinceMs: now - 6 * 3600e3, limit: 60, office, now })));      // what travels over HTTP
    assert.equal(wire.state.state, 'ok');
    assert.ok(Array.isArray(wire.channels), 'the chat source answers channels as a list');
    const data = normalizePayload(wire);
    assert.equal(data.state.state, 'ok');
    assert.ok(data.messages.length >= 3, 'the posts of the board are there');
    assert.deepEqual(data.messages.map(m => m.seq), [...data.messages.map(m => m.seq)].sort((x, y) => x - y), 'oldest first');
    const first = data.messages[0];
    assert.equal(first.from, 'alpha');
    assert.deepEqual(first.to, ['beta']);
    assert.ok(first.text.includes('review the lounge'));
    assert.ok(Object.keys(data.channels).includes('general'), 'channel counts survive the list form');
    assert.ok(data.channels.general >= 2);
    for (const a of data.agents) assert.ok(typeof a.name === 'string' && a.name);
    const view = buildView(data, { now, mode: 'text', source: 'live', sessionInfo: id => (id === 'sess-aaaa' ? { name: 'Alpha chat', color: '#8899ff' } : null) });
    assert.equal(view.state, 'ok');
    assert.ok(view.wall.rows.length >= 3, 'the wall has rows');
    assert.ok(view.card.channels.some(c => c.name === 'general' && c.n >= 2), 'the card lists the channel with its count');
    src.close();
  });
}

test('normalizePayload: a recipient list as the comma-separated text the board stores, and an agent whose Office chat is named by `office`', () => {
  const d = normalizePayload({
    state: { state: 'ok', schema: 3, reason: '' },
    messages: [{ seq: 1, ts: 1_800_000_000_000, channel: 'tasks', from: 'a', to: 'b, c ,,d', text: 'x' }],
    channels: [{ name: 'tasks', count: 4 }, { name: '', count: 1 }, { name: 'bad', count: 'many' }, null],
    agents: [{ name: 'a', lastSeenMs: 1_800_000_000_000, session: 'own-session', office: 'office-chat' }, { name: 'b', lastSeenMs: 1_800_000_000_000, session: 'only-session', office: null }],
  });
  assert.deepEqual(d.messages[0].to, ['b', 'c', 'd']);
  assert.deepEqual(d.channels, { tasks: 4 });
  assert.equal(d.agents[0].session, 'office-chat', 'the Office chat wins over the board agent\'s own session');
  assert.equal(d.agents[1].session, 'only-session');
});
