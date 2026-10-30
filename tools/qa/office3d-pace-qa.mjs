// QA of the frame pacing: when the 3D scene draws (public/js/ofis-pace.js, wired in public/js/ofis.js, the rules and their reasons in docs/pacing.md). Headless Chrome with software
// WebGL in a throw-away profile (harness3d.mjs), the server against a fake ~/.claude, one `CHECK <name> PASS|FAIL <detail>` line per check and a final `QA PASS` or `QA FAIL`.
//   node tools/qa/office3d-pace-qa.mjs [--only decide|rates] [--mutations [--mutation <words>|<more words>]] [--verify-mutations]
//
// Headless Chrome here is software GL: it draws on the CPU, 8 frames a second, and no machine time is the machine's of the user. So this QA never reads a frame time. It reads DECISIONS:
//   decide (real time, the scene as software GL runs it: the pacer still decides, and says so on root.__ofis.pacing)
//     3d-pace-walkin   people walk in: the scene is moving in at least 95 percent of the readings while anybody walks (the pacer's decision), and the detection (`busy`) is on in every frame of a walk
//     3d-pace-rest     everybody seated and typing, the cars driving, the river flowing, the lamps flickering: 0 of at least 38 readings over 6 s are moving, no frame is busy, nothing casts
//     3d-pace-wake     each of pointermove, pointerdown, pointerup, wheel, keydown, touchmove (on the Office element itself), a visibilitychange to visible, and a camera move make the very next
//                      reading moving and are over 1.6 s later; a real wheel turn and a real mouse move do the same
//     3d-pace-hold     the scene stays moving 0.9 to 1.3 s after the last signal
//     3d-pace-sit      a figure that sits down is moving until it has sat (every frame in which a seated figure is more than 2 percent short of its seat is busy)
//     3d-pace-leave    a sub-agent that leaves (stands up, walks, the door) is moving all the way, and the scene is at rest after it
//     3d-pace-door     a door that swings with nobody walking and nobody sitting down (the walker was removed in the doorway) is motion, in every frame it moves
//     3d-pace-shadow   the shadow map is asked for again in every drawn frame while a figure walks, and at most once per 400 ms at rest (the decisions, counted by the pacer)
//     3d-pace-errors   no console error
//   rates (a virtual display: the page's animation frames and its clock are driven by this QA, one frame every 8.33 ms = 120 Hz, and the page believes it has a real GPU, so shadows are on
//   and the pacer is in its hardware profile; software GL then only has to run the frames that are drawn)
//     3d-pace-rate-moving  while people walk every animation frame is drawn (120 fps), with the window not focused (headless: document.hasFocus() is false)
//     3d-pace-rate-idle    at rest 30 frames a second
//     3d-pace-rate-deep    after a minute of nothing 15 frames a second, and a wake gives the display rate again at the very next frame
//     3d-pace-rate-shadow  the shadow map: one pass in three frames while somebody walks (25 ms), at most one per 400 ms at rest; every pass the pacer asks for is a pass the renderer draws
//                          (draw calls jump by the shadow pass in exactly those frames)
//     3d-pace-guard        a machine whose animation frames come late (a third of them one frame late) is drawn at half the rate after a few seconds: the gap guard
//
// --mutations breaks the code in a copy of the repo, one line at a time, and runs the checks that guard that line: every one must FAIL there. --verify-mutations only checks that every line
// to break is in the code exactly once (after a change to ofis.js or ofis-pace.js that moves or rewrites one).
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scenario3d, o3, sleep, ROOT } from './harness3d.mjs';

const args = process.argv.slice(2);
const val = f => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : undefined; };
const only = val('only');

const OPTIONAL = /\/local\/ofis-extras\.js/;
const errorsOf = page => page.errors.filter(e => !OPTIONAL.test(e));
const make = (name, ok, detail) => ({ name, ok, detail });
const f1 = n => (+n).toFixed(1);
const ev = (page, expr) => page.evaluate(o3(expr));
const until = async (fn, ms = 60000, step = 150) => { const t0 = Date.now(); for (;;) { const r = await fn(); if (r) return r; if (Date.now() - t0 > ms) return null; await sleep(step); } };

