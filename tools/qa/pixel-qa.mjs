// QA harness of the pixel scene (docs/pixel-scene-plan.md section 7). Starts the server against a fake ~/.claude (fixture.mjs), drives
// headless Chrome through the DevTools protocol in a throw-away profile, and prints one `CHECK <name> PASS|FAIL <detail>` line per check
// and a final `QA PASS` or `QA FAIL`.
//   node tools/qa/pixel-qa.mjs [--proj iso] [--shots <dir>] [--only <name>]
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome, sleep } from './cdp.mjs';
import { makeFixture } from './fixture.mjs';
import { ROOT, VIEW, startServer, px, waitReady, scenario as baseScenario } from './harness.mjs';
import { countRows } from '../sprites/content-minimums.mjs';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const val = f => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : undefined; };
const proj = val('proj') || 'iso';
const shotsDir = val('shots');
const shotSet = val('set') || 'm3';          // which pictures --shots writes: m3 (both projections at 4, 10, 20 agents, a waiting agent) or m2 (garden, room, times)
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`CHECK ${name} ${ok ? 'PASS' : 'FAIL'} ${detail}`);
}
// every scenario of this run uses the projection under test
const scenario = (n, o = {}) => baseScenario(n, { proj, ...o });
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
const NIGHT = '?time=22:00';              // the worst case for drawing: tint, glows, stars and every light on

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
  // the content lists of plan section 5 (counting rule in the plan) and the rule that only small items animate
  const rows = countRows(man), unmet = rows.filter(r => !r.met);
  const P = man.projections[proj].sprites, big = Object.entries(man.sprites).filter(([id, s]) => (s.tags.includes('sway') || s.tags.includes('steam')) && P[id].rects.some(([, , w, h]) => w > 36 || h > 48));
  check('09-content-minimums', unmet.length === 0 && big.length === 0, `${rows.length} rows of the section 5 table, met ${rows.length - unmet.length}${unmet.length ? ' (unmet: ' + unmet.map(r => `${r.row} ${r.actual}/${r.min}`).join('; ') + ')' : ''}; animated sprites (sway, steam) larger than 36 x 48 px: ${big.length ? big.map(b => b[0]).join(',') : 'none'}`);
}

// ---- 1 to 5 at N = 4, 10, 20
const SIZES = [4, 10, 20];
const perN = {};
for (const n of SIZES) {
  if (!['load', 'labels', 'targets', 'occlusion', 'hit'].some(want) && only) continue;
  const S = await scenario(n, { query: NIGHT });
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
    // the longest names (120 characters) wrap into at most 5 lines inside their label, and no label box is cut or crosses another
    const longest = Math.max(...mains.map(a => (a.name || '').length)), longRects = mainRects.filter(r => r.name && r.name.length >= 100), maxLines = Math.max(0, ...mainRects.map(r => r.lines));
    check(`02-labels-n${n}`, wrong.length === 0 && mainRects.every(r => r.shown) && clash.length === 0 && outside.length === 0 && maxLines <= 5 && (n < 10 || (longRects.length > 0 && Math.max(...longRects.map(r => r.lines)) === 5)),
      `${mainRects.length}/${mains.length} main labels shown with the full chat name (wrong ${wrong.length}), longest name ${longest} chars${longRects.length ? `, ${longRects.length} names of 100 chars or more fill ${longRects.map(r => r.lines).join('/')} lines` : ''}, most lines in any label ${maxLines} (limit 5), ${shown.length} labels shown, overlapping pairs ${clash.length}${clash[0] ? ' (' + clash.slice(0, 3).join(' ') + ')' : ''}, outside the view ${outside.length}`);

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
  } finally {
    if (n !== 20) { await S.done(); delete perN[n]; }
  }
}

