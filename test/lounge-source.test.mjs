import test from 'node:test';
import assert from 'node:assert/strict';
import { POLL_MS, RETRY_MS, OFF_MS, sourceFromQuery, fetchReader, createDemoSource, createPoller, DEMO_SCRIPT, DEMO_PERIOD, DEMO_AGENTS } from '../public/js/lounge-source.js';
import { normalizePayload, buildView, LIMITS } from '../public/js/lounge-model.js';

// a clock and timers that only move when the test says so
function fake() {
  let t = 1_000_000, id = 0;
  const q = [];
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  return {
    now: () => t,
    setTimer: (fn, ms) => { const h = ++id; q.push({ h, at: t + Math.max(0, ms), fn }); return h; },
    clearTimer: h => { const i = q.findIndex(x => x.h === h); if (i >= 0) q.splice(i, 1); },
    get pending() { return q.length; },
    async advance(ms) {
      const end = t + ms;
      for (;;) {
        q.sort((a, b) => a.at - b.at || a.h - b.h);
        if (!q.length || q[0].at > end) break;
        const e = q.shift();
        t = Math.max(t, e.at);
        e.fn();                                    // not awaited: a read that waits for a later timer must not stop the clock
        await flush();
      }
      t = end;
      await flush();
    },
  };
}
const okRead = () => async () => ({ status: 'ok', http: 200, payload: { state: { state: 'ok' }, messages: [] } });

test('poller: a request every 3 seconds, no faster, from the first moment', async () => {
  const c = fake(), t0 = c.now();
  const p = createPoller({ read: okRead(), ...c });
  p.start();
  await c.advance(10_000);
  assert.equal(p.stats.requests, 4, 'at 0, 3, 6 and 9 seconds');
  assert.deepEqual(p.stats.starts.map(x => x - t0), [0, 3000, 6000, 9000]);
  p.stop();
  await c.advance(10_000);
  assert.equal(p.stats.requests, 4, 'stopped means stopped');
  assert.equal(c.pending, 0);
});

test('poller: a server that answers but says the board is off is asked every 30 seconds, and a board that comes on is read at the next ask', async () => {
  const c = fake(), t0 = c.now();
  let said = 'off';
  const read = async () => ({ status: 'ok', http: 200, payload: { state: { state: said }, messages: [], channels: [], agents: [] } });
  const p = createPoller({ read, ...c });
  p.start();
  await c.advance(65_000);
  assert.deepEqual(p.stats.starts.map(x => x - t0), [0, OFF_MS, 2 * OFF_MS], 'at 0, 30 and 60 seconds');
  said = 'ok';
  await c.advance(OFF_MS);                                                       // to 95 s: the ask at 90 finds the board on
  assert.deepEqual(p.stats.starts.map(x => x - t0), [0, OFF_MS, 2 * OFF_MS, 3 * OFF_MS, 3 * OFF_MS + POLL_MS], 'and from then on every 3 seconds');
  await c.advance(POLL_MS);
  assert.equal(p.stats.starts.length, 6);
  p.stop();
});

test('poller: never two at once, and a slow answer pushes the next request back instead of piling up', async () => {
  const c = fake();
  let open = 0, worst = 0;
  const read = () => new Promise(res => { open++; worst = Math.max(worst, open); c.setTimer(() => { open--; res({ status: 'ok', http: 200, payload: {} }); }, 5000); });
  const p = createPoller({ read, ...c });
  p.start();
  await c.advance(30_000);
  assert.equal(worst, 1);
  const gaps = p.stats.starts.slice(1).map((x, i) => x - p.stats.starts[i]);
  assert.ok(gaps.every(g => g >= POLL_MS), gaps.join());
  p.stop();
});

test('poller: nothing is asked while it must not poll (hidden tab, lounge off screen), and it goes on when kicked', async () => {
  const c = fake(), t0 = c.now();
  let can = true;
  const p = createPoller({ read: okRead(), canPoll: () => can, ...c });
  p.start();
  await c.advance(4000);
  assert.equal(p.stats.requests, 2);
  can = false;
  p.kick();
  assert.equal(c.pending, 0, 'the waiting timer is gone: a hidden tab does not even wake up');
  await c.advance(120_000);
  assert.equal(p.stats.requests, 2, 'two minutes hidden, no request');
  can = true;
  p.kick();
  await c.advance(0);
  assert.equal(p.stats.requests, 3, 'visible again: the first request is at once, the last was long ago');
  await c.advance(2900);
  assert.equal(p.stats.requests, 3);
  await c.advance(200);
  assert.equal(p.stats.requests, 4, 'then every 3 seconds');
  // hidden at the moment the timer fires, without a kick: it stops there
  can = false;
  await c.advance(10_000);
  assert.equal(p.stats.requests, 4);
  assert.equal(c.pending, 0);
  assert.ok(p.stats.starts.every((x, i, a) => !i || x - a[i - 1] >= POLL_MS), 'whoever asks, never faster');
  assert.equal(t0 > 0, true);
  p.stop();
});