// ---- what runs in the page
// q.chat(id) is a copy of the first working chat, q.sub(chat, id) a copy of the first sub-agent, q.remove(id) takes either out (a chat with its sub-agents)
const HELPERS = `(async () => {
  const { store } = await import('/js/main.js');
  const v = document.querySelector('#view-ofis');
  const clone = o => JSON.parse(JSON.stringify(o));
  let seq = 0;
  window.__qa = {
    sub(chatId, id, status = 'working') {
      const base = [...store.agents.values()].find(a => a.kind === 'sub');
      const a = Object.assign(clone(base), { id, parent: chatId, status, started: Date.now() + (++seq), since: Date.now(), desc: id });
      store.agents.set(id, a);
      store.agents.get(chatId).subs.push(id);
    },
    remove(id) {
      const a = store.agents.get(id);
      if (!a) return;
      if (a.kind === 'sub') { const p = store.agents.get(a.parent); if (p) p.subs = p.subs.filter(s => s !== id); } else for (const s of a.subs) store.agents.delete(s);
      store.agents.delete(id);
    },
    mainId() { return [...store.agents.values()].find(a => a.kind === 'main' && a.status === 'working').id; },
    sync() { v.__ofis.sync(); },
  };
  return true;
})()`;
const qa = (page, code) => page.evaluate(`(() => { const q = window.__qa; ${code} })()`);

// a record of every frame the scene draws: what the pacer decided and found (busy: the detection of this frame's step; moving: the decision with its hold), how many walk, which seated
// figure is still sitting down, how far each door moved since the last frame, the shadow requests counted so far, and the draw calls of the frame
const RECORDER = `(() => {
  const v = document.querySelector('#view-ofis'), o = v.__ofis3d, s = v.__ofis;
  const R = window.__pq = { rec: [], stop: false };
  let last = -1, prev = null;
  const k = () => {
    if (R.stop) return;
    if (o.frameNo !== last) {
      last = o.frameNo;
      const p = s.pacing, doors = o.doors().map(d => d.open);
      let dm = 0; if (prev && prev.length === doors.length) for (let i = 0; i < doors.length; i++) dm = Math.max(dm, Math.abs(doors[i] - prev[i]));
      prev = doors;
      const sit = o.sitting();
      R.rec.push({ t: performance.now(), n: last, busy: p.busy, moving: p.moving, casters: p.casters, walking: s.walking.length, sitting: sit.some(c => c.mode === 'seated' && Math.abs(c.sit - 1) > 0.02), door: dm, doorOpen: Math.max(0, ...doors), shadows: p.shadows, drawn: p.drawn, calls: o.info.calls });
      if (R.rec.length > 20000) R.rec.shift();
    }
    requestAnimationFrame(k);
  };
  requestAnimationFrame(k);
  R.mark = () => R.rec.length;
  R.since = i => R.rec.slice(i);
  return true;
})()`;
const mark = page => page.evaluate('window.__pq.mark()');
const since = (page, i) => page.evaluate(`window.__pq.since(${i})`);
const share = (rows, f) => (rows.length ? rows.filter(f).length / rows.length : 1);
const pct = x => (x * 100).toFixed(0) + '%';

// a read of the decision every `step` ms for `ms`: [t, moving, busy, walking]
const sample = (page, ms, step = 120) => page.evaluate(o3(`new Promise(res => { const t0 = performance.now(), out = []; const k = () => { const p = s.pacing; out.push([Math.round(performance.now() - t0), p.moving ? 1 : 0, p.busy ? 1 : 0, s.walking.length]); if (performance.now() - t0 < ${ms}) setTimeout(k, ${step}); else res(out); }; k(); })`));
const frac = (a, i = 1) => (a.length ? a.filter(x => x[i]).length / a.length : 0);