// ---- 6. frame budget at N = 20 (the page of the last scenario is still open, at 22:00: the worst case), ambient animation, re-tint cost
if (perN[20]) {
  const S = perN[20];
  try {
    const p = S.page, P = e => p.evaluate(px(e));
    const sample = async seconds => {
      await P('p.resetStats()');
      await sleep(seconds * 1000);
      const st = await P('({stats: p.stats, p95: p.frameP95(), frames: p.frames, buildMs: p.buildMs, active: p.active, fx: p.effects, clock: p.time.clock, rate: p.frameRate()})');
      return { ...st, fps: st.rate.fps };
    };
    const night = await sample(10);
    // hidden: stub the visibility state and count scheduler callbacks
    await p.evaluate(`Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); document.dispatchEvent(new Event('visibilitychange'))`);
    await sleep(600);
    await P('p.resetStats()');
    await sleep(2500);
    const hid = await P('p.stats');
    await p.evaluate(`delete document.hidden; document.dispatchEvent(new Event('visibilitychange'))`);
    await P('p.setTime(720)');
    await sleep(600);
    const noon = await sample(6);
    const rebuilds = [];
    for (let k = 0; k < 3; k++) rebuilds.push(await P('p.rebuild()'));
    const frameOk = s => s.fps <= 10.1 && s.p95 <= 4;
    check('06-frame-budget', frameOk(night) && frameOk(noon) && hid.callbacks === 0 && hid.frames === 0,
      `N=20 at ${VIEW.w}x${VIEW.h}: at ${night.clock} (10 s, ${night.rate.frames} frames) ${night.fps.toFixed(2)} frames per second (limit 10), p95 JavaScript time per dynamic frame ${night.p95} ms (limit 4); at ${noon.clock} (6 s, ${noon.rate.frames} frames) ${noon.fps.toFixed(2)} frames per second, p95 ${noon.p95} ms; frame rate = frames after the first divided by the time from the first to the last; animation sources ${JSON.stringify(night.active)}, callbacks while hidden ${hid.callbacks}, frames while hidden ${hid.frames}; JavaScript time only (headless Chrome, software canvas)`);
    const warm = Math.min(...rebuilds);
    check('06-static-rebuild', warm <= 50, `layout and static layer of 20 rooms rebuilt in ${warm} ms warm (limit 50; first build ${night.buildMs} ms cold, repeated rebuilds ${rebuilds.join(', ')} ms)`);
    // ambient animation: only small things move, through the one scheduler; nothing at all in the picture is animated beyond these counts
    const nf = night.fx, df = noon.fx;
    check('06-ambient', df.steam > 0 && df.swayed > 0 && df.butterflies >= 1 && df.butterflies <= 4 && df.birds >= 1 && df.birds <= 2 && nf.butterflies === 0 && nf.birds === 0 && nf.steam > 0 && Object.keys(nf.lights).length >= 3 && night.active.includes('ambient'),
      `N=20 at noon: ${df.steam} steam plumes, ${df.swayed} plants and trees swaying, ${df.butterflies} butterflies (limit 4), ${df.birds} birds (limit 2); at night ${nf.butterflies} butterflies, ${nf.birds} birds, ${nf.steam} steam plumes, monitor flicker over ${nf.lights.monitor || 0} monitors; every moving sprite is at most 36 x 48 px (check 09); sources ${JSON.stringify(night.active)}; frame rate and hidden behaviour in check 06-frame-budget`);

    // 11 (cost). Re-tint: a new time of day costs one re-tint, never more than one per minute, nothing on pan, zoom and redraws.
    // Sweep the evening, when the light changes every minute, and take the largest JavaScript time of the re-tint plus
    // the first frame after it (which makes the shaded copies of the garden sprites again)
    const month = (await P('p.time')).month;
    const costs = [], r0 = await P('p.retints');
    for (let m = 15 * 60 + 30; m <= 18 * 60 + 40; m++) {
      await P(`p.setTime(${m})`);
      await sleep(70);
      costs.push(await P('p.retintCost'));
    }
    const r1 = await P('p.retints');
    const last = 18 * 60 + 40;
    const again = await P(`p.setTime(${last}, false).retinted`);
    const r2 = await P('p.retints');
    for (const z of [2, 3, 2, 1]) { await P(`p.setZoom(${z})`); await sleep(60); }
    await P('p.fit()'); await P('p.redraw()');
    await sleep(200);
    const r3 = await P('p.retints');
    const tot = costs.map(c => c.totalMs), maxTot = Math.max(...tot), mean = tot.reduce((a, b) => a + b, 0) / tot.length, maxRetint = Math.max(...costs.map(c => c.retintMs)), maxFrame = Math.max(...costs.map(c => c.firstFrameMs));
    check('11-retint-cost', maxTot <= 15 && r1 - r0 === costs.length && !again && r2 === r1 && r3 === r2,
      `N=20 at fit, month ${month}, ${costs.length} consecutive minutes 15:30 to 18:40: ${r1 - r0} re-tints (one per minute), JavaScript time of a re-tint plus the first frame after it: largest ${maxTot.toFixed(2)} ms, mean ${mean.toFixed(2)} ms (limit 15; re-tint alone at most ${maxRetint.toFixed(2)} ms, first frame at most ${maxFrame.toFixed(2)} ms); the same minute again re-tints ${again ? 'again' : 'nothing'}; zoom, pan and redraws re-tint nothing (${r3 - r2}); JavaScript time only`);
  } finally { await S.done(); delete perN[20]; }
}