test('poller: a kick right after a request does not make the next one sooner', async () => {
  const c = fake();
  const p = createPoller({ read: okRead(), ...c });
  p.start();
  await c.advance(0);
  for (let i = 0; i < 20; i++) p.kick();
  await c.advance(2999);
  assert.equal(p.stats.requests, 1);
  await c.advance(1);
  assert.equal(p.stats.requests, 2);
  p.stop();
});

test('poller: a 404 means the server has no endpoint: asked again in five minutes, not every three seconds; the console is not flooded', async () => {
  const c = fake();
  const seen = [];
  const p = createPoller({ read: async () => ({ status: 'nofile', http: 404, payload: null }), onData: r => seen.push(r.status), ...c });
  p.start();
  await c.advance(RETRY_MS - 1000);
  assert.equal(p.stats.requests, 1);
  await c.advance(1500);
  assert.equal(p.stats.requests, 2);
  assert.deepEqual(seen, ['nofile', 'nofile']);
  p.stop();
});

test('poller: a failed request is tried again in 3 seconds, and the poll survives a handler that throws and a read that rejects', async () => {
  const c = fake();
  let n = 0;
  const p = createPoller({ read: async () => { n++; if (n === 1) throw new Error('boom'); return { status: n === 2 ? 'failed' : 'ok', http: 500, payload: null }; }, onData: () => { throw new Error('handler'); }, ...c });
  p.start();
  await c.advance(9500);
  assert.equal(p.stats.requests, 4);
  assert.equal(p.stats.lastStatus, 'ok');
  p.stop();
});

test('poller: a start that is already running is not doubled, and stop then start works', async () => {
  const c = fake();
  const p = createPoller({ read: okRead(), ...c });
  p.start(); p.start(); p.start();
  assert.equal(c.pending, 1);
  await c.advance(100);
  p.stop(); p.start();
  await c.advance(6000);
  assert.ok(p.stats.requests >= 2 && p.stats.requests <= 3);
  p.stop();
});

// ------------------------------------------------------------ one read

const res = (status, body, badJson = false) => ({ status, ok: status >= 200 && status < 300, json: async () => { if (badJson) throw new SyntaxError('bad'); return body; } });
test('fetchReader: 404 is "no endpoint", other failures are failures, and an answer is an answer', async () => {
  const mk = f => fetchReader({ fetchFn: f, baseURI: 'http://127.0.0.1:7321/' });
  assert.deepEqual(await mk(async () => res(404))(), { status: 'nofile', http: 404, payload: null });
  assert.deepEqual(await mk(async () => res(500))(), { status: 'failed', http: 500, payload: null });
  assert.deepEqual(await mk(async () => res(200, null, true))(), { status: 'failed', http: 200, payload: null });
  assert.deepEqual(await mk(async () => { throw new TypeError('network'); })(), { status: 'failed', http: 0, payload: null });
  assert.deepEqual(await mk(async () => res(200, { state: { state: 'ok' } }))(), { status: 'ok', http: 200, payload: { state: { state: 'ok' } } });
});