// ---- the checks in real time: software GL, the scene as it is in headless Chrome
async function runDecide({ root, want }) {
  const out = [];
  const W = n => !want || want.has(n);
  const S = await scenario3d(3, { tag: 'pace', width: 1280, height: 800, root, settle: false });
  try {
    const { page } = S;
    await page.evaluate(HELPERS); await page.evaluate(RECORDER);
    // 1. the walk-in: moving while anybody walks, and the sit-down at the end of each walk
    if (W('3d-pace-walkin') || W('3d-pace-sit')) {
    const i0 = await mark(page);
    const walkSamples = [];
    for (let i = 0; i < 400 && (await ev(page, 's.walking.length')) > 0; i++) { walkSamples.push(...(await sample(page, 600, 100))); }
    await sleep(1500);                                                       // the last one to arrive sits down
    const walk = await since(page, i0);
    const walkers = walk.filter(r => r.walking > 0), sitting = walk.filter(r => r.sitting && r.walking === 0);
    const w = walkSamples.filter(x => x[3] > 0);
    out.push(make('3d-pace-walkin', walkers.length >= 20 && w.length >= 20 && frac(w) >= 0.95 && share(walkers, r => r.busy) >= 0.99,
      `${w.length} readings with somebody walking: ${pct(frac(w))} moving (at least 95%); ${walkers.length} frames with a walker: ${pct(share(walkers, r => r.busy))} busy (all)`));
    out.push(make('3d-pace-sit', sitting.length >= 2 && share(sitting, r => r.busy) >= 0.99, `${sitting.length} frames in which nobody walks and a figure is still sitting down: ${pct(share(sitting, r => r.busy))} busy (all)`));
    }

    // 2. at rest: nobody walks, everybody sits and types, the cars drive, the lamps flicker: nothing moves
    await ev(page, 's.settle()');
    await sleep(3500);
    if (W('3d-pace-rest')) {
    const typing = await ev(page, 'o.sitting().filter(c => c.mode === "seated" && c.sit > 0.99).length');
    const r0 = await mark(page);
    const rest = await sample(page, 6000, 150);
    const restFrames = await since(page, r0);
    const sum = await ev(page, 's.pacingSeconds(5).summary');
    out.push(make('3d-pace-rest', typing >= 3 && rest.length >= 38 && frac(rest) === 0 && share(restFrames, r => r.busy || r.casters) === 0 && restFrames.length >= 10 && sum.movingShare === 0,
      `${typing} figures seated; ${rest.length} readings over 6 s: ${rest.filter(x => x[1]).length} moving; ${restFrames.length} frames: ${restFrames.filter(r => r.busy || r.casters).length} busy or casting; moving share of the last 5 s ${sum.movingShare}`));
    }

    // 3. the signals: each makes the next reading moving and lets go after the hold
    if (W('3d-pace-wake')) {
      const wake = [];
      const events = [
        ['pointermove', "new PointerEvent('pointermove', { bubbles: true })"], ['pointerdown', "new PointerEvent('pointerdown', { bubbles: true })"], ['pointerup', "new PointerEvent('pointerup', { bubbles: true })"],
        ['wheel', "new WheelEvent('wheel', { bubbles: true, deltaY: 10 })"], ['keydown', "new KeyboardEvent('keydown', { bubbles: true, key: 'a' })"], ['touchmove', "new Event('touchmove', { bubbles: true })"],
      ];
      for (const [name, make_] of events) {
        const first = await ev(page, `(() => { v.dispatchEvent(${make_}); return s.pacing.moving; })()`);
        await sleep(1700);
        const later = await ev(page, 's.pacing.moving');
        wake.push({ name, first, later });
      }
      // a visibilitychange to visible, and a camera move (what every pan, zoom, fit and resize ends in)
      const vis = await ev(page, '(() => { document.dispatchEvent(new Event("visibilitychange")); return s.pacing.moving; })()');
      await sleep(1700);
      const visLater = await ev(page, 's.pacing.moving');
      wake.push({ name: 'visibilitychange', first: vis, later: visLater });
      const cam = await ev(page, '(() => { const z = s.zoom; o.view(0, 0, 0, z); return s.pacing.moving; })()');
      await sleep(1700);
      wake.push({ name: 'camera', first: cam, later: await ev(page, 's.pacing.moving') });
      // the real thing: a wheel turn and a mouse move over the scene
      await page.mouse.move(600, 400);
      const mm = await ev(page, 's.pacing.moving');
      await sleep(1700);
      wake.push({ name: 'real mouse move', first: mm, later: await ev(page, 's.pacing.moving') });
      await page.mouse.wheel(600, 400, -60);
      const rw = await ev(page, 's.pacing.moving');
      await sleep(1700);
      wake.push({ name: 'real wheel', first: rw, later: await ev(page, 's.pacing.moving') });
      const badWake = wake.filter(x => !x.first || x.later);
      out.push(make('3d-pace-wake', badWake.length === 0, `${wake.length} signals: ${wake.map(x => `${x.name} ${x.first ? 'moving' : 'NOT moving'} then ${x.later ? 'STILL moving' : 'at rest'}`).join('; ')}`));
    }

    // 4. the hold: from the last signal to rest, measured in the page frame by frame
    if (W('3d-pace-hold')) {
      const hold = await ev(page, `new Promise(res => { const t0 = performance.now(); v.dispatchEvent(new PointerEvent('pointermove', { bubbles: true })); const k = () => { if (!s.pacing.moving) res(performance.now() - t0); else if (performance.now() - t0 > 4000) res(-1); else requestAnimationFrame(k); }; requestAnimationFrame(k); })`);
      out.push(make('3d-pace-hold', hold >= 900 && hold <= 1300, `moving for ${f1(hold)} ms after the signal (0.9 to 1.3 s)`));
    }

    // the chat whose office is nearest to the entrance (the walks of the scene run on its own clock, which software GL slows: a short walk keeps the checks short)
    const chat = await ev(page, `(() => { const L = r => r.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - r[i - 1][0], p[1] - r[i - 1][1]) : 0), 0); return o.sitting().filter(c => c.main).map(c => [c.id, L(o.routeOf(c.id) || [])]).sort((a, b) => a[1] - b[1])[0][0]; })()`);
    // 5. a sub-agent that leaves: it stands up, walks to the entrance through the door, is removed; moving all the way, at rest after
    if (W('3d-pace-leave')) {
      await qa(page, `q.sub(${JSON.stringify(chat)}, 'pace-sub-1'); q.sync();`);
      await until(async () => (await ev(page, 'o.figures().some(f => f.id === "pace-sub-1" && f.mode === "walk")')), 20000, 100);
      await ev(page, 's.settle()');
      await sleep(2500);
      const l0 = await mark(page);
      await qa(page, `q.remove('pace-sub-1'); q.sync();`);
      await sleep(500);
      await until(async () => (await ev(page, 's.walking.length')) === 0 && !(await ev(page, 'o.figures().some(f => f.id === "pace-sub-1")')), 150000, 250);
      const leave = await since(page, l0);
      const lw = leave.filter(r => r.walking > 0);
      await sleep(1800);
      const after = await ev(page, 's.pacing.moving');
      out.push(make('3d-pace-leave', lw.length >= 10 && share(lw, r => r.busy) >= 0.99 && share(lw, r => r.moving) >= 0.99 && !after, `${lw.length} frames with the sub-agent standing up or walking: ${pct(share(lw, r => r.busy))} busy, ${pct(share(lw, r => r.moving))} moving; at rest 1.8 s after it was gone: ${!after}`));
    }

    // 6. the door alone: a sub-agent walks in and is in a doorway with the door open; the walk ends on the spot (the QA hook), nobody walks and nobody sits down, and the door closes
    if (W('3d-pace-door')) {
      const doorChat = await ev(page, '(o.doors().find(d => !d.vacant) || {}).id');          // an office with a hinged door (the others have an open doorway)
      await qa(page, `q.sub(${JSON.stringify(doorChat)}, 'pace-sub-2'); q.sync();`);
      const inDoor = await until(async () => (await ev(page, 'o.doors().some(d => d.open > 0.6) && s.walking.length > 0')), 150000, 50);
      await ev(page, 's.settle()');
      const d0 = await mark(page);
      await sleep(2500);
      const door = await since(page, d0);
      const still = door.filter(r => r.walking === 0 && !r.sitting), moved = still.filter(r => r.door > 0.002);
      out.push(make('3d-pace-door', !!inDoor && moved.length >= 2 && share(moved, r => r.busy) >= 0.99, `${moved.length} frames in which a door moved with nobody walking or sitting down (of ${door.length} recorded, ${door.length - still.length} others): ${pct(share(moved, r => r.busy))} busy (all); the door was open ${inDoor ? 'when the walk ended' : 'NEVER (no door was caught)'}`));
      await qa(page, `q.remove('pace-sub-2'); q.sync();`);
    }

    // 7. the shadow map: asked for in every drawn frame while a figure walks, rarely at rest (the pacer's own counter; software GL draws no shadows)
    if (W('3d-pace-shadow')) {
      await ev(page, 's.settle()');
      await sleep(4500);
      const q0 = await ev(page, 's.pacing');
      await sleep(6000);
      const q1 = await ev(page, 's.pacing');
      const idleShadows = q1.shadows - q0.shadows, idleDrawn = q1.drawn - q0.drawn;
      await qa(page, `q.sub(${JSON.stringify(chat)}, 'pace-sub-3'); q.sync();`);
      await sleep(500);
      const a0 = await ev(page, 's.pacing');
      await sleep(5000);
      const a1 = await ev(page, 's.pacing');
      const walkShadows = a1.shadows - a0.shadows, walkDrawn = a1.drawn - a0.drawn;
      out.push(make('3d-pace-shadow', idleDrawn >= 20 && idleShadows <= 6000 / 400 + 1 && walkDrawn >= 20 && walkShadows >= 0.9 * walkDrawn,
        `at rest ${idleShadows} shadow requests in 6 s (at most ${6000 / 400 + 1}) with ${idleDrawn} frames drawn; while a figure walks ${walkShadows} in ${walkDrawn} frames drawn (at least 90%)`));
    }

    out.push(make('3d-pace-errors', errorsOf(page).length === 0, errorsOf(page).slice(0, 2).join(' | ') || 'none'));
  } finally { await S.done(); }
  return out;
}

