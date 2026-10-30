// QA of the label cards of the three.js Office (public/js/ofis.js placeLabels, public/js/ofis-label-layout.js createLabelLayout, public/app.css .of-l): the cards of the agents do not
// flicker while people walk or the view zooms (docs/labels.md has the causes and the numbers). Headless Chrome with software WebGL in a throw-away profile (harness3d.mjs), the
// server against a fake ~/.claude, one `CHECK <name> PASS|FAIL <detail>` line per check and a final `QA PASS` or `QA FAIL`.
//   node tools/qa/office3d-labels-qa.mjs [--only walk|zoom|fade|clock] [--mutations [--mutation <words>|<more words>]] [--verify-mutations]
//
// How it sees: a read-only sampler in the page (it reads the inline visibility and transform of every label and the screen place of its agent on every requestAnimationFrame and keeps one
// record per scene frame in which a label changed, the idea of a console script the user can run on his own Chrome) and the numbers below, counted per label over those records:
//   toggles  changes of visible <-> hidden       blinks  hidden for at most 0.5 s between two visible spells       flashes  visible for at most 5 scene frames between two hidden spells
//   jumps    one scene frame in which a visible label moved more than 40 px farther than its agent did (the headless page draws about 8 frames a second, so a hop of 40 px is 5 px at 60 fps)
//
//   3d-walk-labels     the page opens with 10 chats and 12 sub-agents and everybody walks in (nothing is settled), at dpr 1 and at dpr 2: no jump over 40 px, no flash, at most 2 blinks; once
//                      the walks are over every visible label is clear of the card and the buttons
//   3d-labels-walkers  the walker rule: a walking sub-agent has no card until it sits, the card of a walking chief is shown and carried under it, the cards of the seated sub-agents are
//                      there once the walks are over
//   3d-labels-zoom     the view zooms 14 -> 60 -> 14 in 6 s while the people walk: at most 40 toggles, no jump over 40 px; a zoom that shakes around a limit (22, the sub-agents'
//                      balloons) does not make a label flap (the 6 percent band)
//   3d-labels-fade     opacity is a CSS transition (0.2 s, ease out in, none under prefers-reduced-motion) and the inline visibility switches at once; the scale of a label is in steps of
//                      0.04 and its place in whole device pixels (dpr 2: halves)
//   3d-labels-clock    the chip of a chat that waits counts up without the label being built again (the same chip element after three ticks, no change in the label but the seconds)
//
// --mutations breaks the code in a copy of the repo, one line at a time, and runs the check that guards that line: every one must FAIL there.
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
const report = (name, problems, text) => make(name, problems.length === 0, `${text}${problems.length ? '; PROBLEMS: ' + problems.slice(0, 5).join(' | ') + (problems.length > 5 ? ` (and ${problems.length - 5} more)` : '') : ''}`);
const until = async (fn, ms = 30000, step = 150) => { const t0 = Date.now(); for (;;) { const r = await fn().catch(() => null); if (r) return r; if (Date.now() - t0 > ms) return null; await sleep(step); } };
const f1 = n => (+n).toFixed(1);

// 10 chats with 12 sub-agents between them: 22 people, a mix of working, waiting and asking chats (the fixture of the investigation that found the causes)
const FIXTURE = { statuses: ['working', 'working', 'waiting', 'working', 'working', 'ask', 'working', 'waiting'], subs: i => (i % 2 === 0 ? ['working', 'working'] : i % 3 === 1 ? ['working'] : []) };
const VIEWPORT = { width: 1680, height: 913 };

