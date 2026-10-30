// A fake ~/.claude with N Claude Code sessions for the QA harness: live session files (each backed by a real `sleep` process so the
// server's liveness check passes), transcripts, and subagents. Names mix plain, wrapped, emoji and 120 character chat names.
import { mkdirSync, writeFileSync, appendFileSync, rmSync, utimesSync, renameSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const PROJECTS = ['nebula-web', 'atlas-api', 'pixel-forge', 'docs-hub', 'orbit-mobile', 'data-lake', 'ml-lab', 'core-infra', 'billing', 'search'];
const NAMES = [
  'Fix flaky checkout test', 'Review auth middleware', 'Valkey migration plan', 'Why is the nightly ETL slow',
  '🚀 Launch checklist for the Q4 release and the staged rollout of the new onboarding flow',
  'Investigate the intermittent Mezmo ingestion lag on the stg1 pipeline after the node-group move and write up what we found so far',
  'Refactor cart state', 'Terraform plan for the new subnet range', 'Audit bundle size',
  'Draft the incident write-up for the reverse geocode regression and the follow-up actions we agreed with the on-call team',
  'Jira sync', 'Éléonore’s question about the café dataset ☕', 'Migrate docs to Astro',
  'Add a rate limiter to the public API and make sure the burst behaviour matches what the mobile clients expect',
  'Release notes', 'Debug the orbit sync queue', 'Snapshot tests for the editor', 'Chat about the Q4 roadmap', 'Port the shader to WebGPU',
  'A very long single word name: Pneumonoultramicroscopicsilicovolcanoconiosis-and-then-some-more-letters-to-reach-one-hundred-and-twenty',
];
const STATUS_CYCLE = ['working', 'working', 'waiting', 'working', 'dormant', 'ask', 'working', 'waiting'];
const SUB_TASKS = ['Audit bundle size', 'E2E tests for checkout', 'Profile slow queries', 'Draft migration guide', 'Review auth edge cases', 'Generate sprite atlas', 'Fix flaky test', 'Update API docs', 'Write changelog', 'Trace memory leak', 'Load test the API', 'Dark mode tokens'];

const iso = ms => new Date(ms).toISOString();
const enc = cwd => cwd.replace(/[^a-zA-Z0-9]/g, '-');
const line = o => JSON.stringify(o) + '\n';

function userRec(ts, text) { return line({ type: 'user', timestamp: iso(ts), uuid: 'u' + ts, message: { role: 'user', content: text } }); }
function toolUse(ts, id, name, input, msgId) {
  return line({ type: 'assistant', timestamp: iso(ts), message: { id: msgId, model: 'claude-opus-5-5', usage: { input_tokens: 800, output_tokens: 90, cache_read_input_tokens: 40000 }, stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] } });
}
function toolResult(ts, id) { return line({ type: 'user', timestamp: iso(ts), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } }); }
function endTurn(ts, text, msgId) {
  return line({ type: 'assistant', timestamp: iso(ts), message: { id: msgId, model: 'claude-opus-5-5', usage: { input_tokens: 900, output_tokens: 140, cache_read_input_tokens: 41000 }, stop_reason: 'end_turn', content: [{ type: 'text', text }] } });
}

// Closed sessions: transcripts with no process and no session file. Ages in minutes, in an order that is not the order of creation, so a sort is
// really tested; every 7th one is large (padding at the start, so the end of the file, which is what the server reads, stays the same).
const CLOSED_AGES = [95, 12, 410, 31, 2600, 55, 180, 22, 700, 1500, 65, 8, 240, 120, 15000, 45, 330, 5200, 18, 900];
// (the fourth is a long name with an emoji: the shelf must show it in full)
const CLOSED_NAMES = ['Postmortem draft for the cache outage', 'Rename the billing events', 'Why does the search index lag', '🔧 Pairing session on the Valkey TTL regression: the CAS retry path, the expiry bug and what we still owe the cache team', 'Cleanup of the old feature flags',
  'Spike: sprite atlas packing', 'Release checklist 4.18', 'Review the onboarding copy', 'Terraform: new subnet range', 'Data export for the audit', 'Snapshot test failures on CI', 'Draft: team update'];