// ---- the checks on a virtual display: the animation frames and the clock are this QA's, the GPU is claimed real (shadows on, the pacer in its hardware profile)
const VT = `(() => {
  const realRaf = window.requestAnimationFrame.bind(window), realCaf = window.cancelAnimationFrame.bind(window), realNow = performance.now.bind(performance);
  const vt = window.__vt = { on: false, now: 0, q: new Map(), n: 0 };
  window.requestAnimationFrame = cb => { if (!vt.on) return realRaf(cb); const id = ++vt.n + 1e9; vt.q.set(id, cb); return id; };
  window.cancelAnimationFrame = id => { if (vt.q.delete(id)) return; realCaf(id); };
  performance.now = () => (vt.on ? vt.now : realNow());
  vt.start = () => { vt.now = realNow(); vt.on = true; };
  vt.tick = ms => { vt.now += ms; const cbs = [...vt.q.values()]; vt.q.clear(); for (const cb of cbs) { try { cb(vt.now); } catch (e) { console.error(e); } } };
  const fake = orig => function (p) { return p === 0x9246 ? 'ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro, Unspecified Version)' : orig.call(this, p); };
  WebGLRenderingContext.prototype.getParameter = fake(WebGLRenderingContext.prototype.getParameter);
  WebGL2RenderingContext.prototype.getParameter = fake(WebGL2RenderingContext.prototype.getParameter);
})()`;
// n ticks of the virtual display, `ms` apart (`late`: the share of ticks that come one frame late, as a browser that cannot keep up hands them over); what the pacer did in each: [drawn, moving, busy, shadows, calls, gapSkip, skip, casters]
const TICKS = (n, ms = 1000 / 120, late = 0, wake = false) => o3(`(async () => {
  const out = []; let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < ${n}; i++) {
    const p0 = s.pacing, f0 = o.frameNo;
    if (${wake}) v.dispatchEvent(new Event('pointermove'));
    __vt.tick(${late} && rnd() < ${late} ? ${ms} * 2 : ${ms});
    const p = s.pacing, drawn = o.frameNo - f0;
    out.push([drawn, p.moving ? 1 : 0, p.busy ? 1 : 0, p.shadows - p0.shadows, drawn ? o.info.calls : 0, p.gapSkip, p.skip, p.casters ? 1 : 0]);
    if (i % 8 === 7) await new Promise(r => setTimeout(r, 0));
  }
  return out; })()`);
