// Fixtures for the chat-source tests: throw-away agent chat boards made by the REAL chat.py (never the live board).
//   makeBoard('v2')  the live tool (~/.claude/agentchat/chat.py, schema 2)
//   makeBoard('v3')  the next version (/Users/ayu/agentchat-next/chat.py, schema 3); override with CCO_CHAT_PY_V3
// A variant whose chat.py is missing is skipped with a clear message, never failed.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const PY = '/opt/homebrew/bin/python3';
export const CHAT_PY = {
  v2: process.env.CCO_CHAT_PY_V2 || join(homedir(), '.claude', 'agentchat', 'chat.py'),
  v3: process.env.CCO_CHAT_PY_V3 || '/Users/ayu/agentchat-next/chat.py',
};
export const missing = variant => (existsSync(PY) && existsSync(CHAT_PY[variant]) ? false
  : `the chat tool for ${variant} is not at ${CHAT_PY[variant]} (or ${PY} is missing): variant skipped`);

const dirs = [];
export function scratch(prefix = 'cco-chat-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
process.on('exit', () => { for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* gone */ } } });

// One run of a chat.py, in a home of its own. The environment is built from scratch: no session id, no real home.
export function tool(variant, home, args, env = {}) {
  return execFileSync(PY, ['-I', CHAT_PY[variant], ...args], {
    env: { PATH: process.env.PATH, HOME: home, AGENTCHAT_HOME: home, ...env },
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60e3,
  });
}

// A board with a few posts made by the real tool: alpha (joined from session sess-aaaa) tells beta something, beta answers, gamma posts to the channel.
export function makeBoard(variant, { posts = true } = {}) {
  const home = scratch();
  tool(variant, home, ['init']);
  const as = name => ({ AGENTCHAT_AGENT: name });
  tool(variant, home, ['join', 'alpha', '--send-name', 'Alpha chat'], { CLAUDE_CODE_SESSION_ID: 'sess-aaaa' });
  tool(variant, home, ['join', 'beta'], as('beta'));
  if (posts) {
    tool(variant, home, ['post', 'general', 'hello @beta, can you review the lounge?'], as('alpha'));
    tool(variant, home, ['post', 'general', 'yes @alpha, on it'], as('beta'));
    tool(variant, home, ['post', 'scratch', 'a note for everybody'], as('gamma'));
  }
  return { home, db: join(home, 'chat.db'), variant, post: (author, channel, text) => tool(variant, home, ['post', channel, text], as(author)) };
}

// A writer connection on a board file (the tool's own writes are done through chat.py; this is for bulk and odd rows).
export function writer(file) {
  const d = new DatabaseSync(file);
  d.exec('PRAGMA busy_timeout = 2000');
  return d;
}
export function insertRows(file, rows) {
  const d = writer(file);
  try {
    const ins = d.prepare('INSERT INTO messages(ts_ms, channel, thread, author, via, human, to_list, body) VALUES (?,?,?,?,?,?,?,?)');
    d.exec('BEGIN');
    for (const r of rows) ins.run(r.ts ?? Date.now(), r.channel ?? 'general', null, r.author ?? 'gamma', 'test', r.human ? 1 : 0, r.to ?? '', r.body ?? 'row');
    d.exec('COMMIT');
  } finally { d.close(); }
}

// A database made by hand: `ddl` is a list of statements. Returns its path.
export function handmade(ddl, name = 'hand.db') {
  const dir = scratch();
  const file = join(dir, name);
  const d = new DatabaseSync(file);
  for (const s of ddl) d.exec(s);
  d.close();
  return file;
}

export const GOOD_DDL = [
  'CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT NOT NULL)',
  "INSERT INTO meta VALUES('schema_version','7')",
  'CREATE TABLE messages(seq INTEGER PRIMARY KEY AUTOINCREMENT, ts_ms INTEGER NOT NULL, channel TEXT NOT NULL, author TEXT NOT NULL, human INTEGER NOT NULL DEFAULT 0, to_list TEXT NOT NULL DEFAULT \'\', body TEXT NOT NULL)',
  'CREATE TABLE agents(name TEXT PRIMARY KEY, kind TEXT NOT NULL, last_seen_ms INTEGER NOT NULL)',
  'CREATE TABLE agent_keys(key TEXT PRIMARY KEY, agent TEXT NOT NULL)',
];

export function writeText(file, text) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
}
