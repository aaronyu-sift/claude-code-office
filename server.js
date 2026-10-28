'use strict';
// Claude Code Office — live, local visualizer for your Claude Code sessions.
// Sources: ~/.claude/sessions/*.json (live sessions) + projects/**/<sessionId>.jsonl
// (transcripts) + <sessionId>/subagents/agent-*.jsonl (subagents). Read-only.
// Zero dependencies. Standalone it binds to 127.0.0.1 only; it can also be mounted
// into an existing Express/Connect app via createOffice().handler.

const http = require('http');
const { createChatBridge } = require('./chatbridge');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { StringDecoder } = require('string_decoder');
const { Worker } = require('worker_threads');

const HOME = os.homedir();
const HOST = '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const VERSION = (() => { try { return require('./package.json').version; } catch { return '0.0.0'; } })();
const expandHome = p => (p && p.startsWith('~') ? path.join(HOME, p.slice(1)) : p);

// Set by configure(); defaults match a plain `npx claude-code-office`.
let CLAUDE_DIR = path.join(HOME, '.claude');
let SESS_DIR = path.join(CLAUDE_DIR, 'sessions');
let PROJ_DIR = path.join(CLAUDE_DIR, 'projects');
let DATA_DIR = path.join(HOME, '.claude-code-office');
let COLORS_FILE = null;
let INLINE_COLORS = {};
let CSWAP_URL = null;
let CHAT = null;   // optional read-only bridge from the agentchat database
let DEMO = false;
let SITE = null;
let demo = null;

function readJsonFile(f) {
  try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch { return null; }
}
// Optional local settings (never committed): <app>/config.local.json, then ~/.claude-code-office/config.json.
function loadConfigFiles() {
  return Object.assign({}, readJsonFile(path.join(HOME, '.claude-code-office', 'config.json')) || {},
    readJsonFile(path.join(__dirname, 'config.local.json')) || {});
}
function configure(o) {
  CLAUDE_DIR = path.resolve(expandHome(o.claudeDir || process.env.CLAUDE_CONFIG_DIR || path.join(HOME, '.claude')));
  SESS_DIR = path.join(CLAUDE_DIR, 'sessions');
  PROJ_DIR = path.join(CLAUDE_DIR, 'projects');
  DATA_DIR = path.resolve(expandHome(o.dataDir || path.join(HOME, '.claude-code-office')));
  COLORS_FILE = o.projectColorsFile ? path.resolve(expandHome(o.projectColorsFile)) : null;
  INLINE_COLORS = o.projectColors || {};
  CSWAP_URL = o.cswapUrl || null;
  const chatDb = o.chatDb || process.env.CCO_CHAT_DB;
  CHAT = chatDb ? createChatBridge(path.resolve(expandHome(chatDb))) : null;
  DEMO = !!o.demo;
  SITE = o.site || null;
}

const MAIN_TAIL = 6 * 1024 * 1024;     // on first read, only the last 6 MB of a main transcript
const SUB_TAIL = 3 * 1024 * 1024;
const READ_CHUNK = 16 * 1024 * 1024;
const HISTORY_MS = 6 * 3600e3;         // event history kept in memory
const SNAP_MS = 3 * 3600e3;            // history sent to a newly connected client
const SUB_KEEP_MS = 3 * 3600e3;        // subagent files older than this are ignored
const SUB_STALE_MS = 45 * 60e3;        // an unfinished subagent with no new records counts as "stale"
const MAX_EVENTS = 900;
const SPARK_MIN = 60;

// ---------------------------------------------------------------- helpers

