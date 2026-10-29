// QA harness of the pixel scene (docs/pixel-scene-plan.md section 7). Starts the server against a fake ~/.claude (fixture.mjs), drives
// headless Chrome through the DevTools protocol in a throw-away profile, and prints one `CHECK <name> PASS|FAIL <detail>` line per check
// and a final `QA PASS` or `QA FAIL`.
//   node tools/qa/pixel-qa.mjs [--proj iso|front] [--season summer|spring|autumn|winter|auto] [--shots <dir>] [--set m4|m3|m2] [--only <name>]
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchChrome, sleep } from './cdp.mjs';
import { makeFixture } from './fixture.mjs';
import { ROOT, VIEW, startServer, px, waitReady, scenario as baseScenario } from './harness.mjs';
import { countRows } from '../sprites/content-minimums.mjs';
import { tmpdir } from 'node:os';
import { spriteFor, addDays } from '../../public/js/pixel/season.js';
import { weatherFor, rainbowFor } from '../../public/js/pixel/weather.js';
import { contactSheet } from './contact-sheet.mjs';
import { LANGUAGES } from '../../public/js/lang/index.js';

const args = process.argv.slice(2);
const val = f => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : undefined; };
const proj = val('proj') || 'iso';
const shotsDir = val('shots');
const shotSet = val('set') || 'm3';          // which pictures --shots writes: m5 (the shelf and the details panel), m4 (seasons, weather, times of day), m3 (4, 10, 20 agents, a waiting agent) or m2 (garden, room, times)
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`CHECK ${name} ${ok ? 'PASS' : 'FAIL'} ${detail}`);
}
// every scenario of this run uses the projection under test and one fixed season (the date the QA runs on must not matter; `--season auto` follows the date)
const season = val('season') || 'summer';
const scenario = (n, o = {}) => baseScenario(n, { proj, season, ...o });
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
    const mains = S.agents.filter(a => a.kind === 'main' && a.status !== 'dormant'), subs = S.agents.filter(a => a.kind === 'sub');      // an asleep chat has no room
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
    const base = await S.page.evaluate(`document.querySelector('#view-ofis .of-area').getBoundingClientRect().toJSON()`);
    const free = (x, y) => S.page.evaluate(`(()=>{const e=document.elementFromPoint(${x},${y}); return !!e && !e.closest('.px-l, .of-ctl, .of-hud, .of-card, header, #attention')})()`);
    // close the card, so it never covers the next agent
    const closeDrawer = async () => {
      await S.page.evaluate(`(document.querySelector('.of-card:not([hidden]) .oc-x') || { click() {} }).click()`);
      await S.page.evaluate(`document.querySelector('.of-card:not([hidden])') ? new Promise(r => setTimeout(r, 30)) : 0`);
    };
    await S.page.evaluate(px('p.freeze(true)'));        // labels and figures stay where they are while the clicks run
    for (const id of ids) {
      const c = await S.page.evaluate(px(`p.agentCss(${JSON.stringify(id)})`));
      const clickAt = async (dx, dy) => {
        await closeDrawer();
        await S.page.mouse.click(base.left + c.x + dx, base.top + c.y + dy);
        await sleep(60);
        return S.page.evaluate(`(()=>{const d=document.querySelector('.of-card'); return d && !d.hidden ? d.dataset.id : null})()`);
      };
      // the agent has to be visible: some point on it must not sit under a label or a control
      await closeDrawer();
      let spot = null;
      for (const [dx, dy] of [[0, 0], [0, 6], [0, -6], [3, 0], [-3, 0], [0, 12], [0, -12]]) if (await free(base.left + c.x + dx, base.top + c.y + dy)) { spot = [dx, dy]; break; }
      if (!spot) { hidden.push(id.slice(-12)); continue; }
      const center = await clickAt(spot[0], spot[1]);
      if (center !== id) miss.push(`${id.slice(-12)}→${center ? center.slice(-12) : 'nothing'}`);
      for (const [dx, dy] of [[-11, 0], [11, 0], [0, -11], [0, 11]]) {
        await closeDrawer();                                                               // an open card would hide a label
        if (!(await free(base.left + c.x + dx, base.top + c.y + dy))) continue;           // covered by a label: that part is not clickable by design
        const got = await clickAt(dx, dy);
        if (got !== id) { probs.push(`${id.slice(-12)} at ${dx},${dy} → ${got ? got.slice(-12) : 'nothing'}`); break; }
      }
    }
    await closeDrawer();
    await S.page.evaluate(px('p.freeze(false)'));
    check(`03-targets-n${n}`, probs.length === 0 && hidden.length === 0, `${ids.length} agents, every uncovered click within 11 px of the centre (a 24 x 24 px target) opens that agent: ${probs.length ? 'misses ' + probs.slice(0, 4).join('; ') : 'all'}${hidden.length ? '; agents with no uncovered point: ' + hidden.join(',') : ''}`);
    check(`05-hit-n${n}`, miss.length === 0, `clicking a visible point at the centre of ${ids.length - hidden.length} agents opened the right card for ${ids.length - hidden.length - miss.length}${miss.length ? ' (misses: ' + miss.slice(0, 4).join('; ') + ')' : ''}`);

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
    const mains = S.agents.filter(a => a.kind === 'main' && a.status !== 'dormant');
    const base = await S.page.evaluate(`document.querySelector('#view-ofis .of-area').getBoundingClientRect().toJSON()`);
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
      const f = await P(`(() => { const c = p.agentCss(${JSON.stringify(sub.id)}); if (!c) return null; p.redraw(); return Object.assign({}, c, { fx: p.effects, size: p.size, zoom: p.zoom, pan: p.pan }); })()`);
      if (f && f.status === 'done') done = f; else await sleep(300);
    }
    // `p.redraw()` only asks the scheduler for a frame (at most 10 a second), so the effects of the first sample that shows the state are the ones of the
    // frame before it: ask again and read on a later sample until the balloon is drawn (the figure stays at its seat for 4 s)
    for (let k = 0; done && k < 12 && !(done.fx.doneBalloons >= 1); k++) {
      await sleep(150);
      const g = await P(`(() => { const c = p.agentCss(${JSON.stringify(sub.id)}); if (!c) return null; p.redraw(); return Object.assign({}, c, { fx: p.effects, size: p.size, zoom: p.zoom, pan: p.pan }); })()`);
      if (g && g.status === 'done') done = g;
    }
    let left = false, tDone = Date.now();
    while (done && Date.now() - tDone < 12000 && !left) { left = !(await P(`p.figures().includes(${JSON.stringify(sub.id)})`)); if (!left) await sleep(300); }
    check('ux-states', S.ready && mf.length === mains.length && wrongPose.length === 0 && n('working') > 0 && waitN > 0 && n('dormant') === 0 &&
      fx.markers === mf.length && fx.beams === waitN && fx.waitBalloons === waitN && fx.zzBalloons === n('dormant') && chips === waitN && !!hud &&
      !!done && /relax$/.test(done.sprite) && done.fx.doneBalloons >= 1 && left,
      `${mf.length} main figures: ${n('working')} working (typing poses), ${waitN} waiting for you (raised-hand pose, ${chips} "your turn" chips, summary "${hud}"), ${n('dormant')} asleep in rooms (an asleep chat is on the shelf, check 15); drawn: ${fx.markers} markers, ${fx.beams} light beams, ${fx.waitBalloons} wait balloons, ${fx.zzBalloons} Zz balloons; wrong poses ${wrongPose.length}; ` +
      `done subagent: ${done ? `pose ${pose(done)}, check balloons drawn ${done.fx.doneBalloons} (its seat at ${Math.round(done.x)},${Math.round(done.y)} in a ${done.size.join(' x ')} view, zoom ${done.zoom}, pan ${done.pan.join(',')}), left its seat after ${((Date.now() - tDone) / 1000).toFixed(1)} s: ${left}` : 'never reached the done state'}`);

    // hover tip: over an uncovered agent the tip shows its project and name and the figure gets a ring; away from it the tip goes
    const pf = await P(`p.figures().filter(id => p.agentCss(id).main).map(id => Object.assign({ id }, p.agentCss(id)))`);
    let tipOk = false, tipText = '', ring = 0, hoverId = null;
    for (const f of pf) {
      const x = base.left + f.x, y = base.top + f.y;
      if (!(await S.page.evaluate(`(()=>{const e=document.elementFromPoint(${x},${y}); return !!e && !e.closest('.px-l, .of-ctl, .of-card, header, #attention')})()`))) continue;
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
    // the page is settled first: the last start-up message of the server (a late cost summary, say) may still draw one frame; wait until
    // 1.5 s pass without a frame, then measure the steady state
    let settled = 0;
    for (let k = 0; k < 40; k++) {
      await S.page.evaluate(px('p.resetStats()'));
      await sleep(1500);
      if ((await S.page.evaluate(px('p.stats.frames'))) === 0) break;
      settled++;
    }
    await S.page.evaluate(px('p.freeze(true), p.resetStats()'));                        // live data is frozen for the window: a server tick (every 10 to 30 s even when nothing changed) draws one frame on purpose
    await sleep(4000);
    const st = await S.page.evaluate(px('({stats: p.stats, active: p.active, pending: p.pending})'));
    check('07-idle', S.ready && st.stats.frames === 0 && st.stats.callbacks === 0 && !st.pending && st.active.length === 0,
      `10 dormant agents at 22:00 (fixed time, so no minute ticker; settled after ${settled} busy 1.5 s windows), 4 s: ${st.stats.frames / 4} frames per second, ${st.stats.callbacks} scheduler callbacks, animation sources ${JSON.stringify(st.active)}, loop pending ${st.pending}`);
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
      return { min, phase: amb.phase, lightsK: amb.lights, fx, lum: await P('p.agentLuminances()'), stage: await P('p.stageColour'), label: await labelStyle(), errors: S.page.errors.length - e0, figures: (await P('p.figures().length')) };
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
    const stageLum = r => lumOf((r.stage.match(/\d+/g) || [0, 0, 0]).slice(0, 3).map(Number));
    const stages = new Set(rows.filter(r => REQUIRED.includes(r.min)).map(r => r.stage));
    const noSky = await P("typeof p.skyAt === 'undefined' && !document.querySelector('.of-sky')");
    const nightStage = rows.find(r => r.min === 22 * 60), sameLabel = rows.every(r => r.label === noon.label), noErr = rows.every(r => r.errors === 0 && r.figures === ids.length);
    const req = worst.filter(w => REQUIRED.includes(w.r.min)).map(w => `${hhmm(w.r.min)} ${w.r.phase}: lowest ${w.min.toFixed(2)}, mean ${w.mean.toFixed(2)}, lit ${['window', 'lamp', 'monitor'].map(k => `${k} ${w.r.fx.lights[k] || 0}`).join(' ')}`);
    check('11-time', start.fixed && start.clock === '12:00' && lowRows.length === 0 && unlit.length === 0 && lit.length === 0 && stages.size >= 4 && stageLum(nightStage) < 0.75 * stageLum(noon) && noSky && sameLabel && noErr,
      `${ids.length} agents, month ${start.month}; luminance of every agent's silhouette as a share of its noon value, at ${order.length} times (the six required and every hour): lowest of all ${lowest.min.toFixed(2)} at ${hhmm(lowest.r.min)} (floor 0.60), times below the floor ${lowRows.length}; ` +
      `${req.join('; ')}; after dark (${dark.length} of those times) windows, lamps and monitors all lit at ${dark.length - unlit.length}; in daylight (${day.length} times) lights drawn at ${lit.length}; the ground colour behind the scene (there is no sky, sun, moon or stars) at the six times: ${stages.size} different values (no sky element: ${noSky}), 22:00 is ${(stageLum(nightStage) / stageLum(noon) * 100).toFixed(0)} percent as bright as noon (limit 75: the night tint of the ground is a quarter to a third dark); label colours identical at every time: ${sameLabel} (${noon.label}); errors ${S.page.errors.length}; ?time=12:00 start: fixed ${start.fixed}, ticker ${start.ticking}`);
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

// ---- UI language: a supported system language is used as it is; an unsupported one opens the language list (each language in its own language),
// which Esc cannot close; the choice is saved and beats the system language; the header button opens the same list and Esc closes it
if (want('language')) {
  const names = LANGUAGES.map(l => `${l.name}|${l.code}`), titles = LANGUAGES.map(l => `${l.chooseTitle}|${l.code}`);
  const msgs = Object.fromEntries(LANGUAGES.map(l => [l.code, l.messages]));
  const read = page => page.evaluate(`(() => { const d = document.querySelector('#lang-dlg'); return JSON.stringify({
    nav: navigator.languages.join(), html: document.documentElement.lang, stored: localStorage.getItem('cco.lang'), dialog: !!d, modal: !!(d && d.open && d.matches(':modal')),
    options: d ? [...d.querySelectorAll('.lang-opt')].map(b => b.textContent + '|' + b.lang + (b.getAttribute('aria-current') ? '*' : '')) : [],
    titles: d ? [...d.querySelectorAll('h2 span')].map(s => s.textContent + '|' + s.lang) : [], close: !!(d && d.querySelector('.lang-close')),
    tab: document.querySelector('[data-view="ofis"]').textContent, btn: document.querySelector('#lang').textContent }); })()`).then(JSON.parse).catch(() => ({ options: [], titles: [], failed: true }));
  const until = async (page, ok, ms = 15000) => { let st = {}; for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(250)) { st = await read(page); if (!st.failed && ok(st)) { await sleep(200); return read(page); } } return st; };
  const escape = async page => { for (let i = 0; i < 2; i++) for (const type of ['keyDown', 'keyUp']) await page.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(300); };
  const click = async (page, sel) => {
    const r = await page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    if (!r) return false;                                                                            // nothing to click: the check then fails with its numbers
    for (const type of ['mousePressed', 'mouseReleased']) await page.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    return true;
  };
  const run = async (lang, tag, steps) => { const S = await scenario(4, { tag, query: '?time=12:00', lang }); try { return { out: await steps(S), errors: S.page.errors.length }; } finally { await S.done(); } };

  // a browser in German: not supported
  const de = await run('de-DE', 'langde', async S => {
    const url = `http://127.0.0.1:${S.srv.port}/?time=12:00#ofis`;
    const a0 = await read(S.page);
    await escape(S.page); const a1 = await read(S.page);
    await click(S.page, '.lang-opt[lang="tr"]');
    const a2 = await until(S.page, s => s.html === 'tr' && !s.dialog);
    await S.page.goto(url, 800); const a3 = await until(S.page, s => s.html === 'tr');
    await click(S.page, '#lang'); const a4 = await until(S.page, s => s.dialog);
    await escape(S.page); const a5 = await read(S.page);
    await click(S.page, '#lang'); await until(S.page, s => s.dialog);
    await click(S.page, '.lang-opt[lang="en"]');
    const a6 = await until(S.page, s => s.html === 'en' && !s.dialog);
    await S.page.goto(url, 800); const a7 = await until(S.page, s => s.html === 'en');
    return { a0, a1, a2, a3, a4, a5, a6, a7 };
  });
  const tr = await run('tr-TR', 'langtr', async S => ({ b: await read(S.page) }));
  const en = await run('en-GB', 'langen', async S => ({ c: await read(S.page) }));
  const { a0, a1, a2, a3, a4, a5, a6, a7 } = de.out, { b } = tr.out, { c } = en.out;
  const marked = code => LANGUAGES.map(l => `${l.name}|${l.code}${l.code === code ? '*' : ''}`).join();
  check('ux-language',
    a0.nav === 'de-DE' && a0.dialog && a0.modal && a0.html === 'en' && a0.stored === null && a0.options.join() === names.join() && a0.titles.join() === titles.join() && !a0.close && a0.tab === msgs.en['tab.ofis'] &&
    a1.dialog && a1.modal && a1.stored === null &&
    a2.html === 'tr' && a2.stored === 'tr' && !a2.dialog && a2.tab === msgs.tr['tab.ofis'] && a2.btn === 'TR' && a3.html === 'tr' && !a3.dialog &&
    a4.dialog && a4.modal && a4.close && a4.options.join() === marked('tr') && !a5.dialog && a5.html === 'tr' &&
    a6.html === 'en' && a6.stored === 'en' && !a6.dialog && a6.btn === 'EN' && a7.html === 'en' && !a7.dialog && a7.stored === 'en' &&
    b.nav === 'tr-TR' && b.html === 'tr' && !b.dialog && b.stored === null && b.tab === msgs.tr['tab.ofis'] && b.btn === 'TR' &&
    c.nav === 'en-GB' && c.html === 'en' && !c.dialog && c.stored === null && c.tab === msgs.en['tab.ofis'] && c.btn === 'EN' && de.errors + tr.errors + en.errors === 0,
    `browser in ${a0.nav}, nothing saved: list open ${a0.dialog} (modal ${a0.modal}), page shows ${a0.html}, options [${a0.options.join(', ')}], headings [${a0.titles.join(', ')}], Close button ${a0.close}; after two Esc presses still open ${a1.dialog && a1.modal}; click ${LANGUAGES[1].name}: page ${a2.html}, saved "${a2.stored}", tab "${a2.tab}", header button ${a2.btn}, list closed ${!a2.dialog}; reload: ${a3.html}, list ${a3.dialog ? 'open' : 'closed'}; header button: list open ${a4.dialog}, Close button ${a4.close}, current marked [${a4.options.join(', ')}]; Esc closes it ${!a5.dialog}; choose ${LANGUAGES[0].name}: page ${a6.html}, saved "${a6.stored}", reload in German with a saved choice: ${a7.html}, list ${a7.dialog ? 'open' : 'closed'}; browser in ${b.nav}: page ${b.html}, list ${b.dialog ? 'open' : 'closed'}, saved ${b.stored === null ? 'nothing' : '"' + b.stored + '"'}; browser in ${c.nav}: page ${c.html}, list ${c.dialog ? 'open' : 'closed'}, saved ${c.stored === null ? 'nothing' : '"' + c.stored + '"'}; console errors ${de.errors + tr.errors + en.errors}`);
}

