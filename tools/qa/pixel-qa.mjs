// QA harness of the pixel scene (docs/pixel-scene-plan.md section 7). Starts the server against a fake ~/.claude (fixture.mjs), drives
// headless Chrome through the DevTools protocol in a throw-away profile, and prints one `CHECK <name> PASS|FAIL <detail>` line per check
// and a final `QA PASS` or `QA FAIL`.
//   node tools/qa/pixel-qa.mjs [--proj iso] [--shots <dir>] [--only <name>]
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchChrome, sleep } from './cdp.mjs';
import { makeFixture } from './fixture.mjs';

const ROOT = new URL('../../', import.meta.url).pathname;
const args = process.argv.slice(2);
const val = f => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : undefined; };
const proj = val('proj') || 'iso';
const shotsDir = val('shots');
const VIEW = { w: 1500, h: 900 };
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`CHECK ${name} ${ok ? 'PASS' : 'FAIL'} ${detail}`);
}
const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

async function startServer(dir) {
  const port = await freePort();
  const proc = spawn('node', [ROOT + 'server.js', '--claude-dir', dir, '--data-dir', join(dir, 'data'), '--port', String(port)], { stdio: 'ignore', env: { ...process.env, CCO_CHAT_DB: '', CCO_DEMO: '' } });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/config`)).ok) break; } catch { /* starting */ } await sleep(150); }
  return { port, stop() { try { proc.kill('SIGKILL'); } catch { /* gone */ } } };
}
// the agents as the server reports them (what the page shows)
const apiAgents = async port => (await (await fetch(`http://127.0.0.1:${port}/api/state`)).json()).agents;
const px = expr => `(()=>{const p=document.querySelector('#view-ofis').__pixel; return ${expr}})()`;

async function waitReady(page, expectFigures, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const n = await page.evaluate(px('p ? p.figures().length : -1')).catch(() => -1);
    if (n >= expectFigures) { await sleep(500); return true; }
    await sleep(250);
  }
  return false;
}
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

async function scenario(n, opts = {}) {
  const dir = join(tmpdir(), `cco-qa-${process.pid}-${n}${opts.tag || ''}`);
  const fx = await makeFixture({ dir, n, ...(opts.fixture || {}) });
  const srv = await startServer(dir);
  const page = await launchChrome({ width: VIEW.w, height: VIEW.h, dpr: opts.dpr || 1, reducedMotion: !!opts.reducedMotion });
  const done = async () => { await page.close(); srv.stop(); fx.cleanup(); };
  try {
    const agents = await apiAgents(srv.port);
    await page.goto(`http://127.0.0.1:${srv.port}/#ofis`, 800);
    const ready = await waitReady(page, agents.filter(a => a.kind === 'main').length);
    return { fx, srv, page, agents, ready, done, dir };
  } catch (e) { await done(); throw e; }
}

const only = val('only');
const want = name => !only || only === name;

// ---- 10. determinism of the committed art
if (want('determinism')) {
  const r = spawnSync('node', [ROOT + 'tools/sprites/build-atlas.mjs', '--proj', proj, '--check'], { encoding: 'utf8' });
  check('10-determinism', r.status === 0, (r.stdout.split('\n')[0] || r.stderr.split('\n')[0] || '').trim());
}
// ---- 9. manifest has no river, car, road or traffic
if (want('manifest')) {
  const man = JSON.parse(readFileSync(ROOT + 'public/pixel/manifest.json', 'utf8'));
  const bad = Object.keys(man.sprites).filter(id => /river|car|road|traffic/.test(id));
  check('09-manifest-ids', bad.length === 0 && Object.keys(man.sprites).length >= 60, `${Object.keys(man.sprites).length} sprites, matching river|car|road|traffic: ${bad.length ? bad.join(',') : 'none'}`);
}