const sum = (a, i) => a.reduce((x, r) => x + r[i], 0);

async function runRates({ root }) {
  const out = [];
  const S = await scenario3d(3, { tag: 'pacev', width: 400, height: 260, root, settle: false, intercept: async page => { await page.send('Page.addScriptToEvaluateOnNewDocument', { source: VT }); } });
  try {
    const { page } = S;
    await page.evaluate(HELPERS);
    const hw = await ev(page, 's.pacing.softwareGL');
    // from here the page's clock is ours; one real frame lets the animation frame that was already asked for go by
    await page.evaluate('window.__vt.start()');
    // the animation frame that was already asked for in real time goes by and asks for the next one in the virtual queue (a busy machine can take a while); then the clock jumps ahead of anything real
    await until(async () => (await page.evaluate('window.__vt.q.size')) > 0, 60000, 100);
    await page.evaluate('window.__vt.tick(5000)');
    await ev(page, 's.settle()');
    // warm-up: the frames of the real-time start (compiling shaders on the CPU) cost seconds, and the cost guard rightly drew every 4th frame; the virtual clock has no cost, so it settles
    await page.evaluate(TICKS(260));
    for (let i = 0; i < 6 && (await ev(page, 's.pacing.cost')) > 1; i++) await page.evaluate(TICKS(120));
    await page.evaluate(TICKS(130));                                                      // the hold of the last signal is over: at rest
    const focus = await ev(page, 's.pacing.hasFocus');

    // idle: 30 frames a second, 3 s
    const idle = await page.evaluate(TICKS(360));
    const idleFps = sum(idle, 0) / 3, idleMoving = sum(idle, 1);
    out.push(make('3d-pace-rate-idle', !hw && idleMoving === 0 && Math.abs(idleFps - 30) <= 1.5, `software GL claimed off: ${!hw}; at rest ${f1(idleFps)} frames a second over 3 s (30), ${idleMoving} moving readings`));

    // the shadow map at rest: the passes asked for, and the frames whose draw calls jump by a pass
    const jumpsOf = rows => { const c = rows.filter(r => r[0]).map(r => r[4]).sort((a, b) => a - b), b = c[Math.floor(c.length / 2)]; return { base: b, jumps: rows.filter(r => r[0] && r[4] > b + 8).length }; };
    const idleShadows = sum(idle, 3), idleJ = jumpsOf(idle);
    // deep idle: a minute of nothing (the clock jumps 61 s: one stall), then 15 frames a second; a wake gives the display rate again at the very next frame
    await page.evaluate('window.__vt.tick(61000)');
    await page.evaluate(TICKS(40));
    const deep = await page.evaluate(TICKS(240));
    const deepFps = sum(deep, 0) / 2;
    await ev(page, 'v.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }))');
    const wake = await page.evaluate(TICKS(6));
    out.push(make('3d-pace-rate-deep', Math.abs(deepFps - 15) <= 1.5 && wake[0][0] === 1 && wake.every(r => r[0] === 1), `after a minute of nothing ${f1(deepFps)} frames a second over 2 s (15); after a wake the next ${wake.length} animation frames drew ${sum(wake, 0)}`));

    // people walk in (a sub-agent, made now): every animation frame is drawn, with the window not focused; the shadow map follows the walkers
    const chat = await qa(page, 'return q.mainId();');
    await qa(page, `q.sub(${JSON.stringify(chat)}, 'pace-v1'); q.sub(${JSON.stringify(chat)}, 'pace-v2'); q.sync();`);
    await page.evaluate(TICKS(60));
    const walkers = await ev(page, 's.walking.length');
    const mv = await page.evaluate(TICKS(240));
    const mvFps = sum(mv, 0) / 2, mvJ = jumpsOf(mv);
    out.push(make('3d-pace-rate-moving', walkers > 0 && !focus && mv.every(r => r[1] === 1) && Math.abs(mvFps - 120) <= 3, `${walkers} walking, document.hasFocus() ${focus}; ${f1(mvFps)} frames drawn a second over 2 s (120, every animation frame), ${sum(mv, 1)} of ${mv.length} readings moving`));
    const shadows = sum(mv, 3);
    const casting = sum(mv, 7), expected = casting / 3;                       // a figure that waits at the entrance is moving but casts nothing: the passes follow the frames with a caster
    out.push(make('3d-pace-rate-shadow', walkers > 0 && casting >= 100 && Math.abs(shadows - expected) <= 0.15 * expected + 4 && Math.abs(mvJ.jumps - shadows) <= 2 && idleShadows >= 1 && idleShadows <= 8 && Math.abs(idleJ.jumps - idleShadows) <= 1,
      `walking: ${shadows} shadow passes asked for in 2 s (one in three frames with a caster: ${f1(expected)}; casters in ${casting} of ${mv.length} frames), ${mvJ.jumps} frames drew the pass (calls above ${mvJ.base + 8}); at rest ${idleShadows} asked for in 3 s (at most one per 400 ms: 8), ${idleJ.jumps} frames drew the pass`));

    // the guard: a third of the animation frames come one frame late while people walk
    const g0 = await ev(page, 's.pacing.gapSkip');
    await page.evaluate(TICKS(360, 1000 / 120, 0.35, true));
    const g1 = await ev(page, 's.pacing.gapSkip');
    const tail = await page.evaluate(TICKS(240, 1000 / 120, 0.35, true));
    out.push(make('3d-pace-guard', g0 === 1 && g1 >= 2 && sum(tail, 0) < 0.75 * tail.length, `before ${g0}; after 360 animation frames, a third of which come late, the guard is at ${g1} (2 or more); ${sum(tail, 0)} of the next ${tail.length} animation frames drawn (fewer than 75%)`));
  } finally { await S.done(); }
  return out;
}