// ---- Goal 5: the shelf and the details panel. 10 live and 12 closed sessions: the closed ones and the asleep ones are on the shelf, newest first,
// with their full chat names and "closed N min ago"; a chat that waits for you never is; a click on a shelf entry or on a figure in a room opens the
// details panel of that id (full name, project, status, time since, last prompt and reply, tool mix, the VS Code link, the copy button)
if (want('shelf')) {
  const S = await scenario(10, { tag: 'shelf', query: '?time=12:00&shelf=200', fixture: { closed: 12 } });           // ?shelf=200: a row for every chat (the cap has its own check, 15-shelf-cap)
  try {
    const P = e => S.page.evaluate(px(e));
    const ev = e => S.page.evaluate(e);
    const live = S.agents.filter(a => a.kind === 'main');
    const asleep = live.filter(a => a.status === 'dormant'), waiting = live.filter(a => a.status === 'waiting' || a.status === 'ask');
    const expected = [...S.fx.closed.map(c => ({ id: c.id, at: c.closedAt, name: c.name, kind: 'closed', ageMin: c.ageMin })), ...asleep.map(a => ({ id: a.id, at: a.updated || a.since, name: a.name, kind: 'dormant' }))]
      .sort((p, q) => q.at - p.at || (p.id < q.id ? -1 : 1));
    const until = async (fn, ms = 15000) => { let r; for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(250)) { r = await fn().catch(() => null); if (r) return r; } return r; };
    const shelf = () => P('p.shelf()');
    await until(async () => (await shelf()).rows.length === expected.length);
    const minutes = text => { const m = /(?:(\d+)d)?\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s)?\s+ago$/.exec(text), u = x => +(x || 0); return m ? { min: u(m[1]) * 1440 + u(m[2]) * 60 + u(m[3]) + u(m[4]) / 60, days: !!m[1] } : null; };
    const sh = await shelf(), figs = await P('p.figures()');

    // order, names, times, figures
    const orderOk = sh.rows.map(r => r.id).join() === expected.map(e => e.id).join();
    const namesOk = sh.rows.length === expected.length && sh.rows.every((r, i) => r.name === expected[i].name);
    const whenBad = sh.rows.filter((r, i) => {
      const e = expected[i];
      if (!e) return true;
      if (e.kind === 'dormant') return !/^idle \d+h/.test(r.when);
      const m = minutes(r.when);
      return !/^closed /.test(r.when) || !m || Math.abs(m.min - e.ageMin) > (m.days ? 1440 : 2.5);
    });
    const figBad = sh.rows.filter(r => !r.figure || r.figure.w < 8 || r.figure.h < 20 || r.figure.ink < 100);
    const longName = sh.rows.find(r => r.name.length >= 100);
    // waiting chats stay in their rooms; asleep chats left theirs
    const waitingOnShelf = waiting.filter(a => sh.rows.some(r => r.id === a.id)), waitingInRooms = waiting.filter(a => figs.includes(a.id));
    const asleepOnShelf = asleep.filter(a => sh.rows.some(r => r.id === a.id)), asleepInRooms = asleep.filter(a => figs.includes(a.id));
    // the lane is beside the scene: no overlap with the scene, a label or a figure's click target; it scrolls on its own
    const A = await ev(`document.querySelector('#view-ofis .of-area').getBoundingClientRect().toJSON()`), canvasR = await ev(`document.querySelector('#view-ofis .of-main').getBoundingClientRect().toJSON()`);
    const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const labels = (await P('p.labelRects()')).filter(l => l.shown).map(l => ({ x: A.left + l.x, y: A.top + l.y, w: l.w, h: l.h }));
    const overLabels = labels.filter(l => hit(l, sh.rect)).length;
    const overTargets = (await P(`p.figures().map(id => p.agentCss(id))`)).filter(f => f && hit({ x: A.left + f.x - 12, y: A.top + f.y - 12, w: 24, h: 24 }, sh.rect)).length;
    const sceneClear = A.width >= (await ev('innerWidth')) - 1 && canvasR.width >= (await ev('innerWidth')) - 1 && sh.rect.x + sh.rect.w <= (await ev('innerWidth')) + 1 && await ev(`(() => { const r = document.querySelector('.of-shelf').getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + 40); return !!e && !!e.closest('.of-shelf'); })()`);          // the scene spans the whole view and the card floats over it
    // the card is the first thing in the right-hand column and the zoom buttons come right after it, outside the scene area
    const columnOk = await ev(`(() => { const h = document.querySelector('.of-shelf'), c = document.querySelector('.of-ctl'); return h.parentElement.classList.contains('of-side') && h.nextElementSibling === c && !document.querySelector('.of-area').contains(c) && c.getBoundingClientRect().top >= h.getBoundingClientRect().bottom - 0.5; })()`);
    const z0 = await P('p.zoom'), pan0 = await P('p.pan');
    await S.page.mouse.wheel(sh.rect.x + sh.rect.w / 2, sh.rect.y + sh.rect.h / 2, 260);
    await sleep(350);
    const scrolled = await shelf();
    const sceneStill = (await P('p.zoom')) === z0 && (await P('p.pan')).join() === pan0.join();
    await S.page.mouse.wheel(sh.rect.x + sh.rect.w / 2, sh.rect.y + sh.rect.h / 2, -600);
    await sleep(250);

    // fold away and back, remembered
    const stored = () => ev(`localStorage.getItem('ajan-ofisi.shelf')`);
    const hideR = await ev(`(() => { const b = document.querySelector('.sh-hide').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await S.page.mouse.click(hideR.x, hideR.y);
    await sleep(500);
    const folded = await shelf(), foldedArea = await ev(`document.querySelector('#view-ofis .of-area').getBoundingClientRect().width`), foldedStore = await stored();
    const tabR = await ev(`(() => { const b = document.querySelector('.of-shelf-tab').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await S.page.mouse.click(tabR.x, tabR.y);
    await sleep(500);
    const unfolded = await shelf(), unfoldedStore = await stored();

    // stable between refreshes: the same list from the server twice, and again after a reload
    const api = async () => (await (await fetch(`http://127.0.0.1:${S.srv.port}/api/closed`)).json()).closed.map(c => c.id + ':' + c.closedAt).join();
    const api1 = await api(); await sleep(1200); const api2 = await api();
    const idsBefore = sh.rows.map(r => r.id).join();
    await S.page.goto(`http://127.0.0.1:${S.srv.port}/?time=12:00&shelf=200&proj=${proj}&season=${season}#ofis`, 800);
    await waitReady(S.page, live.length - asleep.length);
    await until(async () => (await shelf()).rows.length === expected.length);
    const reloaded = await shelf();

    // check 15
    check('15-shelf',
      S.ready && orderOk && namesOk && !whenBad.length && !figBad.length && !!longName && sh.count === `${expected.length} chats` &&
      !waitingOnShelf.length && waitingInRooms.length === waiting.length && waiting.length > 0 && asleepOnShelf.length === asleep.length && !asleepInRooms.length && asleep.length > 0 &&
      sceneClear && columnOk && overLabels === 0 && overTargets === 0 && sh.scroll.height > sh.scroll.client && sh.scroll.overflowY === 'auto' && scrolled.scroll.top > 0 && sceneStill &&
      folded.mode === 'collapsed' && !folded.tabHidden && /^Shelf · \d+$/.test(folded.tab) && foldedStore === 'closed' && Math.abs(foldedArea - A.width) < 1 &&
      unfolded.mode === 'open' && unfolded.tabHidden && unfoldedStore === 'open' &&
      api1 === api2 && reloaded.rows.map(r => r.id).join() === idsBefore,
      `${live.length} live + ${S.fx.closed.length} closed sessions: shelf "${sh.title}", ${sh.count} (${sh.rows.filter(r => r.kind === 'closed').length} closed, ${sh.rows.filter(r => r.kind === 'dormant').length} asleep); order newest first as expected ${orderOk}; full chat names ${namesOk} (longest ${Math.max(...sh.rows.map(r => r.name.length))} chars, emoji name included); times: ${sh.rows.slice(0, 4).map(r => `"${r.when}"`).join(', ')} … within tolerance of the fixture ages (off ${whenBad.length}); figures drawn in every row (${sh.rows.length - figBad.length}/${sh.rows.length}, ${sh.rows[0].figure.w}x${sh.rows[0].figure.h} px); waiting (${waiting.length}): on the shelf ${waitingOnShelf.length}, in rooms ${waitingInRooms.length}; asleep (${asleep.length}): on the shelf ${asleepOnShelf.length}, in rooms ${asleepInRooms.length}; card x ${sh.rect.x.toFixed(0)}..${(sh.rect.x + sh.rect.w).toFixed(0)} floating over a scene ${A.width.toFixed(0)} px wide (canvas ${canvasR.width.toFixed(0)}, the whole view: ${sceneClear}), the zoom buttons right under the card in the same column ${columnOk}, overlap with ${labels.length} shown labels ${overLabels}, with figure targets ${overTargets}; own scroll: content ${sh.scroll.height} px in ${sh.scroll.client} px (${sh.scroll.overflowY}), wheel on the lane moved it to ${scrolled.scroll.top.toFixed(0)} and left the scene's zoom and pan alone ${sceneStill}; fold: ${folded.mode} (tab "${folded.tab}", saved "${foldedStore}", scene ${foldedArea.toFixed(0)} px wide against ${A.width.toFixed(0)}), unfold: ${unfolded.mode} (saved "${unfoldedStore}"); the server's list twice identical ${api1 === api2}; the shelf after a reload identical ${reloaded.rows.map(r => r.id).join() === idsBefore}`);

    // ---- the card, from a shelf entry and from a figure in a room
    const card = () => P('p.card');
    const closeCard = async () => { await ev(`document.querySelector('.of-card:not([hidden]) .oc-x') && document.querySelector('.of-card:not([hidden]) .oc-x').click()`); await sleep(150); };
    const rowCentre = id => ev(`(() => { const li = document.querySelector('.sh-list li[data-id="${id}"]'); li.scrollIntoView({ block: 'nearest' }); const b = li.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);

    const target = expected.filter(e => e.kind === 'closed')[2];                                                                  // the third newest closed chat
    const tr = await rowCentre(target.id);
    await S.page.mouse.click(tr.x, tr.y);
    const fromShelf = await until(async () => { const d = await card(); return d.open && d.id === target.id ? d : null; }) || await card();
    await sleep(500);
    const shelfPanel = await card();
    // copy: from the menu of the open button; the id lands on the clipboard and the item says so
    await S.page.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});                  // headless: the page counts as focused, so the clipboard can be read back
    await S.page.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'], origin: `http://127.0.0.1:${S.srv.port}` }).catch(() => {});
    const at = sel => ev(`(() => { const b = document.querySelector('${sel}').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await S.page.mouse.click((await at('.of-card .oc-caret')).x, (await at('.of-card .oc-caret')).y);
    await sleep(200);
    const menuShown = await ev(`!document.querySelector('.of-card .oc-menu').hidden`);
    await S.page.mouse.click((await at('.of-card [data-copy="id"]')).x, (await at('.of-card [data-copy="id"]')).y);
    await sleep(500);
    const afterCopy = await ev(`JSON.stringify({ flag: document.querySelector('.of-card').dataset.copied || null, text: document.querySelector('.of-card [data-copy="id"]').textContent.trim() })`).then(JSON.parse);
    const clip = await ev(`navigator.clipboard.readText().then(t => ({ ok: true, text: t }), e => ({ ok: false, err: String(e) }))`);
    await closeCard();

    // a figure in a room
    await P('p.freeze(true)');
    const A2 = await ev(`document.querySelector('#view-ofis .of-area').getBoundingClientRect().toJSON()`);
    const roomed = live.filter(a => a.status !== 'dormant');
    let fig = null;
    for (const a of roomed) {
      const f = await P(`p.agentCss(${JSON.stringify(a.id)})`);
      if (!f || f.x < 20 || f.y < 20 || f.x > A2.width - 20 || f.y > A2.height - 20) continue;
      const x = A2.left + f.x, y = A2.top + f.y;
      if (!(await ev(`(()=>{const e=document.elementFromPoint(${x},${y}); return !!e && !e.closest('.px-l, .of-ctl, .of-hud, .of-shelf, .of-card, header, #attention')})()`))) continue;
      fig = { agent: a, x, y };
      break;
    }
    if (!fig) throw new Error('no figure of a room can be clicked without a label or control over it');
    await S.page.mouse.click(fig.x, fig.y);
    const fromRoom = await until(async () => { const d = await card(); return d.open && d.id === fig.agent.id ? d : null; }) || await card();
    await sleep(500);
    const roomPanel = await card();
    await closeCard();
    await P('p.freeze(false)');

    const prompt = `Please continue with: ${target.name}`;
    const vs = id => `vscode://anthropic.claude-code/open?session=${id}`;
    const closedOk = shelfPanel.open && shelfPanel.id === target.id && shelfPanel.title === target.name && /^[\w-]+/.test(shelfPanel.world || '') && /^Closed\s*\d+(s|m|h|d)/.test(shelfPanel.pill || '') && /closed/.test(shelfPanel.pillClass || '') &&
      /^\d+(s|m|h|d)/.test(shelfPanel.since || '') && shelfPanel.quotes.includes(prompt) && shelfPanel.quotes.some(q => q.startsWith(`Finished: ${target.name}`)) &&
      ['Read 1', 'Edit 1', 'Bash 1'].every(x => shelfPanel.toolsList.includes(x)) && shelfPanel.mix >= 3 && shelfPanel.facts.includes('Folder') &&
      shelfPanel.mainHref === vs(target.id) && shelfPanel.mainText === 'Open in VS Code' && shelfPanel.side === 'left' && !shelfPanel.hint &&
      shelfPanel.items.map(i => i.kind).join() === 'vscode,desktop,terminal,copy-cmd,copy-id' && shelfPanel.items.find(i => i.kind === 'copy-id').copyText === target.id;
    const liveOk = roomPanel.open && roomPanel.id === fig.agent.id && roomPanel.title === fig.agent.name && /^[\w-]+/.test(roomPanel.world || '') && /\d+(s|m|h|d)/.test(roomPanel.since || '') && !!roomPanel.pill &&
      roomPanel.quotes.length >= 1 && roomPanel.toolsList.length >= 1 && roomPanel.mainHref === vs(fig.agent.id) && roomPanel.mainText === 'Open in VS Code' && roomPanel.hint;
    const copyOk = menuShown && afterCopy.flag === target.id && afterCopy.text === 'Copied' && clip.ok && clip.text === target.id;
    check('16-details',
      closedOk && liveOk && copyOk && S.page.errors.length === 0,
      `shelf entry "${target.name.slice(0, 40)}": card opened for ${shelfPanel.id === target.id ? 'the same id' : 'ANOTHER id'}, title "${(shelfPanel.title || '').slice(0, 40)}", ${shelfPanel.world}, status "${shelfPanel.pill}" (time since ${shelfPanel.since}), last prompt "${(shelfPanel.quotes[0] || '').slice(0, 44)}", last reply "${(shelfPanel.quotes[1] || '').slice(0, 44)}", tools [${(shelfPanel.toolsList || []).join(' | ')}], ${shelfPanel.mix} tool bar segments, main button "${shelfPanel.mainText}" ${shelfPanel.mainHref === vs(target.id) ? 'linking to the VS Code extension URL of the id' : 'WITH ANOTHER LINK ' + shelfPanel.mainHref}, menu [${(shelfPanel.items || []).map(i => i.kind).join(', ')}], to the left of its row (${shelfPanel.side}); ` +
      `copy session id from the menu: ${afterCopy.text}, clipboard ${clip.ok ? (clip.text === target.id ? 'equals the id' : 'WRONG ' + clip.text) : 'unreadable ' + clip.err}; ` +
      `figure in a room "${(fig.agent.name || '').slice(0, 30)}": card for ${roomPanel.id === fig.agent.id ? 'the same id' : 'ANOTHER id'}, title ${roomPanel.title === fig.agent.name}, status "${roomPanel.pill}", ${roomPanel.quotes.length} quotes, ${(roomPanel.toolsList || []).length} tools, link ${roomPanel.mainHref === vs(fig.agent.id)}, hint about a running chat ${roomPanel.hint}; errors ${S.page.errors.length}`);

    // a live session that closes while the page is open goes on the shelf at once and leaves its room
    const victim = live.find(a => a.status === 'working');
    S.fx.closeSession(victim.id);
    const arrived = await until(async () => { const s2 = await shelf(); return s2.rows[0] && s2.rows[0].id === victim.id ? s2 : null; }, 12000);
    const figsAfter = await P('p.figures()');
    const apiAfter = (await (await fetch(`http://127.0.0.1:${S.srv.port}/api/closed`)).json()).closed.find(c => c.id === victim.id);
    check('15-shelf-close', !!arrived && /^closed \d+s ago$/.test(arrived.rows[0].when) && !figsAfter.includes(victim.id) && !!apiAfter && apiAfter.observed === true && arrived.rows[0].name === victim.name,
      `a working session is closed while the page is open: ${arrived ? `first on the shelf after the next ticks, "${arrived.rows[0].when}", name in full ${arrived.rows[0].name === victim.name}` : 'never reached the shelf'}; its room is gone (figure drawn ${figsAfter.includes(victim.id)}); the server marks it as seen closing (${apiAfter && apiAfter.observed}); shelf now ${arrived ? arrived.count : '?'}`);
  } finally { await S.done(); }
}

// ---- the shelf as a card of the Setup Atlas style, with the zoom buttons fixed in the bottom-right corner under it, open or folded. The computed styles of the card, its chip, a
// row and the round buttons are read back and compared with the tokens of the Atlas page; the geometry is measured in every window width from 360 to 2560 px
// (the buttons below the card, inside the column, over no row and over no label or figure of the scene) and in the two states with no card (folded, and
// nothing on the shelf), where the buttons float in the bottom-right corner and the scene spans the whole view.
if (want('shelf-style')) {
  const cssOf = (ev, sel, props) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}), c = getComputedStyle(e); return JSON.stringify(Object.fromEntries(${JSON.stringify(props)}.map(p => [p, c[p]]))); })()`).then(JSON.parse);
  const geoOf = ev => ev(`(() => {
    const r = e => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
    const view = document.querySelector('#view-ofis'), side = view.querySelector('.of-side'), host = view.querySelector('.of-shelf'), list = view.querySelector('.sh-list'), area = view.querySelector('.of-area');
    const btns = [...view.querySelectorAll('.of-ctl button')], lr = r(list), foot = view.querySelector('.sh-more'), bar = r(document.querySelector('.top'));
    return JSON.stringify({
      listB: lr.b, bar, barPos: getComputedStyle(document.querySelector('.top')).position, foot: foot.hidden || host.hidden ? null : r(foot),
      mode: view.dataset.shelf, view: r(view), area: r(area), canvas: r(view.querySelector('.of-main')), side: r(side), host: host.hidden ? null : r(host),
      btns: btns.map(r), inArea: btns.some(b => area.contains(b)), reachable: btns.map(b => { const q = b.getBoundingClientRect(), e = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2); return e === b || b.contains(e); }),
      rows: host.hidden ? [] : [...list.children].map(li => r(li)).filter(b => b.b > lr.y && b.y < lr.b).map(b => ({ x: b.x, w: b.w, y: Math.max(b.y, lr.y), h: Math.min(b.b, lr.b) - Math.max(b.y, lr.y) })),   // the part of each row that is on show (the rest is scrolled out and clipped)
      names: host.hidden ? [] : [...list.querySelectorAll('.sh-name')].map(n => ({ clipped: n.scrollWidth > n.clientWidth + 1 || getComputedStyle(n).textOverflow === 'ellipsis' || getComputedStyle(n).webkitLineClamp !== 'none', lines: Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight)) })),
      vw: innerWidth, vh: innerHeight });
  })()`).then(JSON.parse);
  const hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const S = await scenario(10, { tag: 'shstyle', query: '?time=12:00', fixture: { closed: 12 } });
  try {
    const P = e => S.page.evaluate(px(e)), ev = e => S.page.evaluate(e), sleepUntil = async (fn, ms = 8000) => { let r; for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(200)) { r = await fn().catch(() => null); if (r) return r; } return r; };
    await sleepUntil(async () => (await P('p.shelf().total')) >= 13);                // the default cap: 10 rows and the footer under them
    const bad = [];
    const eq = (what, got, want_) => { if (JSON.stringify(got) !== JSON.stringify(want_)) bad.push(`${what}: ${JSON.stringify(got)} instead of ${JSON.stringify(want_)}`); };
    // 1. the tokens of the Atlas card, in the window the scene is normally seen in (and again with a light operating system, the Office is dark either way)
    const readStyles = async () => {
      const card = await cssOf(ev, '.of-shelf', ['backgroundColor', 'backdropFilter', 'borderTopColor', 'borderTopWidth', 'borderTopStyle', 'borderTopLeftRadius', 'borderBottomRightRadius', 'paddingTop', 'paddingLeft', 'colorScheme']);
      const chip = await cssOf(ev, '.sh-title', ['color', 'fontWeight', 'fontSize', 'textTransform', 'letterSpacing', 'fontFamily', 'borderTopColor', 'borderTopLeftRadius', 'paddingLeft']);
      const hide = await cssOf(ev, '.sh-hide', ['borderTopLeftRadius', 'width', 'height', 'borderTopColor', 'backgroundColor', 'color']);
      const row = await cssOf(ev, '.sh-item', ['borderTopLeftRadius', 'paddingTop', 'paddingLeft']);
      const name = await cssOf(ev, '.sh-name', ['fontSize', 'fontWeight', 'color']);
      const meta = await cssOf(ev, '.sh-meta', ['fontSize', 'color']);
      const when = await cssOf(ev, '.sh-when', ['fontSize', 'fontFamily']);
      const zoom = await cssOf(ev, '.of-ctl button', ['borderTopLeftRadius', 'borderTopColor', 'borderTopWidth', 'backgroundColor', 'color']);
      const more = await cssOf(ev, '.sh-more-btn', ['borderTopLeftRadius', 'borderTopColor', 'backgroundColor', 'color']);
      return { card, chip, hide, row, name, meta, when, zoom, more };
    };
    const checkStyles = (st, tag) => {
      eq(tag + ' card background', st.card.backgroundColor, 'rgba(9, 12, 28, 0.8)'); eq(tag + ' card blur', st.card.backdropFilter, 'blur(10px)');
      eq(tag + ' card border', [st.card.borderTopWidth, st.card.borderTopStyle, st.card.borderTopColor], ['1px', 'solid', 'rgba(196, 208, 255, 0.32)']);
      eq(tag + ' card radius', [st.card.borderTopLeftRadius, st.card.borderBottomRightRadius], ['18px', '18px']); eq(tag + ' card padding', [st.card.paddingTop, st.card.paddingLeft], ['14px', '16px']);
      eq(tag + ' chip', [st.chip.color, st.chip.fontWeight, st.chip.fontSize, st.chip.textTransform, st.chip.letterSpacing, st.chip.borderTopColor, st.chip.borderTopLeftRadius, st.chip.paddingLeft], ['rgb(143, 176, 255)', '600', '12px', 'uppercase', '0.96px', 'rgba(150, 165, 255, 0.22)', '999px', '10px']);
      if (!/ui-monospace/.test(st.chip.fontFamily) || !/ui-monospace/.test(st.when.fontFamily)) bad.push(tag + ' mono font ' + st.chip.fontFamily);
      eq(tag + ' hide button', [st.hide.borderTopLeftRadius, st.hide.width, st.hide.height, st.hide.borderTopColor, st.hide.backgroundColor], ['50%', '28px', '28px', 'rgba(196, 208, 255, 0.32)', 'rgba(9, 12, 28, 0.8)']);
      eq(tag + ' row', [st.row.borderTopLeftRadius, st.row.paddingTop, st.row.paddingLeft], ['10px', '6px', '8px']);
      eq(tag + ' name', [st.name.fontSize, st.name.fontWeight, st.name.color], ['14px', '600', 'rgb(234, 238, 255)']); eq(tag + ' meta', [st.meta.fontSize, st.meta.color], ['13px', 'rgb(169, 179, 214)']); eq(tag + ' time', st.when.fontSize, '12px');
      eq(tag + ' footer button', [st.more.borderTopLeftRadius, st.more.borderTopColor, st.more.backgroundColor, st.more.color], ['999px', 'rgba(196, 208, 255, 0.32)', 'rgba(9, 12, 28, 0.8)', 'rgb(234, 238, 255)']);
      eq(tag + ' zoom button', [st.zoom.borderTopLeftRadius, st.zoom.borderTopWidth, st.zoom.borderTopColor, st.zoom.backgroundColor], ['50%', '1px', 'rgba(196, 208, 255, 0.32)', 'rgba(9, 12, 28, 0.8)']);
    };
    const dark = await readStyles(); checkStyles(dark, 'dark');
    await S.page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await sleep(300);
    const light = await readStyles(); checkStyles(light, 'light'); eq('light card color-scheme', light.card.colorScheme, 'dark');
    await S.page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    // hover: a row gets the Atlas list hover colour, a round button the accent border
    const rowC = await ev(`(() => { const b = document.querySelector('.sh-list li:nth-child(2) .sh-item').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await S.page.mouse.move(rowC.x, rowC.y); await sleep(300);
    const hov = await ev(`getComputedStyle(document.querySelector('.sh-list li:nth-child(2) .sh-item')).backgroundColor`);
    const zC = await ev(`(() => { const b = document.querySelector('.of-ctl button[data-z="fit"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await S.page.mouse.move(zC.x, zC.y); await sleep(450);
    const hovZ = await ev(`getComputedStyle(document.querySelector('.of-ctl button[data-z="fit"]')).borderTopColor`);
    eq('row hover background', hov, 'rgba(143, 176, 255, 0.12)'); eq('zoom button hover border', hovZ, 'rgb(143, 176, 255)');
    await S.page.mouse.move(2, 2);

    // 2. geometry in every width: the shelf open (the zoom buttons in the corner under the card, in the column), then folded (the buttons in the same corner)
    const rowsOut = [];
    const around = async () => {
      const g = await geoOf(ev), x = Math.min(...g.btns.map(b => b.x)), y = Math.min(...g.btns.map(b => b.y));
      return { g, btnsRect: { x, y, w: Math.max(...g.btns.map(b => b.r)) - x, h: Math.max(...g.btns.map(b => b.b)) - y } };         // the three buttons as one box
    };
    const widths = [360, 700, 1024, 1500, 2560];
    for (const w of widths) {
      // the card is open before the window changes size, as in use: the fit that a resize triggers frames the offices beside it. (Unfolding the card afterwards never moves the map, rule 6 of
      // docs/motion.md, so unfolding it after the resize would leave the offices where the folded view put them, and whether the resize or the unfold came first was a matter of timing.)
      await P('p.setShelfFolded(false)'); await S.page.setViewport(w, 900, 1); await sleep(900);
      const { g, btnsRect } = await around();
      const L = `${w}px open`, A = g.area, labs = (await P('p.labelRects()')).filter(l => l.shown).map(l => ({ x: A.x + l.x, y: A.y + l.y, w: l.w, h: l.h }));
      const figs = (await P('p.figures().map(id => p.agentCss(id))')).filter(Boolean).map(f => ({ x: A.x + f.x - 12, y: A.y + f.y - 12, w: 24, h: 24 }));
      const vOk = g.btns.every(b => b.x >= 0 && b.r <= g.vw + 0.5 && b.y >= 0 && b.b <= g.vh + 0.5) && g.host && g.host.x >= 0 && g.host.r <= g.vw + 0.5;
      if (g.mode !== 'open' || !g.host) bad.push(`${L}: the shelf is ${g.mode}`);
      if (g.inArea) bad.push(`${L}: the zoom buttons are inside the scene area`);
      { const last = g.btns[g.btns.length - 1], want16o = w <= 640 ? 8 : 16, gr = g.view.r - last.r, gb = g.view.b - last.b;      // fixed in the bottom-right corner, open or folded: the card ends above them and never pulls them up
        if (Math.abs(gr - want16o) > 1.5 || Math.abs(gb - want16o) > 1.5) bad.push(`${L}: with the card open the zoom buttons are ${gr.toFixed(1)} px from the right and ${gb.toFixed(1)} px from the bottom of the view, not ${want16o} (they must stay in the corner)`); }
      if (g.host && g.btns.some(b => b.y < g.host.b - 0.5)) bad.push(`${L}: a zoom button starts at ${Math.min(...g.btns.map(b => b.y)).toFixed(0)}, above the card's bottom edge ${g.host.b.toFixed(0)}`);
      if (g.host && !(btnsRect.x >= g.side.x - 0.5 && btnsRect.x + btnsRect.w <= g.side.r + 0.5 && btnsRect.x >= g.host.x - 0.5 && btnsRect.x + btnsRect.w <= g.host.r + 0.5)) bad.push(`${L}: the zoom buttons (x ${btnsRect.x.toFixed(0)}..${(btnsRect.x + btnsRect.w).toFixed(0)}) leave the column (x ${g.side.x.toFixed(0)}..${g.side.r.toFixed(0)}, card ${g.host.x.toFixed(0)}..${g.host.r.toFixed(0)})`);
      if (g.rows.some(r => hit(r, btnsRect))) bad.push(`${L}: a zoom button is over a list row`);
      if (!g.foot || g.foot.y < g.listB - 0.5 || g.foot.y + g.foot.h > g.host.b + 0.5 || g.foot.x < g.host.x || g.foot.x + g.foot.w > g.host.r) bad.push(`${L}: the footer is missing or is not inside the card under the list`);
      if (!g.reachable.every(Boolean)) bad.push(`${L}: a zoom button is covered by something (hit test)`);
      if (!vOk) bad.push(`${L}: the card or a zoom button leaves the window`);
      if (g.names.some(n => n.clipped)) bad.push(`${L}: a chat name is cut off`);
      if (w >= 761) {            // the card floats over the scene, which spans the whole view; "fit" frames the offices in the free part, so no label or agent lies under the card, the buttons or the bar
        if (Math.abs(g.area.w - g.view.w) > 1 || Math.abs(g.canvas.w - g.view.w) > 1) bad.push(`${L}: the scene is ${g.area.w.toFixed(0)} px wide in a ${g.view.w.toFixed(0)} px view (it must span all of it, the card floats over it)`);
        // an agent is never under the card, the buttons or the bar; a label (up to 115 px tall) may reach under the bar, because the world must cover the view and
        // the offices cannot be moved down where the world ends (a window much wider than the world is tall)
        const under = (o, what) => [['the card', g.host], ['the buttons', btnsRect], ['the bar', g.bar]].filter(([n, r]) => r && hit(o, r) && !(n === 'the bar' && what === 'label')).map(([n]) => n).join(' and ');
        // labels (about 200 px wide, centred on their agent) can only be kept from under the card where the offices fit beside it at the lowest zoom: a window of 1500 px or more
        const hits = [...(w >= 1500 ? labs.map(l => ({ what: 'label', o: l })) : []), ...figs.map(f => ({ what: 'agent', o: f }))].filter(({ o, what }) => under(o, what));
        if (hits.length) bad.push(`${L}: ${hits.length} label or agent lies under the card, the buttons or the bar: ${hits.slice(0, 3).map(({ what, o }) => `${what} at ${o.x.toFixed(0)},${o.y.toFixed(0)} ${o.w.toFixed(0)}x${o.h.toFixed(0)} under ${under(o, what)}`).join('; ')}`);
        if (g.side.r - g.side.x < 300) bad.push(`${L}: the column of the card is only ${(g.side.r - g.side.x).toFixed(0)} px wide`);
        if (g.barPos !== 'absolute' || g.view.y > 0.5 || g.bar.x < 0 || g.bar.r > g.view.w) bad.push(`${L}: the bar (${g.barPos}) does not float over a scene that starts at the top of the page (view top ${g.view.y.toFixed(0)})`);
      }
      rowsOut.push(`${w}: open, card ${g.host ? `${g.host.w.toFixed(0)}x${g.host.h.toFixed(0)}` : '-'}, buttons ${btnsRect.w.toFixed(0)}x${btnsRect.h.toFixed(0)} ${(btnsRect.y - (g.host ? g.host.b : 0)).toFixed(0)} px under it, ${g.rows.length} rows on show, scene ${g.area.w.toFixed(0)} wide`);
      // folded: no card, the buttons float in the corner and the scene is as wide as the view
      await P('p.setShelfFolded(true)'); await sleep(700);
      const f = (await around()).g, fb = f.btns[f.btns.length - 1], F = `${w}px folded`, gapR = f.view.r - fb.r, gapB = f.view.b - fb.b, want16 = w <= 640 ? 8 : 16;
      if (f.mode !== 'collapsed' || f.host) bad.push(`${F}: the shelf is ${f.mode}`);
      if (Math.abs(gapR - want16) > 1.5 || Math.abs(gapB - want16) > 1.5) bad.push(`${F}: the zoom buttons are ${gapR.toFixed(1)} px from the right and ${gapB.toFixed(1)} px from the bottom of the view, not ${want16}`);
      if (Math.abs(f.area.w - f.view.w) > 1 || Math.abs(f.canvas.w - f.view.w) > 1) bad.push(`${F}: the scene is ${f.area.w.toFixed(0)} px wide in a ${f.view.w.toFixed(0)} px view`);
      if (f.inArea || !f.reachable.every(Boolean)) bad.push(`${F}: the zoom buttons are in the area or covered`);
      rowsOut.push(`${w}: folded, buttons ${gapR.toFixed(0)}/${gapB.toFixed(0)} px from the right/bottom corner, scene ${f.area.w.toFixed(0)} of ${f.view.w.toFixed(0)}`);
    }
    // a window taller than the card: the buttons stay in the corner, the card does not pull them up (its height is the list, so here the column is longer than the card)
    for (const [w, h] of [[1500, 1400], [1024, 1300]]) {
      await S.page.setViewport(w, h, 1);
      await P('p.setShelfFolded(false)'); await sleep(900);
      const { g } = await around(), last = g.btns[g.btns.length - 1], gr = g.view.r - last.r, gb = g.view.b - last.b;
      rowsOut.push(`${w}x${h}: open, buttons ${gr.toFixed(0)}/${gb.toFixed(0)} px from the right/bottom corner, card ${g.host ? g.host.h.toFixed(0) : '-'} px tall`);
      if (!g.host || Math.abs(gr - 16) > 1.5 || Math.abs(gb - 16) > 1.5) bad.push(`${w}x${h}: with the card open (${g.host ? g.host.h.toFixed(0) + ' px tall' : 'missing'}) the zoom buttons are ${gr.toFixed(1)} px from the right and ${gb.toFixed(1)} px from the bottom, not 16 (they must stay in the corner)`);
    }
    await S.page.setViewport(1500, 900, 1);
    // 3. nothing on the shelf at all: the same corner, the same full-width scene (a second page: no asleep and no closed chats)
    const N = await scenario(3, { tag: 'shnone', query: '?time=12:00', fixture: { statuses: ['working'] } });
    let none;
    try {
      await sleep(900);
      none = await geoOf(e => N.page.evaluate(e));
      const nb = none.btns[none.btns.length - 1];
      if (none.mode !== 'none' || none.host) bad.push(`empty shelf: mode ${none.mode}`);
      if (Math.abs(none.view.r - nb.r - 16) > 1.5 || Math.abs(none.view.b - nb.b - 16) > 1.5) bad.push(`empty shelf: the zoom buttons are not in the corner (${(none.view.r - nb.r).toFixed(1)}/${(none.view.b - nb.b).toFixed(1)})`);
      if (Math.abs(none.area.w - none.view.w) > 1 || none.inArea || !none.reachable.every(Boolean)) bad.push('empty shelf: the scene is not as wide as the view, or the buttons are misplaced');
    } finally { await N.done(); }
    check('15-shelf-style', bad.length === 0 && S.page.errors.length === 0,
      `${bad.length ? 'FAILED: ' + bad.slice(0, 6).join('; ') + '; ' : ''}card ${dark.card.backgroundColor}, ${dark.card.backdropFilter}, border ${dark.card.borderTopWidth} ${dark.card.borderTopColor}, radius ${dark.card.borderTopLeftRadius}, padding ${dark.card.paddingTop} ${dark.card.paddingLeft}; chip ${dark.chip.color} ${dark.chip.fontWeight} ${dark.chip.fontSize} ${dark.chip.textTransform} spacing ${dark.chip.letterSpacing}; row radius ${dark.row.borderTopLeftRadius}, name ${dark.name.fontSize}/${dark.name.fontWeight} ${dark.name.color}, hover ${hov}; round buttons ${dark.zoom.borderTopColor} on ${dark.zoom.backgroundColor}, hover border ${hovZ}; the same in a light system theme ${JSON.stringify(light.card) === JSON.stringify(dark.card) && JSON.stringify(light.name) === JSON.stringify(dark.name)}; ${rowsOut.join('; ')}; empty shelf: ${none ? none.mode : '?'}, scene ${none ? none.area.w.toFixed(0) : '?'} of ${none ? none.view.w.toFixed(0) : '?'}; console errors ${S.page.errors.length}`);
  } finally { await S.done(); }
}