// ---- 1 to 5 at N = 4, 10, 20
const SIZES = [4, 10, 20];
const perN = {};
for (const n of SIZES) {
  if (!['load', 'labels', 'targets', 'occlusion', 'hit'].some(want) && only) continue;
  const S = await scenario(n);
  perN[n] = S;
  try {
    const mains = S.agents.filter(a => a.kind === 'main'), subs = S.agents.filter(a => a.kind === 'sub');
    // 1. no console errors or failed requests
    check(`01-load-n${n}`, S.ready && S.page.errors.length === 0 && S.page.failed.length === 0,
      `${mains.length} mains + ${subs.length} subs, scene ${await S.page.evaluate(`document.querySelector('#view-ofis').dataset.scene`)}, zoom ${await S.page.evaluate(px('p.zoom'))}, errors ${S.page.errors.length}, failed requests ${S.page.failed.length}${S.page.errors[0] ? ' first: ' + S.page.errors[0] : ''}${S.page.failed[0] ? ' first failed: ' + S.page.failed[0] : ''}`);
    if (!S.ready) throw new Error('scene did not become ready');

    // 2. labels: full name, no overlap, inside the view
    const rects = await S.page.evaluate(px('p.labelRects()'));
    const mainRects = rects.filter(r => r.main), shown = rects.filter(r => r.shown);
    const wrong = mains.filter(a => { const r = mainRects.find(x => x.id === a.id); return !r || r.name !== (a.name || a.title || a.project); });
    const clash = [];
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) if (overlap(shown[i], shown[j])) clash.push(`${shown[i].id.slice(0, 7)}/${shown[j].id.slice(0, 7)}`);
    const outside = shown.filter(r => r.x < 0 || r.y < 0 || r.x + r.w > VIEW.w + 0.5 || r.y + r.h > VIEW.h + 0.5);
    check(`02-labels-n${n}`, wrong.length === 0 && mainRects.every(r => r.shown) && clash.length === 0 && outside.length === 0,
      `${mainRects.length}/${mains.length} main labels shown with the full chat name (wrong ${wrong.length}), longest name ${Math.max(...mains.map(a => (a.name || '').length))} chars, ${shown.length} labels shown, overlapping pairs ${clash.length}${clash[0] ? ' (' + clash.slice(0, 3).join(' ') + ')' : ''}, outside the view ${outside.length}`);

    // 3 and 5. click targets and hit-test round trip
    const ids = await S.page.evaluate(px('p.figures()'));
    const probs = [], miss = [], hidden = [];
    const base = await S.page.evaluate(`document.querySelector('#view-ofis').getBoundingClientRect().toJSON()`);
    const free = (x, y) => S.page.evaluate(`(()=>{const e=document.elementFromPoint(${x},${y}); return !!e && !e.closest('.px-l, .of-ctl, .of-hud, #drawer, header, #attention')})()`);
    // close the drawer and wait until it has slid out of the view, so it never covers the next agent
    const closeDrawer = async () => {
      await S.page.evaluate(`document.querySelector('#scrim').click()`);
      for (let k = 0; k < 40; k++) {
        if (await S.page.evaluate(`document.querySelector('#drawer').getBoundingClientRect().left >= innerWidth - 1`)) return;
        await sleep(50);
      }
    };
    await S.page.evaluate(px('p.freeze(true)'));        // labels and figures stay where they are while the clicks run
    for (const id of ids) {
      const c = await S.page.evaluate(px(`p.agentCss(${JSON.stringify(id)})`));
      const clickAt = async (dx, dy) => {
        await closeDrawer();
        await S.page.mouse.click(base.left + c.x + dx, base.top + c.y + dy);
        await sleep(60);
        return S.page.evaluate(`(()=>{const d=document.querySelector('#drawer'); return d.classList.contains('on') ? d.dataset.id : null})()`);
      };
      // the agent has to be visible: some point on it must not sit under a label or a control
      await closeDrawer();
      let spot = null;
      for (const [dx, dy] of [[0, 0], [0, 6], [0, -6], [3, 0], [-3, 0], [0, 12], [0, -12]]) if (await free(base.left + c.x + dx, base.top + c.y + dy)) { spot = [dx, dy]; break; }
      if (!spot) { hidden.push(id.slice(-12)); continue; }
      const center = await clickAt(spot[0], spot[1]);
      if (center !== id) miss.push(`${id.slice(-12)}→${center ? center.slice(-12) : 'nothing'}`);
      for (const [dx, dy] of [[-11, 0], [11, 0], [0, -11], [0, 11]]) {
        await closeDrawer();                                                               // the scrim of an open drawer would hide a label
        if (!(await free(base.left + c.x + dx, base.top + c.y + dy))) continue;           // covered by a label: that part is not clickable by design
        const got = await clickAt(dx, dy);
        if (got !== id) { probs.push(`${id.slice(-12)} at ${dx},${dy} → ${got ? got.slice(-12) : 'nothing'}`); break; }
      }
    }
    await closeDrawer();
    await S.page.evaluate(px('p.freeze(false)'));
    check(`03-targets-n${n}`, probs.length === 0 && hidden.length === 0, `${ids.length} agents, every uncovered click within 11 px of the centre (a 24 x 24 px target) opens that agent: ${probs.length ? 'misses ' + probs.slice(0, 4).join('; ') : 'all'}${hidden.length ? '; agents with no uncovered point: ' + hidden.join(',') : ''}`);
    check(`05-hit-n${n}`, miss.length === 0, `clicking a visible point at the centre of ${ids.length - hidden.length} agents opened the right drawer for ${ids.length - hidden.length - miss.length}${miss.length ? ' (misses: ' + miss.slice(0, 4).join('; ') + ')' : ''}`);

    // 4. occlusion
    const occ = await S.page.evaluate(px(`p.figures().map(id => [id, p.occlusion(id)])`));
    const worst = occ.reduce((b, x) => (x[1] > b[1] ? x : b), ['-', 0]);
    check(`04-occlusion-n${n}`, occ.every(x => x[1] <= 0.15), `${occ.length} agents, worst ${(worst[1] * 100).toFixed(1)} percent covered (${worst[0].slice(0, 12)}), mean ${(occ.reduce((s, x) => s + x[1], 0) / occ.length * 100).toFixed(1)} percent, limit 15`);

    if (shotsDir) {
      mkdirSync(shotsDir, { recursive: true });
      await S.page.setViewport(VIEW.w, VIEW.h, 2);
      await S.page.mouse.move(2, 2);                        // no hover tip or ring in the picture
      await sleep(1200);
      await S.page.screenshot(join(shotsDir, `m1-${proj}-n${n}.png`));
      await S.page.setViewport(VIEW.w, VIEW.h, 1);
    }
  } finally {
    if (n !== 20) { await S.done(); delete perN[n]; }
  }
}

