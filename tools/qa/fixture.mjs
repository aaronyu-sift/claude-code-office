// A fake ~/.claude with N Claude Code sessions for the QA harness: live session files (each backed by a real `sleep` process so the
// server's liveness check passes), transcripts, and subagents. Names mix plain, wrapped, emoji and 120 character chat names.
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
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

// opts: { dir, n, statuses (array cycled over the sessions, default mixed), subs (function index -> list of 'working'|'done') }
export async function makeFixture({ dir, n, statuses = STATUS_CYCLE, subs } = {}) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  const T = Date.now();
  const children = [];
  const agents = [];
  const subFiles = new Map();                              // `${sessionId}:${subId}` -> path
  const subPlan = subs || (i => (i % 3 === 0 ? ['working', 'done', 'working'].slice(0, 1 + (i % 4 === 0 ? 2 : 0)) : i % 5 === 1 ? ['working'] : []));
  for (let i = 0; i < n; i++) {
    const project = PROJECTS[i % PROJECTS.length] + (i >= PROJECTS.length ? '-' + Math.floor(i / PROJECTS.length) : '');
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
  return {
    dir, agents, pids: children.map(c => c.pid),
    // end a working subagent's turn now, as if it had just finished
    finishSub(subKey) { const f = subFiles.get(subKey); if (!f) throw new Error('no such subagent ' + subKey); appendFileSync(f, endTurn(Date.now(), 'Finished.', 'fin-' + subKey)); },
    cleanup() { for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } } rmSync(dir, { recursive: true, force: true }); },
  };
}