// ---- 15-shelf-fit: "fit" frames the offices in the free part of the view, and that must not depend on when it runs. The shelf card arrives with a small travel and scale, and the
// first fit after it appears can run in the very tick it starts (the observer of the shelf mode), so the fit must use the card's resting box, not where the animation has it that moment:
// a fit in the tick the card starts to arrive gives the same pan and zoom as a fit after it has settled.
if (want('shelf-fit')) {
  const S = await scenario(10, { tag: 'shfit', query: '?time=12:00', fixture: { closed: 12 } });
  try {
    const P = e => S.page.evaluate(px(e)), ev = e => S.page.evaluate(e);
    const sleepUntil = async (fn, ms = 8000) => { let r; for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(200)) { r = await fn().catch(() => null); if (r) return r; } return r; };
    await S.page.setViewport(1500, 900, 1);
    await sleepUntil(async () => (await P('p.shelf().total')) >= 13);
    await P('p.setShelfFolded(true)'); await sleep(900);
    const early = await ev(`(() => { const p = document.querySelector('#view-ofis').__pixel; p.setShelfFolded(false); p.fit(); return JSON.stringify({ pan: p.pan, zoom: p.zoom, moving: document.querySelector('#view-ofis .of-shelf').getAnimations().length }); })()`).then(JSON.parse);
    await sleep(1200);
    const late = await ev(`(() => { const p = document.querySelector('#view-ofis').__pixel; p.fit(); return JSON.stringify({ pan: p.pan, zoom: p.zoom, moving: document.querySelector('#view-ofis .of-shelf').getAnimations().length }); })()`).then(JSON.parse);
    const bad = [];
    if (!early.moving) bad.push('the shelf card was not animating when the early fit ran, so the check proves nothing');
    if (late.moving) bad.push('the shelf card was still animating at the late fit');
    if (JSON.stringify([early.pan, early.zoom]) !== JSON.stringify([late.pan, late.zoom])) bad.push(`a fit while the card arrives gives pan ${JSON.stringify(early.pan)} zoom ${early.zoom}, a fit after it settled gives pan ${JSON.stringify(late.pan)} zoom ${late.zoom}`);
    check('15-shelf-fit', bad.length === 0 && S.page.errors.length === 0,
      bad.length ? `FAILED: ${bad.join('; ')}` : `a fit in the tick the shelf card starts to arrive (${early.moving} animations running) and a fit after it settled give the same pan ${JSON.stringify(late.pan)} and zoom ${late.zoom}; errors ${S.page.errors.length}`);
  } finally { await S.done(); }
}