test('fetchReader: asks the page\'s own server, never caches, and gives up on a server that does not answer', async () => {
  let asked = null;
  await fetchReader({ fetchFn: async (u, o) => { asked = { u, o }; return res(200, {}); }, baseURI: 'http://127.0.0.1:7341/some/page' })();
  assert.equal(asked.u, 'http://127.0.0.1:7341/some/api/lounge');
  assert.equal(asked.o.cache, 'no-store');
  const hang = (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
  const t0 = Date.now();
  const r = await fetchReader({ fetchFn: hang, baseURI: 'http://127.0.0.1:7341/', timeoutMs: 40 })();
  assert.equal(r.status, 'failed'); assert.ok(Date.now() - t0 < 1000);
});

// ------------------------------------------------------------ the address

test('sourceFromQuery: ?lounge=demo picks the demo, a mode picks how it shows, both can be given', () => {
  assert.deepEqual(sourceFromQuery(''), { source: 'live', mode: null });
  assert.deepEqual(sourceFromQuery('?scene=3d'), { source: 'live', mode: null });
  assert.deepEqual(sourceFromQuery('?lounge=demo'), { source: 'demo', mode: null });
  assert.deepEqual(sourceFromQuery('?lounge=names'), { source: 'live', mode: 'names' });
  assert.deepEqual(sourceFromQuery('?lounge=OFF'), { source: 'live', mode: 'off' });
  assert.deepEqual(sourceFromQuery('?lounge=demo,names'), { source: 'demo', mode: 'names' });
  assert.deepEqual(sourceFromQuery('?lounge=names+demo'), { source: 'demo', mode: 'names' });
  assert.deepEqual(sourceFromQuery('?lounge=bogus'), { source: 'live', mode: null });
  assert.deepEqual(sourceFromQuery(undefined), { source: 'live', mode: null });
});

// ------------------------------------------------------------ the demo

test('demo: some posts are already there when the page opens, more come as the script runs, nothing is in the future', async () => {
  const c = fake(), t0 = c.now();
  const read = createDemoSource({ now: c.now, sessions: () => ['chat-a', 'chat-b', 'chat-c'] });
  const first = (await read()).payload;
  assert.equal(first.state.state, 'ok');
  assert.equal(first.messages.length, DEMO_SCRIPT.filter(s => s[0] <= 0).length);
  assert.ok(first.messages.length >= 3 && first.messages.every(m => m.ts <= t0));
  await c.advance(30_000);
  const later = (await read()).payload;
  assert.ok(later.messages.length > first.messages.length);
  assert.ok(later.messages.every(m => m.ts <= c.now()));
  assert.deepEqual(later.messages.map(m => m.ts), [...later.messages.map(m => m.ts)].sort((a, b) => a - b), 'newest last');
  assert.equal(new Set(later.messages.map(m => m.seq)).size, later.messages.length, 'every post has its own number');
  assert.deepEqual(later.channels, later.messages.reduce((o, m) => ({ ...o, [m.channel]: (o[m.channel] || 0) + 1 }), {}));
});

test('demo: the script repeats, with new numbers, and a long run stays small', async () => {
  const c = fake();
  const read = createDemoSource({ now: c.now });
  const seen = new Set();
  let lastSeq = 0;
  for (let i = 0; i < 400; i++) {
    const { messages } = (await read()).payload;
    assert.ok(messages.length <= 60);
    for (const m of messages) { if (!seen.has(m.seq)) { assert.ok(m.seq > lastSeq, `${m.seq} after ${lastSeq}`); lastSeq = m.seq; seen.add(m.seq); } }
    await c.advance(3000);
  }
  assert.ok(seen.size > DEMO_SCRIPT.length * 8, `${seen.size} posts in 20 minutes`);
  assert.ok(DEMO_PERIOD > DEMO_SCRIPT[DEMO_SCRIPT.length - 1][0]);
});

test('demo: the first two agents are tied to the first two chats of the Office, the others are people without a chat', async () => {
  const c = fake();
  await c.advance(DEMO_PERIOD);
  const read = createDemoSource({ now: c.now, sessions: () => ['chat-a', 'chat-b', 'chat-c'], start: c.now() - 100_000 });
  const { agents } = (await read()).payload;
  const by = Object.fromEntries(agents.map(a => [a.name, a]));
  assert.equal(by.builder.session, 'chat-a'); assert.equal(by.reviewer.session, 'chat-b'); assert.equal(by.scout.session, ''); assert.equal(by.lead.session, '');
  const none = (await createDemoSource({ now: c.now, sessions: () => { throw new Error('x'); }, start: c.now() - 100_000 })()).payload;
  assert.ok(none.agents.every(a => a.session === ''), 'a broken sessions function is no sessions');
});

test('demo: the answer goes through the model like a real one; it has long texts, posts to a channel, and no agent beyond the list', async () => {
  const c = fake();
  const read = createDemoSource({ now: c.now });
  await c.advance(95_000);
  const raw = (await read()).payload;
  const data = normalizePayload(raw);
  assert.equal(data.state.state, 'ok'); assert.equal(data.messages.length, raw.messages.length);
  const v = buildView(data, { now: c.now(), mode: 'text', sessionInfo: () => null });
  assert.equal(v.wall.rows.length, LIMITS.wallRows);
  assert.ok(DEMO_SCRIPT.some(s => s[4].length > LIMITS.wallText), 'one post is long enough to be clipped on the wall');
  assert.ok(DEMO_SCRIPT.some(s => s[3].length === 0), 'one post goes to a channel, to nobody in particular');
  assert.ok(DEMO_SCRIPT.every(s => DEMO_AGENTS.includes(s[2]) && s[3].every(n => DEMO_AGENTS.includes(n))));
  assert.ok(v.people.length >= 4 && v.people.length <= LIMITS.people);
  assert.ok(DEMO_SCRIPT.every(s => s[4].length <= LIMITS.cardText));
  assert.ok(v.activity.posts >= 1);
});