function closedRecords({ id, name, cwd, at, pad }) {
  const filler = pad ? line({ type: 'attachment', timestamp: iso(at - 3600e3), sessionId: id, cwd, filler: 'x'.repeat(2000) }).repeat(Math.ceil(pad / 2100)) : '';
  return filler
    + line({ type: 'user', timestamp: iso(at - 120e3), uuid: 'u' + at, cwd, sessionId: id, message: { role: 'user', content: `Please continue with: ${name}` } })   // real records carry the folder
    + toolUse(at - 90e3, 'tc-a-' + id, 'Read', { file_path: '/qa/ws/notes.md' }, 'mc1-' + id) + toolResult(at - 88e3, 'tc-a-' + id)
    + toolUse(at - 60e3, 'tc-b-' + id, 'Edit', { file_path: '/qa/ws/src/index.ts' }, 'mc2-' + id) + toolResult(at - 58e3, 'tc-b-' + id)
    + toolUse(at - 40e3, 'tc-c-' + id, 'Bash', { command: 'npm test', description: 'Run unit tests' }, 'mc3-' + id) + toolResult(at - 38e3, 'tc-c-' + id)
    + endTurn(at - 20e3, `Finished: ${name}. The notes are updated and the tests pass.`, 'mc4-' + id)
    + line({ type: 'last-prompt', lastPrompt: `Please continue with: ${name}`, sessionId: id })
    + line({ type: 'custom-title', customTitle: name, sessionId: id }) + line({ type: 'ai-title', aiTitle: name.slice(0, 40), sessionId: id })
    + line({ type: 'cost-state', sessionId: id });
}

