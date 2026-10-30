import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const { createChatBridge } = createRequire(import.meta.url)('../chatbridge.js');

let sqlite = null;
try { sqlite = await import('node:sqlite'); } catch { /* this Node has no node:sqlite: the bridge reports 'unsupported' */ }

// what the Settings tab shows as "Agent message board" comes from this status (server.js chatState, /api/config chat.state)
test('chat bridge status: a database that opens is on, one that cannot be read is off, nothing is thrown', { skip: !sqlite && 'no node:sqlite in this Node' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'cco-chat-status-'));
  try {
    const file = join(dir, 'chat.db');
    const db = new sqlite.DatabaseSync(file);
    db.exec('CREATE TABLE messages (seq INTEGER PRIMARY KEY, ts_ms INTEGER, channel TEXT, author TEXT, to_list TEXT, body TEXT); CREATE TABLE agent_keys (key TEXT, agent TEXT)');
    db.close();
    const logs = [];
    const on = createChatBridge(file, { log: m => logs.push(m) });
    assert.equal(on.status(), 'on');
    assert.equal(on.status(), 'on', 'asking twice does not open it twice');
    assert.equal(logs.filter(l => /reading/.test(l)).length, 1);
    const off = createChatBridge(join(dir, 'missing', 'chat.db'), { log: m => logs.push(m) });
    assert.equal(off.status(), 'off');
    assert.ok(logs.some(l => /cannot open/.test(l)), 'the log says why');
    assert.equal(typeof on.step, 'function');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('chat bridge status: a Node without node:sqlite says unsupported', { skip: !!sqlite && 'this Node has node:sqlite' }, () => {
  assert.equal(createChatBridge('/nowhere/chat.db', { log() {} }).status(), 'unsupported');
});
