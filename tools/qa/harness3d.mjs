// What the 3D scene's QA tools share (office3d-qa.mjs, office3d-shot.mjs): the server against a fake ~/.claude, headless Chrome with software
// WebGL in a throw-away profile (cdp.mjs) and the Office view open on ?scene=3d with N sessions. `root.__ofis3d` and `root.__ofis` are the
// read-only state the scene exposes (public/js/ofis.js).
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, sleep } from './cdp.mjs';
import { makeFixture } from './fixture.mjs';
import { startServer, apiAgents, VIEW, ROOT } from './harness.mjs';

export { sleep, VIEW, ROOT };

const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
// the server of another copy of the repo (the mutation tests serve a copy with one line broken)
async function startServerAt(root, dir) {
  const port = await freePort();
  const proc = spawn('node', [join(root, 'server.js'), '--claude-dir', dir, '--data-dir', join(dir, 'data'), '--port', String(port)], { stdio: 'ignore', env: { ...process.env, CCO_CHAT_DB: '', CCO_DEMO: '' } });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/config`)).ok) break; } catch { /* starting */ } await sleep(150); }
  return { port, stop() { try { proc.kill('SIGKILL'); } catch { /* gone */ } } };
}
// an expression evaluated with `o` = the 3D view's QA state and `v` = its element
export const o3 = expr => `(()=>{const v=document.querySelector('#view-ofis'), o=v.__ofis3d, s=v.__ofis; return ${expr}})()`;

// The people the scene shows once it has settled: one chief per room (an asleep chat is on the shelf, not in a room), plus the working subagents that fit a room (6 or 12 desks)
export function expectedFigures(agents) {
  const mains = agents.filter(a => a.kind === 'main' && a.status !== 'dormant');
  let n = mains.length;
  for (const m of mains) {
    const subs = agents.filter(a => a.kind === 'sub' && a.parent === m.id && a.status === 'working').length;
    n += Math.min(subs, 12);
  }
  return n;
}

export async function waitReady3d(page, minFigures, ms = 30000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) {
    last = await page.evaluate(o3('o && s ? ({ n: o.figures().length, rooms: s.rooms.length, err: v.dataset.hata || null }) : null')).catch(() => null);
    if (last && last.err) return { ok: false, last };
    if (last && last.rooms > 0 && last.n >= minFigures) { await sleep(600); return { ok: true, last }; }
    await sleep(250);
  }
  return { ok: false, last };
}

// opts: { tag, query ('assets=procedural&polish=off'), fixture, width, height, dpr, root (serve another copy of the repo), intercept (async (page, srv) => void,
//         runs before the page opens), beforeServer (async (fixture, dir) => void, runs before the server starts: files put away there can come back later) }; page.warnings collects the console warnings
export async function scenario3d(n, opts = {}) {
  const dir = join(tmpdir(), `cco-qa3d-${process.pid}-${n}${opts.tag || ''}`);
  const fx = await makeFixture({ dir, n, ...(opts.fixture || {}) });
  if (opts.beforeServer) await opts.beforeServer(fx, dir);
  const srv = opts.root ? await startServerAt(opts.root, dir) : await startServer(dir, opts.serverEnv);
  const page = await launchChrome({ width: opts.width || VIEW.w, height: opts.height || VIEW.h, dpr: opts.dpr || 1, lang: 'en-US' });
  const done = async () => { await page.close(); srv.stop(); fx.cleanup(); };
  try {
    page.warnings = [];
    page.on(d => { if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'warning') page.warnings.push(d.params.args.map(a => a.value ?? a.description ?? '').join(' ')); });
    if (opts.intercept) await opts.intercept(page, srv);
    const agents = await apiAgents(srv.port);
    const q = new URLSearchParams(opts.query || '');
    q.set('scene', '3d');
    await page.goto(`http://127.0.0.1:${srv.port}/?${q}#ofis`, 800);
    const expect = expectedFigures(agents);
    const ready = await waitReady3d(page, opts.minFigures ?? expect);
    return { fx, srv, page, agents, expect, ready, done, dir };
  } catch (e) { await done(); throw e; }
}

// a camera on a room's chief desk (zoom: pixels per metre; the whole building at fit zoom is about 10 to 20), or on a world point
export async function lookAtRoom(page, id, zoom = 70, at = { x: 2.2, y: 0.6, z: 3.4 }) {
  await page.evaluate(o3(`(() => { const r = o.room(${JSON.stringify(id)}); return o.view(r.X + ${at.x}, ${at.y}, r.Z + ${at.z}, ${zoom}); })()`));
}
export async function lookAt(page, x, y, z, zoom) { await page.evaluate(o3(`o.view(${x}, ${y}, ${z}, ${zoom})`)); }
