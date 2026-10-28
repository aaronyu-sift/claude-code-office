'use strict';
// Read-only bridge: agentchat SQLite database -> Claude Code Office events.
// Opt-in (--chat-db <file> or CCO_CHAT_DB). The database is opened read-only; nothing is ever written to it.
//
// Every new message becomes an instant event on the sender's room ("AgentChat", → @recipient: text) and on each
// addressed recipient's room (from @sender: text). The newest line also lives on `agent.say` for 30 s so the
// office can show it next to the avatar.
//
// Mapping chat agent -> office session: agent_keys rows 'session:<sessionId>' (what `chat join --auto` writes),
// else the office agent whose id, name or project equals the chat agent's name (used by the demo).

let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch { /* Node without node:sqlite: bridge stays off */ }

const clip = (s, n) => {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

const HISTORY_MS = 6 * 3600e3;   // on start, replay messages younger than this (at most 60)
const KEYS_MS = 10e3;            // refresh the agent -> session map this often

function createChatBridge(dbPath, { log = console.error } = {}) {
  let db = null;
  let lastSeq = -1;
  let nameToSid = new Map();
  let keysAt = 0;
  let complained = '';

  const complainOnce = msg => { if (complained !== msg) { complained = msg; log('[chat] ' + msg); } };

  function open() {
    if (db) return true;
    if (!DatabaseSync) { complainOnce('node:sqlite is not available in this Node; chat bridge is off'); return false; }
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      db.exec('PRAGMA busy_timeout = 1000');
      complained = '';
      log('[chat] reading ' + dbPath + ' (read-only)');
      return true;
    } catch (e) {
      db = null;
      complainOnce('cannot open ' + dbPath + ': ' + e.message);
      return false;
    }
  }

  function loadKeys(now) {
    if (now - keysAt < KEYS_MS) return;
    keysAt = now;
    const map = new Map();
    for (const r of db.prepare("SELECT key, agent FROM agent_keys WHERE key LIKE 'session:%'").all()) {
      map.set(r.agent, r.key.slice('session:'.length));
    }
    nameToSid = map;
  }

  function find(agents, name) {
    const sid = nameToSid.get(name);
    if (sid && agents.has(sid)) return agents.get(sid);
    for (const a of agents.values()) {
      if (a.kind === 'main' && (a.id === name || a.name === name || a.project === name)) return a;
    }
    return null;
  }

  function emit(agents, pushEvent, m) {
    const to = m.to_list ? m.to_list.split(',').map(s => s.trim()).filter(Boolean) : [];
    const dest = to.length ? to.map(n => '@' + n).join(' ') : '#' + m.channel;
    const body = clip(m.body, 300);
    const sender = find(agents, m.author);
    if (sender) {
      pushEvent(sender, {
        id: 'chat#' + m.seq, c: 'agent', s: m.ts_ms, e: m.ts_ms, n: 'AgentChat',
        l: clip(dest + ': ' + body, 110), d: clip('#' + m.channel + ' → ' + dest + ' · ' + body, 320),
      });
      sender.say = { text: clip(body.startsWith('@') ? body : dest + ': ' + body, 120), ts: m.ts_ms, dir: 'out' };
    }
    for (const r of to) {
      const target = find(agents, r);
      if (!target || target === sender) continue;
      pushEvent(target, {
        id: 'chat#' + m.seq + '@' + r, c: 'agent', s: m.ts_ms, e: m.ts_ms, n: 'AgentChat',
        l: clip('from @' + m.author + ': ' + body, 110), d: clip('#' + m.channel + ' ← @' + m.author + ' · ' + body, 320),
      });
      target.say = { text: clip('@' + m.author + ': ' + body.replace(new RegExp('^@' + r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*'), ''), 120), ts: m.ts_ms, dir: 'in' };
    }
  }

  function step(agents, pushEvent, now) {
    try {
      if (!open()) return;
      loadKeys(now);
      let rows;
      const cols = 'seq, ts_ms, channel, author, to_list, body';
      if (lastSeq < 0) {
        rows = db.prepare(`SELECT ${cols} FROM messages WHERE ts_ms > ? ORDER BY seq DESC LIMIT 60`).all(now - HISTORY_MS).reverse();
        lastSeq = db.prepare('SELECT COALESCE(MAX(seq), 0) AS m FROM messages').get().m;
      } else {
        rows = db.prepare(`SELECT ${cols} FROM messages WHERE seq > ? ORDER BY seq LIMIT 100`).all(lastSeq);
        for (const m of rows) lastSeq = Math.max(lastSeq, m.seq);
      }
      for (const m of rows) emit(agents, pushEvent, m);
    } catch (e) {
      try { if (db) db.close(); } catch { /* already closed */ }
      db = null;
      complainOnce('read failed, will retry: ' + e.message);
    }
  }

  return { step };
}

module.exports = { createChatBridge };