// ---- 6. frame budget at N = 20 (the page of the last scenario is still open)
if (perN[20]) {
  const S = perN[20];
  try {
    const p = S.page;
    await p.evaluate(px('p.resetStats()'));
    await sleep(10000);
    const st = await p.evaluate(px('({stats: p.stats, p95: p.frameP95(), frames: p.frames, buildMs: p.buildMs, active: p.active, zoom: p.zoom})'));
    const fps = st.stats.frames / 10;
    // hidden: stub the visibility state and count scheduler callbacks
    await p.evaluate(`Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); document.dispatchEvent(new Event('visibilitychange'))`);
    await sleep(600);
    await p.evaluate(px('p.resetStats()'));
    await sleep(2500);
    const hid = await p.evaluate(px('p.stats'));
    await p.evaluate(`delete document.hidden; document.dispatchEvent(new Event('visibilitychange'))`);
    const rebuilds = [];
    for (let k = 0; k < 3; k++) rebuilds.push(await p.evaluate(px('p.rebuild()')));
    check('06-frame-budget', fps <= 10.5 && st.p95 <= 4 && hid.callbacks === 0 && hid.frames === 0,
      `N=20 at ${VIEW.w}x${VIEW.h}, 10 s: ${fps.toFixed(1)} frames per second (limit 10), p95 JavaScript time per dynamic frame ${st.p95} ms over ${st.frames} frames (limit 4), animation sources ${JSON.stringify(st.active)}, callbacks while hidden ${hid.callbacks}, frames while hidden ${hid.frames}; JavaScript time only (headless Chrome, software canvas)`);
    const warm = Math.min(...rebuilds);
    check('06-static-rebuild', warm <= 50, `layout and static layer of 20 rooms rebuilt in ${warm} ms warm (limit 50; first build ${st.buildMs} ms cold, repeated rebuilds ${rebuilds.join(', ')} ms)`);
  } finally { await S.done(); delete perN[20]; }
}