// ---- what runs in the page
// The sampler: `seconds` of requestAnimationFrame readings; `drive` is an optional function body (t = seconds since the start) that runs on every frame, to move the camera.
const SAMPLER = (seconds, drive = '') => `(async () => {
  const v = document.querySelector('#view-ofis'), s = v.__ofis, o = v.__ofis3d, layer = v.querySelector('.of-layer');
  const frames = []; let last = '';
  const t0 = performance.now();
  await new Promise(done => {
    const loop = t => {
      const modes = new Map(o.figures().map(f => [f.id, (f.main ? 'M' : 'S') + (f.vis ? f.mode : 'wait')]));          // (a figure that waits for its turn at the entrance is not drawn)
      const labs = [...layer.querySelectorAll('.of-l.of-tagl, .of-l.of-ball')].map(e => {
        const id = e.dataset.id, at = s.charScreen(id);
        return [e.classList.contains('of-ball') ? 'b' : 't', id, e.style.visibility === 'visible' ? 1 : 0, e.style.transform || '', at ? +at[0].toFixed(1) : null, at ? +at[1].toFixed(1) : null, modes.get(id) || ''];
      });
      const sig = JSON.stringify(labs.map(l => l.slice(0, 4)));
      if (sig !== last) { last = sig; frames.push({ t, labs }); }
      ${drive ? `{ const T = (t - t0) / 1000; ${drive} }` : ''}                       // (the camera moves after the reading: the scene's own callback ran before this one and drew with the camera as it is now)
      if (t - t0 < ${seconds} * 1000) requestAnimationFrame(loop); else done();
    };
    ${drive ? `{ const T = 0; ${drive} }` : ''}
    requestAnimationFrame(loop);
  });
  return frames;
})()`;

// ---- what is counted, in node
const xy = tr => { const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(tr || ''); return m ? [+m[1], +m[2]] : null; };
// the part of the view where an agent's card is whole: a card hangs about 100 px to each side of its agent and 200 px below it, a balloon 80 px above; an agent nearer than that to an edge
// has a card that the view cuts, and one that is cut off toggles by the camera
const inView = fig => !!fig && fig[0] > 180 && fig[0] < VIEWPORT.width - 180 && fig[1] > 100 && fig[1] < VIEWPORT.height - 200;
function analyse(frames, kinds = 'tb') {
  const by = new Map();
  frames.forEach((f, i) => f.labs.forEach(l => { if (!kinds.includes(l[0])) return; const k = l[0] + ':' + l[1]; if (!by.has(k)) by.set(k, []); by.get(k).push({ i, t: f.t, vis: l[2], tr: l[3], fig: l[4] === null ? null : [l[4], l[5]], mode: l[6] }); }));
  const out = { toggles: 0, blinks: 0, flashes: 0, jumps: 0, maxStep: 0, labels: by.size, sceneFrames: frames.length }, worst = [];
  for (const [k, ser] of by) {
    let tg = 0, jp = 0;
    for (let i = 1; i < ser.length; i++) {
      if (ser[i].vis !== ser[i - 1].vis && inView(ser[i].fig) && inView(ser[i - 1].fig)) tg++;       // (a label that leaves the view or comes back into it toggles by the camera, not by the layout)
      const a = xy(ser[i - 1].tr), b = xy(ser[i].tr);
      if (ser[i].vis && ser[i - 1].vis && a && b && ser[i].fig && ser[i - 1].fig) {
        const step = Math.hypot(b[0] - a[0], b[1] - a[1]) - Math.hypot(ser[i].fig[0] - ser[i - 1].fig[0], ser[i].fig[1] - ser[i - 1].fig[1]);
        if (step > 40) { out.jumps++; jp++; }
        out.maxStep = Math.max(out.maxStep, step);
      }
    }
    out.toggles += tg;
    for (let r = 0; r < ser.length;) {                               // runs of visible and of hidden readings: a hidden one at most 0.5 s long, or a visible one of at most 5 frames, between two others
      let j = r; while (j < ser.length && ser[j].vis === ser[r].vis) j++;
      if (r > 0 && j < ser.length) {
        if (!ser[r].vis && ser[j].t - ser[r].t <= 500) out.blinks++;
        if (ser[r].vis && j - r <= 5) out.flashes++;
      }
      r = j;
    }
    if (tg || jp) worst.push(`${k.slice(0, 14)}: ${tg} toggles, ${jp} jumps`);
  }
  out.maxStep = +out.maxStep.toFixed(1);
  out.worst = worst.sort((a, b) => parseInt(b.split(': ')[1]) - parseInt(a.split(': ')[1])).slice(0, 3);
  return out;
}
const summary = r => `${r.toggles} toggles, ${r.blinks} blinks, ${r.flashes} flashes, ${r.jumps} jumps over 40 px (largest step ${r.maxStep} px beyond the agent) over ${r.sceneFrames} scene frames and ${r.labels} labels`;

