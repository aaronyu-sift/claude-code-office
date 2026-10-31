'use strict';
// Read-only bridge: agentchat database -> Minion Office events.
// Opt-in (--chat-db <file> or CCO_CHAT_DB). The database is read through chat-source.js (docs/chat-source.md), which opens it read-only, uses only
// the columns of its contract and keeps working across an upgrade of the chat; nothing here knows how the board is stored.
//
// Every new message becomes an instant event on the sender's room ("AgentChat", → @recipient: text) and on each
// addressed recipient's room (from @sender: text). The newest line also lives on `agent.say` for 30 s so the
// office can show it next to the avatar.
//
// Mapping chat agent -> office session: agent_keys rows 'session:<sessionId>' (written when a Claude Code session joins the board),
// else the office agent whose id, name or project equals the chat agent's name (chat-source.js, findOfficeAgent).

const { createChatSource } = require('./chat-source');

const clip = (s, n) => {
  s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

const HISTORY_MS = 6 * 3600e3;   // on start, replay messages younger than this (at most 60)

// `source` is a chat source (createChatSource) or the path of the database file, for which one is made.
function createChatBridge(source, { log = console.error } = {}) {
  const src = typeof source === 'string' ? createChatSource(source, { log }) : source;
  let lastSeq = -1;

  function emit(agents, pushEvent, m) {
    const to = m.to;
    const dest = to.length ? to.map(n => '@' + n).join(' ') : '#' + m.channel;
    const body = clip(m.text, 300);
    const sender = src.officeAgent(agents, m.from);
    if (sender) {
      pushEvent(sender, {
        id: 'chat#' + m.seq, c: 'agent', s: m.ts, e: m.ts, n: 'AgentChat',
        l: clip(dest + ': ' + body, 110), d: clip('#' + m.channel + ' → ' + dest + ' · ' + body, 320),
      });
      sender.say = { text: clip(body.startsWith('@') ? body : dest + ': ' + body, 120), ts: m.ts, dir: 'out' };
    }
    for (const r of to) {
      const target = src.officeAgent(agents, r);
      if (!target || target === sender) continue;
      pushEvent(target, {
        id: 'chat#' + m.seq + '@' + r, c: 'agent', s: m.ts, e: m.ts, n: 'AgentChat',
        l: clip('from @' + m.from + ': ' + body, 110), d: clip('#' + m.channel + ' ← @' + m.from + ' · ' + body, 320),
      });
      target.say = { text: clip('@' + m.from + ': ' + body.replace(new RegExp('^@' + r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*'), ''), 120), ts: m.ts, dir: 'in' };
    }
  }

  function step(agents, pushEvent, now) {
    const r = src.poll(lastSeq, { now, sinceMs: now - HISTORY_MS });       // never throws, never faster than every 2 s, no SQL while the board is quiet
    if (Number.isFinite(r.lastSeq)) lastSeq = r.lastSeq;
    for (const m of r.rows) {
      try { emit(agents, pushEvent, m); } catch { /* one odd message must not stop the others */ }
    }
  }

  return { step, source: src };
}

module.exports = { createChatBridge };