// ---- ux: status states, hover tip, zoom, pan and fit (the scene features of Goal 1)
if (want('ux')) {
  const S = await scenario(10, { tag: 'ux' });
  try {
    const P = e => S.page.evaluate(px(e));
    const mains = S.agents.filter(a => a.kind === 'main');
    const base = await S.page.evaluate(`document.querySelector('#view-ofis').getBoundingClientRect().toJSON()`);
    // states: the pose of every main figure matches its status, and the effects drawn match the states
    await P('p.redraw()');
    const figs = await P(`p.figures().map(id => Object.assign({ id }, p.agentCss(id)))`);
    const pose = f => f.sprite.replace(/^worker_\d+_/, '');
    const want_ = { working: /^type[AB]$/, waiting: /^wait$/, ask: /^wait$/, dormant: /^sleep$/ };
    const mf = figs.filter(f => f.main), wrongPose = mf.filter(f => want_[f.status] && !want_[f.status].test(pose(f)));
    const n = st => mf.filter(f => f.status === st).length, waitN = n('waiting') + n('ask');
    const fx = await P('p.effects');
    const chips = await S.page.evaluate(`document.querySelectorAll('.px-l.px-main.waiting .of-chip.w, .px-l.px-main.ask .of-chip.w').length`);
    const hud = await S.page.evaluate(`document.querySelector('#view-ofis .of-sum .w') ? document.querySelector('#view-ofis .of-sum .w').textContent : ''`);
    // done: a working subagent finishes, shows the relaxed pose with a check balloon, then leaves its seat
    const sub = S.fx.agents.find(a => a.subs.some(x => x.status === 'working')).subs.find(x => x.status === 'working');
    S.fx.finishSub(sub.id);
    let done = null, t0 = Date.now();
    while (Date.now() - t0 < 25000 && !done) {
      const f = await P(`(() => { const c = p.agentCss(${JSON.stringify(sub.id)}); if (!c) return null; p.redraw(); return Object.assign({}, c, { fx: p.effects }); })()`);
      if (f && f.status === 'done') done = f; else await sleep(300);
    }
    let left = false, tDone = Date.now();
    while (done && Date.now() - tDone < 12000 && !left) { left = !(await P(`p.figures().includes(${JSON.stringify(sub.id)})`)); if (!left) await sleep(300); }
    check('ux-states', S.ready && mf.length === mains.length && wrongPose.length === 0 && n('working') > 0 && waitN > 0 && n('dormant') > 0 &&
      fx.markers === mf.length && fx.beams === waitN && fx.waitBalloons === waitN && fx.zzBalloons === n('dormant') && chips === waitN && !!hud &&
      !!done && /relax$/.test(done.sprite) && done.fx.doneBalloons >= 1 && left,
      `${mf.length} main figures: ${n('working')} working (typing poses), ${waitN} waiting for you (raised-hand pose, ${chips} "your turn" chips, summary "${hud}"), ${n('dormant')} dormant (sleeping pose); drawn: ${fx.markers} markers, ${fx.beams} light beams, ${fx.waitBalloons} wait balloons, ${fx.zzBalloons} Zz balloons; wrong poses ${wrongPose.length}; ` +
      `done subagent: ${done ? `pose ${pose(done)}, check balloons drawn ${done.fx.doneBalloons}, left its seat after ${((Date.now() - tDone) / 1000).toFixed(1)} s: ${left}` : 'never reached the done state'}`);

    // hover tip: over an uncovered agent the tip shows its project and name and the figure gets a ring; away from it the tip goes
    const pf = await P(`p.figures().filter(id => p.agentCss(id).main).map(id => Object.assign({ id }, p.agentCss(id)))`);
    let tipOk = false, tipText = '', ring = 0, hoverId = null;
    for (const f of pf) {
      const x = base.left + f.x, y = base.top + f.y;
      if (!(await S.page.evaluate(`(()=>{const e=document.elementFromPoint(${x},${y}); return !!e && !e.closest('.px-l, .of-ctl, #drawer, header, #attention')})()`))) continue;
      await S.page.mouse.move(x, y);
      await sleep(250);
      tipText = await S.page.evaluate(`document.querySelector('#tip').classList.contains('on') ? document.querySelector('#tip').textContent : ''`);
      const a = mains.find(m => m.id === f.id);
      ring = (await P('(p.redraw(), p.effects)')).rings;
      hoverId = f.id;
      tipOk = !!a && tipText.includes(a.project) && tipText.includes(a.name || a.title || '') && ring === 1;
      break;
    }
    await S.page.mouse.move(base.left + 40, base.top + 400);
    await sleep(250);
    const tipGone = await S.page.evaluate(`!document.querySelector('#tip').classList.contains('on')`);
    check('ux-hover-tip', tipOk && tipGone, `hovering ${hoverId ? hoverId.slice(0, 11) : 'nothing'}: tip shown with project and full name ${tipOk}, hover ring drawn ${ring}, tip hidden after moving away ${tipGone}; tip text "${tipText.slice(0, 80).replace(/\s+/g, ' ')}"`);

    // zoom buttons, wheel, drag pan, fit
    const btn = async z => { const r = await S.page.evaluate(`(()=>{const b=document.querySelector('#view-ofis .of-ctl button[data-z="${z}"]'); const r=b.getBoundingClientRect(); return {x:r.left+r.width/2,y:r.top+r.height/2}})()`); await S.page.mouse.click(r.x, r.y); await sleep(250); return P('p.zoom'); };
    const z0 = await P('p.zoom'), steps = [];
    steps.push(await btn('in'), await btn('in'));
    const rectsZ3 = await P('p.labelRects()');
    // at this zoom part of the island is out of view: every main agent that is in view must have its label
    const inView = await P(`p.figures().filter(id => { const c = p.agentCss(id); return c.main && c.x > 0 && c.y > 0 && c.x < p.size[0] / p.dpr && c.y < p.size[1] / p.dpr; })`);
    const subLabels = rectsZ3.filter(r => !r.main && r.shown).length, mainShown = inView.filter(id => rectsZ3.find(r => r.id === id && r.shown)).length;
    const clashZ3 = [], shownZ3 = rectsZ3.filter(r => r.shown);
    for (let i = 0; i < shownZ3.length; i++) for (let j = i + 1; j < shownZ3.length; j++) if (overlap(shownZ3[i], shownZ3[j])) clashZ3.push(1);
    steps.push(await btn('out'));
    const pan0 = await P('p.pan');
    await S.page.mouse.drag(base.left + 40, base.top + 420, base.left + 120, base.top + 450);
    await sleep(250);
    const pan1 = await P('p.pan'), afterDrag = await P('p.autoFit');
    const wz = await (async () => { await S.page.mouse.wheel(base.left + 700, base.top + 400, -120); await sleep(250); return P('p.zoom'); })();
    const fitZ = await btn('fit'), fitAuto = await P('p.autoFit'), panFit = await P('p.pan');
    check('ux-zoom-pan-fit', steps[0] > z0 && steps[1] > steps[0] && steps[2] < steps[1] && pan1[0] !== pan0[0] && !afterDrag && wz > steps[2] && fitZ === z0 && fitAuto && subLabels > 0 && mainShown === inView.length && inView.length > 0 && clashZ3.length === 0,
      `zoom ${z0} → in ${steps[0]} → in ${steps[1]} → out ${steps[2]}; at zoom ${steps[1]} ${mainShown}/${inView.length} main labels of the agents in view (${mains.length} in total) and ${subLabels} subagent labels shown, overlapping pairs ${clashZ3.length}; drag moved the pan from ${pan0.join(',')} to ${pan1.join(',')} (auto fit off ${!afterDrag}); wheel zoom ${wz}; fit button back to zoom ${fitZ} with auto fit ${fitAuto} (pan ${panFit.join(',')}), no console errors ${S.page.errors.length === 0}`);
  } finally { await S.done(); }
}