// the rule of the walkers, read off the same records
function walkers(frames) {
  const w = { subWalk: 0, subWalkVisible: 0, chiefWalk: 0, chiefWalkVisible: 0, firstChief: new Map() };
  for (const f of frames) for (const l of f.labs) {
    if (l[0] !== 't') continue;
    const [, id, vis, , , , mode] = l;
    if (mode === 'Swalk') { w.subWalk++; if (vis) w.subWalkVisible++; }
    if (mode === 'Mwalk') { if (!w.firstChief.has(id)) w.firstChief.set(id, f.t); if (f.t - w.firstChief.get(id) > 1500) { w.chiefWalk++; if (vis) w.chiefWalkVisible++; } }
  }
  return w;
}

// the labels of the settled scene: clear of the card, the buttons and the bar? (what `ui.blocked()` is: the card, the shelf, the buttons)
const CLEAR = `(() => {
  const v = document.querySelector('#view-ofis'), u = v.__ofisUi, A = v.querySelector('.of-area').getBoundingClientRect(), hit = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const blocked = u.blocked(), shown = [...v.querySelectorAll('.of-l')].filter(e => e.style.visibility === 'visible').map(e => { const r = e.getBoundingClientRect(); return { cls: e.className.replace(/of-l | on| cut/g, ''), x: r.left - A.left, y: r.top - A.top, w: r.width, h: r.height }; });
  return { shown: shown.length, blocked: blocked.length, under: shown.filter(l => blocked.some(b => hit(l, b))).map(l => l.cls + ' at ' + Math.round(l.x) + ',' + Math.round(l.y)) };
})()`;

// ---- the checks
async function runWalk(ctx) {
  const rows = [], problems = [], out = [];
  let walkerRows = null;
  for (const dpr of [1, 2]) {
    const S = await scenario3d(10, { tag: 'lbl' + dpr, root: ctx.root, width: VIEWPORT.width, height: VIEWPORT.height, dpr, settle: false, fixture: FIXTURE });
    try {
      const { page } = S;
      if (!S.ready.ok) { problems.push(`dpr ${dpr}: the scene did not become ready`); continue; }
      const frames = await page.evaluate(SAMPLER(14));
      if (val('dump')) writeFileSync(`${val('dump')}-walk-dpr${dpr}.json`, JSON.stringify(frames));          // (for a look at the records: --dump /tmp/x)
      const r = analyse(frames);
      rows.push(`dpr ${dpr}: ${summary(r)}`);
      if (r.sceneFrames < 40) problems.push(`dpr ${dpr}: only ${r.sceneFrames} scene frames were seen`);
      if (r.labels < 20) problems.push(`dpr ${dpr}: only ${r.labels} labels were seen`);
      if (r.jumps) problems.push(`dpr ${dpr}: ${r.jumps} jumps over 40 px (${r.worst.join('; ')})`);
      if (r.flashes) problems.push(`dpr ${dpr}: ${r.flashes} flashes (${r.worst.join('; ')})`);
      if (r.blinks > 2) problems.push(`dpr ${dpr}: ${r.blinks} blinks (${r.worst.join('; ')})`);
      if (dpr === 1) walkerRows = walkers(frames);
      const ended = await until(() => page.evaluate(o3('s.walking.length === 0')), 45000, 250);
      if (!ended) { problems.push(`dpr ${dpr}: the walks did not end`); continue; }
      await sleep(2000);
      const c = await page.evaluate(CLEAR);
      if (dpr === 1 && walkerRows) walkerRows.seated = await page.evaluate(o3(`(() => { const subs = o.figures().filter(f => !f.main && f.mode === 'seated'), shown = subs.filter(f => [...v.querySelectorAll('.of-l.of-tagl')].some(e => e.dataset.id === f.id && e.style.visibility === 'visible')); return { n: subs.length, shown: shown.length }; })()`));
      rows.push(`dpr ${dpr}: ${c.shown} labels shown once everybody sat, ${c.under.length} of them under the card or the buttons`);
      if (c.under.length) problems.push(`dpr ${dpr}: labels under the card or the buttons: ${c.under.slice(0, 3).join('; ')}`);
      if (c.shown < 10) problems.push(`dpr ${dpr}: only ${c.shown} labels are shown once everybody sat`);
      if (errorsOf(page).length) problems.push(`dpr ${dpr}: console error: ${errorsOf(page)[0].slice(0, 120)}`);
    } finally { await S.done(); }
  }
  out.push(report('3d-walk-labels', problems, rows.join('; ')));
  const wp = [];
  let text = 'no reading';
  if (walkerRows) {
    const w = walkerRows;
    const seated = w.seated || { n: 0, shown: 0 };
    text = `${w.subWalk} readings of walking sub-agents (${w.subWalkVisible} with a card), ${w.chiefWalk} of walking chiefs (${w.chiefWalkVisible} with a card), ${seated.shown} of ${seated.n} seated sub-agents have a card once everybody sat`;
    if (w.subWalk < 20) wp.push(`only ${w.subWalk} readings of a walking sub-agent`);
    if (w.subWalkVisible) wp.push(`a walking sub-agent had a card in ${w.subWalkVisible} of ${w.subWalk} readings`);
    if (w.chiefWalk < 20) wp.push(`only ${w.chiefWalk} readings of a walking chief`);
    if (w.chiefWalk && w.chiefWalkVisible / w.chiefWalk < 0.9) wp.push(`the card of a walking chief was shown in ${w.chiefWalkVisible} of ${w.chiefWalk} readings`);
    if (seated.n < 8) wp.push(`only ${seated.n} seated sub-agents once everybody sat`);
    else if (seated.shown / seated.n < 0.6) wp.push(`only ${seated.shown} of ${seated.n} seated sub-agents have a card once everybody sat`);
  } else wp.push('the first page did not run');
  out.push(report('3d-labels-walkers', wp, text));
  return out;
}

