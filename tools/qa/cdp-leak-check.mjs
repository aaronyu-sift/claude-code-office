// Checks that the headless Chrome of the QA harness dies with its runner. A child process launches Chrome through launchChrome (its temp
// directory is unique to this check, so the profile path is a marker) and is killed with SIGKILL, the way a timed-out or cancelled QA
// run ends; the check then looks for processes that still use that marker. A normal close() must leave nothing behind either.
// Run: node tools/qa/cdp-leak-check.mjs   (CDP=file:///path/to/an/older/cdp.mjs shows that the old launcher leaks)
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CDP = process.env.CDP || new URL('./cdp.mjs', import.meta.url).href;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const leftovers = marker => {
  try { return execFileSync('pgrep', ['-f', marker], { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return []; }
};

async function run(mode) {
  const tmp = mkdtempSync(join(tmpdir(), `cco-leak-${mode}.`));
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { launchChrome } from ${JSON.stringify(CDP)};
    const c = await launchChrome();
    console.log('READY');
    ${mode === 'close' ? 'await c.close(); process.exit(0);' : 'await new Promise(() => {});'}
  `], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, TMPDIR: tmp } });
  let out = '';
  child.stdout.on('data', d => { out += d; });
  for (let i = 0; i < 120 && !/READY/.test(out); i++) await sleep(250);
  if (!/READY/.test(out)) { child.kill('SIGKILL'); return { mode, ok: false, why: 'Chrome did not start' }; }
  const running = leftovers(tmp).length;
  if (mode === 'kill') child.kill('SIGKILL'); else await new Promise(r => child.on('exit', r));
  let after = leftovers(tmp).length;
  for (let i = 0; i < 16 && after; i++) { await sleep(500); after = leftovers(tmp).length; }
  rmSync(tmp, { recursive: true, force: true });
  return { mode, ok: (mode === 'kill' ? running > 0 : true) && after === 0, processesWhileRunning: running, processesAfter: after };
}

const results = [await run('kill'), await run('close')];
for (const r of results) console.log(`CHECK chrome-${r.mode} ${r.ok ? 'PASS' : 'FAIL'} ${JSON.stringify(r)}`);
process.exit(results.every(r => r.ok) ? 0 : 1);