const CHECKS = { decide: runDecide, rates: runRates };
const GROUP = { '3d-pace-walkin': 'decide', '3d-pace-sit': 'decide', '3d-pace-rest': 'decide', '3d-pace-wake': 'decide', '3d-pace-hold': 'decide', '3d-pace-leave': 'decide', '3d-pace-door': 'decide', '3d-pace-shadow': 'decide', '3d-pace-errors': 'decide',
  '3d-pace-rate-moving': 'rates', '3d-pace-rate-idle': 'rates', '3d-pace-rate-deep': 'rates', '3d-pace-rate-shadow': 'rates', '3d-pace-guard': 'rates' };

// ---- mutations: break one line in a copy of the repo and expect the check that guards it to fail
const MUTATIONS = [
  { name: 'the detection of motion in step() is gone (a walker is not motion)', file: 'public/js/ofis.js', from: '    paceFigures(T);\n', to: '', fails: ['3d-pace-walkin', '3d-pace-leave'] },
  { name: 'a figure that walks is not busy', file: 'public/js/ofis.js', from: '        } else { c.paceQ = undefined; busy = casters = true; }', to: '        } else { c.paceQ = undefined; }', fails: ['3d-pace-walkin'] },
  { name: 'a figure that sits down or stands up is not motion', file: 'public/js/ofis.js', from: 'if (Math.abs(c.sit - (c.mode === \'seated\' ? 1 : 0)) > PACE_EPS || Math.abs(angTo(c.heading, c.th, 1) - c.heading) > PACE_EPS) busy = casters = true;', to: '', fails: ['3d-pace-sit'] },
  { name: 'a door that swings is not motion', file: 'public/js/ofis.js', from: '    paceDoors(false);\n', to: '', fails: ['3d-pace-door'] },
  { name: 'the wheel does not wake the pacer', file: 'public/js/ofis.js', from: "for (const ev of ['pointermove', 'pointerdown', 'pointerup', 'wheel', 'keydown', 'touchmove']) {", to: "for (const ev of ['pointermove', 'pointerdown', 'pointerup', 'keydown', 'touchmove']) {", fails: ['3d-pace-wake'] },
  { name: 'a camera move does not wake the pacer', file: 'public/js/ofis.js', from: '    pacer.wake(performance.now());                          // every pan, zoom, fit and resize is motion\n', to: '', fails: ['3d-pace-wake'] },
  { name: 'the hold after the last signal is 0', file: 'public/js/ofis-pace.js', from: 'export const HOLD_MS = 1000;', to: 'export const HOLD_MS = 0;', fails: ['3d-pace-hold'] },
  { name: 'the shadow map is drawn every 1e9 ms while something moves', file: 'public/js/ofis-pace.js', from: 'export const SHADOW_MOVING_MS = 25;', to: 'export const SHADOW_MOVING_MS = 1e9;', fails: ['3d-pace-shadow', '3d-pace-rate-shadow'] },
  { name: 'nothing is ever a shadow caster', file: 'public/js/ofis.js', from: '      if (pacer.shadow(now, casters)) renderer.shadowMap.needsUpdate = true;', to: '      if (pacer.shadow(now, false)) renderer.shadowMap.needsUpdate = true;', fails: ['3d-pace-shadow', '3d-pace-rate-shadow'] },
  { name: 'a pass the pacer asks for is not drawn', file: 'public/js/ofis.js', from: '      if (pacer.shadow(now, casters)) renderer.shadowMap.needsUpdate = true;', to: '      pacer.shadow(now, casters);', fails: ['3d-pace-rate-shadow'] },
  { name: 'the idle rate is 8 fps', file: 'public/js/ofis-pace.js', from: 'export const IDLE_FPS = 30;', to: 'export const IDLE_FPS = 8;', fails: ['3d-pace-rate-idle'] },
  { name: 'the deep idle rate is the idle rate', file: 'public/js/ofis-pace.js', from: 'export const DEEP_FPS = 15;', to: 'export const DEEP_FPS = 30;', fails: ['3d-pace-rate-deep'] },
  { name: 'the gap guard never steps down', file: 'public/js/ofis-pace.js', from: 'if (gapSkip < MAX_SKIP && ringN === GAP_WINDOW && ringLate', to: 'if (false && gapSkip < MAX_SKIP && ringN === GAP_WINDOW && ringLate', fails: ['3d-pace-guard'] },
  { name: 'the window\'s focus gates the frame rate again', file: 'public/js/ofis.js', from: '    if (!pacer.due(now)) return;', to: '    if (!pacer.due(now) || (!document.hasFocus() && now - lastT < 66)) return;', fails: ['3d-pace-rate-moving'] },
];
const editsOf = m => m.edits || [[m.from, m.to]];