async function runZoom(ctx) {
  const problems = [];
  const S = await scenario3d(10, { tag: 'lblz', root: ctx.root, width: VIEWPORT.width, height: VIEWPORT.height, settle: false, fixture: FIXTURE });
  try {
    const { page } = S;
    if (!S.ready.ok) return [report('3d-labels-zoom', ['the scene did not become ready'], '')];
    // the middle of the building, from the rooms' own places; the zoom follows a triangle 14 -> 60 -> 14 in 6 s
    const mid = await page.evaluate(o3('(() => { const r = s.rooms; return { x: r.reduce((a, q) => a + q.X + q.W / 2, 0) / r.length, z: r.reduce((a, q) => a + q.Z + 4, 0) / r.length }; })()'));
    const drive = `const k = T < 3 ? T / 3 : Math.max(0, 2 - T / 3); o.view(${mid.x}, 0.6, ${mid.z}, 14 + (60 - 14) * Math.min(1, Math.max(0, k)));`;
    // 1. while the people walk in: the cards of the arriving chiefs come and go with the walks, so the toggles have a looser bound; nothing hops
    const frames = await page.evaluate(SAMPLER(6.2, drive));
    if (val('dump')) writeFileSync(`${val('dump')}-zoom-walking.json`, JSON.stringify(frames));
    const w = analyse(frames);
    if (w.sceneFrames < 20) problems.push(`only ${w.sceneFrames} scene frames were seen in the sweep with people walking`);
    if (w.toggles > 60) problems.push(`${w.toggles} toggles in the sweep with people walking (at most 60; ${w.worst.join('; ')})`);
    if (w.jumps) problems.push(`${w.jumps} jumps over 40 px in the sweep with people walking (${w.worst.join('; ')})`);
    // 2. everybody seated: only the zoom and the crowding move the cards
    if (!(await until(() => page.evaluate(o3('s.walking.length === 0')), 45000, 250))) problems.push('the walks did not end');
    await sleep(2000);
    const f1s = await page.evaluate(SAMPLER(6.2, drive));
    if (val('dump')) writeFileSync(`${val('dump')}-zoom-seated.json`, JSON.stringify(f1s));
    const r = analyse(f1s);
    if (r.toggles > 40) problems.push(`${r.toggles} toggles in the sweep with everybody seated (at most 40; ${r.worst.join('; ')})`);
    if (r.jumps) problems.push(`${r.jumps} jumps over 40 px in the sweep with everybody seated (${r.worst.join('; ')})`);
    // 3. a zoom that shakes around the limit of the sub-agents' balloons (22): shown from 22, they stay down to 22 less 6 percent
    const shake = `o.view(${mid.x}, 0.6, ${mid.z}, T < 0.8 ? 24 : (Math.floor(T * 30) % 2 ? 21.6 : 22.4));`;
    const f2 = await page.evaluate(SAMPLER(3.5, shake));
    if (val('dump')) writeFileSync(`${val('dump')}-zoom-shake.json`, JSON.stringify(f2));
    const r2 = analyse(f2.filter(f => f.t - f2[0].t > 1500), 'b');
    if (r2.toggles > 2) problems.push(`${r2.toggles} toggles while the zoom shook between 21.6 and 22.4 (the band keeps a label that is shown)`);
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return [report('3d-labels-zoom', problems, `sweep 14 -> 60 -> 14 in 6 s with people walking: ${summary(w)}; seated: ${summary(r)}; the zoom shaken around 22: ${r2.toggles} toggles of ${r2.labels} balloons`)];
  } finally { await S.done(); }
}

