// GET /api/lounge and the chat fields of /api/config (server.js), and the contract checker tool (tools/check-chat-contract.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOffice } from '../server.js';
import { makeBoard, missing, handmade, GOOD_DDL, scratch } from './helpers/chat-fixtures.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// one office per scenario: createOffice reconfigures the module, so the scenarios run one after the other
// (the handler is used without start(), so no cost worker or scanner runs; `demo` is only the option the server reads)
async function withOffice(chatDb, fn, { demo = false } = {}) {
  const office = createOffice({ demo, chatDb, loadConfigFiles: false, dataDir: scratch() });
  const srv = http.createServer((req, res) => office.handler(req, res));
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const get = path => new Promise((resolve, reject) => http.get(`http://127.0.0.1:${srv.address().port}${path}`, res => {
    let body = '';
    res.on('data', d => { body += d; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body, json: () => JSON.parse(body) }));
  }).on('error', reject));
  try { await fn(get); } finally { await new Promise(r => srv.close(r)); }
}

test('api: a readable board shows in /api/config as exactly { state, schema } and in /api/lounge as the snapshot', { skip: missing('v2') }, async () => {
  const b = makeBoard('v2');
  await withOffice(b.db, async get => {
    const cfg = await get('/api/config');
    assert.equal(cfg.status, 200);
    assert.deepEqual(cfg.json().chat, { state: 'ok', schema: 2 });
    assert.deepEqual(Object.keys(cfg.json().chat), ['state', 'schema'], 'only these two fields');
    const l = await get('/api/lounge');
    assert.equal(l.status, 200);
    assert.match(l.headers['content-type'], /application\/json/);
    assert.equal(l.headers['cache-control'], 'no-store');
    const j = l.json();
    assert.deepEqual(j.state, { state: 'ok', schema: 2, reason: '' });
    assert.deepEqual(j.messages.map(m => [m.seq, m.from, m.to, m.channel]), [[1, 'alpha', ['beta'], 'general'], [2, 'beta', ['alpha'], 'general'], [3, 'gamma', [], 'scratch']]);
    assert.deepEqual(j.channels, [{ name: 'general', count: 2 }, { name: 'scratch', count: 1 }]);
    assert.deepEqual(j.agents.map(a => a.name).sort(), ['alpha', 'beta', 'gamma']);
    assert.ok(j.agents.every(a => 'session' in a && 'office' in a && a.lastSeenMs > 0));
    assert.deepEqual(Object.keys(j).sort(), ['agents', 'channels', 'countsCapped', 'messages', 'now', 'sinceMs', 'state', 'truncated']);
    // cached for 2 seconds: the same text, whatever happened on the board meanwhile; fresh after that
    b.post('beta', 'general', 'a post after the first look');
    const again = await get('/api/lounge');
    assert.equal(again.body, l.body, 'inside the 2 seconds the answer is the cached one');
    await sleep(2100);
    const later = await get('/api/lounge');
    assert.equal(later.json().messages.length, 4);
    assert.equal(later.json().messages[3].text, 'a post after the first look');
  });
});

test('api: no board configured is off, with empty arrays and no error', async () => {
  await withOffice(undefined, async get => {
    assert.deepEqual((await get('/api/config')).json().chat, { state: 'off', schema: null });
    const j = (await get('/api/lounge')).json();
    assert.equal(j.state.state, 'off');
    assert.match(j.state.reason, /no chat database/);
    assert.deepEqual([j.messages, j.channels, j.agents], [[], [], []]);
  });
});

test('api: a board that breaks the contract is unsupported, with the reason in /api/lounge only', async () => {
  const file = handmade(GOOD_DDL.filter(s => !s.includes('agent_keys')));
  await withOffice(file, async get => {
    assert.deepEqual((await get('/api/config')).json().chat, { state: 'unsupported', schema: 7 });
    const j = (await get('/api/lounge')).json();
    assert.equal(j.state.state, 'unsupported');
    assert.match(j.state.reason, /table agent_keys is missing/);
    assert.deepEqual([j.messages, j.channels, j.agents], [[], [], []]);
  });
});

test('api: --demo reads no chat board: with a database configured, /api/lounge is off and empty and /api/config says off', { skip: missing('v2') }, async () => {
  const b = makeBoard('v2');
  await withOffice(b.db, async get => {
    const cfg = (await get('/api/config')).json();
    assert.equal(cfg.demo, true);
    assert.deepEqual(cfg.chat, { state: 'off', schema: null });
    const j = (await get('/api/lounge')).json();
    assert.equal(j.state.state, 'off');
    assert.deepEqual([j.messages, j.channels, j.agents], [[], [], []]);
    assert.ok(!(await get('/api/lounge')).body.includes('lounge'), 'none of the real posts is in the answer');
  }, { demo: true });
  // the environment variable and a database named in a config file are stopped the same way
  process.env.CCO_CHAT_DB = b.db;
  try {
    await withOffice(undefined, async get => {
      assert.deepEqual((await get('/api/config')).json().chat, { state: 'off', schema: null });
      assert.deepEqual((await get('/api/lounge')).json().messages, []);
    }, { demo: true });
    await withOffice(undefined, async get => {
      assert.equal((await get('/api/config')).json().chat.state, 'ok', 'the same board without --demo is read');
    });
  } finally { delete process.env.CCO_CHAT_DB; }
});

test('api: a missing file is off', async () => {
  await withOffice(join(scratch(), 'not-yet.db'), async get => {
    assert.deepEqual((await get('/api/config')).json().chat, { state: 'off', schema: null });
    assert.match((await get('/api/lounge')).json().state.reason, /not found/);
  });
});

// ---------------------------------------------------------------- the contract checker

const check = (...args) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(ROOT, 'tools', 'check-chat-contract.mjs'), ...args], { encoding: 'utf8' });

for (const [variant, schema] of [['v2', 2], ['v3', 3]]) {
  test(`check tool: a ${variant} board made by the real chat.py is OK`, { skip: missing(variant) }, () => {
    const r = check(makeBoard(variant, { posts: false }).db);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`^OK  schema ${schema}  `));
    assert.match(r.stdout, /messages\(seq ts_ms channel author to_list body human\)/);
  });
}

test('check tool: it names what is missing and exits 1; a missing file or no argument exits 2; --json prints the verdict', () => {
  const bad = handmade(GOOD_DDL.filter(s => !s.includes('CREATE TABLE messages')).concat('CREATE TABLE messages(seq INTEGER PRIMARY KEY, ts_ms INTEGER, channel TEXT, author TEXT, body TEXT)'));
  const r = check(bad);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^UNSUPPORTED /);
  assert.match(r.stdout, /- messages lacks to_list, human/);
  assert.match(r.stdout, /the Office needs: /);
  const none = check(join(scratch(), 'missing.db'));
  assert.equal(none.status, 2);
  assert.match(none.stdout, /NOT FOUND/);
  assert.equal(check().status, 2);
  const j = JSON.parse(check(bad, '--json').stdout);
  assert.deepEqual([j.state, j.schema], ['unsupported', 7]);
  assert.deepEqual(j.problems, ['messages lacks to_list, human']);
  const good = check(handmade(GOOD_DDL), '--json');
  assert.equal(good.status, 0);
  assert.deepEqual(JSON.parse(good.stdout), { state: 'ok', schema: 7, reason: '', problems: [] });
});
