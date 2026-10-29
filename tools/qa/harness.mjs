// What the QA tools share: the server against a fake ~/.claude, headless Chrome in a throw-away profile, and a ready-made scenario with
// N sessions open on the Office view. Used by pixel-qa.mjs (the checks) and shot.mjs (pictures for a look by eye).
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, sleep } from './cdp.mjs';
import { makeFixture } from './fixture.mjs';

export const ROOT = new URL('../../', import.meta.url).pathname;
export const VIEW = { w: 1500, h: 900 };
export { sleep };

const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

export async function startServer(dir) {
  const port = await freePort();
  const proc = spawn('node', [ROOT + 'server.js', '--claude-dir', dir, '--data-dir', join(dir, 'data'), '--port', String(port)], { stdio: 'ignore', env: { ...process.env, CCO_CHAT_DB: '', CCO_DEMO: '' } });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/config`)).ok) break; } catch { /* starting */ } await sleep(150); }
  return { port, stop() { try { proc.kill('SIGKILL'); } catch { /* gone */ } } };
}
// the agents as the server reports them (what the page shows)
export const apiAgents = async port => (await (await fetch(`http://127.0.0.1:${port}/api/state`)).json()).agents;
// an expression evaluated with `p` = the read-only state of the pixel view
export const px = expr => `(()=>{const p=document.querySelector('#view-ofis').__pixel; return ${expr}})()`;

export async function waitReady(page, expectFigures, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const n = await page.evaluate(px('p ? p.figures().length : -1')).catch(() => -1);
    if (n >= expectFigures) { await sleep(500); return true; }
    await sleep(250);
  }
  return false;
}

// opts: { tag, dpr, reducedMotion, lang (the browser's language, default en-US so that no run opens the language list), fixture, query ('?time=22:00'), proj ('iso' | 'front', added to the query), season (added to the query unless 'auto' or already in it), width, height, timezone ('Asia/Tokyo': the browser's local clock) }
export async function scenario(n, opts = {}) {
  const dir = join(tmpdir(), `cco-qa-${process.pid}-${n}${opts.tag || ''}`);
  const fx = await makeFixture({ dir, n, ...(opts.fixture || {}) });
  const srv = await startServer(dir);
  const page = await launchChrome({ width: opts.width || VIEW.w, height: opts.height || VIEW.h, dpr: opts.dpr || 1, reducedMotion: !!opts.reducedMotion, lang: opts.lang || 'en-US' });
  const done = async () => { await page.close(); srv.stop(); fx.cleanup(); };
  try {
    if (opts.timezone) await page.send('Emulation.setTimezoneOverride', { timezoneId: opts.timezone });
    const agents = await apiAgents(srv.port);
    const q = new URLSearchParams(opts.query || '');
    if (opts.proj) q.set('proj', opts.proj);
    if (opts.season && opts.season !== 'auto' && !q.has('season')) q.set('season', opts.season);       // the checks do not depend on the date they run on
    await page.goto(`http://127.0.0.1:${srv.port}/${q.size ? '?' + q : ''}#ofis`, 800);
    const ready = await waitReady(page, agents.filter(a => a.kind === 'main').length);
    return { fx, srv, page, agents, ready, done, dir };
  } catch (e) { await done(); throw e; }
}