// opts: { dir, n, statuses (array cycled over the sessions, default mixed), subs (function index -> list of 'working'|'done'),
//         closed (a number of closed sessions, or a list of { name, project, ageMin, bytes }) }
// sameProject: every chat in one folder (what someone who works from home has), instead of the rotating list of projects
export async function makeFixture({ dir, n, statuses = STATUS_CYCLE, subs, closed = 0, sameProject = null } = {}) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  const T = Date.now();
  const children = [];
  const agents = [];
  const subFiles = new Map();                              // `${sessionId}:${subId}` -> path
  const subPlan = subs || (i => (i % 3 === 0 ? ['working', 'done', 'working'].slice(0, 1 + (i % 4 === 0 ? 2 : 0)) : i % 5 === 1 ? ['working'] : []));
  for (let i = 0; i < n; i++) {
    const project = sameProject || PROJECTS[i % PROJECTS.length] + (i >= PROJECTS.length ? '-' + Math.floor(i / PROJECTS.length) : '');
    const cwd = `/qa/ws/${project}`;
    const sid = `qa-${String(i).padStart(3, '0')}-${(1000 + i * 7919).toString(16)}`;
    const name = (NAMES[i % NAMES.length] + (i >= NAMES.length ? ` #${i}` : '')).slice(0, 120);
    const status = statuses[i % statuses.length];
    const child = spawn('sleep', ['3600'], { stdio: 'ignore', detached: false });
    children.push(child);
    const pid = child.pid;
    const projDir = join(dir, 'projects', enc(cwd));
    mkdirSync(projDir, { recursive: true });
    const base = status === 'dormant' ? T - 3.5 * 3600e3 : T - 600e3;
    let log = line({ type: 'ai-title', aiTitle: name.slice(0, 60) }) + userRec(base, `Please look at ${name}`);
    let sessStatus = 'busy', sessAt = T - 5e3;
    if (status === 'working') {
      log += toolUse(T - 30e3, 'tu-a' + i, 'Read', { file_path: '/qa/ws/src/index.ts' }, 'm1-' + i) + toolResult(T - 28e3, 'tu-a' + i)
        + toolUse(T - 3e3, 'tu-b' + i, 'Bash', { command: 'npm test -- --run', description: 'Run unit tests' }, 'm2-' + i);
    } else if (status === 'ask') {
      log += toolUse(T - 40e3, 'tu-q' + i, 'AskUserQuestion', { questions: [{ question: 'Which environment should I use?' }] }, 'm3-' + i);
    } else {
      const at = status === 'dormant' ? T - 3.2 * 3600e3 : T - 120e3;
      log += endTurn(at, 'Done. Tests pass and the change is ready for review. Want me to open a PR?', 'm4-' + i);
      sessStatus = 'idle'; sessAt = at;
    }
    log += line({ type: 'last-prompt', lastPrompt: `Please look at ${name}` });
    writeFileSync(join(projDir, sid + '.jsonl'), log);
    writeFileSync(join(dir, 'sessions', pid + '.json'), JSON.stringify({ pid, sessionId: sid, cwd, name, status: sessStatus, statusUpdatedAt: sessAt, startedAt: base, version: '2.0.0', kind: 'interactive' }));
    const mine = { id: sid, name, project, status, subs: [] };
    const plan = status === 'dormant' ? [] : subPlan(i);
    plan.forEach((st, k) => {
      const subId = `s${i}x${k}`.padEnd(8, '0');
      const sdir = join(projDir, sid, 'subagents');
      mkdirSync(sdir, { recursive: true });
      const desc = SUB_TASKS[(i + k) % SUB_TASKS.length];
      writeFileSync(join(sdir, `agent-${subId}.meta.json`), JSON.stringify({ description: desc, agentType: 'general-purpose' }));
      let s = userRec(T - 90e3, desc);
      s += st === 'done' ? endTurn(T - 20e3, 'Finished.', 'sm-' + i + '-' + k) : toolUse(T - 4e3, 'st-' + i + '-' + k, 'Grep', { pattern: 'TODO', path: 'src' }, 'sm-' + i + '-' + k);
      writeFileSync(join(sdir, `agent-${subId}.jsonl`), s);
      subFiles.set(`${sid}:${subId}`, join(sdir, `agent-${subId}.jsonl`));
      mine.subs.push({ id: `${sid}:${subId}`, desc, status: st });
    });
    agents.push(mine);
  }
  const closedPlan = typeof closed === 'number'
    ? Array.from({ length: closed }, (_, i) => ({ name: CLOSED_NAMES[i % CLOSED_NAMES.length] + (i >= CLOSED_NAMES.length ? ` #${i}` : ''), project: PROJECTS[(i * 3) % PROJECTS.length], ageMin: CLOSED_AGES[i % CLOSED_AGES.length] + Math.floor(i / CLOSED_AGES.length) * 7, bytes: i % 7 === 6 ? 600e3 : 0 }))
    : closed;
  const closedOut = closedPlan.map((c, i) => {
    const cwd = `/qa/ws/${c.project}`, id = `qc-${String(i).padStart(3, '0')}-${(2000 + i * 6007).toString(16)}`;
    const pdir = join(dir, 'projects', enc(cwd));
    mkdirSync(pdir, { recursive: true });
    const file = join(pdir, id + '.jsonl'), at = T - c.ageMin * 60e3;
    writeFileSync(file, closedRecords({ id, name: c.name, cwd, at, pad: c.bytes }));
    utimesSync(file, at / 1000, at / 1000);                       // the file time is the close time: Claude Code writes its last records when a chat ends
    return { id, name: c.name, project: c.project, ageMin: c.ageMin, file, closedAt: at };
  });
  return {
    dir, agents, pids: children.map(c => c.pid), closed: closedOut,
    // close a live session now, as if the user had quit it: its process ends, its session file goes, its transcript gets its closing records
    closeSession(sid) {
      const m = agents.find(a => a.id === sid);
      if (!m) throw new Error('no such session ' + sid);
      const idx = agents.indexOf(m);
      try { children[idx].kill('SIGKILL'); } catch { /* gone */ }
      rmSync(join(dir, 'sessions', children[idx].pid + '.json'), { force: true });
      const f = join(dir, 'projects', enc(`/qa/ws/${m.project}`), sid + '.jsonl');
      appendFileSync(f, line({ type: 'last-prompt', lastPrompt: 'closing', sessionId: sid }) + line({ type: 'cost-state', sessionId: sid }));
      return f;
    },
    // the task tracker's progress snapshot (docs/progress.md), where the server looks for it by default: `chats` is { sessionId: entry }, or a string that is
    // written as it is (a broken file). It is replaced by a rename, as a careful writer does.
    progressFile: join(dir, 'office-progress.json'),
    writeProgress(chats) {
      const file = join(dir, 'office-progress.json');
      writeFileSync(file + '.tmp', typeof chats === 'string' ? chats : JSON.stringify({ version: 1, updatedAt: iso(Date.now()), chats }));
      renameSync(file + '.tmp', file);
    },
    // end a working subagent's turn now, as if it had just finished
    finishSub(subKey) { const f = subFiles.get(subKey); if (!f) throw new Error('no such subagent ' + subKey); appendFileSync(f, endTurn(Date.now(), 'Finished.', 'fin-' + subKey)); },
    cleanup() { for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } } rmSync(dir, { recursive: true, force: true }); },
  };
}