async function runMutations() {
  const rows = [];
  for (const m of MUTATIONS.filter(x => !val('mutation') || val('mutation').split('|').some(w => x.name.includes(w)))) {
    const dir = mkdtempSync(join(tmpdir(), 'cco-mutp-'));
    try {
      for (const f of readdirSync(ROOT).filter(n => /\.(js|json)$/.test(n) && n !== 'package-lock.json')) cpSync(join(ROOT, f), join(dir, f));
      cpSync(join(ROOT, 'public'), join(dir, 'public'), { recursive: true });
      const file = join(dir, m.file);
      let text = readFileSync(file, 'utf8');
      if (editsOf(m).some(([from]) => !text.includes(from))) { rows.push({ m, caught: false, detail: 'the line to break was not found' }); console.log(`MUTATION MISSED ${m.fails}: ${m.name} -> the line to break was not found`); continue; }
      for (const [from, to] of editsOf(m)) text = text.replace(from, () => to);
      writeFileSync(file, text);
      const groups = [...new Set(m.fails.map(n => GROUP[n]))], got = new Map();
      for (const g of groups) {
        let r;
        const ask = { root: dir, want: new Set(m.fails) };
        try { r = await CHECKS[g](ask); } catch (e) { await sleep(2000); try { r = await CHECKS[g](ask); } catch (e2) { r = [make('threw', false, String(e2.message || e2).slice(0, 200))]; } }
        for (const x of r) got.set(x.name, x);
      }
      const caught = m.fails.every(n => got.has(n) && !got.get(n).ok) || (m.fails.some(n => got.has(n) && !got.get(n).ok) && got.has('threw'));
      rows.push({ m, caught, detail: m.fails.map(n => (got.has(n) ? `${n} ${got.get(n).ok ? 'PASSED' : 'FAILED'}: ${got.get(n).detail.slice(0, 140)}` : `${n} did not run`)).join(' | ') });
    } catch (e) {
      rows.push({ m, caught: false, detail: `the run threw: ${String(e.message || e).slice(0, 160)}` });
    } finally { rmSync(dir, { recursive: true, force: true }); }
    const last = rows[rows.length - 1];
    console.log(`MUTATION ${last.caught ? 'CAUGHT' : 'MISSED'} ${m.fails}: ${m.name} -> ${last.detail}`);
  }
  return rows;
}