const ALLOWED = [0.76, 0.8, 0.84, 0.88, 0.92, 0.96, 1, 0.9];                // the scale steps, and the 0.9 floor of a main agent's label
async function runFade(ctx) {
  const problems = [], rows = [];
  for (const [dpr, reducedMotion] of [[2, false], [1, true]]) {
    const S = await scenario3d(4, { tag: 'lblf' + dpr, root: ctx.root, width: 1400, height: 800, dpr, reducedMotion, fixture: { statuses: ['working', 'working', 'waiting', 'working'], subs: i => (i < 2 ? ['working', 'working'] : []) } });
    try {
      const { page } = S, tag = dpr === 2 ? 'dpr 2' : 'reduced motion';
      if (!S.ready.ok) { problems.push(`${tag}: the scene did not become ready`); continue; }
      const read = () => page.evaluate(`(() => {
        const v = document.querySelector('#view-ofis'), L = [...v.querySelectorAll('.of-l')], on = L.filter(e => e.style.visibility === 'visible');
        const cs = e => getComputedStyle(e);
        return { n: L.length, on: on.length, onClass: on.filter(e => e.classList.contains('on')).length, offClass: L.filter(e => e.style.visibility !== 'visible' && e.classList.contains('on')).length,
          opacity: on.map(e => +cs(e).opacity), durOn: [...new Set(on.map(e => cs(e).transitionDuration))], propOn: [...new Set(on.map(e => cs(e).transitionProperty))],
          durOff: [...new Set(L.filter(e => e.style.visibility !== 'visible').map(e => cs(e).transitionDuration))],
          tf: on.map(e => e.style.transform) };
      })()`);
      const a = await read();
      if (a.on < 4) problems.push(`${tag}: only ${a.on} labels shown`);
      if (a.onClass !== a.on || a.offClass) problems.push(`${tag}: the class "on" does not follow the inline visibility (${a.onClass} of ${a.on} shown labels have it, ${a.offClass} hidden ones do)`);
      if (reducedMotion) {
        const still = d => /^0s(, 0s)*$/.test(d);
        if (!a.durOn.every(still) || !a.durOff.every(still)) problems.push(`reduced motion: the labels still have a transition (${a.durOn.join(',')} / ${a.durOff.join(',')})`);
      } else {
        if (!a.durOn.every(d => /^0\.2s/.test(d)) || !a.propOn.every(p => /^opacity/.test(p))) problems.push(`a shown label's transition is "${a.propOn.join(',')}" for ${a.durOn.join(',')}, not opacity 0.2 s`);
        if (a.opacity.some(x => x < 0.99)) problems.push(`a shown label is not opaque after settling (${f1(Math.min(...a.opacity))})`);
        // a label that goes: the inline visibility is hidden at once, its opacity eases (the zoom below the limit of the sub-agents' cards, 12)
        await page.evaluate(o3('(() => { const r = s.rooms; o.view(r[0].X + 2, 0.6, r[0].Z + 3, 8); })()'));
        let mid = null;
        for (let i = 0; i < 60 && !mid; i++) {
          mid = await page.evaluate(`(() => { const e = [...document.querySelectorAll('.of-l.of-tagl')].find(e => e.style.visibility === 'hidden' && getComputedStyle(e).opacity > 0.02 && getComputedStyle(e).opacity < 0.98); return e ? { o: +getComputedStyle(e).opacity, vis: e.style.visibility, computed: getComputedStyle(e).visibility, click: getComputedStyle(e).pointerEvents } : null; })()`);
          if (!mid) await sleep(30);
        }
        if (!mid) problems.push('a label that went away did not fade: its opacity was never between 0 and 1');
        else if (mid.click !== 'none') problems.push(`a fading label can be clicked (pointer-events ${mid.click})`);
        rows.push(mid ? `a label going away was hidden at once and eased through opacity ${f1(mid.o)}` : 'no fade seen');
      }
      // the scale in steps and the place in whole device pixels, at three zooms that are on no step
      let bad = 0, total = 0, scales = new Set();
      for (const zm of [27.31, 31.77, 35.4]) {
        await page.evaluate(o3(`(() => { const r = s.rooms; o.view(r[0].X + 2, 0.6, r[0].Z + 3, ${zm}); })()`));
        await sleep(900);
        const t = await read();
        for (const tf of t.tf) {
          const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\) scale\(([-\d.]+)\)/.exec(tf);
          if (!m) { bad++; continue; }
          total++;
          const onPx = v => Math.abs(v * dpr - Math.round(v * dpr)) < 1e-6;
          scales.add(+m[3]);
          if (!onPx(+m[1]) || !onPx(+m[2])) bad++;
          if (!ALLOWED.some(x => Math.abs(x - +m[3]) < 1e-6)) bad++;
        }
      }
      if (!total) problems.push(`${tag}: no label transform was read`);
      if (bad) problems.push(`${tag}: ${bad} of ${total} label transforms are not in whole device pixels and scale steps of 0.04`);
      rows.push(`${tag}: ${total} transforms read at three zooms, ${bad} off the grid (scales ${[...scales].join(', ')})`);
      if (errorsOf(page).length) problems.push(`${tag}: console error: ${errorsOf(page)[0].slice(0, 120)}`);
    } finally { await S.done(); }
  }
  return [report('3d-labels-fade', problems, rows.join('; '))];
}