// ---- 7. idle: everything dormant, nothing animating, zero frames
if (want('idle')) {
  const S = await scenario(10, { tag: 'idle', fixture: { statuses: ['dormant'], subs: () => [] } });
  try {
    await S.page.evaluate(px('p.resetStats()'));
    await sleep(4000);
    const st = await S.page.evaluate(px('({stats: p.stats, active: p.active, pending: p.pending})'));
    check('07-idle', S.ready && st.stats.frames === 0 && st.stats.callbacks === 0 && !st.pending && st.active.length === 0,
      `10 dormant agents, 4 s: ${st.stats.frames / 4} frames per second, ${st.stats.callbacks} scheduler callbacks, animation sources ${JSON.stringify(st.active)}, loop pending ${st.pending}`);
  } finally { await S.done(); }
}

// ---- 8. ?scene=3d still renders the old scene
if (want('scene3d')) {
  const dir = join(tmpdir(), `cco-qa-${process.pid}-3d`);
  const fx = await makeFixture({ dir, n: 4 });
  const srv = await startServer(dir);
  const page = await launchChrome({ width: VIEW.w, height: VIEW.h });
  try {
    await page.goto(`http://127.0.0.1:${srv.port}/?scene=3d#ofis`, 6000);
    // the old scene probes the optional git-ignored file local/ofis-extras.js and expects a 404 when it is absent (public/js/ofis.js)
    const optional = /\/local\/ofis-extras\.js/;
    const errs3d = page.errors.filter(e => !optional.test(e)), failed3d = page.failed.filter(e => !optional.test(e));
    const probe404 = page.errors.length + page.failed.length - errs3d.length - failed3d.length;
    const info = await page.evaluate(`(()=>{const r=document.querySelector('#view-ofis'); return JSON.stringify({scene:r.dataset.scene, canvas: !!r.querySelector('.of-stage canvas'), rooms: r.__ofis ? r.__ofis.rooms.length : -1, chars: r.__ofis ? r.__ofis.chars : -1, error: r.dataset.hata || null, three: performance.getEntriesByType('resource').some(e => /three\\.module/.test(e.name))})})()`);
    const i = JSON.parse(info);
    const pixelRes = await (async () => { await page.goto(`http://127.0.0.1:${srv.port}/#ofis`, 2500); return page.requests.some(u => /three\.module/.test(u)); })();
    check('08-scene-3d', i.scene === '3d' && i.canvas && i.rooms === 4 && !i.error && i.three && errs3d.length === 0 && failed3d.length === 0 && !pixelRes,
      `?scene=3d: scene ${i.scene}, canvas ${i.canvas}, ${i.rooms} rooms, ${i.chars} figures, error ${i.error}, three.js loaded ${i.three}, console errors ${errs3d.length}${errs3d[0] ? ' first: ' + errs3d[0].slice(0, 160) : ''}, failed requests ${failed3d.length} (not counted: ${probe404} 404 of the old scene's optional local/ofis-extras.js probe); the default pixel scene loads three.js: ${pixelRes}`);
  } finally { await page.close(); srv.stop(); fx.cleanup(); }
}

const failed = results.filter(r => !r.ok);
console.log(failed.length ? `QA FAIL (${failed.length} of ${results.length} checks failed: ${failed.map(f => f.name).join(', ')})` : `QA PASS (${results.length} checks)`);
process.exit(failed.length ? 1 : 0);