// ---- ux: status states, hover tip, zoom, pan and fit (the scene features of Goal 1)
if (want('ux')) {
  const S = await scenario(10, { tag: 'ux', query: '?time=12:00' });
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
  const S = await scenario(10, { tag: 'idle', query: NIGHT, fixture: { statuses: ['dormant'], subs: () => [] } });
  try {
    await S.page.evaluate(px('p.resetStats()'));
    await sleep(4000);
    const st = await S.page.evaluate(px('({stats: p.stats, active: p.active, pending: p.pending})'));
    check('07-idle', S.ready && st.stats.frames === 0 && st.stats.callbacks === 0 && !st.pending && st.active.length === 0,
      `10 dormant agents at 22:00 (fixed time, so no minute ticker), 4 s: ${st.stats.frames / 4} frames per second, ${st.stats.callbacks} scheduler callbacks, animation sources ${JSON.stringify(st.active)}, loop pending ${st.pending}`);
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

// ---- 11. time of day: six required times plus every hour; luminance floor, lights, sky, labels, errors
const hhmm = min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
if (want('time')) {
  const S = await scenario(10, { tag: 'time', query: '?time=12:00' });
  try {
    const P = e => S.page.evaluate(px(e));
    const start = await P('p.time');
    const ids = await P('p.figures()');
    const labelStyle = () => S.page.evaluate(`(() => { const n = document.querySelector('.px-l.px-main .px-name'), b = n.closest('.px-l'); return getComputedStyle(n).color + ' on ' + getComputedStyle(b).backgroundColor; })()`);
    const lumOf = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    const at = async min => {
      const e0 = S.page.errors.length;
      await P(`p.setTime(${min})`);
      await sleep(350);                                                      // the frame the scheduler draws for it
      const fx = await P('p.effects'), amb = await P('p.ambient');
      return { min, phase: amb.phase, lightsK: amb.lights, fx, lum: await P('p.agentLuminances()'), skyTop: await P('p.skyAt(0.05)'), skyLow: await P('p.skyAt(0.9)'), label: await labelStyle(), errors: S.page.errors.length - e0, figures: (await P('p.figures().length')) };
    };
    const noon = await at(720);
    const REQUIRED = ['06:00', '09:00', '12:00', '18:30', '22:00', '02:00'].map(t => +t.slice(0, 2) * 60 + +t.slice(3));
    const order = [...new Set([...REQUIRED, ...Array.from({ length: 24 }, (_, h) => h * 60)])].sort((a, b) => a - b);
    const rows = [];
    for (const min of order) rows.push(await at(min));
    const ratio = r => ids.map(id => (r.lum[id] && noon.lum[id] ? r.lum[id].lum / noon.lum[id].lum : NaN));
    const worst = rows.map(r => ({ r, min: Math.min(...ratio(r)), mean: ratio(r).reduce((a, b) => a + b, 0) / ids.length }));
    const lowest = worst.reduce((b, w) => (w.min < b.min ? w : b), worst[0]);
    const lowRows = worst.filter(w => !(w.min >= 0.6));
    const dark = rows.filter(r => r.phase === 'dusk' || r.phase === 'night'), unlit = dark.filter(r => !(r.fx.lights.window > 0 && r.fx.lights.lamp > 0 && r.fx.lights.monitor > 0));
    const day = rows.filter(r => r.phase === 'day'), lit = day.filter(r => Object.keys(r.fx.lights).length);
    const skies = new Set(rows.filter(r => REQUIRED.includes(r.min)).map(r => r.skyTop.join(',')));
    const nightSky = rows.find(r => r.min === 22 * 60), sameLabel = rows.every(r => r.label === noon.label), noErr = rows.every(r => r.errors === 0 && r.figures === ids.length);
    const req = worst.filter(w => REQUIRED.includes(w.r.min)).map(w => `${hhmm(w.r.min)} ${w.r.phase}: lowest ${w.min.toFixed(2)}, mean ${w.mean.toFixed(2)}, lit ${['window', 'lamp', 'monitor'].map(k => `${k} ${w.r.fx.lights[k] || 0}`).join(' ')}`);
    check('11-time', start.fixed && start.clock === '12:00' && lowRows.length === 0 && unlit.length === 0 && lit.length === 0 && skies.size >= 4 && lumOf(nightSky.skyTop) < 0.35 * lumOf(noon.skyTop) && sameLabel && noErr,
      `${ids.length} agents, month ${start.month}; luminance of every agent's silhouette as a share of its noon value, at ${order.length} times (the six required and every hour): lowest of all ${lowest.min.toFixed(2)} at ${hhmm(lowest.r.min)} (floor 0.60), times below the floor ${lowRows.length}; ` +
      `${req.join('; ')}; after dark (${dark.length} of those times) windows, lamps and monitors all lit at ${dark.length - unlit.length}; in daylight (${day.length} times) lights drawn at ${lit.length}; sky colour at the top at the six times: ${skies.size} different values (day and night each keep one colour for hours), 22:00 sky is ${(lumOf(nightSky.skyTop) / lumOf(noon.skyTop) * 100).toFixed(0)} percent as bright as noon; label colours identical at every time: ${sameLabel} (${noon.label}); errors ${S.page.errors.length}; ?time=12:00 start: fixed ${start.fixed}, ticker ${start.ticking}`);
  } finally { await S.done(); }

  // the clock is the browser's local clock: two emulated time zones show their own hour, and nothing re-tints except at a minute boundary
  const minutesIn = tz => { const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(x => [x.type, x.value])); return +parts.hour * 60 + +parts.minute; };
  const dist = (a, b) => Math.min((a - b + 1440) % 1440, (b - a + 1440) % 1440);
  const got = [];
  for (const tz of ['Pacific/Auckland', 'America/Los_Angeles']) {
    const T = await scenario(1, { tag: 'tz', timezone: tz });
    try {
      const t = await T.page.evaluate(px('p.time')), local = await T.page.evaluate('(() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })()');
      const w0 = await T.page.evaluate(px('p.retints')); await sleep(3000); const w1 = await T.page.evaluate(px('p.retints'));
      got.push({ tz, shown: t.minute, local, expect: minutesIn(tz), fixed: t.fixed, ticking: t.ticking, retints: w1 - w0, errors: T.page.errors.length });
    } finally { await T.done(); }
  }
  check('11-time-clock', got.every(g => !g.fixed && g.ticking && dist(g.shown, g.local) <= 2 && dist(g.shown, g.expect) <= 3 && g.retints <= 1 && g.errors === 0) && dist(got[0].shown, got[1].shown) > 60,
    `without ?time= the scene shows the browser's local clock: ${got.map(g => `${g.tz} ${hhmm(g.shown)} (page clock ${hhmm(g.local)}, expected ${hhmm(g.expect)}, ticker on ${g.ticking}, re-tints in 3 s ${g.retints})`).join('; ')}; the two zones differ by ${dist(got[0].shown, got[1].shown)} minutes`);
}

// ---- gallery: ?gallery=1 lists every sprite id
if (want('gallery')) {
  const S = await scenario(1, { tag: 'gal', query: '?gallery=1' });
  try {
    await S.page.evaluate(`new Promise(r => { const t0 = Date.now(); (function w() { if (document.querySelector('.gal[data-ready]') || Date.now() - t0 > 15000) r(); else setTimeout(w, 100); })(); })`);
    const ids = Object.keys(JSON.parse(readFileSync(ROOT + 'public/pixel/manifest.json', 'utf8')).sprites);
    const info = await S.page.evaluate(`(() => {
      const g = document.querySelector('.gal'), cards = [...g.querySelectorAll('.gal-card')], el = document.querySelector('#gal-count');
      const blank = cards.filter(c => { const cv = c.querySelector('canvas'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return false; return true; }).map(c => c.dataset.id);
      return { ready: !!g.dataset.ready, shown: +el.dataset.count, text: el.textContent, cards: cards.length, ids: cards.map(c => c.dataset.id), blank };
    })()`);
    const have = new Set(info.ids), missing = ids.filter(id => !have.has(id)), extra = info.ids.filter(id => !ids.includes(id));
    check('gallery', info.ready && info.shown === ids.length && info.cards === ids.length && !missing.length && !extra.length && !info.blank.length && S.page.errors.length === 0,
      `?gallery=1 shows "${info.text}" (number on the page ${info.shown}, cards ${info.cards}); manifest count ${ids.length}; sprite ids missing from the page ${missing.length}, unknown on the page ${extra.length}, blank images ${info.blank.length}${info.blank[0] ? ' (' + info.blank.slice(0, 3).join(',') + ')' : ''}, console errors ${S.page.errors.length}`);
  } finally { await S.done(); }
}

// ---- projection toggle: header buttons, ?proj=, and the choice persists across a reload
if (want('projection')) {
  const S = await baseScenario(4, { tag: 'projtoggle', query: '?time=12:00' });                  // no ?proj= and a fresh profile: nothing stored yet
  try {
    const P = e => S.page.evaluate(px(e));
    const base = `http://127.0.0.1:${S.srv.port}/`;
    const state = async () => S.page.evaluate(`(() => { const p = document.querySelector('#view-ofis').__pixel, seg = document.querySelector('#proj-seg'); return JSON.stringify({ proj: p.proj, attr: document.querySelector('#view-ofis').dataset.proj, shown: !seg.hidden, pressed: [...seg.querySelectorAll('button')].filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.proj), stored: localStorage.getItem('ajan-ofisi.proj'), figures: p.figures().length, westWall: p.layout ? p.layout.rooms[0].walls.west : null, url: location.search }); })()`).then(JSON.parse);
    const settle = async want_ => { for (let k = 0; k < 60; k++) { const st = await state().catch(() => null); if (st && st.proj === want_ && st.figures > 0) { await sleep(300); return state(); } await sleep(150); } return state(); };
    const load = async query => { await S.page.goto(base + query + '#ofis', 800); await waitReady(S.page, 4); return state(); };
    const click = async which => { const r = await S.page.evaluate(`(() => { const b = document.querySelector('#proj-seg button[data-proj="${which}"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`); await S.page.mouse.click(r.x, r.y); };
    const s0 = await state();
    await click('front');
    const s1 = await settle('front');
    const drawn = await P('(p.redraw(), p.counts.entries)');
    const s2 = await load('');                                                                   // reload without ?proj=: the stored choice
    const s3 = await load('?proj=iso');                                                          // a URL override wins and is not stored
    const s4 = await load('?proj=front');
    await click('iso');
    const s5 = await settle('iso');
    const s6 = await load('');
    const s7 = await load('?proj=front&time=12:00');
    const errs = S.page.errors.length;
    check('ux-projection', s0.proj === 'iso' && s0.shown && s0.pressed.join() === 'iso' && s0.westWall === 'tall' &&
      s1.proj === 'front' && s1.attr === 'front' && s1.pressed.join() === 'front' && s1.stored === 'front' && s1.westWall === 'low' && s1.figures === s0.figures && drawn > 0 &&
      s2.proj === 'front' && s2.pressed.join() === 'front' &&
      s3.proj === 'iso' && s3.stored === 'front' && s4.proj === 'front' && s4.stored === 'front' &&
      s5.proj === 'iso' && s5.stored === 'iso' && s6.proj === 'iso' && s6.pressed.join() === 'iso' &&
      s7.proj === 'front' && s7.stored === 'iso' && errs === 0,
      `fresh profile, no ?proj=: ${s0.proj} (toggle shown ${s0.shown}, pressed ${s0.pressed}, west wall ${s0.westWall}); click Front: ${s1.proj} (pressed ${s1.pressed}, stored "${s1.stored}", west wall ${s1.westWall}, ${s1.figures} figures, ${drawn} sprites drawn); reload with no ?proj=: ${s2.proj}; ?proj=iso: ${s3.proj} (stored stays "${s3.stored}"); ?proj=front: ${s4.proj}; click Isometric: ${s5.proj} (stored "${s5.stored}"); reload: ${s6.proj}; ?proj=front over stored iso: ${s7.proj} (stored "${s7.stored}"); console errors ${errs}`);
  } finally { await S.done(); }
}

// ---- pictures for the review folder (--shots <dir> [--set m3|m2])
if (shotsDir) {
  mkdirSync(shotsDir, { recursive: true });
  const snap = async (S, file) => { await S.page.mouse.move(2, 2); await sleep(900); await S.page.screenshot(join(shotsDir, file)); console.log('SHOT', file); };
  if (shotSet === 'm3') {
    // M3: this projection with 4, 10 and 20 agents at fit, and a waiting agent with its light at zoom 4 (dusk); the first run also takes the old 3D scene
    for (const n of [4, 10, 20]) {
      const S = await scenario(n, { tag: 'shots' + n, dpr: 2, query: '?time=12:00' });
      try {
        await snap(S, `m3-${proj}-n${n}.png`);
        if (n === 10) {
          const P = e => S.page.evaluate(px(e)), waiting = S.agents.find(a => a.kind === 'main' && (a.status === 'waiting' || a.status === 'ask'));
          await P('p.setTime(1110)');
          await P('p.setZoom(4)');
          await P(`(() => { const r = p.layout.rooms.find(q => q.id === ${JSON.stringify(waiting.id)}); return p.centerOnWorld(r.chiefPos.x, r.chiefPos.y, 16); })()`);
          await sleep(400);
          await snap(S, `m3-${proj}-waiting.png`);
        }
      } finally { await S.done(); }
    }
    if (proj === 'iso') {                                                                   // "before": the three.js scene this replaces, same 10 agents
      const dir = join(tmpdir(), `cco-qa-${process.pid}-before`);
      const fx = await makeFixture({ dir, n: 10 });
      const srv = await startServer(dir);
      const page = await launchChrome({ width: VIEW.w, height: VIEW.h, dpr: 2 });
      try {
        await page.goto(`http://127.0.0.1:${srv.port}/?scene=3d#ofis`, 9000);
        await page.mouse.move(2, 2);
        await sleep(1500);
        await page.screenshot(join(shotsDir, 'm3-before-3d-n10.png'));
        console.log('SHOT m3-before-3d-n10.png');
      } finally { await page.close(); srv.stop(); fx.cleanup(); }
    }
  } else {
    const S10 = await scenario(10, { tag: 'shots', dpr: 2, query: '?time=12:00' });
    try {
      const P = e => S10.page.evaluate(px(e));
      const mains = S10.agents.filter(a => a.kind === 'main'), waiting = mains.find(a => a.status === 'waiting' || a.status === 'ask');
      for (const [t, file] of [['06:00', 'm2-0600.png'], ['12:00', 'm2-1200.png'], ['18:30', 'm2-1830.png'], ['22:00', 'm2-2200.png']]) {
        await P(`p.setTime(${+t.slice(0, 2) * 60 + +t.slice(3)})`);
        await sleep(400);
        await snap(S10, file);
      }
      await P('p.setTime(720)');
      await P('p.setZoom(3)');
      await P(`p.centerOnRoom(${JSON.stringify(mains[2].id)})`);
      await sleep(400);
      await snap(S10, 'm2-room-zoom3.png');
      await P('p.setZoom(4)');
      await P('(() => { const b = p.layout.building; return p.centerOnWorld(b.x1 + 46, (b.y0 + b.y1) / 2 + 12, 6); })()');
      await sleep(400);
      await snap(S10, 'm2-garden.png');
      await P('p.setTime(1110)');
      await P('p.setZoom(4)');
      await P(`(() => { const r = p.layout.rooms.find(q => q.id === ${JSON.stringify(waiting.id)}); return p.centerOnWorld(r.chiefPos.x, r.chiefPos.y, 16); })()`);
      await sleep(400);
      await snap(S10, 'm2-waiting.png');
    } finally { await S10.done(); }
    const S20 = await scenario(20, { tag: 'shots20', dpr: 2, query: '?time=12:00' });
    try { await snap(S20, 'm2-n20-fit.png'); } finally { await S20.done(); }
  }
}

const failed = results.filter(r => !r.ok);
console.log(failed.length ? `QA FAIL (${failed.length} of ${results.length} checks failed: ${failed.map(f => f.name).join(', ')})` : `QA PASS (${results.length} checks)`);
process.exit(failed.length ? 1 : 0);