async function runClock(ctx) {
  const problems = [];
  const S = await scenario3d(3, { tag: 'lblc', root: ctx.root, width: 1400, height: 800, fixture: { statuses: ['waiting', 'working', 'working'] } });
  try {
    const { page } = S;
    if (!S.ready.ok) return [report('3d-labels-clock', ['the scene did not become ready'], '')];
    const waiting = S.agents.find(a => a.kind === 'main' && a.status === 'waiting');
    if (!waiting) return [report('3d-labels-clock', ['no waiting chat in the fixture'], '')];
    const r = await page.evaluate(`(async () => {
      const v = document.querySelector('#view-ofis'), s = v.__ofis, e = [...v.querySelectorAll('.of-l.of-tagl')].find(x => x.dataset.id === ${JSON.stringify(waiting.id)});
      if (!e) return { error: 'no label for the waiting chat' };
      // the chip counts seconds only for the first minute: the chat has waited for 8 s when the readings begin
      const { store } = await import('/js/main.js');
      const a = store.agents.get(${JSON.stringify(waiting.id)});
      if (a) { a.since = store.now() - 8000; s.sync(); await new Promise(r => setTimeout(r, 300)); }
      const chip = () => e.querySelector('.of-chip'), c0 = chip(), t0 = c0 && c0.textContent;
      const rec = [];
      const mo = new MutationObserver(list => { for (const m of list) { const n = m.target.nodeType === 3 ? m.target.parentElement : m.target; if (!n || !n.closest('[data-since]')) rec.push(m.type + ' on ' + (n ? n.tagName + '.' + n.className : '?')); } });
      mo.observe(e, { subtree: true, childList: true, characterData: true, attributes: true });
      const texts = [];
      for (let i = 0; i < 3; i++) { await new Promise(r => setTimeout(r, 1150)); s.sync(); texts.push(chip() && chip().textContent); }
      mo.disconnect();
      return { same: chip() === c0, hasChip: !!c0, t0, texts, outside: rec };
    })()`);
    if (r.error) problems.push(r.error);
    else {
      if (!r.hasChip) problems.push('the waiting chat has no chip');
      if (!r.same) problems.push('the chip was built again (another element after three ticks)');
      if (r.outside.length) problems.push(`the label changed ${r.outside.length} times outside the clock: ${r.outside.slice(0, 3).join('; ')}`);
      if (new Set([r.t0, ...r.texts]).size < 3) problems.push(`the seconds did not count up: ${[r.t0, ...r.texts].join(' | ')}`);
    }
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return [report('3d-labels-clock', problems, r.error ? '' : `the chip of "${waiting.name.slice(0, 20)}" went ${[r.t0, ...(r.texts || [])].join(' -> ')} in three ticks, the same element, ${(r.outside || []).length} other changes`)];
  } finally { await S.done(); }
}