// ---- the shelf shows only the newest few chats (setting `shelf`, default 10, ?shelf=N overrides it for a visit). 10 live and 36 closed chats, so 37 are on the
// shelf with the one that is asleep: with ?shelf=5 there are exactly 5 rows, the 5 newest by time, a footer that says so and a button that adds ten; with
// ?shelf=50 there is a row for each of them and no footer; a choice made in the settings popover is stored and survives a reload, the address is not stored
if (want('shelf-cap')) {
  const S = await scenario(10, { tag: 'shcap', query: '?time=12:00&shelf=5', fixture: { closed: 36 } });
  try {
    const P = e => S.page.evaluate(px(e)), ev = e => S.page.evaluate(e);
    const until = async (fn, ms = 20000) => { let r; for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(250)) { r = await fn().catch(() => null); if (r) return r; } return r; };
    const live = S.agents.filter(a => a.kind === 'main'), asleep = live.filter(a => a.status === 'dormant');
    const expected = [...S.fx.closed.map(c => ({ id: c.id, at: c.closedAt, name: c.name })), ...asleep.map(a => ({ id: a.id, at: a.updated || a.since, name: a.name }))].sort((p, q) => q.at - p.at || (p.id < q.id ? -1 : 1));
    const TOTAL = expected.length;
    const shelf = () => P('p.shelf()'), ids = sh => sh.rows.map(r => r.id).join();
    const want_ = n => expected.slice(0, n).map(e => e.id).join();
    const bad = [];
    const short = x => { const t = JSON.stringify(x); return t.length > 110 ? t.slice(0, 110) + '…' : t; };
    const eq = (what, got, want) => { if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${what}: ${short(got)} instead of ${short(want)}`); };
    await until(async () => (await shelf()).total === TOTAL);
    const stored = () => ev(`JSON.parse(localStorage.getItem('ajan-ofisi.settings') || '{}')`);
    const click = async css => { const r = await ev(`(() => { const b = document.querySelector(${JSON.stringify(css)}).getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`); await S.page.mouse.click(r.x, r.y); await sleep(450); };
    const word = n => `Showing the newest ${n} of ${TOTAL}`;

    // 1. ?shelf=5
    const a = await shelf();
    eq('total', a.total, TOTAL); eq('rows with ?shelf=5', a.rows.length, 5); eq('the rows are the 5 newest by time', ids(a), want_(5)); eq('header count', a.count, '5 chats');
    eq('footer text', a.foot.text, word(5)); eq('footer button', a.foot.button, 'Show 10 more'); eq('footer shown', a.foot.hidden, false);
    const inCard = r => r.x >= a.rect.x - 0.5 && r.x + r.w <= a.rect.x + a.rect.w + 0.5 && r.y >= a.rect.y - 0.5 && r.y + r.h <= a.rect.y + a.rect.h + 0.5;
    const lastRow = a.rows[a.rows.length - 1];
    if (!inCard(a.foot.rect) || !inCard(a.foot.buttonRect)) bad.push('the footer or its button is outside the card');
    if (a.foot.rect.y < lastRow.rect.y + lastRow.rect.h - 0.5) bad.push('the footer is over the list');
    const figs = await P('p.figures()'), asleepId = asleep.map(x => x.id);
    eq('the asleep chat (older than 5 closed ones) has no row', asleepId.filter(id => a.rows.some(r => r.id === id)).length, 0);
    eq('and no room: it is not drawn in the scene', asleepId.filter(id => figs.includes(id)).length, 0);
    eq('a ?shelf= value is not stored', (await stored()).shelf, undefined);
    eq('the settings say 5 from the address', [(await P('p.settings')).shelf, (await P('p.settingsFrom')).shelf], [5, 'url']);

    // 2. the footer button: ten more each time, the last click takes what is left, then no footer
    const steps = [];
    for (const [rowsWant, text, btn] of [[15, word(15), 'Show 10 more'], [25, word(25), 'Show 10 more'], [35, word(35), 'Show 2 more'], [TOTAL, null, null]]) {
      await click('.sh-more-btn');
      const b = await shelf();
      steps.push(b.rows.length);
      eq(`rows after the click that makes ${rowsWant}`, b.rows.length, rowsWant); eq('they are the newest in order', ids(b), want_(rowsWant)); eq('header count', b.count, `${rowsWant} chats`);
      if (text) { eq('footer text', b.foot.text, text); eq('footer button', b.foot.button, btn); eq('footer shown', b.foot.hidden, false); } else eq('footer gone when nothing is left out', b.foot.hidden, true);
    }
    const afterAll = await shelf();
    eq('the asleep chat has its row once everything is shown', asleepId.filter(id => afterAll.rows.some(r => r.id === id)).length, asleep.length);
    // the tab of a folded shelf keeps the total
    await click('.sh-hide');
    const folded = await shelf();
    eq('folded tab', folded.tab, `Shelf · ${TOTAL}`);
    await click('.of-shelf-tab');

    // 3. the settings popover: a choice is applied at once, takes back what the footer added, is stored, and the address is kept in step
    const origin0 = await ev('performance.timeOrigin');
    await click('#set-btn');
    const opts = await ev(`[...document.querySelector('#set-shelf').options].map(o => o.value).join()`), label = await ev(`document.querySelector('label[for="set-shelf"]').textContent.trim()`);
    eq('the select offers', opts, '5,10,20,50'); eq('its label', label, 'Chats on the shelf'); eq('the select shows the 5 of the address', await ev(`document.querySelector('#set-shelf').value`), '5');
    await ev(`(() => { const s = document.querySelector('#set-shelf'); s.value = '20'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await sleep(500);
    const b20 = await shelf(), st20 = await stored();
    eq('rows after choosing 20 (no reload, the earlier "more" is gone)', b20.rows.length, 20); eq('they are the 20 newest', ids(b20), want_(20)); eq('footer', b20.foot.text, word(20));
    eq('no reload', await ev('performance.timeOrigin'), origin0); eq('stored', st20.shelf, 20); eq('the address follows', await ev('location.search.includes("shelf=20")'), true);
    const folded20 = await shelf(); eq('the tab still has the total', folded20.total, TOTAL);

    // 4. ?shelf=50: everything, no footer; the stored 20 is not touched; a plain reload gives the stored 20 back
    const base = `http://127.0.0.1:${S.srv.port}/`, load = async q => { await S.page.goto(base + q + '#ofis', 800); await waitReady(S.page, live.length - asleep.length); await until(async () => (await shelf()).total === TOTAL); await sleep(300); return shelf(); };
    const all = await load(`?time=12:00&shelf=50&proj=${proj}&season=${season}`);
    eq('rows with ?shelf=50', all.rows.length, TOTAL); eq('no footer', all.foot.hidden, true); eq('in order', ids(all), want_(TOTAL)); eq('count', all.count, `${TOTAL} chats`);
    const keptStored = (await stored()).shelf;
    eq('still stored 20 after a visit with ?shelf=50', keptStored, 20);
    const again = await load(`?time=12:00&proj=${proj}&season=${season}`);
    eq('rows after a reload with the stored 20', again.rows.length, 20); eq('footer after the reload', again.foot.text, word(20));
    eq('settings say 20 from the store', [(await P('p.settings')).shelf, (await P('p.settingsFrom')).shelf], [20, 'stored']);
    // 5. a value out of range in the address is ignored (the stored 20 stays)
    const odd = await load(`?time=12:00&shelf=2&proj=${proj}&season=${season}`);
    eq('?shelf=2 is ignored', odd.rows.length, 20);
    check('15-shelf-cap', bad.length === 0 && S.page.errors.length === 0,
      `${bad.length ? 'FAILED: ' + bad.slice(0, 6).join('; ') + '; ' : ''}${live.length} live (${asleep.length} asleep) + ${S.fx.closed.length} closed chats = ${TOTAL} on the shelf; ?shelf=5: ${a.rows.length} rows, the 5 newest by time ${ids(a) === want_(5)}, header "${a.count}", footer "${a.foot.text}" with the button "${a.foot.button}", not stored; the asleep chat (rank ${expected.findIndex(e => asleepId.includes(e.id)) + 1}) has no row and no room; the button adds ten: rows ${steps.join(' → ')}, no footer at the end; folded tab "${folded.tab}"; popover: options ${opts}, 20 chosen → ${b20.rows.length} rows without a reload, stored ${st20.shelf}; ?shelf=50 → ${all.rows.length} rows, footer hidden ${all.foot.hidden}, stored value still ${keptStored}; plain reload → ${again.rows.length} rows; ?shelf=2 ignored → ${odd.rows.length}; console errors ${S.page.errors.length}`);
  } finally { await S.done(); }
}

// ---- Goal 5: the scan of closed sessions has a count cap and a time budget, reads only tails, and never reads an unchanged file again
if (want('scan')) {
  const dir = join(tmpdir(), `cco-qa-${process.pid}-scan`);
  const fx = await makeFixture({ dir, n: 2, closed: 300 });
  const CAP = 12, BUDGET = 1;          // a cap of 12 of 300 and the smallest budget (1 ms): the stat of 300 files alone uses it up, so a pass reads about one transcript and the cold scan takes about a dozen passes (the server scans once a second)
  const srv = await startServer(dir, { CCO_CLOSED_BUDGET_MS: String(BUDGET), CCO_CLOSED_EVERY_MS: '300' }, ['--closed-max', String(CAP)]);
  try {
    const get = async () => (await fetch(`http://127.0.0.1:${srv.port}/api/closed`)).json();
    const finalN = [...fx.closed].sort((a, b) => b.closedAt - a.closedAt || (a.id < b.id ? -1 : 1)).slice(0, CAP);
    const polls = [];
    let d = await get();
    for (const t0 = Date.now(); Date.now() - t0 < 60000; await sleep(300)) {
      d = await get(); polls.push(d.closed.map(c => c.id));
      if (d.closed.length === CAP && d.scan.pending === 0) break;
    }
    const settled = d, cold = settled.scan.totals;
    const finalIds = settled.closed.map(c => c.id), wantN = finalN.map(c => c.id);
    const prefixOk = polls.every(l => l.every((id, i) => id === wantN[i]));
    const sawPartial = polls.some(l => l.length > 0 && l.length < 50);
    const tailSum = finalN.reduce((n, c) => n + Math.min(statSync(c.file).size, 256 * 1024), 0);
    // warm: let several more passes go by
    await sleep(5000);
    const warm = await get();
    // a file that grows is read again, once, and moves to the top
    const bumped = finalN[CAP - 3];
    appendFileSync(bumped.file, JSON.stringify({ type: 'last-prompt', lastPrompt: 'bumped', sessionId: bumped.id }) + '\n');
    await sleep(4500);
    const after = await get();
    const sizes = finalN.map(c => statSync(c.file).size);
    check('17-scan',
      finalIds.join() === wantN.join() && settled.closed.length === CAP && prefixOk && sawPartial && cold.read === CAP && cold.bytes === tailSum && cold.passes >= 3 && cold.maxMs <= BUDGET + 15 &&
      warm.scan.totals.read === CAP && warm.scan.totals.bytes === cold.bytes && warm.scan.read === 0 && warm.scan.bytes === 0 && warm.scan.totals.passes > cold.passes + 2 &&
      after.scan.totals.read === CAP + 1 && after.closed.length === CAP && after.closed[0].id === bumped.id,
      `${fx.closed.length} closed transcripts on disk (${sizes.filter(x => x > 256 * 1024).length} of the newest ${CAP} larger than the 256 KB tail, up to ${(Math.max(...sizes) / 1024).toFixed(0)} KB), budget ${BUDGET} ms per pass: the list is capped at ${settled.closed.length} and is the ${CAP} newest by file time (${finalIds.join() === wantN.join()}; the default cap is 50); it filled from the top over ${cold.passes} passes (partial lists seen ${sawPartial}, every one a prefix of the final list ${prefixOk}); cold: ${cold.read} transcripts read (never more than the cap, not 300), ${(cold.bytes / 1024).toFixed(0)} KB = the tail rule ${cold.bytes === tailSum}, ${cold.ms.toFixed(0)} ms in the scanner, longest pass ${cold.maxMs.toFixed(1)} ms; warm (${warm.scan.totals.passes - cold.passes} more passes): reads ${warm.scan.totals.read - cold.read} files and ${warm.scan.totals.bytes - cold.bytes} bytes, last pass ${warm.scan.ms.toFixed(1)} ms with ${warm.scan.statted} files stat'ed; one transcript appended to: read again once (reads ${after.scan.totals.read}), now first in the list ${after.closed[0].id === bumped.id}`);
  } finally { srv.stop(); fx.cleanup(); }
}

// ---- the four tabs: only the chosen view is displayed. The Office is the only view that is built from a scene with its own layout; when it
// stayed displayed under the other tabs (its display rule was heavier than the hidden attribute) the Dashboard was a blue sky and the Cost
// tab had it behind its text. Each tab is opened with a real click; what lies on top of the view, and what is displayed of the other views, is read back
if (want('views')) {
  const S = await scenario(10, { tag: 'views', query: '?time=12:00&shelf=200', fixture: { closed: 12 } });
  try {
    const ev = e => S.page.evaluate(e);
    const probe = view => ev(`(() => {
      const views = [...document.querySelectorAll('main .view')], active = document.querySelector('#view-${view}'), r = active.getBoundingClientRect();
      const shown = views.filter(v => getComputedStyle(v).display !== 'none').map(v => v.id.replace('view-', ''));
      const other = {};
      for (const v of views) if (v !== active) other[v.id.replace('view-', '')] = [...v.querySelectorAll('*')].filter(e => e.getClientRects().length > 0).length + (v.getClientRects().length > 0 ? 1 : 0);
      const over = [];
      for (let i = 0; i < 16; i++) for (let j = 0; j < 10; j++) {
        const e = document.elementFromPoint(r.left + (i + .5) * r.width / 16, r.top + (j + .5) * r.height / 10), v = e && e.closest('.view');
        if (v && v !== active) over.push(v.id.replace('view-', '') + ':' + e.className.toString().slice(0, 18));
      }
      const sel = [...document.querySelectorAll('.top .seg button[data-view]')].filter(b => b.getAttribute('aria-selected') === 'true').map(b => b.dataset.view);
      return JSON.stringify({ shown, other, over, sel, h: Math.round(r.height), text: active.innerText.trim().length, hidden: active.hidden });
    })()`).then(JSON.parse);
    const out = {};
    for (const view of ['pano', 'akis', 'maliyet', 'ofis', 'pano']) {
      const b = await ev(`(() => { const r = document.querySelector('.top .seg button[data-view="${view}"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await S.page.mouse.click(b.x, b.y);
      await sleep(900);
      out[view] = await probe(view);
    }
    const names = Object.keys(out), bad = names.filter(v => {
      const o = out[v], leaks = Object.entries(o.other).filter(([, n]) => n > 0).map(([k]) => k);
      return o.shown.join() !== v || leaks.length || o.over.length || o.sel.join() !== v || o.hidden || o.h < 400 || o.text < (v === 'ofis' ? 40 : 100);
    });
    const back = await ev(px('p ? { figures: p.figures().length, shelf: p.shelf().rows.length } : null'));
    // the shelf's first state follows the window, not the size of a view that is hidden while it is built: a page that opens on the Dashboard and
    // goes to the Office later shows the shelf in a wide window, and folded in a narrow one
    const url = `http://127.0.0.1:${S.srv.port}/?time=12:00&shelf=200&proj=${proj}&season=${season}`;
    const firstShelf = async (w, hash) => {
      await S.page.setViewport(w, 900, 1);
      await ev(`localStorage.removeItem('ajan-ofisi.shelf')`);
      await S.page.goto(url + hash, 1500);
      await ev(`document.querySelector('.top .seg button[data-view="ofis"]').click()`);
      await waitReady(S.page, 9);
      await sleep(600);
      return ev(px('(() => { const s = p.shelf(); return { mode: s.mode, hidden: s.hidden, tabHidden: s.tabHidden, tab: s.tab, rows: s.rows.length }; })()'));
    };
    const wideFirst = await firstShelf(1500, '#pano'), narrowFirst = await firstShelf(700, '#pano');
    await S.page.setViewport(1500, 900, 1);
    const shelfOk = wideFirst.mode === 'open' && !wideFirst.hidden && wideFirst.tabHidden && wideFirst.rows >= 13 && narrowFirst.mode === 'collapsed' && narrowFirst.hidden && !narrowFirst.tabHidden && /^Shelf · \d+$/.test(narrowFirst.tab);
    check('18-views', bad.length === 0 && !!back && back.figures >= 9 && back.shelf >= 13 && shelfOk && S.page.errors.length === 0,
      `tabs opened by a click: ${['pano', 'akis', 'maliyet', 'ofis'].map(v => `${v}: displayed [${out[v].shown}], selected [${out[v].sel}], boxes still laid out in the other views ${Object.values(out[v].other).reduce((a, n) => a + n, 0)}, elements of another view on top of this one at 160 sample points ${out[v].over.length}${out[v].over.length ? ' (' + out[v].over.slice(0, 2) + ')' : ''}, ${out[v].h} px high, ${out[v].text} characters of text`).join('; ')}; back on the Dashboard last; the Office came back with ${back && back.figures} figures and ${back && back.shelf} shelf rows; the page opened on the Dashboard and moved to the Office: the shelf is ${wideFirst.mode} in a 1500 px window (${wideFirst.rows} rows) and ${narrowFirst.mode} in a 700 px window (tab "${narrowFirst.tab}"); console errors ${S.page.errors.length}`);
  } finally { await S.done(); }
}

// ---- 19. the landscape: the scene is ground everywhere (no sky, no backdrop), at every zoom the view may take, at every edge of the pan range, in
// the daylight and at night, with 2 agents (a small building in a big landscape), 10 and 20. `uncovered` is the number of canvas pixels that
// are not fully opaque after a redraw: whatever is not covered would show the page behind the scene.
if (want('landscape')) {
  const rows = [];
  for (const [n, query] of [[2, '?time=12:00'], [10, '?time=22:00'], [20, '?time=12:00&weather=rain']]) {
    const S = await scenario(n, { tag: 'land' + n, query, dpr: 2 });
    try {
      const P = e => S.page.evaluate(px(e));
      await sleep(900);
      const info = await P('({ zoom: p.zoom, min: p.minZoom, size: p.size, world: p.world, outer: p.outer, build: p.buildMs })');
      const zooms = [...new Set([info.min, info.min * 2, info.zoom])];
      const bad = [];
      let probes = 0;
      for (const z of zooms) {
        await P(`p.setZoom(${z})`); await sleep(250);
        for (const [px_, py_] of [[0, 0], [-1e6, -1e6], [1e6, -1e6], [-1e6, 1e6], [1e6, 1e6]]) {
          if (px_ || py_) await P(`p.setPan(${px_}, ${py_})`);
          await sleep(120);
          const u = await P('p.uncovered()');
          probes++;
          if (u.pixels > 0) bad.push(`zoom ${z} pan ${px_ ? (px_ < 0 ? 'min' : 'max') : 'centre'}/${py_ ? (py_ < 0 ? 'min' : 'max') : 'centre'}: ${u.pixels}`);
        }
      }
      const world = info.world, wpx = (world.x1 - world.x0) * info.min, hpx = (world.y1 - world.y0) * info.min, cv = await P('p.size');                                                    // p.size is in device pixels already
      rows.push({ n, info, bad, probes, zooms, fills: wpx >= cv[0] - 1 && hpx >= cv[1] - 1, noSky: await P("typeof p.skyAt === 'undefined' && !document.querySelector('.of-sky')"), errors: S.page.errors.length });
    } finally { await S.done(); }
  }
  check('19-landscape', rows.every(r => r.bad.length === 0 && r.fills && r.noSky && r.errors === 0 && r.info.outer.drawn > 600 && r.info.build < 150),
    rows.map(r => `${r.n} agents: ${r.probes} views (${r.zooms.length} zooms, ${r.zooms.join(', ')}, x 5 pan positions, the four corners of the pan range among them) with ${r.bad.length ? 'UNCOVERED ' + r.bad.join('; ') : 'no uncovered pixel'}; the world (${r.info.world.x1 - r.info.world.x0} x ${r.info.world.y1 - r.info.world.y0} px) fills the canvas at the lowest zoom ${r.fills}; ${r.info.outer.drawn} decor sprites baked outside the garden (${r.info.outer.dropped} dropped where they touched it); build ${r.info.build} ms (limit 150); errors ${r.errors}`).join(' | ') +
    `; no sky element or sky function ${rows.every(r => r.noSky)}`);
}

// ---- 20. the card: a click on an agent opens a glass card next to it (no drawer, no dimming), with the Open button and its menu; it follows the
// agent through pan and zoom, closes with Esc, its cross or a click on empty ground, and a click on another agent moves it
if (want('card')) {
  const S = await scenario(10, { tag: 'card', query: '?time=12:00', fixture: { closed: 12 } });
  try {
    const P = e => S.page.evaluate(px(e)), ev = e => S.page.evaluate(e);
    const sleepFrames = () => sleep(450);                                           // the scheduler draws at most 10 frames a second
    const area = await ev(`document.querySelector('#view-ofis .of-area').getBoundingClientRect().toJSON()`);
    // a link of the card must never be followed in the QA browser: vscode://, claude:// and claude-cli:// would start real programs
    await ev(`document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.of-card a')) e.preventDefault(); }, true)`);
    const free = (x, y) => ev(`(()=>{const e=document.elementFromPoint(${x},${y}); return !!e && !e.closest('.px-l, .of-ctl, .of-hud, .of-shelf, .of-card, header, #attention')})()`);
    const roomed = S.agents.filter(a => a.kind === 'main' && a.status !== 'dormant');
    const spots = [];
    await P('p.freeze(true)');
    for (const a of roomed) {
      const f = await P(`p.agentCss(${JSON.stringify(a.id)})`);
      if (!f || f.x < 60 || f.y < 60 || f.x > area.width - 60 || f.y > area.height - 60) continue;
      if (await free(area.left + f.x, area.top + f.y)) spots.push({ agent: a, x: area.left + f.x, y: area.top + f.y });
    }
    if (spots.length < 2) throw new Error('fewer than two figures can be clicked without a label or control over them');
    const [A] = spots;
    const mouseAway = async () => { await S.page.mouse.move(area.left + 6, area.top + area.height - 6); await sleepFrames(); };
    const card = () => P('p.card');
    const closeCard = async () => { await ev(`document.querySelector('.of-card:not([hidden]) .oc-x') && document.querySelector('.of-card:not([hidden]) .oc-x').click()`); await sleep(150); };
    const inside = (r, b, m = 0) => r.x >= b.left + m && r.y >= b.top + m && r.x + r.w <= b.left + b.width - m && r.y + r.h <= b.top + b.height - m;
    const hits = (r, f) => r.x < area.left + f.x + 12 && r.x + r.w > area.left + f.x - 12 && r.y < area.top + f.y + 12 && r.y + r.h > area.top + f.y - 12;

    // 1. a click opens the card next to the agent, in the Atlas style, with nothing dimmed and no drawer
    const rings0 = await P('p.effects.rings'), pan0 = await P('p.pan'), zoomStart = await P('p.zoom');
    await S.page.mouse.click(A.x, A.y);
    await mouseAway();
    const c1 = await card(), fA = await P(`p.agentCss(${JSON.stringify(A.agent.id)})`);
    const look = await ev(`(() => {
      const c = document.querySelector('.of-card'), cs = getComputedStyle(c), d = document.querySelector('#drawer');
      const corner = (x, y) => { const e = document.elementFromPoint(x, y); return e ? (e.closest('.of-stage') ? 'stage' : e.className.toString().slice(0, 20) || e.tagName) : 'none'; };
      const r = document.querySelector('#view-ofis .of-area').getBoundingClientRect();
      return JSON.stringify({ bg: cs.backgroundColor, blur: cs.backdropFilter || cs.webkitBackdropFilter, border: cs.borderTopColor + ' ' + cs.borderTopWidth, radius: cs.borderTopLeftRadius,
        scrim: !!document.querySelector('#scrim'), drawer: d.classList.contains('on'),
        corners: [corner(r.left + 4, r.top + 4), corner(r.right - 4, r.top + 4), corner(r.left + 4, r.bottom - 4)], role: c.getAttribute('role'), label: c.getAttribute('aria-label') });
    })()`).then(JSON.parse);
    const ringOn = await P('p.effects.rings');
    const openOk = c1.open && c1.id === A.agent.id && ['right', 'left'].includes(c1.side) && inside(c1.rect, area, 0) && !hits(c1.rect, fA) && c1.title === A.agent.name && c1.mainText === 'Open in VS Code' && !c1.away;
    const styleOk = /rgba\(9, 12, 28, 0\.8\)/.test(look.bg) && /blur\(10px\)/.test(look.blur) && /rgba\(196, 208, 255, 0\.32\) 1px/.test(look.border) && look.radius === '18px' && !look.scrim && !look.drawer && look.corners.every(c => c === 'stage') && look.role === 'dialog' && look.label === A.agent.name;

    // 2. it follows the agent: pan the scene, then zoom; the card keeps its place beside the agent and never covers it
    const rel0 = { dx: c1.rect.x - (area.left + fA.x), dy: c1.rect.y - (area.top + fA.y), side: c1.side };
    await S.page.mouse.drag(area.left + 30, area.top + area.height - 30, area.left + 75, area.top + area.height - 55);
    // the card follows on the next frame the scheduler draws; wait for it to move (up to 4 s) instead of a fixed sleep, because a busy machine can hold a frame back for longer than that
    for (const t0 = Date.now(); Date.now() - t0 < 4000; await sleep(150)) { const c = await card(); if (c.open && (Math.abs(c.rect.x - c1.rect.x) > 1 || Math.abs(c.rect.y - c1.rect.y) > 1)) break; }
    await sleepFrames(); await mouseAway();
    const c2 = await card(), fA2 = await P(`p.agentCss(${JSON.stringify(A.agent.id)})`);
    const moved = Math.hypot(fA2.x - fA.x, fA2.y - fA.y);
    const followed = c2.open && !c2.away && (c2.side !== rel0.side || (Math.abs((c2.rect.x - (area.left + fA2.x)) - rel0.dx) <= 3 && Math.abs((c2.rect.y - (area.top + fA2.y)) - rel0.dy) <= 3 && moved > 5));
    const zoom0 = await P('p.zoom');
    await P(`p.setZoom(${zoom0 + 1}, ${area.width}, ${area.height})`);
    await sleepFrames(); await mouseAway();
    const c3 = await card(), fA3 = await P(`p.agentCss(${JSON.stringify(A.agent.id)})`);
    const zoomOk = c3.open && inside(c3.rect, area, 0) && (c3.away || !hits(c3.rect, fA3));
    await P(`p.setZoom(${zoomStart})`); await P(`p.setPan(${pan0[0]}, ${pan0[1]})`); await sleepFrames();      // back where the clicks below expect the agents

    // 3. the Open button: the remembered choice is the main button, the menu lists the others; choosing one is remembered (across a reload too)
    const caret = async () => ev(`(() => { const b = document.querySelector('.of-card .oc-caret').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    const cb = await caret();
    await S.page.mouse.click(cb.x, cb.y);
    await sleep(200);
    const menu1 = await card();
    await sleep(2200);                                                                   // the page refreshes the card while the chat runs: an open menu stays open
    const menu2 = await card();
    const termPos = await ev(`(() => { const b = document.querySelector('.of-card [data-kind="terminal"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await S.page.mouse.click(termPos.x, termPos.y);
    await sleep(500);
    const stored = await ev(`localStorage.getItem('ajan-ofisi.open')`);
    const c4 = await card();
    const cwd = (S.agents.find(a => a.id === A.agent.id) || {}).cwd;
    const termHref = `claude-cli://open?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent('/resume ' + A.agent.id)}`;
    const menuOk = menu1.menuOpen && menu2.menuOpen && menu1.items.map(i => i.kind).join() === 'vscode,desktop,terminal,copy-cmd,copy-id' && menu1.items[1].href === `claude://resume?session=${A.agent.id}` &&
      menu1.items[3].copyText === `cd '${cwd}' && claude --resume ${A.agent.id}` && stored === 'terminal' && c4.mainKind === 'terminal' && c4.mainHref === termHref && /Terminal/.test(c4.mainText) && !c4.menuOpen;

    // 4. closing: Esc closes the menu first and then the card; the cross; a click on empty ground; another agent moves the card
    const cb2 = await caret();
    await S.page.mouse.click(cb2.x, cb2.y); await sleep(150);
    const menuAgain = (await card()).menuOpen;
    const esc = () => S.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).then(() => S.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }));
    await esc(); await sleep(150);
    const afterEsc1 = await card();
    await esc(); await sleep(150);
    const afterEsc2 = await card();
    await sleepFrames();
    const ringsOff = await P('p.effects.rings');
    await S.page.mouse.click(A.x, A.y); await mouseAway();
    const reopened = await card();
    const x = await ev(`(() => { const b = document.querySelector('.of-card .oc-x').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await S.page.mouse.click(x.x, x.y); await sleep(150);
    const afterX = await card();
    await S.page.mouse.click(A.x, A.y); await mouseAway();
    await S.page.mouse.click(area.left + 8, area.top + area.height - 8); await sleep(400);
    const afterEmpty = await card();
    await S.page.mouse.click(A.x, A.y); await mouseAway();
    let other = null;                                                                     // another agent that the open card does not cover
    for (const sp of spots.filter(q => q.agent.id !== A.agent.id)) if (await free(sp.x, sp.y)) { other = sp; break; }
    if (!other) throw new Error('every other agent is under the card');
    await S.page.mouse.click(other.x, other.y); await mouseAway();
    const afterOther = await card();
    const closeOk = menuAgain && afterEsc1.open && !afterEsc1.menuOpen && !afterEsc2.open && reopened.open && !afterX.open && !afterEmpty.open && afterOther.open && afterOther.id === other.agent.id;

    // 5. a subagent chip switches to the subagent's card, which opens its parent chat; "All details" opens the side card (the drawer element, styled as a glass card)
    let subOk = false, subInfo = 'no subagent chip';
    const parents = new Set(S.agents.filter(a => a.kind === 'sub').map(a => a.id.split(':')[0]));
    const withSubs = spots.find(q => parents.has(q.agent.id));
    if (withSubs) {
      await closeCard();
      await P('p.freeze(true)');
      await S.page.mouse.click(withSubs.x, withSubs.y); await mouseAway();
    }
    const subChip = await ev(`(() => { const b = document.querySelector('.of-card [data-sub]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, id: b.dataset.sub }; })()`);
    if (subChip) {
      await S.page.mouse.click(subChip.x, subChip.y); await sleep(300);
      const cs = await card();
      const parent = subChip.id.split(':')[0];
      subOk = cs.open && cs.id === subChip.id && cs.title.startsWith('↳') && cs.mainText === 'Open the chat' && cs.mainKind === 'terminal' && cs.mainHref.includes(encodeURIComponent('/resume ' + parent));       // the remembered choice (Terminal, from step 3) opens the parent chat
      subInfo = `${subChip.id.slice(-12)}: title "${cs.title}", button "${cs.mainText}" (${cs.mainKind}) → the parent ${parent.slice(-8)}`;
    }
    const more = await ev(`(() => { const b = document.querySelector('.of-card .oc-more').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
    await S.page.mouse.click(more.x, more.y); await sleep(700);
    const drawerOn = await ev(`JSON.stringify({ on: document.querySelector('#drawer').classList.contains('on'), id: document.querySelector('#drawer').dataset.id })`).then(JSON.parse);
    // the details card: a glass card at the right edge, no slide (no transform), no scrim, nothing full-screen dimming the scene
    const dcard = await ev(`(() => {
      const d = document.querySelector('#drawer'), r = d.getBoundingClientRect(), cs = getComputedStyle(d), c = document.querySelector('.of-card');
      const dim = [...document.querySelectorAll('body *')].filter(e => {
        if (d.contains(e) || e === d) return false;
        const k = getComputedStyle(e), b = e.getBoundingClientRect();
        return k.position === 'fixed' && b.width >= innerWidth - 2 && b.height >= innerHeight - 2 && k.backgroundColor !== 'rgba(0, 0, 0, 0)' && k.visibility !== 'hidden' && parseFloat(k.opacity) > 0;
      }).length;
      return JSON.stringify({ x: r.left, y: r.top, w: r.width, vw: innerWidth, bg: cs.backgroundColor, blur: cs.backdropFilter || cs.webkitBackdropFilter, radius: cs.borderTopLeftRadius,
        transform: cs.transform, scrim: !!document.querySelector('#scrim'), dim, cardGone: !c || c.hidden, open: !!d.querySelector('.oc-go'), head: !!d.querySelector('.dw-head') });
    })()`).then(JSON.parse);
    await ev(`document.querySelector('#dw-close').click()`); await sleep(400);
    const drawerOff = await ev(`getComputedStyle(document.querySelector('#drawer')).visibility`);
    const detailsOk = dcard.w <= 431 && dcard.x + dcard.w <= dcard.vw - 10 && dcard.y >= 60 && /rgba\(9, 12, 28, 0\.8\)/.test(dcard.bg) && /blur\(10px\)/.test(dcard.blur) && dcard.radius === '18px'
      && (dcard.transform === 'none' || dcard.transform === 'matrix(1, 0, 0, 1, 0, 0)') && !dcard.scrim && dcard.dim === 0 && dcard.cardGone && dcard.open && dcard.head && drawerOff === 'hidden';
    const moreOk = drawerOn.on && !!drawerOn.id && detailsOk;
    await P('p.freeze(false)');

    // 6. remembered after a reload; a chat that closes while its card is open closes the card
    await S.page.goto(`http://127.0.0.1:${S.srv.port}/?time=12:00&proj=${proj}&season=${season}#ofis`, 1500);
    await waitReady(S.page, 9);
    await sleep(600);
    const area2 = await ev(`document.querySelector('#view-ofis .of-area').getBoundingClientRect().toJSON()`);
    const f2 = await P(`p.agentCss(${JSON.stringify(A.agent.id)})`);
    await S.page.mouse.click(area2.left + f2.x, area2.top + f2.y); await sleep(500);
    const afterReload = await card();
    await P('p.freeze(false)');
    const reloadOk = afterReload.open ? afterReload.mainKind === 'terminal' : false;

    check('20-card', openOk && styleOk && followed && zoomOk && menuOk && closeOk && subOk && moreOk && reloadOk && ringOn > rings0 && ringsOff === rings0 && S.page.errors.length === 0,
      `click on "${A.agent.name.slice(0, 30)}": card ${c1.open ? 'open' : 'NOT open'} on the ${c1.side} of the agent for the right id ${c1.id === A.agent.id}, inside the scene ${inside(c1.rect, area, 0)}, not covering the agent ${!hits(c1.rect, fA)}, title ${c1.title === A.agent.name}, button "${c1.mainText}"; ` +
      `style: background ${look.bg}, blur ${look.blur}, border ${look.border}, radius ${look.radius}, role ${look.role}; no scrim ${!look.scrim}, no drawer ${!look.drawer}, the corners of the scene are still the scene (${look.corners.join(',')}); selection ring ${ringOn} drawn (${rings0} before, ${ringsOff} after closing); ` +
      `pan: the agent moved ${moved.toFixed(0)} px and the card ${followed ? 'went with it' : 'DID NOT follow'}; zoom ${zoom0 + 1}: inside ${inside(c3.rect, area, 0)}, not covering ${!hits(c3.rect, fA3)}; ` +
      `menu: ${menu1.menuOpen} open, still open after 2.2 s ${menu2.menuOpen}, items [${(menu1.items || []).map(i => i.kind).join(', ')}], choosing Terminal stored "${stored}" and the main button reads "${c4.mainText}" (${c4.mainHref === termHref}); after a reload the main button is ${afterReload.mainKind}; ` +
      `Esc closes the menu then the card (${afterEsc1.open && !afterEsc1.menuOpen}, ${!afterEsc2.open}), cross ${!afterX.open}, empty ground ${!afterEmpty.open}, another agent moves it ${afterOther.open && afterOther.id === other.agent.id}; subagent: ${subInfo}; "All details" opens the side card (${dcard.w.toFixed(0)} px glass card at the right edge, no slide, no scrim, nothing dimming the scene ${detailsOk}; the floating card closes ${dcard.cardGone}; opened ${drawerOn.on}) ${moreOk}; errors ${S.page.errors.length}`);
  } finally { await S.done(); }
}

// ---- 12. seasons: every outdoor id resolves, the pictures differ, the automatic season follows the date and the hemisphere
// ---- 21-motion: the rules of docs/motion.md hold on the page. The CSS tokens equal public/js/motion.js (the springs are generated from it); the card beside an agent comes
// out of its agent on a spring (not linear, and no overshoot because a click has no momentum) and leaves on a quicker one; the loops of the indicators use the two loop tempos; a click on the interface (a card, the shelf, a menu) moves nothing
// on the map; the details card and the shelf card use the same springs; reduced motion removes the travel; and app.css has no literal duration left in a transition.
if (want('motion')) {
  const { DUR, EASE, LOOP, SPRING, SLIDE, SCALE } = await import('../../public/js/motion.js');
  const S = await scenario(10, { tag: 'motion', query: '?time=12:00', fixture: { closed: 12 } });
  try {
    const P = e => S.page.evaluate(px(e)), ev = e => S.page.evaluate(e);
    const bad = [];
    const eq = (what, got, want_) => { if (JSON.stringify(got) !== JSON.stringify(want_)) bad.push(`${what}: ${JSON.stringify(got)} instead of ${JSON.stringify(want_)}`); };
    const norm = s => String(s).replace(/\s+/g, '');
    // the points of the first linear(...) in a string, however the browser writes them (with or without stop positions)
    const lin = str => { const m = /linear\(([^)]*)\)/.exec(str); return m ? m[1].split(',').map(x => parseFloat(x.trim())) : []; };
    const sameCurve = (got, spring) => { const a = lin(got), b = lin(spring.css); return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-3); };
    // a link of the card must never be followed in the QA browser
    await ev(`document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.of-card a')) e.preventDefault(); }, true)`);

    // 1. the tokens: the CSS variables equal motion.js (the springs are generated from it), and no transition in app.css has a literal duration
    const names = Object.keys(SPRING);
    const tokens = await ev(`(() => { const c = getComputedStyle(document.documentElement); return JSON.stringify(Object.fromEntries(['--m-hover', '--m-fast', '--m-slow', '--ease-out', '--ease-in', '--ease-in-out', '--slide', '--scale-from', '--loop-slow', '--loop-quick', ...${JSON.stringify(names)}.flatMap(n => ['--spring-' + n, '--spring-' + n + '-ms'])].map(k => [k, c.getPropertyValue(k).trim()]))); })()`).then(JSON.parse);
    for (const k of ['hover', 'fast', 'slow']) eq('token --m-' + k, tokens['--m-' + k], DUR[k] + 'ms');
    for (const [c, j] of [['out', 'out'], ['in', 'in'], ['in-out', 'inOut']]) eq('token --ease-' + c, norm(tokens['--ease-' + c]), norm(EASE[j]));
    for (const k of ['slow', 'quick']) eq('token --loop-' + k, tokens['--loop-' + k], LOOP[k] + 'ms');
    eq('token --slide', tokens['--slide'], SLIDE + 'px'); eq('token --scale-from', Number(tokens['--scale-from']), SCALE);
    for (const n of names) { eq(`token --spring-${n}-ms`, tokens[`--spring-${n}-ms`], SPRING[n].ms + 'ms'); if (!sameCurve(tokens['--spring-' + n], SPRING[n])) bad.push(`token --spring-${n} differs from motion.js`); }
    const css = readFileSync(join(ROOT, 'public/app.css'), 'utf8').split('\n');
    const literal = css.filter(l => /transition:/.test(l) && !/transition: none/.test(l) && /[\s:,](?!0s[\s;,])\.?\d+(\.\d+)?m?s[\s;,]/.test(l.replace(/var\([^)]*\)/g, '')));
    if (literal.length) bad.push(`${literal.length} transition lines in app.css with a literal duration: ${literal[0].trim().slice(0, 90)}`);
    const loops = css.filter(l => /animation:[^;]*infinite/.test(l)), ownLoop = loops.filter(l => !/var\(--loop-(slow|quick)\)/.test(l));
    if (!loops.length || ownLoop.length) bad.push(`${ownLoop.length} of ${loops.length} looping animations in app.css have a period of their own: ${(ownLoop[0] || '').trim().slice(0, 90)}`);

    // helpers
    const area = await ev(`document.querySelector('#view-ofis .of-area').getBoundingClientRect().toJSON()`);
    const free = (x, y) => ev(`(()=>{const e=document.elementFromPoint(${x},${y}); return !!e && !e.closest('.px-l, .of-ctl, .of-hud, .of-shelf, .of-card, header, #attention')})()`);
    const roomed = S.agents.filter(a => a.kind === 'main' && a.status !== 'dormant');
    const spots = [];
    await P('p.freeze(true)');
    for (const a of roomed) {
      const f = await P(`p.agentCss(${JSON.stringify(a.id)})`);
      if (!f || f.x < 60 || f.y < 130 || f.x > area.width - 400 || f.y > area.height - 60) continue;
      if (await free(area.left + f.x, area.top + f.y)) spots.push({ agent: a, x: area.left + f.x, y: area.top + f.y });
    }
    if (spots.length < 2) throw new Error('fewer than two figures can be clicked without a label, the bar, the shelf or a control over them');
    const [A, B] = spots;
    const view = async () => JSON.stringify({ pan: await P('p.pan'), zoom: await P('p.zoom') });
    const anims = sel => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return '[]'; return JSON.stringify(e.getAnimations().map(a => ({ name: a.animationName || 'waapi', duration: a.effect.getTiming().duration, easing: a.effect.getTiming().easing, kf: a.effect.getKeyframes().map(k => ({ opacity: k.opacity, translate: k.translate, scale: k.scale })) }))); })()`).then(JSON.parse);
    const style = (sel, props) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}), c = getComputedStyle(e); return JSON.stringify(Object.fromEntries(${JSON.stringify(props)}.map(p => [p, c[p]]))); })()`).then(JSON.parse);
    // wait until the animations of the cards and the shelf are over (a headless browser with a busy main thread starts them late)
    const settle = async () => { await sleep(120); for (let i = 0; i < 40; i++) { const n = await ev(`document.getAnimations().filter(a => (a.playState === 'running' || a.pending) && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.of-card, .of-shelf, .of-shelf-tab, #drawer')).length`); if (!n) return; await sleep(100); } };
    const atRest = o => (o.translate === 'none' || o.translate === '0px' || o.translate === '0px 0px') && (o.scale === 'none' || o.scale === '1');
    const vecOf = t => { const [x = 0, y = 0] = String(t || '0px 0px').split(' ').map(v => parseFloat(v) || 0); return [x, y]; };
    const moveOf = list => list.find(a => a.kf[0] && a.kf[0].translate !== undefined);
    const fadeOf = list => list.find(a => a.kf[0] && a.kf[0].opacity !== undefined && a.kf[0].translate === undefined);
    const v0 = await view();

    // 2. a click on an agent: the card comes out of its agent: it fades in (base ease) while it travels and grows on the enter spring, which is not linear and does not overshoot (a click has no momentum)
    await S.page.mouse.click(A.x, A.y);
    const inA = await anims('.of-card'), inFade = fadeOf(inA), inMove = moveOf(inA);
    const side = await ev(`document.querySelector('.of-card').dataset.side`);
    if (!inFade || !inMove) bad.push(`the card has no enter animation (${inA.length} animations)`);
    else {
      eq('card enter fade', [inFade.duration, norm(inFade.easing), Number(inFade.kf[0].opacity), Number(inFade.kf[1].opacity)], [DUR.fast, norm(EASE.out), 0, 1]);
      eq('card enter spring duration', inMove.duration, SPRING.enter.ms);
      if (!sameCurve(inMove.easing, SPRING.enter)) bad.push(`card enter easing is not the enter spring: ${inMove.easing.slice(0, 60)}`);
      const [dx, dy] = vecOf(inMove.kf[0].translate), pts = lin(inMove.easing);
      eq('card enter size', [Math.hypot(dx, dy), Number(inMove.kf[0].scale)], [SLIDE, SCALE]);
      eq('card enter ends in place', [vecOf(inMove.kf[1].translate), Number(inMove.kf[1].scale)], [[0, 0], 1]);
      if (!(pts[12] > 0.5 && Math.max(...pts) <= 1.0001)) bad.push(`the enter curve is not a spring without overshoot (a quarter through: ${pts[12]}, peak ${Math.max(...pts)})`);
      const comes = { right: dx < 0, left: dx > 0, below: dy < 0, above: dy > 0, dock: dy > 0 }[side];
      if (!comes) bad.push(`the card on the ${side} of its agent travels from (${dx}, ${dy}), not out of the agent`);
      // it grows out of the point it belongs to: the transform origin is its tail
      const o = await ev(`(() => { const c = document.querySelector('.of-card'), s = getComputedStyle(c); return JSON.stringify({ tail: c.dataset.tail, w: c.offsetWidth, h: c.offsetHeight, origin: s.transformOrigin, at: parseFloat(s.getPropertyValue('--tail')) }); })()`).then(JSON.parse);
      const [ox, oy] = o.origin.split(' ').map(parseFloat), near = (u, w) => Math.abs(u - w) < 1.5;
      const originOk = { left: near(ox, 0) && near(oy, o.at), right: near(ox, o.w) && near(oy, o.at), top: near(oy, 0) && near(ox, o.at), bottom: near(oy, o.h) && near(ox, o.at) }[o.tail] ?? true;
      if (!originOk) bad.push(`the card does not grow out of its tail (${o.tail} at ${o.at}, origin ${o.origin})`);
    }
    await settle();
    eq('map after the card opened', await view(), v0);
    const rest = await style('.of-card', ['opacity', 'translate', 'scale']);
    eq('card at rest', [rest.opacity, atRest(rest)], ['1', true]);

    // 3. it glides to another agent on the glide spring (a transition on its position), the map still does not move
    const cardRect = await ev(`document.querySelector('.of-card').getBoundingClientRect().toJSON()`);
    const B2 = spots.find(q => q !== A && !(q.x > cardRect.left - 14 && q.x < cardRect.right + 14 && q.y > cardRect.top - 14 && q.y < cardRect.bottom + 14)) || B;
    await S.page.mouse.click(B2.x, B2.y);
    const gl = await style('.of-card', ['transitionDuration', 'transitionProperty', 'transitionTimingFunction']);
    const glide = await ev(`document.querySelector('.of-card').classList.contains('glide')`);
    eq('card glide', [glide, gl.transitionDuration, gl.transitionProperty], [true, SPRING.glide.ms / 1000 + 's', 'transform']);
    if (!sameCurve(gl.transitionTimingFunction, SPRING.glide)) bad.push('the glide easing is not the glide spring');
    await settle(); await sleep(SPRING.glide.ms);
    eq('map after the card moved to another agent', await view(), v0);

    // 4. the Open menu pops in on the pop spring; the cross: the card leaves (fade, then a quick spring back toward its agent, no bounce) and is hidden afterwards
    await ev(`document.querySelector('.of-card .oc-caret').click()`);
    const menu = await style('.of-card .oc-menu', ['animationName', 'animationDuration', 'animationTimingFunction']);
    eq('menu pop', [menu.animationName, menu.animationDuration], ['m-pop-move, m-pop-fade', `${SPRING.pop.ms / 1000}s, ${DUR.fast / 1000}s`]);
    if (!sameCurve(menu.animationTimingFunction, SPRING.pop)) bad.push('the menu does not move on the pop spring');
    await ev(`document.querySelector('.of-card .oc-x').click()`);
    const outA = await anims('.of-card'), outFade = fadeOf(outA), outMove = moveOf(outA);
    if (!outFade || !outMove) bad.push('the card has no leave animation');
    else {
      eq('card leave fade', [outFade.duration, norm(outFade.easing)], [DUR.fast, norm(EASE.in)]);
      eq('card leave spring duration', outMove.duration, SPRING.leave.ms);
      if (!sameCurve(outMove.easing, SPRING.leave)) bad.push('the card leaves on another curve than the leave spring');
      if (Math.max(...lin(outMove.easing)) > 1.0001) bad.push('the leave spring bounces');
      if (!(SPRING.leave.ms < SPRING.enter.ms)) bad.push('leaving is not quicker than arriving');
    }
    eq('a leaving card takes no clicks (data-motion)', await ev(`document.querySelector('.of-card').dataset.motion`), 'out');
    await settle(); await sleep(250);
    eq('card hidden after it left', await ev(`document.querySelector('.of-card').hidden`), true);
    eq('map after the card closed', await view(), v0);

    // 5. the details card: closed, it waits 20 px to the right and a little smaller; "All details" brings it in on the enter spring, the cross sends it out on the leave spring
    const dClosed = await style('#drawer', ['translate', 'scale', 'visibility']);
    eq('details card closed', [dClosed.translate, Number(dClosed.scale), dClosed.visibility], [SLIDE + 'px', SCALE, 'hidden']);
    await S.page.mouse.click(A.x, A.y); await settle();
    await ev(`document.querySelector('.of-card .oc-more').click()`);
    await sleep(80);
    const dOpen = await style('#drawer', ['transitionProperty', 'transitionDuration', 'transitionTimingFunction']);
    eq('details card enter', dOpen.transitionDuration.split(',').map(x => x.trim()), [SPRING.enter.ms / 1000 + 's', SPRING.enter.ms / 1000 + 's', DUR.fast / 1000 + 's']);
    if (!sameCurve(dOpen.transitionTimingFunction, SPRING.enter)) bad.push('the details card does not arrive on the enter spring');
    await settle(); await sleep(SPRING.enter.ms);
    const dRest = await style('#drawer', ['translate', 'scale', 'opacity', 'visibility']);
    eq('details card at rest', [dRest.opacity, dRest.visibility, atRest(dRest)], ['1', 'visible', true]);
    eq('map after the details card opened', await view(), v0);
    await ev(`document.querySelector('#dw-close').click()`);
    const dLeave = await style('#drawer', ['transitionDuration', 'transitionTimingFunction']);
    eq('details card leave', dLeave.transitionDuration.split(',').slice(0, 2).map(x => x.trim()), [SPRING.leave.ms / 1000 + 's', SPRING.leave.ms / 1000 + 's']);
    if (!sameCurve(dLeave.transitionTimingFunction, SPRING.leave)) bad.push('the details card does not leave on the leave spring');
    await sleep(SPRING.leave.ms + 200);
    eq('details card hidden after it left', await ev(`getComputedStyle(document.querySelector('#drawer')).visibility`), 'hidden');
    eq('map after the details card closed', await view(), v0);

    // 6. the shelf card goes out to the right edge and comes back, on the same springs; folding and unfolding never move the map
    await ev(`document.querySelector('.sh-hide').click()`);
    const shOut = await anims('.of-shelf');
    if (!fadeOf(shOut) || !moveOf(shOut)) bad.push('the shelf card has no leave animation');
    else eq('shelf leave', [fadeOf(shOut).duration, moveOf(shOut).duration, sameCurve(moveOf(shOut).easing, SPRING.leave)], [DUR.fast, SPRING.leave.ms, true]);
    await settle(); await sleep(250);
    eq('shelf card hidden after it left', await ev(`document.querySelector('.of-shelf').hidden`), true);
    eq('map after the shelf folded', await view(), v0);
    await ev(`document.querySelector('.of-shelf-tab').click()`);
    const shIn = await anims('.of-shelf');
    if (!fadeOf(shIn) || !moveOf(shIn)) bad.push('the shelf card has no enter animation');
    else eq('shelf enter', [fadeOf(shIn).duration, moveOf(shIn).duration, sameCurve(moveOf(shIn).easing, SPRING.enter), Number(moveOf(shIn).kf[0].scale)], [DUR.fast, SPRING.enter.ms, true, SCALE]);
    await settle();
    eq('map after the shelf unfolded', await view(), v0);

    // 7. less motion on request: only a short fade, no travel, no spring, no menu pop
    await S.page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await sleep(200);
    await S.page.mouse.click(A.x, A.y);
    const inR = await anims('.of-card');
    if (!fadeOf(inR)) bad.push('reduced motion: the card has no fade'); else eq('reduced motion card', [fadeOf(inR).duration, moveOf(inR) === undefined], [DUR.hover, true]);
    await ev(`document.querySelector('.of-card .oc-caret').click()`);
    eq('reduced motion menu', (await style('.of-card .oc-menu', ['animationName'])).animationName, 'none');
    await ev(`document.querySelector('.of-card .oc-x').click()`);
    await S.page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await P('p.freeze(false)');

    const pts = lin(inMove.easing);
    check('21-motion', bad.length === 0 && S.page.errors.length === 0,
      bad.length ? `FAILED: ${bad.join('; ')}` :
      `tokens equal motion.js (${Object.entries(SPRING).map(([n, s]) => `${n} ${s.duration} s/bounce ${s.bounce} = ${s.ms} ms`).join(', ')}); no literal duration in a transition of app.css and ${loops.length} looping animations on the two loop tempos (${LOOP.slow} and ${LOOP.quick} ms); the card comes out of its agent (${side} side) on the enter spring: ${inMove.duration} ms, travel ${SLIDE} px and growth from ${SCALE}, a quarter of the way through the curve it is already at ${pts[12].toFixed(2)} and it peaks at ${Math.max(...pts).toFixed(3)}; the fade is ${inFade.duration} ms; it glides to another agent on the glide spring (${SPRING.glide.ms} ms); the menu pops on the pop spring; the card leaves on the leave spring (${outMove.duration} ms, no bounce) and takes no clicks while it leaves; the details card (closed: ${SLIDE} px right, scaled ${SCALE}) and the shelf card use the same springs; the pan and zoom of the map were identical (${v0}) after every one of these; reduced motion: ${fadeOf(inR).duration} ms fade, no travel, no menu pop; errors ${S.page.errors.length}`);
  } finally { await S.done(); }
}

// ---- 22-glass-bar: the glass bar floats over every page, not only the Office. The Office map fills the page under it; Dashboard, Timeline and Cost start below it (and below the your-turn
// strip when one shows) and their content scrolls under it; the strip floats under the bar and is not shown in the Office view.
if (want('glass-bar')) {
  const S = await scenario(10, { tag: 'glass', query: '?time=12:00', fixture: { statuses: ['working', 'waiting', 'working'] } });
  try {
    const ev = e => S.page.evaluate(e);
    const bad = [], rows = [];
    await S.page.setViewport(1500, 700, 1);
    for (const [view, sel] of [['ofis', '#view-ofis'], ['pano', '#view-pano'], ['akis', '#view-akis'], ['maliyet', '#view-maliyet']]) {
      await ev(`document.querySelector('.top [data-view="${view}"]').click()`);
      await sleep(900);
      const g = await ev(`(() => {
        const bar = document.querySelector('.top'), cs = getComputedStyle(bar), b = bar.getBoundingClientRect(), v = document.querySelector('${sel}'), st = document.getElementById('attention');
        const stripShown = !st.hidden && st.offsetParent !== null, sr = stripShown ? st.getBoundingClientRect() : null, vr = v.getBoundingClientRect(), vs = getComputedStyle(v);
        const kids = [...v.children].filter(c => c.offsetParent !== null && c.getBoundingClientRect().height > 0);
        return JSON.stringify({ pos: cs.position, blur: cs.backdropFilter, border: cs.borderTopColor, radius: cs.borderTopLeftRadius, bar: [b.left, b.top, b.right, b.bottom], vw: innerWidth, topH: getComputedStyle(document.documentElement).getPropertyValue('--top-h'),
          stripH: getComputedStyle(document.documentElement).getPropertyValue('--strip-h'), stripShown, strip: sr && [sr.top, sr.bottom], view: [vr.left, vr.top, vr.right, vr.bottom], pad: vs.paddingTop, firstTop: kids.length ? Math.min(...kids.map(c => c.getBoundingClientRect().top)) : null,
          scrolls: v.scrollHeight > v.clientHeight + 1 });
      })()`).then(JSON.parse);
      const L = view;
      if (g.pos !== 'absolute') bad.push(`${L}: the bar is ${g.pos}, not floating`);
      if (!/blur\(10px\)/.test(g.blur) || g.radius !== '18px' || !/196, 208, 255/.test(g.border)) bad.push(`${L}: the bar is not the glass card (${g.blur}, ${g.radius}, ${g.border})`);
      if (!(g.bar[0] >= 0 && g.bar[2] <= g.vw && g.bar[1] >= 0)) bad.push(`${L}: the bar leaves the window ${JSON.stringify(g.bar)}`);
      if (Math.abs(parseFloat(g.topH) - g.bar[3]) > 1) bad.push(`${L}: --top-h ${g.topH} is not the bar's bottom edge ${g.bar[3].toFixed(0)}`);
      if (Math.abs(g.view[1]) > 0.5) bad.push(`${L}: the view starts at ${g.view[1]}, not at the top of the page (it must fill it under the bar)`);
      if (view === 'ofis') {
        if (g.stripShown) bad.push('ofis: the your-turn strip shows over the map');
      } else {
        if (!g.stripShown) bad.push(`${L}: the fixture has a waiting chat but the your-turn strip is not shown`);
        else {
          if (g.strip[0] < g.bar[3] - 0.5) bad.push(`${L}: the strip (${g.strip[0].toFixed(0)}) is under the bar (${g.bar[3].toFixed(0)})`);
          if (g.firstTop !== null && g.firstTop < g.strip[1] - 0.5) bad.push(`${L}: the content starts at ${g.firstTop.toFixed(0)}, under the strip (${g.strip[1].toFixed(0)})`);
        }
        if (g.firstTop !== null && g.firstTop < g.bar[3] - 0.5) bad.push(`${L}: the content starts at ${g.firstTop.toFixed(0)}, under the bar (${g.bar[3].toFixed(0)})`);
      }
      rows.push(`${view}: bar ${g.bar.map(Math.round).join(',')}, ${g.stripShown ? 'strip ' + g.strip.map(Math.round).join('-') : 'no strip'}, content from ${g.firstTop === null ? '-' : Math.round(g.firstTop)}`);
    }
    // the content scrolls under the bar: scroll the dashboard in a short window and the first card must reach the bar's top edge
    await S.page.setViewport(1500, 380, 1);
    await ev(`document.querySelector('.top [data-view="pano"]').click()`);
    await sleep(700);
    const sc = await ev(`(() => { const v = document.querySelector('#view-pano'); v.scrollTop = 150; const bar = document.querySelector('.top').getBoundingClientRect(), t = [...v.querySelectorAll('.tile')].map(e => e.getBoundingClientRect().top); return JSON.stringify({ scrollTop: v.scrollTop, bottom: bar.bottom, minTop: Math.min(...t) }); })()`).then(JSON.parse);
    if (!(sc.scrollTop > 100 && sc.minTop < sc.bottom)) bad.push(`the dashboard does not scroll under the bar (scrollTop ${sc.scrollTop}, first tile at ${sc.minTop}, bar bottom ${sc.bottom})`);
    check('22-glass-bar', bad.length === 0 && S.page.errors.length === 0,
      bad.length ? `FAILED: ${bad.join('; ')}` : `the bar floats as the glass card (blur 10px, radius 18px, absolute) on all four pages; ${rows.join('; ')}; scrolled 150 px the dashboard's tiles pass under the bar (first tile at ${Math.round(sc.minTop)}, bar bottom ${Math.round(sc.bottom)}); errors ${S.page.errors.length}`);
  } finally { await S.done(); }
}

if (want('seasons')) {
  const man = JSON.parse(readFileSync(ROOT + 'public/pixel/manifest.json', 'utf8')), has = id => !!man.sprites[id];
  const S = await baseScenario(10, { tag: 'seasons', proj, query: '?time=12:00' });                    // no season given: the page decides
  try {
    const P = e => S.page.evaluate(px(e));
    const base = `http://127.0.0.1:${S.srv.port}/`;
    const rows = [];
    for (const sea of ['spring', 'summer', 'autumn', 'winter']) {
      await S.page.goto(`${base}?season=${sea}&time=12:00#ofis`, 800);
      await waitReady(S.page, 10);
      const info = await P(`({ season: p.season, seasonal: p.seasonal, attr: document.querySelector('#view-ofis').dataset.season, figures: p.figures().length, ids: [...p.layout.outdoor.items, ...p.layout.outdoor.tiles, ...p.layout.outer.tiles].map(i => i.id), from: p.settingsFrom.season, hash: p.stillHash() })`);
      const resolved = info.ids.map(id => [id, spriteFor(id, sea, has)]);
      rows.push({ sea, ...info, unresolved: resolved.filter(([, r]) => r !== null && !has(r)).length, expect: resolved.filter(([id, r]) => r && r !== id).length, errors: S.page.errors.length });
    }
    // the automatic season: no ?season=, so it follows the (pretended) date and the hemisphere
    await S.page.goto(`${base}?time=12:00#ofis`, 800);
    await waitReady(S.page, 10);
    const dates = [['2026-01-15', 'winter', 'summer'], ['2026-04-15', 'spring', 'autumn'], ['2026-07-15', 'summer', 'winter'], ['2026-10-15', 'autumn', 'spring']], auto = [];
    for (const hemi of ['north', 'south']) {
      await P(`p.setSetting('hemisphere', '${hemi}')`);
      for (const [d, n, s] of dates) auto.push({ hemi, d, got: (await P(`p.setDate('${d}')`)).season, want: hemi === 'north' ? n : s, from: (await P('p.settingsFrom')).season });
    }
    const hashes = new Set(rows.map(r => r.hash));
    const ok = rows.every(r => r.season === r.sea && r.attr === r.sea && r.from === 'url' && r.figures >= 10 && r.unresolved === 0 && r.seasonal.variants === r.expect && r.errors === 0 && (r.sea === 'summer' ? r.expect <= 2 : r.expect >= 40))
      && hashes.size === 4 && auto.every(a => a.got === a.want && a.from === 'default');
    check('12-seasons', ok,
      `?season=spring|summer|autumn|winter: ${rows.map(r => `${r.sea} ${r.seasonal.variants} of ${r.expect} expected seasonal sprites in the garden and the landscape tiles (${r.ids.length} outdoor pieces and ground tiles, unresolved ${r.unresolved}, picture ${r.hash.toString(16)})`).join('; ')}; four different pictures: ${hashes.size === 4}; ` +
      `automatic season by date: ${auto.map(a => `${a.hemi} ${a.d} ${a.got}`).join(', ')} (every one as expected: ${auto.every(a => a.got === a.want)}); outdoor sprite ids with a seasonal variant in the manifest: ${Object.keys(man.sprites).filter(id => id.includes('@')).length}; console errors ${S.page.errors.length}`);
  } finally { await S.done(); }
}

// ---- 13. weather: off costs nothing, every weather is capped and cheap, nothing runs hidden or with reduced motion, no network
if (want('weather')) {
  const S = await scenario(20, { tag: 'wx', query: '?time=12:00' });
  let off, table = [], hid, netBad, same, bow, noBow, port = 0;
  try {
    const P = e => S.page.evaluate(px(e));
    port = S.srv.port;
    const sample = async secs => { await P('(p.resetWeatherStats(), p.resetStats())'); await sleep(secs * 1000); return P('({ w: p.weather, active: p.active, scene95: p.frameP95(), sceneFrames: p.frames, fps: p.frameRate().fps, pixels: p.weatherPixels() })'); };
    off = await sample(3);                                                                     // off by default: the overlay does nothing at all
    S.page.requests.length = 0;
    const cases = [['rain', 'summer', 720, 'rain'], ['snow', 'summer', 720, 'snow'], ['fog', 'summer', 720, 'fog'], ['cloudy', 'summer', 720, 'cloud'],
      ['clear', 'spring', 720, 'petal'], ['clear', 'autumn', 720, 'leaf'], ['clear', 'winter', 720, 'flake'], ['clear', 'summer', 1320, 'firefly']];
    for (const [w, sea, min, kind] of cases) {
      await P(`p.setSetting('season', '${sea}')`); await P(`p.setTime(${min})`); await P(`p.setSetting('weather', '${w}')`);
      await sleep(400);
      const r = await sample(4);
      table.push({ label: `${w}${w === 'clear' ? ' ' + sea + (min > 1000 ? ' night' : '') : ''}`, kind, ...r });
    }
    // hidden: nothing is scheduled, nothing is drawn
    await P(`p.setSetting('weather', 'rain')`); await P('p.setTime(720)');
    await S.page.evaluate(`Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); document.dispatchEvent(new Event('visibilitychange'))`);
    await sleep(600);
    await P('(p.resetWeatherStats(), p.resetStats())');
    await sleep(2500);
    hid = await P('({ w: p.weather, stats: p.stats })');
    await S.page.evaluate(`delete document.hidden; document.dispatchEvent(new Event('visibilitychange'))`);
    // nothing was requested from anywhere while the weather ran
    const reqs = [...S.page.requests];
    netBad = reqs.filter(u => !u.startsWith(`http://127.0.0.1:${port}/`) || /weather|forecast|openweather|meteo/i.test(u));
    // the same date and season give the same automatic weather, in the page as in the unit test; a rainbow follows rain, rarely
    await P(`p.setSetting('weather', 'auto')`); await P(`p.setSetting('season', 'autumn')`);
    const A = [];
    for (const d of ['2026-10-28', '2026-10-29', '2026-11-03']) A.push({ d, a: (await P(`p.setDate('${d}')`)).weather, b: (await P(`p.setDate('${d}')`)).weather, want: weatherFor(d, 'autumn') });
    same = A;
    let bowDay = null, plainDay = null;
    for (let k = 0; k < 120 && (!bowDay || !plainDay); k++) { const d = addDays('2026-03-01', k); if (rainbowFor(d, 'spring')) bowDay ||= d; else if (weatherFor(d, 'spring') === 'clear') plainDay ||= d; }
    await P(`p.setSetting('season', 'spring')`); await P('p.setTime(720)');
    await P(`p.setDate('${bowDay}')`); await sleep(300); bow = await P('({ w: p.weather, pixels: p.weatherPixels() })');
    await P(`p.setDate('${plainDay}')`); await sleep(300); noBow = await P('({ w: p.weather })');
    bow.day = bowDay; noBow.day = plainDay;
  } finally { await S.done(); }

  // all agents asleep and rain on: the overlay alone runs (at most 10 fps) and the scene is not redrawn
  const D = await scenario(10, { tag: 'wxidle', query: '?time=12:00&weather=rain', fixture: { statuses: ['dormant'], subs: () => [] } });
  let idle;
  try {
    const P = e => D.page.evaluate(px(e));
    await sleep(2500);
    await P('(p.freeze(true), p.resetWeatherStats(), p.resetStats())');                  // live data frozen: a server tick would redraw the scene once
    await sleep(4000);
    idle = await P('({ w: p.weather, active: p.active, sceneFrames: p.frames, fps: p.frameRate().fps })');
  } finally { await D.done(); }
  // reduced motion: the weather is off whatever is set
  const R = await scenario(10, { tag: 'wxrm', reducedMotion: true, query: '?time=12:00&weather=rain' });
  let rm;
  try {
    const P = e => R.page.evaluate(px(e));
    await sleep(1500);
    await P('(p.resetWeatherStats(), p.resetStats())');
    await sleep(3000);
    rm = await P('({ w: p.weather, active: p.active, pixels: p.weatherPixels(), settings: p.settings })');
  } finally { await R.done(); }

  const live = table.filter(t => t.w.count > 0);
  const rowOk = t => t.w.count <= 120 && t.w.count > 0 && t.w.frames > 0 && t.w.p95 <= 1 && t.scene95 <= 4 && t.w.kind === t.kind && t.active.includes('weather') && t.w.cap === 120 && t.fps <= 10.1;
  check('13-weather',
    off.w.frames === 0 && off.w.weather === null && off.w.count === 0 && !off.active.includes('weather') && off.pixels === 0 &&
    table.length === 8 && table.every(rowOk) && live.length === 8 &&
    hid.w.frames === 0 && hid.stats.callbacks === 0 &&
    idle.w.frames >= 20 && idle.fps <= 10.1 && idle.fps >= 5 && idle.sceneFrames === 0 && idle.w.count > 0 &&
    rm.w.reduced === true && rm.w.weather === null && rm.w.count === 0 && rm.w.frames === 0 && !rm.active.includes('weather') && rm.pixels === 0 && rm.settings.weather === 'rain' &&
    netBad.length === 0 && same.every(x => x.a === x.b && x.a === x.want) && bow.w.rainbow === true && bow.w.weather === 'clear' && noBow.w.rainbow === false && S.page.errors.length === 0,
    `N=20, 1500x900, noon (JavaScript time only): weather off: ${off.w.frames} overlay frames in 3 s, particles ${off.w.count}, 'weather' among the animation sources ${off.active.includes('weather')}, overlay pixels drawn ${off.pixels}, scene p95 ${off.scene95} ms per frame; ` +
    `with weather on (4 s each): ${table.map(t => `${t.label}: ${t.w.count} particles (cap ${t.w.cap}), overlay p95 ${t.w.p95} ms (limit 1) over ${t.w.frames} frames, scene p95 ${t.scene95} ms, ${t.fps.toFixed(2)} fps`).join('; ')}; ` +
    `hidden (2.5 s, rain on): overlay frames ${hid.w.frames}, scheduler callbacks ${hid.stats.callbacks}; all agents asleep with rain on (4 s): overlay ${idle.w.frames} frames at ${idle.fps.toFixed(2)} fps, scene redraws ${idle.sceneFrames}, ${idle.w.count} particles; ` +
    `prefers-reduced-motion with ?weather=rain: weather shown ${rm.w.weather}, particles ${rm.w.count}, overlay frames ${rm.w.frames}, overlay pixels ${rm.pixels}, setting kept as ${rm.settings.weather}; ` +
    `network: requests while weather ran: not to 127.0.0.1 or naming weather: ${netBad.length}${netBad[0] ? ' (' + netBad[0] + ')' : ''}; ` +
    `automatic weather (autumn): ${same.map(x => `${x.d} ${x.a}/${x.b} (unit test ${x.want})`).join(', ')}; rainbow on ${bow.day} (clear after rain, spring): ${bow.w.rainbow}, none on ${noBow.day}: ${!noBow.w.rainbow}; console errors ${S.page.errors.length}`);
}

// ---- 14. settings popover: applied without a reload, remembered across a reload, URL overrides win
if (want('settings')) {
  const S = await baseScenario(4, { tag: 'settings', proj });                                // a fresh profile and no query: nothing stored, nothing overridden
  try {
    const ev = e => S.page.evaluate(e);
    const base = `http://127.0.0.1:${S.srv.port}/`;
    const st = () => ev(`(() => { const p = document.querySelector('#view-ofis').__pixel; const n = document.querySelector('#set-note'); return JSON.stringify({ settings: p.settings, from: p.settingsFrom, season: p.season, weather: p.weather.weather, wcount: p.weather.count, clock: p.time.clock, fixed: p.time.fixed, proj: p.proj, stored: localStorage.getItem('ajan-ofisi.settings'), url: location.search, origin: performance.timeOrigin, variants: p.seasonal && p.seasonal.variants, hash: p.stillHash(), note: n.hidden ? '' : n.textContent, open: !document.querySelector('#set-pop').hidden, shelfRows: p.shelf().rows.length, shelfSel: document.querySelector('#set-shelf').value, shelfOpts: [...document.querySelector('#set-shelf').options].map(o => o.value).join() }); })()`).then(JSON.parse);
    const sel = (id, v) => ev(`(() => { const s = document.querySelector('#${id}'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; })()`);
    const range = v => ev(`(() => { const s = document.querySelector('#set-time'); s.value = '${v}'; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    const click = async css => {
      const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(css)}); const b = e.getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return { x: b.left + b.width / 2, y: b.top + b.height / 2, ok: !!hit && (hit === e || e.contains(hit) || hit.contains(e)) }; })()`);
      await S.page.mouse.click(r.x, r.y);
      return r.ok;
    };
    const load = async q => { await S.page.goto(base + q + '#ofis', 800); await waitReady(S.page, 4); await sleep(300); return st(); };
    const settle = async (want_, ms = 9000) => { const t0 = Date.now(); let s = await st(); while (Date.now() - t0 < ms && !want_(s)) { await sleep(150); s = await st(); } return s; };
    await waitReady(S.page, 4);
    const s0 = await st();
    const opened = await click('#set-btn'); await sleep(250);
    const s1 = await st();
    await sel('set-season', 'winter'); await sleep(500); const s2 = await st();
    await sel('set-weather', 'rain'); await sleep(600); const s3 = await st();
    const fixedBtn = await click('#set-time-mode button[data-v="fixed"]'); await sleep(250);
    await ev(`document.querySelector('#set-time').scrollIntoView()`);
    await range(1320); await sleep(500); const s4 = await st();
    await sel('set-hemisphere', 'south'); await sleep(300); const s5 = await st();
    const camBtn = await click('#set-pop .proj-seg button[data-proj="front"]'); const s6 = await settle(s => s.proj === 'front');
    await click('#set-pop .proj-seg button[data-proj="iso"]'); const s6b = await settle(s => s.proj === 'iso');
    await sel('set-season', 'autumn'); await sel('set-weather', 'snow'); await range(390); await sel('set-shelf', '20'); await sleep(500); const s7 = await st();
    const s8 = await load('');                                                                // reload, no parameters: what was chosen is still there
    const s9 = await load('?season=spring&weather=fog&time=22:00&hemisphere=north&shelf=7');   // URL overrides win over what is stored, and are not stored
    await click('#set-btn'); await sleep(250); const s9n = await st();
    const s10 = await load('');                                                               // and the stored choice is back without them
    await load('?season=spring');
    await sel('set-season', 'winter'); await sleep(400); const s11 = await st();               // a change keeps an explicit parameter in step and is remembered
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const E = { time: '06:30', season: 'autumn', weather: 'snow', hemisphere: 'south', shelf: 20 };
    const ES = { ...E, project: 'off' };                                       // the settings in force: the setting `project` was never touched here, so it is at its default
    const fromAll = (f, v) => Object.entries(f).every(([k, x]) => x === (k === 'project' ? 'default' : v));
    const noReload = [s2, s3, s4, s5].every(x => x.origin === s1.origin);
    const C = {
      defaults: s0.settings.time === 'auto' && s0.settings.season === 'auto' && s0.settings.weather === 'off' && s0.settings.hemisphere === 'north' && s0.settings.shelf === 10 && s1.shelfSel === '10' && s1.shelfOpts === '5,10,20,50' && Object.values(s0.from).every(v => v === 'default') && s0.weather === null && s0.stored === null && !s0.open,
      opened: opened && s1.open,
      season: s2.season === 'winter' && s2.settings.season === 'winter' && s2.from.season === 'user' && /winter/.test(s2.stored) && s2.variants > 40 && s2.hash !== s1.hash,
      weather: s3.weather === 'rain' && s3.wcount >= 100 && s3.wcount <= 120,
      time: fixedBtn && s4.fixed && s4.clock === '22:00' && s4.settings.time === '22:00',
      hemisphere: s5.settings.hemisphere === 'south' && s5.clock === '22:00',
      noReload: noReload && s5.url === `?proj=${proj}`,
      camera: camBtn && s6.proj === 'front' && s6b.proj === 'iso',
      stored: same(s7.settings, ES) && same(JSON.parse(s7.stored), E) && s7.shelfSel === '20' && s7.settings.shelf === 20 && s7.from.shelf === 'user',
      reload: same(s8.settings, ES) && fromAll(s8.from, 'stored') && s8.season === 'autumn' && s8.weather === 'snow' && s8.wcount > 0 && s8.clock === '06:30' && s8.fixed && !s8.open,
      url: same(s9.settings, { time: '22:00', season: 'spring', weather: 'fog', hemisphere: 'north', shelf: 7, project: 'off' }) && s9n.shelfSel === '7' && s9n.shelfOpts === '5,7,10,20,50' && /\?\u2060?shelf=7/.test(s9n.note) && fromAll(s9.from, 'url') && s9.season === 'spring' && s9.weather === 'fog' && s9.clock === '22:00' && same(JSON.parse(s9.stored), E) && /\?\u2060?season=spring/.test(s9n.note),
      back: same(s10.settings, ES) && s10.season === 'autumn',
      keepUrl: /season=winter/.test(s11.url) && s11.season === 'winter' && JSON.parse(s11.stored).season === 'winter',
      noErrors: S.page.errors.length === 0,
    };
    const bad = Object.keys(C).filter(k => !C[k]), ok = bad.length === 0;
    check('14-settings', ok,
      `${ok ? '' : 'FAILED PARTS: ' + bad.join(', ') + '; '}fresh profile: defaults ${JSON.stringify(s0.settings)} (all from "default", weather off, nothing stored); popover opened by a click: ${s1.open}; no reload for any change (page origin unchanged ${noReload}): season select → ${s2.season} (${s2.variants} variants drawn, picture changed ${s2.hash !== s1.hash}, stored ${/winter/.test(s2.stored)}), weather select → ${s3.weather} (${s3.wcount} particles), time Fixed + slider → ${s4.clock} (fixed ${s4.fixed}), hemisphere → ${s5.settings.hemisphere}, camera buttons in the popover → ${s6.proj} then ${s6b.proj}, shelf size select (options ${s1.shelfOpts}, default ${s1.shelfSel}) → ${s7.settings.shelf} (stored, from "${s7.from.shelf}"); ` +
      `after the last changes stored ${s7.stored}; reload with no parameters: ${JSON.stringify(s8.settings)} (all from "${[...new Set(Object.values(s8.from))]}", clock ${s8.clock}, ${s8.wcount} particles); ` +
      `URL ?season=spring&weather=fog&time=22:00&hemisphere=north&shelf=7: ${JSON.stringify(s9.settings)} (from "${[...new Set(Object.values(s9.from))]}", store unchanged ${same(JSON.parse(s9.stored), E)}, popover note "${s9n.note.slice(0, 70)}", shelf select ${s9n.shelfSel} among ${s9n.shelfOpts}); plain reload again: ${JSON.stringify(s10.settings)}; changing the season with ?season=spring in the URL: URL now "${s11.url}", stored season ${JSON.parse(s11.stored).season}; console errors ${S.page.errors.length}`);
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
  } else if (shotSet === 'm5') {
    // M5: this projection with 10 live and 12 closed chats at midday: the scene with the shelf, the shelf folded away, and the details panel
    // open on a closed chat (clicked on the shelf) and on a live one (clicked on its figure in a room)
    const S = await scenario(10, { tag: 'shots5', dpr: 2, query: '?time=12:00', fixture: { closed: 12 } });
    try {
      const P = e => S.page.evaluate(px(e)), ev = e => S.page.evaluate(e);
      const closeDrawer = async () => { await ev(`document.querySelector('#dw-close') && document.querySelector('#dw-close').click()`); await sleep(700); };
      await sleep(1200);
      await snap(S, `m5-${proj}-shelf.png`);
      // a closed chat: its entry on the shelf
      const closedId = S.fx.closed.slice().sort((a, b) => b.closedAt - a.closedAt)[2].id;
      const r = await ev(`(() => { const b = document.querySelector('.sh-list li[data-id="${closedId}"]').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
      await S.page.mouse.click(r.x, r.y);
      await sleep(800);
      await snap(S, `m5-${proj}-details-closed.png`);
      await closeDrawer();
      // a live chat: its figure in a room
      await P('p.freeze(true)');
      const A = await ev(`document.querySelector('#view-ofis .of-area').getBoundingClientRect().toJSON()`);
      let hit = null;
      for (const a of S.agents.filter(q => q.kind === 'main' && q.status === 'working')) {
        const f = await P(`p.agentCss(${JSON.stringify(a.id)})`);
        if (!f || f.x < 20 || f.y < 20 || f.x > A.width - 20 || f.y > A.height - 20) continue;
        const x = A.left + f.x, y = A.top + f.y;
        if (!(await ev(`(()=>{const e=document.elementFromPoint(${x},${y}); return !!e && !e.closest('.px-l, .of-ctl, .of-hud, .of-shelf, .of-card, header, #attention')})()`))) continue;
        hit = { x, y };
        break;
      }
      if (!hit) throw new Error('no clickable figure for the live details picture');
      await S.page.mouse.click(hit.x, hit.y);
      await sleep(800);
      await snap(S, `m5-${proj}-details-live.png`);
      await closeDrawer();
      await P('p.freeze(false)');
      await P('p.setShelfFolded(true)');
      await sleep(600);
      await snap(S, `m5-${proj}-shelf-folded.png`);
    } finally { await S.done(); }
  } else if (shotSet === 'm4') {
    // M4: this projection, four agents: the four seasons clear, rain in summer, snow in winter, fog in autumn, each in the morning, the evening
    // and at night (the date is pretended so that the light is the season's: evening is a little after sunset), plus a rainbow after rain
    const DAY = { spring: ['2026-04-15', 19 * 60], summer: ['2026-07-15', 19 * 60 + 50], autumn: ['2026-10-15', 17 * 60 + 50], winter: ['2026-01-15', 17 * 60 + 15] };
    const SCENES = [['spring-clear', 'spring', 'clear'], ['summer-clear', 'summer', 'clear'], ['autumn-clear', 'autumn', 'clear'], ['winter-clear', 'winter', 'clear'],
      ['summer-rain', 'summer', 'rain'], ['winter-snow', 'winter', 'snow'], ['autumn-fog', 'autumn', 'fog']];
    const S = await scenario(4, { tag: 'shots4', dpr: 1, query: '?time=12:00' });
    try {
      const P = e => S.page.evaluate(px(e));
      for (const [name, sea, weather] of SCENES) {
        const [date, evening] = DAY[sea];
        await P(`p.setSetting('season', '${sea}')`); await P(`p.setSetting('weather', '${weather}')`); await P(`p.setDate('${date}')`);
        for (const [when, min] of [['morning', 7 * 60 + 45], ['evening', evening], ['night', 22 * 60 + 30]]) {
          await P(`p.setTime(${min})`);
          await sleep(500);
          await snap(S, `m4-${proj}-${name}-${when}.png`);
        }
      }
      let bow = null;
      for (let k = 0; k < 120 && !bow; k++) { const d = addDays('2026-03-01', k); if (rainbowFor(d, 'spring')) bow = d; }
      await P(`p.setSetting('season', 'spring')`); await P(`p.setSetting('weather', 'auto')`); await P(`p.setDate('${bow}')`); await P('p.setTime(780)');
      await sleep(500);
      await snap(S, `m4-${proj}-rainbow-day.png`);
      console.log('rainbow day', bow, JSON.stringify(await P('({ weather: p.weather.weather, rainbow: p.weather.rainbow })')));
    } finally { await S.done(); }
    console.log(`CONTACT sheet lists ${contactSheet(shotsDir)} pictures`);
  } else {
    const S10 = await scenario(10, { tag: 'shots', dpr: 2, query: '?time=12:00' });
    try {
      const P = e => S10.page.evaluate(px(e));
      const mains = S10.agents.filter(a => a.kind === 'main' && a.status !== 'dormant'), waiting = mains.find(a => a.status === 'waiting' || a.status === 'ask');
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