// ---- main
if (args.includes('--verify-mutations')) {
  let bad = 0;
  for (const m of MUTATIONS) {
    for (const [from] of editsOf(m)) {
      const n = readFileSync(join(ROOT, m.file), 'utf8').split(from).length - 1;
      if (n !== 1) { bad++; console.log(`MUTATION LINE ${n === 0 ? 'NOT FOUND' : 'FOUND ' + n + ' TIMES'}: ${m.name}`); }
    }
    for (const n of m.fails) if (!GROUP[n]) { bad++; console.log(`MUTATION GUARD UNKNOWN: ${n}`); }
  }
  console.log(bad ? `MUTATION LINES BAD ${bad} of ${MUTATIONS.length}` : `MUTATION LINES OK (${MUTATIONS.length})`);
  process.exit(bad ? 1 : 0);
}
const results = [];
const show = r => { results.push(r); console.log(`CHECK ${r.name} ${r.ok ? 'PASS' : 'FAIL'} ${r.detail}`); };
if (args.includes('--mutations')) {
  const rows = await runMutations();
  const missed = rows.filter(r => !r.caught);
  console.log(missed.length ? `MUTATIONS MISSED ${missed.length} of ${rows.length}` : `MUTATIONS ALL CAUGHT (${rows.length})`);
  process.exit(missed.length ? 1 : 0);
}
for (const k of Object.keys(CHECKS)) if (!only || only === k) for (const r of await CHECKS[k]({ root: undefined })) show(r);
const bad = results.filter(r => !r.ok);
console.log(bad.length ? `QA FAIL (${bad.length} of ${results.length} checks)` : `QA PASS (${results.length} checks)`);
process.exit(bad.length ? 1 : 0);