const RUN = { walk: runWalk, zoom: runZoom, fade: runFade, clock: runClock };
const OWNER = { '3d-walk-labels': 'walk', '3d-labels-walkers': 'walk', '3d-labels-zoom': 'zoom', '3d-labels-fade': 'fade', '3d-labels-clock': 'clock' };

// ---- mutations: break one line in a copy of the repo and expect the check that guards it to fail
const MUTATIONS = [
  { name: 'the stateless layout again (every frame from scratch)', file: 'public/js/ofis.js', edits: [
    ['import { createLabelLayout } from', 'import { createLabelLayout, layoutLabels } from'],
    ['const shown = labelLayout.step({ fixed, tags, blocked: ui.blocked(), figures: standing, vw, vh, reduced: !!atmosphere.state.reducedMotion }, now);', 'const shown = new Map([...layoutLabels({ fixed, tags, blocked: ui.blocked(), figures: [...figs.values()], vw, vh })].map(([id, p]) => [id, { ...p, shown: true }]));']], fails: '3d-walk-labels' },
  { name: 'a walking chief is an ordinary label that holds a place', file: 'public/js/ofis.js', from: "T.walking = !!c && c.mode === 'walk';", to: 'T.walking = false;', fails: '3d-walk-labels' },
  { name: 'a walking sub-agent keeps its card', file: 'public/js/ofis.js', from: 'c.tag.off = c.bal.off || (!c.main && c.mode === \'walk\');', to: 'c.tag.off = c.bal.off;', fails: '3d-labels-walkers' },
  { name: 'the figure of a walker is an obstacle for the cards of the others', file: 'public/js/ofis.js', from: "if (!c || c.mode !== 'walk') standing.push(r);", to: 'standing.push(r);', fails: '3d-walk-labels' },
  { name: 'show and hide are not debounced', file: 'public/js/ofis-label-layout.js', from: '  SHOW_MS: 90, HIDE_MS: 400, MIN_SHOWN_MS: 700, MIN_HIDDEN_MS: 500,', to: '  SHOW_MS: 0, HIDE_MS: 0, MIN_SHOWN_MS: 0, MIN_HIDDEN_MS: 0,', fails: '3d-walk-labels' },
  { name: 'a label jumps to its cell instead of gliding', file: 'public/js/ofis-label-layout.js', from: '      if (reduced || fresh) { s.sx.jump(s.tu); s.sy.jump(s.tv); }', to: '      s.sx.jump(s.tu); s.sy.jump(s.tv);', fails: '3d-walk-labels' },
  { name: 'a label does not stay in its cell: it goes home at once', file: 'public/js/ofis-label-layout.js', from: '  RETURN_MS: 1000,  ', to: '  RETURN_MS: 0,  ', fails: '3d-walk-labels' },
  { name: 'the zoom limits have no band', file: 'public/js/ofis.js', from: 'ZOOM_SLACK = 0.06;', to: 'ZOOM_SLACK = 0;', fails: '3d-labels-zoom' },
  { name: 'the fade is gone: a label appears and goes in one frame', file: 'public/app.css', from: '.of-l.on { opacity: 1; pointer-events: auto; transition: opacity var(--m-fast) var(--ease-out), visibility 0s; }', to: '.of-l.on { opacity: 1; pointer-events: auto; transition: none; }', fails: '3d-labels-fade' },
  { name: 'reduced motion keeps the fade', file: 'public/app.css', from: '  .of-l, .of-l.on { transition: none; }\n', to: '', fails: '3d-labels-fade', also: { file: 'public/app.css', from: '  * { transition: none !important; }\n', to: '' } },
  { name: 'a label is placed at fractions of a device pixel', file: 'public/js/ofis.js', from: 'snap = v => Math.round(v * dpr) / dpr;', to: 'snap = v => +v.toFixed(1);', fails: '3d-labels-fade' },
  { name: 'the scale of a label follows the zoom continuously', file: 'public/js/ofis.js', from: 'labelScale = clamp(Math.round(zoom / 38 / LABEL_STEP) * LABEL_STEP, LABEL_MIN, 1);', to: 'labelScale = clamp(zoom / 38, LABEL_MIN, 1);', fails: '3d-labels-fade' },
  { name: 'a label is rebuilt when only its seconds change', file: 'public/js/ofis.js', from: '      const key = unticked(html);', to: '      const key = html;', fails: '3d-labels-clock' },
];