const now = () => Date.now();
const clip = (s, n) => {
  if (s == null) return '';
  s = String(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const baseName = p => (p ? String(p).split(/[\\/]/).filter(Boolean).pop() || String(p) : '');
const firstLine = s => (s ? String(s).split('\n').find(l => l.trim()) || '' : '');

const PALETTE = ['#5B9BD5', '#4FB3BF', '#6DBE73', '#E0B04E', '#B8C25A', '#5CC8A8', '#9B87D4', '#D080B8', '#8AA4D6', '#E08A6E'];
let projectColors = {};
let colorsReadAt = 0;
function loadColors() {
  if (now() - colorsReadAt < 30e3) return;
  colorsReadAt = now();
  projectColors = Object.assign({}, INLINE_COLORS, (COLORS_FILE && readJsonFile(COLORS_FILE)) || {});
}
function colorFor(project) {
  loadColors();
  if (projectColors[project]) return projectColors[project];
  let h = 0;
  for (const ch of project) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// ---------------------------------------------------------------- tool classification

const CAT_BY_TOOL = {
  Bash: 'shell', PowerShell: 'shell', Monitor: 'shell', TaskStop: 'shell', KillShell: 'shell', BashOutput: 'shell',
  Read: 'read', Grep: 'read', Glob: 'read', LSP: 'read', NotebookRead: 'read',
  ReadMcpResourceTool: 'read', ListMcpResourcesTool: 'read', ReadMcpResourceDirTool: 'read',
  Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit',
  WebFetch: 'web', WebSearch: 'web',
  Agent: 'agent', Task: 'agent', SendMessage: 'agent', Workflow: 'agent', ListAgents: 'agent',
  AskUserQuestion: 'ask', ExitPlanMode: 'ask',
};

function categorize(name, input) {
  if (name.startsWith('mcp__')) return 'web';
  const c = CAT_BY_TOOL[name];
  if (c === 'shell' && input && typeof input.command === 'string' &&
      /browser-harness|\bcurl\b|\bwget\b|Invoke-WebRequest/.test(input.command)) return 'web';
  return c || 'other';
}

function toolName(name) {
  if (name.startsWith('mcp__')) {
    const srv = name.split('__')[1] || 'mcp';
    return 'mcp:' + srv.replace(/^claude_ai_/, '').replace(/^plugin_[^_]+_/, '');
  }
  return name;
}

function toolLabel(name, inp) {
  inp = inp || {};
  try {
    switch (name) {
      case 'Bash': case 'PowerShell': return inp.description || firstLine(inp.command);
      case 'Monitor': return inp.description || firstLine(inp.command) || 'İzleniyor';
      case 'Read': return baseName(inp.file_path);
      case 'Edit': case 'MultiEdit': case 'Write': return baseName(inp.file_path);
      case 'NotebookEdit': return baseName(inp.notebook_path);
      case 'Grep': return `"${inp.pattern}"` + (inp.path ? ' · ' + baseName(inp.path) : '');
      case 'Glob': return inp.pattern;
      case 'WebFetch': try { return new URL(inp.url).hostname; } catch { return inp.url; }
      case 'WebSearch': return inp.query;
      case 'Agent': case 'Task': return inp.description || inp.subagent_type || 'Alt ajan';
      case 'Skill': return inp.skill;
      case 'ToolSearch': return inp.query;
      case 'SendMessage': return '→ ' + (inp.to || '');
      case 'AskUserQuestion': return (inp.questions && inp.questions[0] && inp.questions[0].question) || 'Soru';
      case 'ExitPlanMode': return 'Plan onayı';
      case 'TodoWrite': return 'Görev listesi';
      case 'ScheduleWakeup': return inp.reason || 'Uyanma planı';
      case 'Artifact': return inp.action || 'Artifact';
    }
  } catch { /* unexpected input shape */ }
  if (name.startsWith('mcp__')) return name.split('__').slice(2).join('__');
  return name;
}

function toolDetail(name, inp) {
  inp = inp || {};
  if (inp.command) return clip(inp.command, 320);
  if (inp.file_path) return clip(inp.file_path, 320);
  if (inp.url) return clip(inp.url, 320);
  if (inp.prompt) return clip(inp.prompt, 320);
  if (inp.pattern) return clip(`${inp.pattern} ${inp.path || ''}`, 320);
  if (inp.query) return clip(inp.query, 320);
  try { return clip(JSON.stringify(inp), 240); } catch { return ''; }
}

function prettyModel(m) {
  if (!m) return '';
  const r = /claude-(opus|sonnet|haiku|fable)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?/.exec(m);
  if (!r) return m;
  const fam = r[1][0].toUpperCase() + r[1].slice(1);
  return `${fam} ${r[2]}${r[3] ? '.' + r[3] : ''}`;
}

function isHumanPrompt(text) {
  const t = text.trimStart();
  return !/^<(command-|local-command|task-notification|system-reminder|bash-|user-memory|teammate)/.test(t) &&
         !t.startsWith('Caveat:');
}

// ---------------------------------------------------------------- state

const agents = new Map();          // id -> Agent
const outEvents = new Map();       // events to send on this tick
const removed = new Set();
const lastSent = new Map();        // id -> JSON summary (change detection)
let sessionFiles = new Map();      // pid -> session json

class Agent {
  constructor(o) {
    Object.assign(this, {
      id: '', kind: 'main', parent: null, sid: '', pid: null, name: '', cwd: '', project: '', color: '#9A9A9A',
      title: '', desc: '', atype: '', bg: false, depth: 0,
      file: null, offset: 0, dec: new StringDecoder('utf8'), buf: '', skipFirst: false, lookedAt: 0,
      pending: new Map(), events: [], seq: 0,
      msgTok: new Map(), buckets: new Map(), tools: {}, cats: {},
      genStart: null, curThink: null, curWait: null, turnEnded: false, endAt: null,
      lastText: '', lastPrompt: '', summary: '', thought: '',
      model: '', effort: '', ctx: 0, ctxMax: 0, big: false, tokOut: 0, calls: 0, prompts: 0,
      started: null, updated: null, sess: null,
    }, o);
  }
}

function pushEvent(a, ev) {
  ev.a = a.id;
  a.events.push(ev);
  if (a.events.length > MAX_EVENTS) a.events.splice(0, a.events.length - MAX_EVENTS);
  outEvents.set(ev.id, ev);
  return ev;
}
const touch = ev => { outEvents.set(ev.id, ev); };

function bucket(a, ts) {
  const k = Math.floor(ts / 60e3);
  let b = a.buckets.get(k);
  if (!b) { b = { o: 0, t: 0 }; a.buckets.set(k, b); }
  return b;
}

function closeThink(a, ts) {
  if (a.curThink) { a.curThink.e = Math.max(a.curThink.s, ts); touch(a.curThink); a.curThink = null; }
}

function turnStart(a, ts) {
  a.turnEnded = false;
  a.endAt = null;
  a.genStart = ts;
  if (a.curWait) { a.curWait.e = ts; touch(a.curWait); a.curWait = null; }
  for (const ev of a.pending.values()) { ev.e = ts; ev.x = 2; touch(ev); } // tools left unfinished
  a.pending.clear();
}

function ingest(a, r) {
  const ts = r.timestamp ? Date.parse(r.timestamp) : null;
  if (ts) {
    if (!a.started || ts < a.started) a.started = ts;
    if (!a.updated || ts > a.updated) a.updated = ts;
  }
  switch (r.type) {
    case 'ai-title': if (r.aiTitle) a.title = r.aiTitle; return;
    case 'last-prompt': if (r.lastPrompt && a.kind === 'main') a.lastPrompt = clip(r.lastPrompt, 400); return;
    case 'system': return onSystem(a, r, ts);
    case 'attachment': {
      const at = r.attachment;
      if (at && at.type === 'model' && at.identity) a.big = /\[1m\]/.test(at.identity.modelId || '');
      return;
    }
    case 'user': return onUser(a, r, ts);
    case 'assistant': return onAssistant(a, r, ts);
  }
}

function onSystem(a, r, ts) {
  if (!ts) return;
  if (r.subtype === 'away_summary') a.summary = clip(String(r.content || '').replace(/\(disable recaps.*$/i, ''), 500);
  else if (r.subtype === 'compact_boundary') {
    pushEvent(a, { id: `${a.id}#c${++a.seq}`, c: 'compact', code: 'compact', s: ts, e: ts, n: 'Sıkıştırma', l: 'Bağlam sıkıştırıldı' });
  } else if (r.subtype === 'scheduled_task_fire') {
    turnStart(a, ts);
    pushEvent(a, { id: `${a.id}#p${++a.seq}`, c: 'prompt', code: 'scheduled', s: ts, e: ts, n: 'Zamanlı görev', l: clip(r.prompt || r.content, 160) });
  }
}

function onUser(a, r, ts) {
  if (r.isMeta || !ts) return;
  const m = r.message && r.message.content;
  if (typeof m === 'string' || (Array.isArray(m) && m.some(b => b.type === 'text') && !m.some(b => b.type === 'tool_result'))) {
    const text = typeof m === 'string' ? m : m.filter(b => b.type === 'text').map(b => b.text).join('\n');
    if (/^\[Request interrupted/.test(text)) {
      closeThink(a, ts);
      for (const ev of a.pending.values()) { ev.e = ts; ev.x = 2; touch(ev); }
      a.pending.clear();
      a.genStart = null;
      return;
    }
    turnStart(a, ts);
    if (isHumanPrompt(text)) {
      a.prompts++;
      if (a.kind === 'sub' && !a.lastPrompt) a.lastPrompt = clip(text, 400);
      else if (a.kind === 'main') a.lastPrompt = clip(text, 400);
      pushEvent(a, { id: r.uuid || `${a.id}#p${++a.seq}`, c: 'prompt', code: a.kind === 'sub' ? 'task' : 'prompt', s: ts, e: ts, n: a.kind === 'sub' ? 'Görev' : 'İstek', l: clip(firstLine(text), 160) });
    }
    return;
  }
  if (Array.isArray(m)) {
    for (const b of m) {
      if (b.type !== 'tool_result') continue;
      const ev = a.pending.get(b.tool_use_id);
      if (ev) {
        ev.e = ts;
        if (b.is_error) ev.x = 1;
        if (r.toolUseResult && r.toolUseResult.interrupted) ev.x = 2;
        touch(ev);
        a.pending.delete(b.tool_use_id);
      }
    }
    a.genStart = ts;
  }
}

function onAssistant(a, r, ts) {
  const msg = r.message;
  if (!msg || !ts) return;
  if (msg.model && msg.model !== '<synthetic>') a.model = msg.model;
  if (r.effort) a.effort = r.effort;
  const u = msg.usage;
  if (u) {
    const out = u.output_tokens || 0;
    const prev = a.msgTok.get(msg.id) || 0;
    if (out > prev) {
      a.msgTok.set(msg.id, out);
      a.tokOut += out - prev;
      bucket(a, ts).o += out - prev;
      if (a.msgTok.size > 400) a.msgTok.delete(a.msgTok.keys().next().value);
    }
    const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    if (ctx > 0) a.ctx = ctx;
  }
  // Model generation: the "thinking" span from the last user/tool result up to this record.
  if (a.genStart != null) {
    if (!a.curThink) a.curThink = pushEvent(a, { id: `${a.id}#t${++a.seq}`, c: 'think', code: 'think', s: a.genStart, e: ts, n: 'Model', l: 'Düşünüyor' });
    else { a.curThink.e = ts; touch(a.curThink); }
  }
  let sawTool = false;
  for (const b of msg.content || []) {
    if (b.type === 'thinking' && b.thinking) {
      a.thought = clip(b.thinking, 220);
      if (a.curThink) a.curThink.l = clip(b.thinking, 120);
    } else if (b.type === 'text' && b.text && b.text.trim()) {
      a.lastText = clip(b.text, 700);
    } else if (b.type === 'tool_use') {
      sawTool = true;
      const name = b.name || '?';
      const ev = pushEvent(a, {
        id: b.id || `${a.id}#u${++a.seq}`, c: categorize(name, b.input), s: ts, e: null,
        n: toolName(name), l: clip(toolLabel(name, b.input), 110), d: toolDetail(name, b.input),
      });
      a.pending.set(ev.id, ev);
      a.tools[ev.n] = (a.tools[ev.n] || 0) + 1;
      a.cats[ev.c] = (a.cats[ev.c] || 0) + 1;
      a.calls++;
      bucket(a, ts).t++;
    }
  }
  if (sawTool) { closeThink(a, ts); a.genStart = null; }
  if (msg.stop_reason === 'end_turn' || msg.stop_reason === 'stop_sequence') {
    closeThink(a, ts);
    a.genStart = null;
    a.turnEnded = true;
    a.endAt = ts;
    if (a.kind === 'main' && !a.curWait) {
      a.curWait = pushEvent(a, { id: `${a.id}#w${++a.seq}`, c: 'wait', code: 'wait', s: ts, e: null, n: 'Bekleme', l: 'Sıra sende' });
    }
  }
}

// ---------------------------------------------------------------- file reading

function readNew(a, initialTail) {
  if (!a.file) return;
  let st;
  try { st = fs.statSync(a.file); } catch { return; }
  if (st.size < a.offset) { a.offset = 0; a.buf = ''; a.dec = new StringDecoder('utf8'); }
  if (a.offset === 0 && !a.readOnce && st.size > initialTail) {
    a.offset = st.size - initialTail;
    a.skipFirst = true;
  }
  a.readOnce = true;
  if (st.size === a.offset) return;
  let fd;
  try { fd = fs.openSync(a.file, 'r'); } catch { return; }
  try {
    while (a.offset < st.size) {
      const len = Math.min(st.size - a.offset, READ_CHUNK);
      const b = Buffer.allocUnsafe(len);
      const n = fs.readSync(fd, b, 0, len, a.offset);
      if (n <= 0) break;
      a.offset += n;
      let text = a.buf + a.dec.write(n === len ? b : b.subarray(0, n));
      if (a.skipFirst) {
        const i = text.indexOf('\n');
        if (i < 0) { a.buf = ''; continue; }
        text = text.slice(i + 1);
        a.skipFirst = false;
      }
      const lines = text.split('\n');
      a.buf = lines.pop();
      for (const line of lines) {
        if (line.length < 2) continue;
        let r;
        try { r = JSON.parse(line); } catch { continue; }
        try { ingest(a, r); } catch (e) { /* one malformed record must not stop the stream */ }
      }
    }
  } finally { fs.closeSync(fd); }
}

function findTranscript(sid, cwd) {
  const enc = String(cwd || '').replace(/[^a-zA-Z0-9]/g, '-');
  const guess = path.join(PROJ_DIR, enc, sid + '.jsonl');
  if (fs.existsSync(guess)) return guess;
  let dirs = [];
  try { dirs = fs.readdirSync(PROJ_DIR); } catch { return null; }
  for (const d of dirs) {
    const f = path.join(PROJ_DIR, d, sid + '.jsonl');
    if (fs.existsSync(f)) return f;
  }
  return null;
}

// ---------------------------------------------------------------- session discovery

function refreshSessions() {
  let files = [];
  try { files = fs.readdirSync(SESS_DIR).filter(f => /^\d+\.json$/.test(f)); } catch { /* missing */ }
  const live = new Set();
  const next = new Map();
  for (const f of files) {
    const pid = Number(f.slice(0, -5));
    let s;
    try { s = JSON.parse(fs.readFileSync(path.join(SESS_DIR, f), 'utf8')); } catch { s = sessionFiles.get(pid); }
    if (!s || !s.sessionId) continue;
    if (!pidAlive(pid)) continue;
    next.set(pid, s);
    live.add(s.sessionId);
    let a = agents.get(s.sessionId);
    if (!a) {
      const project = baseName(s.cwd) || s.cwd || '?';
      a = new Agent({ id: s.sessionId, kind: 'main', sid: s.sessionId, pid, cwd: s.cwd, project, color: colorFor(project) });
      agents.set(a.id, a);
    }
    a.pid = pid;
    a.name = s.name || '';
    a.sess = s;
  }
  sessionFiles = next;
  for (const a of [...agents.values()]) {
    const root = a.kind === 'main' ? a.id : a.parent;
    if (!live.has(root)) { agents.delete(a.id); removed.add(a.id); lastSent.delete(a.id); }
  }
}

function locateAndRead() {
  for (const a of agents.values()) {
    if (a.kind !== 'main') continue;
    if (!a.file && now() - a.lookedAt > 3000) {
      a.lookedAt = now();
      a.file = findTranscript(a.sid, a.cwd);
    }
    readNew(a, MAIN_TAIL);
  }
  for (const a of agents.values()) if (a.kind === 'sub') readNew(a, SUB_TAIL);
}

let subScanAt = 0;
function discoverSubs() {
  if (now() - subScanAt < 2500) return;
  subScanAt = now();
  for (const m of [...agents.values()]) {
    if (m.kind !== 'main' || !m.file) continue;
    const dir = path.join(m.file.slice(0, -6), 'subagents');
    let list;
    try { list = fs.readdirSync(dir); } catch { continue; }
    for (const f of list) {
      const r = /^agent-([\w-]+)\.jsonl$/.exec(f);
      if (!r) continue;
      const id = `${m.id}:${r[1]}`;
      if (agents.has(id)) continue;
      const file = path.join(dir, f);
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      if (now() - st.mtimeMs > SUB_KEEP_MS) continue;
      let meta = {};
      try { meta = JSON.parse(fs.readFileSync(path.join(dir, `agent-${r[1]}.meta.json`), 'utf8')); } catch { /* no meta file */ }
      const a = new Agent({
        id, kind: 'sub', parent: m.id, sid: m.sid, cwd: m.cwd, project: m.project, color: m.color, file,
        desc: meta.description || '', atype: meta.agentType || 'ajan', bg: meta.requestShape === 'background',
        depth: meta.spawnDepth || 1, name: r[1].slice(0, 7),
      });
      agents.set(id, a);
      readNew(a, SUB_TAIL);
    }
  }
}

function prune() {
  const t = now();
  for (const a of [...agents.values()]) {
    const cut = t - HISTORY_MS;
    if (a.events.length && a.events[0].s < cut) {
      const i = a.events.findIndex(ev => (ev.e || t) >= cut);
      a.events.splice(0, i < 0 ? a.events.length : i);
    }
    for (const k of a.buckets.keys()) if (k < Math.floor(cut / 60e3)) a.buckets.delete(k);
    if (a.kind === 'sub' && (a.updated || 0) < t - SUB_KEEP_MS) {
      agents.delete(a.id); removed.add(a.id); lastSent.delete(a.id);
    }
  }
}

// ---------------------------------------------------------------- summaries

function statusOf(a, t) {
  const pend = [...a.pending.values()];
  const asking = pend.find(ev => ev.c === 'ask');
  if (a.kind === 'main') {
    const s = a.sess || {};
    const sAt = Math.max(s.statusUpdatedAt || 0, a.endAt || 0);
    if (asking) return ['ask', asking.s];
    if (s.status === 'idle' || (s.status !== 'busy' && a.turnEnded)) {
      return [t - sAt > 2 * 3600e3 ? 'dormant' : 'waiting', a.endAt || s.statusUpdatedAt || t];
    }
    return ['working', a.genStart || (pend[0] && pend[0].s) || s.statusUpdatedAt || t];
  }
  if (a.turnEnded) return ['done', a.endAt];
  if (t - (a.updated || 0) > SUB_STALE_MS) return ['stale', a.updated];
  return ['working', a.started];
}

function activityOf(a, status, t, subsWorking) {
  if (status === 'waiting' || status === 'dormant' || status === 'done' || status === 'stale') return null;
  const pend = [...a.pending.values()].sort((x, y) => y.s - x.s);
  if (pend.length) {
    const ev = pend[0];
    return { c: ev.c, n: ev.n, l: ev.l, since: ev.s, k: pend.length };
  }
  if (a.kind === 'main' && subsWorking && a.genStart == null) {
    return { c: 'agent', n: 'Agent', code: 'waitSubs', m: subsWorking, l: `${subsWorking} alt ajan bekleniyor`, since: a.endAt || a.updated || t, k: 1 };
  }
  if (a.genStart != null) return { c: 'think', n: 'Model', code: 'thinking', l: a.thought || 'Düşünüyor', since: a.genStart, k: 1 };
  return { c: 'think', n: 'Model', code: 'working', l: 'Çalışıyor', since: a.updated || t, k: 1 };
}

const DOING_SKIP = new Set(['think', 'wait', 'prompt', 'compact']);
// What the agent is doing right now: its newest tool call, while it runs and for 20 s after.
function doingOf(a, t) {
  for (let i = a.events.length - 1; i >= 0 && i >= a.events.length - 40; i--) {
    const ev = a.events[i];
    if (DOING_SKIP.has(ev.c) || ev.n === 'AgentChat') continue;
    return ev.e == null || t - ev.e < 20e3 ? { n: ev.n, l: ev.l } : null;
  }
  return null;
}

function summarize(a, t) {
  const subs = [...agents.values()].filter(x => x.parent === a.id);
  const subsWorking = subs.filter(x => statusOf(x, t)[0] === 'working').length;
  const [status, since] = statusOf(a, t);
  const nowMin = Math.floor(t / 60e3);
  const spark = [], sparkT = [];
  let hourOut = 0;
  for (let i = SPARK_MIN - 1; i >= 0; i--) {
    const b = a.buckets.get(nowMin - i);
    spark.push(b ? b.o : 0);
    sparkT.push(b ? b.t : 0);
    if (b) hourOut += b.o;
  }
  const s = a.sess || {};
  const ctxMax = a.big || a.ctx > 200e3 ? 1e6 : 200e3;
  return {
    id: a.id, kind: a.kind, parent: a.parent, pid: a.pid, name: a.name, cwd: a.cwd, project: a.project, color: a.color,
    title: a.title, desc: a.desc, atype: a.atype, bg: a.bg, depth: a.depth,
    status, since: since || t, act: activityOf(a, status, t, subsWorking),
    model: prettyModel(a.model), effort: a.effort, ctx: a.ctx, ctxMax,
    lastText: a.lastText, lastPrompt: a.lastPrompt, summary: a.summary, thought: a.thought,
    doing: doingOf(a, t), say: a.say && t - a.say.ts < 30e3 ? { text: a.say.text, dir: a.say.dir } : null,
    tools: a.tools, cats: a.cats, calls: a.calls, prompts: a.prompts,
    spark, sparkT, hourOut, tokOut: a.tokOut,
    started: a.kind === 'main' ? (s.startedAt || a.started) : a.started, updated: a.updated,
    version: s.version || '', entry: s.kind || '', remote: !!s.bridgeSessionId,
    subs: subs.map(x => x.id), subsWorking, usd: usdOf(a),
  };
}

// ---------------------------------------------------------------- cost

const cost = { summary: null, progress: null, scannedAt: 0, ver: 0 };
function sessionUsd(a) {
  const files = cost.summary && cost.summary.files;
  if (!files || !a.file) return null;
  if (a.kind === 'sub') return files[a.file] || 0;
  let usd = files[a.file] || 0;
  const dir = a.file.slice(0, -6) + path.sep;
  for (const [f, v] of Object.entries(files)) if (f.startsWith(dir)) usd += v;
  return usd;
}
const usdCache = new Map();
function usdOf(a) {
  const k = a.id + '|' + cost.ver;
  if (!usdCache.has(k)) { usdCache.set(k, sessionUsd(a)); if (usdCache.size > 2000) usdCache.clear(); }
  return usdCache.get(k);
}

const pad2 = n => String(n).padStart(2, '0');
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
function costTotals() {
  const s = cost.summary;
  if (!s) return null;
  const t = now();
  const sumDay = k => Object.values(s.days[k] || {}).reduce((x, v) => x + v[5], 0);
  const today = sumDay(dayKey(t));
  let week = 0;
  for (let i = 0; i < 7; i++) week += sumDay(dayKey(t - i * 86400e3));
  const mk = dayKey(t).slice(0, 7);
  let month = 0;
  for (const k of Object.keys(s.days)) if (k.startsWith(mk)) month += sumDay(k);
  const d = new Date(t);
  const hk = `${dayKey(t)}T${pad2(d.getHours())}`;
  const phk = `${dayKey(t - 3600e3)}T${pad2(new Date(t - 3600e3).getHours())}`;
  return { today, week, month, all: s.total, hour: s.hours[hk] || 0, prevHour: s.hours[phk] || 0 };
}
function costPayload() {
  return { progress: cost.progress, scannedAt: cost.scannedAt, totals: costTotals() };
}

function startCostWorker() {
  const w = new Worker(path.join(__dirname, 'cost-worker.js'), {
    workerData: { projDir: PROJ_DIR, cacheFile: path.join(DATA_DIR, 'cost-cache.json') },
  });
  w.on('message', m => {
    if (m.type === 'progress') cost.progress = m;
    else if (m.type === 'summary') {
      cost.summary = m.data;
      cost.ver++;
      if (!m.cached) { cost.scannedAt = m.scannedAt; cost.progress = null; }
      for (const a of agents.values()) lastSent.delete(a.id);
    } else if (m.type === 'log') console.error('[cost]', m.msg);
    for (const res of clients) send(res, 'cost', costPayload());
  });
  w.on('error', e => console.error('[cost] worker error', e));
  w.on('exit', code => { if (code) setTimeout(startCostWorker, 10e3); });
}

// ---------------------------------------------------------------- broadcast

const clients = new Set();

function snapshot() {
  const t = now();
  const cut = t - SNAP_MS;
  const list = [...agents.values()];
  const events = [];
  for (const a of list) for (const ev of a.events) if ((ev.e || t) >= cut) events.push(ev);
  return { now: t, agents: list.map(a => summarize(a, t)), events };
}

function send(res, type, data) {
  try { res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); } catch { clients.delete(res); }
}

let minuteMark = 0;
function tick() {
  try {
    if (demo) demo.step(now());
    else { refreshSessions(); locateAndRead(); discoverSubs(); }
    if (CHAT) CHAT.step(agents, pushEvent, now());
  } catch (e) { console.error('tick', e); }
  const t = now();
  const forceAll = Math.floor(t / 60e3) !== minuteMark;
  if (forceAll) { minuteMark = Math.floor(t / 60e3); prune(); }
  const changed = [];
  for (const a of agents.values()) {
    const sum = summarize(a, t);
    const key = JSON.stringify(sum);
    if (forceAll || lastSent.get(a.id) !== key) { lastSent.set(a.id, key); changed.push(sum); }
  }
  const events = [...outEvents.values()];
  outEvents.clear();
  const gone = [...removed];
  removed.clear();
  if (changed.length || events.length || gone.length) {
    for (const res of clients) send(res, 'tick', { now: t, agents: changed, events, removed: gone });
  }
}

// ---------------------------------------------------------------- optional account-usage proxy (cswapUrl)

let cswapCache = { at: 0, body: null };
function cswap(cb) {
  if (!CSWAP_URL || DEMO) return cb('{"accounts":[]}');
  if (now() - cswapCache.at < 25e3 && cswapCache.body) return cb(cswapCache.body);
  const req = http.get(CSWAP_URL, { timeout: 2500 }, res => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', d => { body += d; });
    res.on('end', () => { cswapCache = { at: now(), body }; cb(body); });
  });
  req.on('timeout', () => req.destroy());
  req.on('error', () => cb(cswapCache.body || '{"accounts":[]}'));
}

// ---------------------------------------------------------------- http

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const json = (res, body) => {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

// Works standalone (http.createServer) and mounted (Express/Connect strip the mount path from req.url).
function handler(req, res, next) {
  const url = new URL(req.url, 'http://local');
  const mountedAt = req.originalUrl && req.originalUrl !== req.url ? req.originalUrl.split('?')[0] : null;
  if (mountedAt && url.pathname === '/' && !mountedAt.endsWith('/')) {
    res.writeHead(301, { Location: mountedAt + '/' + (url.search || '') });
    return res.end();
  }
  if (url.pathname === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    send(res, 'snap', snapshot());
    send(res, 'cost', costPayload());
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/config') return json(res, { version: VERSION, demo: DEMO, site: SITE, cswap: !!CSWAP_URL && !DEMO });
  if (url.pathname === '/api/state') return json(res, snapshot());
  if (url.pathname === '/api/cost') {
    const s = cost.summary || { days: {}, hours: {}, projects: {}, models: {}, total: 0, unpriced: [] };
    const { files, ...rest } = s;
    return json(res, { ...rest, ...costPayload() });
  }
  if (url.pathname === '/api/cswap') return cswap(body => json(res, body || '{"accounts":[]}'));
  // Optional private decorations live in public/local/ (git-ignored) and are never served in demo mode.
  if (DEMO && url.pathname.startsWith('/local/')) { res.writeHead(404); return res.end(); }
  let p;
  try { p = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) {
      if (typeof next === 'function') return next();
      res.writeHead(404); return res.end('not found');
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

let started = false;
function start() {
  if (started) return;
  started = true;
  if (DEMO) {
    demo = require('./demo.js')({ Agent, agents, ingest, colorFor });
    cost.summary = demo.costSummary(); cost.ver++; cost.scannedAt = now();
  } else {
    startCostWorker();
  }
  tick();
  setInterval(tick, 1000).unref();
  setInterval(() => { for (const res of clients) { try { res.write(': ping\n\n'); } catch { clients.delete(res); } } }, 20e3).unref();
}

/**
 * Create the office. Options (all optional; local config files are merged underneath):
 *   claudeDir, dataDir, demo, cswapUrl, projectColorsFile, projectColors,
 *   site: { name, home, links: [{ label, href }] }  – shown in the header when mounted into another site
 * Returns { handler(req, res, next), start(), listen(port, host, cb) }.
 */
function createOffice(opts = {}) {
  const given = Object.fromEntries(Object.entries(opts).filter(([, v]) => v !== undefined));
  const merged = Object.assign({}, opts.loadConfigFiles === false ? {} : loadConfigFiles(), given);
  configure(merged);
  return {
    handler,
    start,
    config: merged,
    listen(port, host = HOST, cb) {
      start();
      const srv = http.createServer((req, res) => handler(req, res));
      srv.on('error', e => {
        if (e.code === 'EADDRINUSE') { console.error(`Port ${port} is busy. Is Claude Code Office already running? Try --port.`); process.exit(1); }
        throw e;
      });
      srv.listen(port, host, () => cb && cb(`http://${host}:${port}/`));
      return srv;
    },
  };
}

function openBrowser(url) {
  const { spawn } = require('child_process');
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).unref(); } catch { /* no browser */ }
}

function cli(argv) {
  const has = f => argv.includes('--' + f);
  const val = f => { const i = argv.indexOf('--' + f); return i >= 0 ? argv[i + 1] : undefined; };
  if (has('help') || argv.includes('-h')) {
    console.log(`Claude Code Office ${VERSION}

  npx claude-code-office [options]

  --port <n>          Port to listen on (default 7321)
  --open              Open the browser after start
  --demo              Fictional demo data; does not read ~/.claude
  --claude-dir <dir>  Claude config dir (default ~/.claude or $CLAUDE_CONFIG_DIR)
  --data-dir <dir>    Where the cost cache is kept (default ~/.claude-code-office)
  --chat-db <file>    agentchat SQLite database to show (read-only; or set CCO_CHAT_DB)
`);
    return;
  }
  const files = loadConfigFiles();
  const opts = Object.assign({}, files, { loadConfigFiles: false });
  if (has('demo') || process.env.CCO_DEMO === '1') opts.demo = true;
  if (val('claude-dir')) opts.claudeDir = val('claude-dir');
  if (val('data-dir')) opts.dataDir = val('data-dir');
  if (val('chat-db')) opts.chatDb = val('chat-db');
  const port = Number(val('port') || process.env.CCO_PORT || files.port) || 7321;
  const office = createOffice(opts);
  office.listen(port, HOST, url => {
    console.log(`Claude Code Office ${VERSION}${opts.demo ? ' (demo)' : ''} → ${url}`);
    if (has('open') || files.open) openBrowser(url);
  });
}

module.exports = { createOffice, cli };
if (require.main === module) cli(process.argv.slice(2));