const editsOf = m => m.edits || [[m.from, m.to]];
const allEdits = m => [...editsOf(m), ...(m.also ? [[m.also.from, m.also.to, m.also.file]] : [])];

async function runMutations() {
  const rows = [];
  for (const m of MUTATIONS.filter(x => !val('mutation') || val('mutation').split('|').some(w => x.name.includes(w)))) {
    const dir = mkdtempSync(join(tmpdir(), 'cco-mutl-'));
    try {
      for (const f of readdirSync(ROOT).filter(n => /\.(js|json)$/.test(n) && n !== 'package-lock.json')) cpSync(join(ROOT, f), join(dir, f));
      cpSync(join(ROOT, 'public'), join(dir, 'public'), { recursive: true });
      let missing = false;
      for (const [from, to, file] of allEdits(m)) {
        const path = join(dir, file || m.file);
        const text = readFileSync(path, 'utf8');
        if (!text.includes(from)) { missing = true; break; }
        writeFileSync(path, text.replace(from, () => to));
      }
      if (missing) { rows.push({ m, caught: false, detail: 'the line to break was not found' }); console.log(`MUTATION MISSED ${m.fails}: ${m.name} -> the line to break was not found`); continue; }
      let r;
      try { r = await RUN[OWNER[m.fails]]({ root: dir }); } catch (e) { await sleep(2000); r = await RUN[OWNER[m.fails]]({ root: dir }); }
      const got = r.find(x => x.name === m.fails);
      const at = got ? Math.max(0, got.detail.indexOf('PROBLEMS')) : 0;
      rows.push({ m, caught: !!got && !got.ok, detail: got ? `${got.name} ${got.ok ? 'PASSED' : 'FAILED'}: ${got.detail.slice(at, at + 200)}` : `${m.fails} did not run` });
    } catch (e) {
      rows.push({ m, caught: false, detail: `the run threw twice, so nothing was read: ${String(e.message || e).slice(0, 160)}` });
    } finally { rmSync(dir, { recursive: true, force: true }); }
    const last = rows.at(-1);
    console.log(`MUTATION ${last.caught ? 'CAUGHT' : 'MISSED'} ${m.fails}: ${m.name} -> ${last.detail}`);
  }
  return rows;
}

// ---- main
if (args.includes('--verify-mutations')) {            // every line to break is there exactly once (no QA run: after a change to ofis.js that moves or rewrites one)
  let bad = 0;
  for (const m of MUTATIONS) for (const [from, , file] of allEdits(m)) {
    const n = readFileSync(join(ROOT, file || m.file), 'utf8').split(from).length - 1;
    if (n !== 1) { bad++; console.log(`MUTATION LINE ${n === 0 ? 'NOT FOUND' : 'FOUND ' + n + ' TIMES'}: ${m.name}`); }
  }
  console.log(bad ? `MUTATION LINES BAD ${bad} of ${MUTATIONS.length}` : `MUTATION LINES OK (${MUTATIONS.length})`);
  process.exit(bad ? 1 : 0);
}
if (args.includes('--mutations')) {
  const rows = await runMutations();
  const missed = rows.filter(r => !r.caught);
  console.log(missed.length ? `MUTATIONS MISSED ${missed.length} of ${rows.length}` : `MUTATIONS ALL CAUGHT (${rows.length})`);
  process.exit(missed.length ? 1 : 0);
}
const results = [];
for (const k of Object.keys(RUN)) if (!only || only === k) for (const r of await RUN[k]({ root: undefined })) { results.push(r); console.log(`CHECK ${r.name} ${r.ok ? 'PASS' : 'FAIL'} ${r.detail}`); }
const bad = results.filter(r => !r.ok);
console.log(bad.length ? `QA FAIL (${bad.length} of ${results.length} checks)` : `QA PASS (${results.length} checks)`);
process.exit(bad.length ? 1 : 0);
