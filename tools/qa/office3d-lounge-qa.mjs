// QA of the lounge on the plaza of the 3D office (public/js/ofis-lounge.js and the modules it uses: lounge-model.js, lounge-plan.js, lounge-paint.js, lounge-source.js, lounge-card.js):
// headless Chrome with software WebGL in a throw-away profile, the server against a fake ~/.claude, one `CHECK lounge PASS|FAIL <detail>` line and a final `QA PASS` or `QA FAIL`.
//   node tools/qa/office3d-lounge-qa.mjs [--scenes demo,reduced,live,off,churn,stub] [--mutations [--mutation <words>[,<words>]]] [--shots <dir>]
//
//   lounge  six scenes
//     demo     ?lounge=demo at 22:00 with 4 chats: the wall shows the posts the demo script produced (read from the canvas by the page's own fillText calls and by its pixels), the
//              people are in the lounge (named, on the deck, the first two tied to the chats of the Office, the figures of the Office are unchanged), a click on the wall opens the card
//              with its posts newest first and a line that says where the data comes from, Escape closes it, the sign is reachable and openable from the keyboard, the pointer changes over the
//              wall, the poll never runs faster than every 3 seconds and stops when the tab is hidden or the lounge is panned off the screen (and comes back), the setting names shows no text
//              (the sign neither), off shows nothing and stops the poll, the pavilion costs at most 4 draw calls and 8,000 triangles (counted by the building around the lounge's build, not by
//              the lounge) and a person at most 3 and 900, a new post fades in over 450 ms (the frames sampled in the page), the sign carries the newest post, the ambient pulse moves,
//              nothing leaves 127.0.0.1
//     reduced  the same with prefers-reduced-motion: the pulse is still, no post animates, the people do not pop
//     live     no ?lounge= and a server without the endpoint (a 404): the board says it is off, with its hint, no request after the 404 (a first request that failed under load is retried
//              by design), no people, no error
//     off      no ?lounge= and this checkout's server without --chat-db (the endpoint answers 200 with state off): the board says it is off and how to start it, one request in 30 seconds, no error
//     churn    the same server, reduced motion (a person pops in and out at once): 100 people come and go through the lounge by hand-fed answers and the GPU textures stay at their
//              baseline (a person who leaves must not keep the bone texture of its skeleton)
//     stub     the endpoint answered by the QA (Chrome's Fetch domain): 30 posts of which some are hostile (bidi marks, control characters, 5000 characters, a long channel), 9 posters, two of
//              them tied to chats of the Office: eight rows on the wall, twenty in the card, newest first, every text cleaned and clipped, six people at most, a click on a person tied to a
//              chat opens that chat's card; two posters and two posts have markup in them (an img with a handler, a script, a name that breaks out of an attribute): it stays text in the card,
//              the sign and the labels (a scan of the page for elements and on* attributes, and window.__xss unset); the server answers 500 from the first request (the board says it does
//              not answer, not that it is off); then `unsupported`, a quiet board, a server error (a blip: the last answer stays; after 10 s a quiet board does not answer), garbage, and the
//              wall is not painted again while nothing changes; a board full of posts whose server stops answering keeps its posts, marked old and dimmed, and recovers
//
// --mutations breaks the code in a copy of the repo, one line at a time, and runs the scenes that line matters to: every one must FAIL (a check that cannot fail guards nothing). Timing is
// checked with margins; a failing run on a busy machine is worth a second look alone before concluding anything.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scenario3d, lookAt, o3, sleep, ROOT, VIEW } from './harness3d.mjs';
import { DEMO_SCRIPT, DEMO_AGENTS } from '../../public/js/lounge-source.js';
import { BOARD, DECK } from '../../public/js/lounge-plan.js';
import { clipChars, splitLines, LIMITS } from '../../public/js/lounge-model.js';
import { DUR } from '../../public/js/motion.js';

const args = process.argv.slice(2);
const val = f => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : undefined; };
const shotsDir = val('shots');

const BUDGET = { calls: 4, tris: 8000 };           // what the lounge adds to the building (the people are counted on their own)
const PERSON = { calls: 3, tris: 900 };            // one person of the lounge: 3 draw calls and about 730 triangles (the figures of the scene), at most 6 of them (LIMITS.people)
// What a live board costs on top of the whole-building limits of office3d-qa.mjs (3d-budget, 3d-vacant: they run with no endpoint, so the board is off and nobody is in the lounge): the
// pavilion's own 4 draw calls and 8,000 triangles, and 6 people at 3 draw calls and 900 triangles each: 22 draw calls and 13,400 triangles at the most. Measured: 198 draw calls and
// about 200,700 triangles with 10 chats, 15 figures and 6 people at the fit zoom (3d-budget: 178 and 196,000 with the board off).
const POLL = { min: 2900, max: 7000 };             // ms between two polls: never faster than 3 s (with a margin for a timer that fires a little early), and not stalled
const make = (name, ok, detail) => ({ name, ok, detail });
const NIGHT = 'time=22:00';

// ---- in the page: every string painted on the wall's canvas, by the page's own calls (an independent reading of what the wall shows); a clearRect starts a new painting
const HOOK = `(() => {
  const proto = CanvasRenderingContext2D.prototype, fill = proto.fillText, clear = proto.clearRect;
  window.__wallTexts = [];
  proto.fillText = function (s, x, y, w) { if (this.canvas && this.canvas.__lounge) { window.__wallTexts.push(String(s)); if (window.__wallTexts.length > 6000) window.__wallTexts.splice(0, 3000); } return fill.call(this, s, x, y, w); };
  proto.clearRect = function (x, y, w, h) { if (this.canvas && this.canvas.__lounge) window.__wallTexts.push('\\u0000'); return clear.call(this, x, y, w, h); };
})()`;
const LAST_PAINT = `(() => { const a = window.__wallTexts || [], i = a.lastIndexOf('\\u0000'); return a.slice(i + 1); })()`;
const SNAP = o3('o.lounge');

async function hook(page) { await page.send('Page.addScriptToEvaluateOnNewDocument', { source: HOOK }); }
// a server without the endpoint (an older Office server): GET /api/lounge answers 404. The server of this checkout has the endpoint now (it says `off` without a database: scene off).
async function hook404(page) {
  await hook(page);
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/lounge*' }] });
  page.on(async d => {
    if (d.method !== 'Fetch.requestPaused') return;
    await page.send('Fetch.fulfillRequest', { requestId: d.params.requestId, responseCode: 404, responseHeaders: [{ name: 'Content-Type', value: 'text/plain' }], body: Buffer.from('not found').toString('base64') }).catch(() => {});
  });
}
const snap = page => page.evaluate(SNAP);
const painted = page => page.evaluate(LAST_PAINT);
async function until(page, test, ms = 20000, every = 200) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < ms) { last = await snap(page).catch(() => null); if (last && test(last)) return last; await sleep(every); }
  return null;
}
async function key(page, k, code, vk, text) {
  await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(text ? { text } : {}) });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await page.send('Page.bringToFront').catch(() => {});          // headless Chrome marks the page hidden after an Escape key; the poll would stop for a reason that has nothing to do with the lounge
}
// where a world point is on the page
const at = (page, x, y, z) => page.evaluate(o3(`(() => { const a = v.querySelector('.of-area').getBoundingClientRect(), p = s.project(${x}, ${y}, ${z}); return [a.left + p[0], a.top + p[1]]; })()`));
const boardAt = (page, c) => at(page, c.X + BOARD.cu, BOARD.y0 + BOARD.h / 2, c.Z + BOARD.cv);
async function toHub(page, zoom = 60) {
  const o = await page.evaluate(o3('o.office().lounge'));
  await lookAt(page, o.X + o.W / 2, 0.5, o.Z + o.D / 2, zoom);
  await sleep(500);
  return o;
}
const clean = s => String(s).replace(/\s+/g, '');
const foreignOf = page => page.requests.filter(u => !/^(data|blob|about):/.test(u) && new URL(u).hostname !== '127.0.0.1');
const loungeHits = page => page.requests.filter(u => /\/api\/lounge(\?|$)/.test(u)).length;
const gaps = a => a.slice(1).map((v, i) => v - a[i]);
// how far the pulse moves while the activity stays the same: a change of the activity (a post in the last minute, or one that is over a minute old) is a step of the data, not motion
function pulseSpread(samples) {
  const by = new Map();
  for (const [level, pulse] of samples) { const r = by.get(level) || [pulse, pulse]; r[0] = Math.min(r[0], pulse); r[1] = Math.max(r[1], pulse); by.set(level, r); }
  return Math.max(0, ...[...by.values()].map(r => r[1] - r[0]));
}

// the frames of a fade, sampled in the page on every frame the scene draws ([ms, animating], only while a post is fading in and the frame after; software GL draws 8 frames a second, so one
// frame is 125 ms or more): a run starts when a new post arrives and ends at the first frame at rest. gap is the longest time between two frames inside the run, which is how far a
// measurement can be off.
const FADE_REC = o3(`(() => { const rec = window.__fade = []; let prev = false, f = -1; const tick = () => { if (o.frameNo !== f) { f = o.frameNo; const a = o.loungeAnim.animating; if (a || prev) rec.push([performance.now(), a]); prev = a; } requestAnimationFrame(tick); }; requestAnimationFrame(tick); })()`);
function fadeRuns(samples) {
  const runs = [];
  let cur = null;
  for (const [t, a] of samples) {
    if (a && !cur) cur = { t0: t, last: t, gap: 0 };
    else if (a) { cur.gap = Math.max(cur.gap, t - cur.last); cur.last = t; }
    else if (cur) { cur.gap = Math.max(cur.gap, t - cur.last); cur.t1 = t; runs.push(cur); cur = null; }
  }
  return runs;
}

// ---- the draw calls and triangles of the lounge: the scene drawn with all of it, without the people, and without anything of it that is a mesh of its own (the wall's face, the strip of
// light, anything else the lounge adds to the building). The furniture is in the building's batch, which the check cannot toggle, so its triangles are the growth of the batch around the
// call of the lounge's build (ofis.js: `o.loungeBatchTris`), counted by the building and not by the lounge. The lounge's own count (`built.staticTris`) must agree with it.
async function cost(page) {
  const draw = async (on, part) => { await page.evaluate(o3(`o.loungeVisible(${on}, ${part ? JSON.stringify(part) : 'undefined'})`)); await sleep(150); return page.evaluate(o3('o.draw()')); };
  const all = await draw(true), noPeople = await draw(false, 'people'), none = await draw(false);
  await draw(true);
  const s = await snap(page), lights = s.built.tris - s.built.staticTris - 4;           // the lamps and candles are in ofis-decor's shared meshes: counted from their shape
  const batch = await page.evaluate(o3('o.loungeBatchTris'));
  return {
    pavilion: { calls: noPeople.calls - none.calls, tris: noPeople.tris - none.tris + batch + lights, batch, counted: s.built.staticTris }, people: { calls: all.calls - noPeople.calls, tris: all.tris - noPeople.tris, n: s.people.length },
    all, none, lightTris: lights,
  };
}

// =====================================================================================================================================================================
// scene demo
async function sceneDemo({ root, shots }) {
  const out = { tag: 'demo', problems: [], notes: [] };
  const bad = m => out.problems.push('demo: ' + m);
  const S = await scenario3d(4, { tag: 'ldemo', query: `lounge=demo&${NIGHT}`, root, fixture: { subs: () => [] }, intercept: hook });
  try {
    const { page, fx } = S;
    if (!S.ready.ok) { bad(`the scene did not become ready (${JSON.stringify(S.ready.last)})`); return out; }
    const mains = fx.agents.map(a => a.id);
    await page.evaluate(FADE_REC);
    const c = await toHub(page, 60);
    let s = await until(page, x => x.state === 'ok' && x.wall.length >= 4 && x.people.length >= 4 && x.people.every(p => p.scale > 0.99), 25000);
    if (!s) { bad(`no posts and people after 25 s: ${JSON.stringify((await snap(page)) && { state: (await snap(page)).state, wall: (await snap(page)).wall.length, people: (await snap(page)).people.length })}`); return out; }
    out.notes.push(`${s.wall.length} posts on the wall, ${s.people.length} people`);

    // the wall shows the posts the script produced, and what is drawn is what the model says
    const scriptBy = (from, text) => DEMO_SCRIPT.find(e => e[2] === from && clean(clipChars(e[4], LIMITS.wallText)) === clean(text));
    const drawn = await painted(page);
    for (const r of s.wall) {
      const from = r.who.split(' ')[0];
      if (!scriptBy(from, r.lines.join(' '))) bad(`a post on the wall is not one of the script's: ${from}: ${r.lines.join(' ')}`);
      if (!r.lines.length || r.lines.length > 2) bad(`a post has ${r.lines.length} lines (1 or 2): ${r.who}`);
      for (const piece of [r.who.length > 40 ? r.who.slice(0, 20) : r.who, ...r.lines, r.age]) if (piece && !drawn.some(d => d.startsWith(piece.slice(0, 30)))) bad(`the canvas has no "${piece.slice(0, 40)}" (drawn by the page: ${drawn.length} strings)`);
    }
    if (JSON.stringify(drawn) !== JSON.stringify(s.paint.texts)) bad('what the scene reports it painted is not what the canvas was given');
    if (s.wall.length > LIMITS.wallRows) bad(`${s.wall.length} posts on the wall (at most ${LIMITS.wallRows})`);
    if (!drawn.some(d => /post/.test(d))) bad('no "posts in the last hour" line in the header');
    out.ink = s.ink; out.drawn = drawn.length;
    if (!(s.ink > 25000)) bad(`the wall's pixels are nearly empty: ${s.ink} bright pixels`);

    // the people: named, on the deck, the first two tied to the chats of the Office, not counted among the Office's figures
    const cell = s.cell, dk = { x0: cell.X + DECK.u0, x1: cell.X + DECK.u1, z0: cell.Z + DECK.v0, z1: cell.Z + DECK.v1 };
    const names = s.people.map(p => p.name);
    if (names.some(n => !DEMO_AGENTS.includes(n))) bad(`a person is not an agent of the script: ${names.join(', ')}`);
    for (const p of s.people) if (!(p.x > dk.x0 && p.x < dk.x1 && p.z > dk.z0 && p.z < dk.z1)) bad(`${p.name} stands outside the pavilion (${p.x}, ${p.z})`);
    if (new Set(s.people.map(p => p.seat)).size !== s.people.length) bad('two people share a seat');
    const b = s.people.find(p => p.name === 'builder'), rv = s.people.find(p => p.name === 'reviewer'), sc = s.people.find(p => p.name === 'scout');
    if (!b || !mains.includes(b.session)) bad(`builder is not tied to a chat of the Office (${b && b.session})`);
    if (!rv || !mains.includes(rv.session) || rv.session === (b && b.session)) bad(`reviewer is not tied to another chat of the Office (${rv && rv.session})`);
    if (!sc || sc.session !== '') bad(`scout, whose chat is not in the Office, is not a plain named person (${sc && sc.session})`);
    if (s.people.some(p => !p.label || p.labelText !== p.name)) bad(`a person has no name label on the screen: ${s.people.map(p => p.name + ':' + p.label).join(' ')}`);
    const figs = await page.evaluate(o3('o.figures().length'));
    if (figs !== S.expect) bad(`the Office has ${figs} figures, ${S.expect} expected: the people of the lounge must not be counted among them`);
    let talk = s.people.some(p => p.pose === 'talk');
    for (let i = 0; i < 40 && !talk; i++) { await sleep(250); talk = (await snap(page)).people.some(p => p.pose === 'talk'); }
    if (!talk) bad('nobody talks (no person posted in the last 20 seconds shows the talking pose)');

    // the cost: the pavilion and the people
    const k = await cost(page);
    out.cost = k;
    if (k.pavilion.calls > BUDGET.calls) bad(`the pavilion is ${k.pavilion.calls} draw calls (at most ${BUDGET.calls})`);
    if (k.pavilion.tris > BUDGET.tris) bad(`the pavilion is ${k.pavilion.tris} triangles (at most ${BUDGET.tris})`);
    if (!(k.pavilion.calls >= 1 && k.pavilion.tris > 500)) bad(`the pavilion does not draw anything (${JSON.stringify(k.pavilion)})`);
    if (k.pavilion.batch !== k.pavilion.counted) bad(`the lounge counted ${k.pavilion.counted} triangles in the building's batch, but the batch grew by ${k.pavilion.batch} around its build: part of the pavilion is not counted`);
    if (!(k.people.calls >= s.people.length && k.people.tris > 100 * s.people.length)) bad(`the people do not draw (${s.people.length} people: ${JSON.stringify(k.people)})`);
    if (k.people.calls > PERSON.calls * s.people.length || k.people.tris > PERSON.tris * s.people.length) bad(`${s.people.length} people cost ${k.people.calls} draw calls and ${k.people.tris} triangles (at most ${PERSON.calls} and ${PERSON.tris} each)`);

    // the pulse moves with the clock
    const pulses = [];
    for (let i = 0; i < 14; i++) { const x = await snap(page); pulses.push([x.activity.level, x.pulse]); await sleep(260); }
    out.pulse = [Math.min(...pulses.map(p => p[1])), Math.max(...pulses.map(p => p[1]))].map(v => +v.toFixed(3));
    if (!(out.pulse[1] > 0.05)) bad(`no pulse under the wall (${out.pulse.join('..')})`);
    if (!(pulseSpread(pulses) > 0.01)) bad(`the pulse does not move while the activity stays the same (${out.pulse.join('..')})`);

    // the pointer over the wall, a click on it opens the card, the card lists the posts, Escape closes it
    const [bx, by] = await boardAt(page, cell);
    await page.mouse.move(2, 2); await sleep(200);
    await page.mouse.move(bx, by); await sleep(300);
    const hov = await page.evaluate(o3("v.querySelector('.of-stage').classList.contains('hover')"));
    if (!hov) bad('the pointer does not change over the wall');
    await page.mouse.click(bx, by);
    const sc1 = await until(page, x => x.card.open && x.card.posts && x.card.posts.length, 4000, 150);
    if (!sc1) bad('a click on the wall does not open the card');
    else {
      const cd = sc1.card;
      if (cd.posts.length < s.wall.length || cd.posts.length > LIMITS.cardRows) bad(`the card lists ${cd.posts.length} posts (at least the wall's ${s.wall.length}, at most ${LIMITS.cardRows})`);
      const newest = (await snap(page)).wall.at(-1);
      if (cd.posts[0].who !== newest.who || cd.posts[0].chip !== newest.chip) bad(`the card does not start with the newest post (${cd.posts[0].who} / ${newest.who})`);
      if (!/demo/i.test(cd.source)) bad(`the card does not say where the data comes from: "${cd.source}"`);
      if (!cd.hasClose || !cd.focusInside) bad('the card has no close button or does not take the focus');
      if (!cd.scroll || cd.scroll.overflowY !== 'auto') bad(`the card does not scroll (${JSON.stringify(cd.scroll)})`);
      if (cd.rect.x < 0 || cd.rect.y < 0 || cd.rect.x + cd.rect.w > VIEW.w + 1 || cd.rect.y + cd.rect.h > VIEW.h + 1) bad(`the card is partly off the screen (${JSON.stringify(cd.rect)})`);
      if (!cd.people.length || !cd.posts.every(p => p.text && p.age)) bad('the card shows no people or a post without text or age');
      if (shots) { await page.mouse.move(2, 2); await sleep(500); await page.screenshot(join(shots, 'lounge-card-night.png')); }
      await key(page, 'Escape', 'Escape', 27);
      await sleep(700);
      if ((await snap(page)).card.open) bad('Escape does not close the card');
    }
    // the sign: reachable and openable from the keyboard, focus comes back to it
    const sgS = await snap(page), sg = sgS.signLabel;
    if (!sg || !sg.shown || sg.tabIndex !== 0 || sg.role !== 'button' || !/lounge/i.test(sg.label || '')) bad(`the sign is not a keyboard button (${JSON.stringify(sg)})`);
    else if (!sgS.wall.length || !sg.text.includes(sgS.wall.at(-1).who)) bad(`the sign, readable at every zoom, does not carry the newest post (sign "${sg.text}", newest ${sgS.wall.length && sgS.wall.at(-1).who})`);
    await page.evaluate(o3("(() => { const l = document.querySelector('.of-loungel'); if (l) l.focus(); })()"));
    await key(page, 'Enter', 'Enter', 13, '\r');
    const sc2 = await until(page, x => x.card.open, 3000, 150);
    if (!sc2) bad('Enter on the focused sign does not open the card');
    else {
      await key(page, 'Escape', 'Escape', 27);
      await sleep(700);
      const back = await page.evaluate(o3("document.activeElement && document.activeElement.classList.contains('of-loungel')"));
      if ((await snap(page)).card.open) bad('Escape does not close the card opened from the sign');
      else if (!back) bad('the focus does not return to the sign when the card closes');
    }

    // the poll: never faster than every 3 seconds, and it stops while the tab is hidden
    await sleep(6000);
    s = await snap(page);
    const starts = s.poll.starts, gp = gaps(starts);
    out.poll = { requests: s.poll.requests, minGap: Math.round(Math.min(...gp)), maxGap: Math.round(Math.max(...gp)) };
    if (starts.length < 4) bad(`only ${starts.length} polls so far`);
    else {
      if (Math.min(...gp) < POLL.min) bad(`two polls ${Math.round(Math.min(...gp))} ms apart (never under ${POLL.min})`);
      if (Math.max(...gp) > POLL.max) bad(`a gap of ${Math.round(Math.max(...gp))} ms between two polls: the poll stalls (over ${POLL.max})`);
    }
    await page.evaluate(o3("(() => { Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); })()"));
    await sleep(900);
    const r0 = (await snap(page)).poll.requests;
    await sleep(7500);
    const hid = await snap(page);
    if (hid.poll.requests !== r0) bad(`the poll goes on while the tab is hidden: ${hid.poll.requests - r0} more requests in 7.5 s`);
    if (hid.poll.armed || hid.poll.canPoll) bad(`a poll is waiting while the tab is hidden (armed ${hid.poll.armed}, canPoll ${hid.poll.canPoll})`);
    await page.evaluate(o3("(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); })()"));
    const back = await until(page, x => x.poll.requests > r0, 7000, 200);
    if (!back) bad('the poll does not come back when the tab is visible again');

    // the poll runs only while the wall is on the screen: pan to empty ground and it stops, pan back and it resumes
    await lookAt(page, c.X + 90, 0.5, c.Z - 40, 60);
    await sleep(700);
    const [wx, wy] = await boardAt(page, cell);
    if (wx > 0 && wx < VIEW.w && wy > 0 && wy < VIEW.h) bad(`the pan did not take the wall off the screen (it is at ${Math.round(wx)}, ${Math.round(wy)})`);
    else {
      const away = await until(page, x => !x.onScreen && !x.poll.canPoll, 4000, 150);
      if (!away) bad(`the wall is off the screen and the poll may still run (${JSON.stringify((await snap(page)).poll.why)})`);
      else {
        await sleep(900);                                    // a request that was on its way may finish
        const q0 = (await snap(page)).poll.requests;
        await sleep(7500);
        const q1 = await snap(page);
        if (q1.poll.requests !== q0) bad(`the poll goes on while the lounge is off the screen: ${q1.poll.requests - q0} more requests in 7.5 s`);
        if (q1.poll.armed) bad('a poll is waiting while the lounge is off the screen');
        await toHub(page, 60);
        if (!(await until(page, x => x.onScreen && x.poll.requests > q0, 7000, 200))) bad('the poll does not come back when the lounge is on the screen again');
      }
    }

    // a new post fades in over 450 ms (DUR.slow): the frames sampled in the page while the wall animates, a run per post that arrived. Never faster, never slower, and at least one seen.
    let runs = fadeRuns(await page.evaluate('window.__fade || []'));
    for (let i = 0; i < 40 && !runs.length; i++) { await sleep(500); runs = fadeRuns(await page.evaluate('window.__fade || []')); }
    out.fade = runs.map(r => Math.round(r.t1 - r.t0));
    if (!runs.length) bad('no new post faded in while the demo talked (the wall never animated)');
    for (const r of runs) {
      const d = r.t1 - r.t0;
      if (d < DUR.slow - r.gap - 30 || d > DUR.slow + 2 * r.gap + 30) bad(`a new post faded in over ${Math.round(d)} ms (frames up to ${Math.round(r.gap)} ms apart), not ${DUR.slow} ms`);
    }

    // the setting names: no text of a post anywhere; off: nothing, and no poll; text again: it all comes back
    const set = v => page.evaluate(o3(`v.__office.settings.set('lounge', ${JSON.stringify(v)})`));
    const lines = DEMO_SCRIPT.flatMap(e => splitLines(clipChars(e[4], LIMITS.wallText)));          // every line of text the script can put on the wall
    await set('names');
    const nm = await until(page, x => x.mode === 'names' && x.paint.texts.length && !x.paint.texts.some(t => lines.includes(t)), 6000, 200);
    if (!nm) bad(`the setting names still draws the text of the posts (${JSON.stringify((await snap(page)).paint.texts.slice(0, 8))})`);
    else if (!nm.paint.texts.some(t => /^(lead|builder|scout|reviewer|tester|docs)/.test(t))) bad('the setting names draws no names');
    else if (nm.signLabel && lines.some(l => l.length > 12 && nm.signLabel.text.includes(l.slice(0, 12)))) bad(`the sign shows the text of a post in the mode names: "${nm.signLabel.text}"`);
    await page.mouse.click(bx, by);
    const nc = await until(page, x => x.card.open, 3000, 150);
    if (!nc) bad('in the mode names a click on the wall opens no card');
    else if (nc.card.posts.some(p => p.text)) bad('in the mode names the card shows the text of a post');
    await key(page, 'Escape', 'Escape', 27); await sleep(600);
    await set('off');
    const off = await until(page, x => x.mode === 'off' && x.people.length === 0 && x.paint.texts.length === 0, 8000, 250);
    if (!off) bad(`the setting off leaves something on the wall or people in the lounge (${JSON.stringify(await snap(page).then(x => ({ people: x.people.length, texts: x.paint.texts.length })))})`);
    else {
      const o0 = off.poll.requests;
      await sleep(7500);
      const o1 = await snap(page);
      if (o1.poll.requests !== o0) bad(`the poll goes on in the mode off (${o1.poll.requests - o0} requests in 7.5 s)`);
      if (o1.signLabel && o1.signLabel.want) bad('the sign is still wanted in the mode off');
      if (o1.pulse !== 0 || o1.stripVisible) bad(`the strip of light is on in the mode off (${o1.pulse})`);
      await page.mouse.click(bx, by);
      const oc = await until(page, x => x.card.open, 3000, 150);
      if (!oc) bad('in the mode off a click on the wall opens no card (it should say that the lounge is off)');
      else if (!/off/i.test(oc.card.source) || oc.card.posts.length) bad(`the card of the mode off does not say it is off: "${oc.card.source}"`);
      await key(page, 'Escape', 'Escape', 27); await sleep(600);
    }
    await set('text');
    const on = await until(page, x => x.mode === 'text' && x.state === 'ok' && x.wall.length && x.people.length >= 3 && x.poll.requests > (off ? off.poll.requests : 0), 12000, 250);
    if (!on) bad('the setting text does not bring the lounge back (wall, people and the poll)');

    out.foreign = foreignOf(page);
    if (out.foreign.length) bad(`a request leaves 127.0.0.1: ${out.foreign[0].slice(0, 100)}`);
    if (loungeHits(page)) bad(`the demo asks the server (${loungeHits(page)} requests to /api/lounge)`);
    const err = page.errors.filter(e => !/\/local\/ofis-extras\.js/.test(e));
    if (err.length) bad(`console error: ${err[0].slice(0, 160)}`);
    if (shots) { await toHub(page, 60); await sleep(600); await page.screenshot(join(shots, 'lounge-hub-night.png')); await toHub(page, 105); await sleep(600); await page.screenshot(join(shots, 'lounge-closeup-night.png')); }
    return out;
  } finally { await S.done(); }
}

// =====================================================================================================================================================================
// scene reduced
async function sceneReduced({ root }) {
  const out = { tag: 'reduced', problems: [], notes: [] };
  const bad = m => out.problems.push('reduced: ' + m);
  const S = await scenario3d(4, { tag: 'lred', query: `lounge=demo&${NIGHT}`, root, reducedMotion: true, fixture: { subs: () => [] }, intercept: hook });
  try {
    const { page } = S;
    if (!S.ready.ok) { bad('the scene did not become ready'); return out; }
    await toHub(page, 60);
    const s = await until(page, x => x.state === 'ok' && x.people.length >= 4, 25000);
    if (!s) { bad('no posts and people after 25 s'); return out; }
    if (!s.reduced) bad('prefers-reduced-motion is on and the lounge does not know it');
    const pulses = [], anims = [], scales = [];          // pulses: [activity level, pulse]
    let count0 = s.paint.count, texts = new Set(s.paint.texts);
    for (let i = 0; i < 60; i++) {
      const x = await snap(page);
      pulses.push([x.activity.level, x.pulse]); anims.push(x.paint.animating); scales.push(...x.people.map(p => p.scale));
      for (const t of x.paint.texts) texts.add(t);
      await sleep(220);
    }
    const last = await snap(page);
    out.pulse = [Math.min(...pulses.map(p => p[1])), Math.max(...pulses.map(p => p[1]))];
    if (pulseSpread(pulses) > 1e-6) bad(`the pulse moves with prefers-reduced-motion while the activity stays the same (${pulseSpread(pulses).toFixed(4)})`);
    if (!(out.pulse[1] > 0.05)) bad(`no pulse at all (${out.pulse.join('..')}): the strip should stay lit, only still`);
    if (anims.some(a => a)) bad('a post animates onto the wall with prefers-reduced-motion');
    if (scales.some(v => v !== 1)) bad(`a person pops in or out with prefers-reduced-motion (scales ${[...new Set(scales)].join(',')})`);
    if (last.paint.count <= count0 || texts.size <= s.paint.texts.length) bad('the wall does not change while the demo talks: text must still update');
    const err = page.errors.filter(e => !/\/local\/ofis-extras\.js/.test(e));
    if (err.length) bad(`console error: ${err[0].slice(0, 160)}`);
    out.notes.push(`pulse ${out.pulse.map(v => v.toFixed(3)).join('..')}, ${last.paint.count - count0} paintings in 13 s`);
    return out;
  } finally { await S.done(); }
}

// =====================================================================================================================================================================
// scene live: a server without the endpoint (404)
async function sceneLive({ root, shots }) {
  const out = { tag: 'live', problems: [], notes: [] };
  const bad = m => out.problems.push('live: ' + m);
  const S = await scenario3d(4, { tag: 'llive', query: NIGHT, root, fixture: { subs: () => [] }, intercept: hook404 });
  try {
    const { page } = S;
    if (!S.ready.ok) { bad('the scene did not become ready'); return out; }
    const c = await toHub(page, 60);
    const s = await until(page, x => x.status === 'nofile' && x.state === 'off', 30000);
    if (!s) { bad(`the board did not turn off on a 404 (${JSON.stringify((await snap(page)).state)})`); return out; }
    await sleep(9000);
    const t = await snap(page);
    if (t.boardVisible) bad('the wall draws its face although the board is off (a lounge with nothing to say adds no draw call)');
    const k = await cost(page);
    out.cost = k;
    if (k.pavilion.calls !== 0) bad(`a board that is off adds ${k.pavilion.calls} draw calls to the building (none: the pavilion is in the building's batch and the face of the wall is not drawn)`);
    if (k.pavilion.tris > BUDGET.tris || k.pavilion.tris < 500) bad(`the pavilion is ${k.pavilion.tris} triangles (500 to ${BUDGET.tris})`);
    if (k.pavilion.batch !== k.pavilion.counted) bad(`the lounge counted ${k.pavilion.counted} triangles in the building's batch, but the batch grew by ${k.pavilion.batch} around its build: part of the pavilion is not counted`);
    if (!t.signLabel || !/Agent message board is off/.test(t.signLabel.text)) bad(`the sign does not say the board is off (${t.signLabel && t.signLabel.text})`);
    if (t.people.length) bad(`${t.people.length} people in a lounge whose board is off`);
    if (t.wall.length) bad('posts on a board that is off');
    if (t.stripVisible || t.pulse > 0.001) bad(`the strip of light is on for a board that is off (${t.pulse})`);
    // what the design promises: no request starts after the 404 (the next one is five minutes away). A request that failed before it (under load the first can be aborted: Failed to fetch) is
    // retried after 3 seconds by design and is not counted here.
    if (t.poll.requests !== s.poll.requests) bad(`${t.poll.requests - s.poll.requests} requests started after the 404 in the following 9 s: a server without the endpoint is asked again only after 5 minutes`);
    if (loungeHits(page) > t.poll.requests) bad(`${loungeHits(page)} requests to /api/lounge, but the poll started ${t.poll.requests}: something else asks the server`);
    const e404 = { log: page.expected.filter(e => e.startsWith('log:')).length, response: page.expected.filter(e => /^404 /.test(e)).length };          // Chrome's console line and the response itself
    if (e404.log !== 1 || e404.response !== 1) bad(`the endpoint's 404 was seen ${e404.response} times and logged ${e404.log} times (once each expected)`);
    const err = page.errors.filter(e => !/\/local\/ofis-extras\.js/.test(e));
    if (err.length) bad(`console error: ${err[0].slice(0, 160)}`);
    const nf = page.failed.filter(f => !/ofis-extras/.test(f));
    if (nf.length) bad(`failed request: ${nf[0].slice(0, 120)}`);
    out.foreign = foreignOf(page);
    if (out.foreign.length) bad(`a request leaves 127.0.0.1: ${out.foreign[0].slice(0, 100)}`);
    const [bx, by] = await boardAt(page, t.cell);
    await page.mouse.click(bx, by);
    const cd = await until(page, x => x.card.open, 3000, 150);
    if (!cd) bad('a click on the wall of a board that is off opens no card');
    else if (!/\/api\/lounge/.test(cd.card.source) || !/(--chat-db|off)/i.test(cd.card.note.join(' '))) bad(`the card does not say why the board is off: "${cd.card.source}" / ${cd.card.note.join(' | ')}`);
    if (shots) { await page.mouse.move(2, 2); await sleep(500); await page.screenshot(join(shots, 'lounge-off-card.png')); }
    out.notes.push('no request after its 404 answer, the 404 and its console line expected once, the face of the wall not drawn');
    return out;
  } finally { await S.done(); }
}

// =====================================================================================================================================================================
// scene off: this checkout's own server, started without --chat-db: the endpoint answers 200 with state `off`. The board says it is off and how to start it, the poll slows to one
// request in 30 seconds (nothing on that server changes faster), and the page has no console error and no failed request: this is the default state of the Office today.
async function sceneOff({ root, shots }) {
  const out = { tag: 'off', problems: [], notes: [] };
  const bad = m => out.problems.push('off: ' + m);
  const S = await scenario3d(4, { tag: 'loff', query: NIGHT, root, fixture: { subs: () => [] }, intercept: hook });
  try {
    const { page } = S;
    if (!S.ready.ok) { bad('the scene did not become ready'); return out; }
    await toHub(page, 60);
    const s = await until(page, x => x.status === 'ok' && x.state === 'off', 30000);
    if (!s) { bad(`the endpoint's answer "off" did not arrive (${JSON.stringify((await snap(page)).state)})`); return out; }
    await sleep(20000);
    const t = await snap(page);
    if (t.poll.requests !== s.poll.requests) bad(`${t.poll.requests - s.poll.requests} requests started in the 20 s after a board that is off: it is asked again only after 30 seconds`);
    if (t.boardVisible) bad('the wall draws its face although the board is off');
    if (!t.signLabel || !/Agent message board is off/.test(t.signLabel.text)) bad(`the sign does not say the board is off (${t.signLabel && t.signLabel.text})`);
    if (t.people.length || t.wall.length) bad('people or posts on a board that is off');
    const err = page.errors.filter(e => !/\/local\/ofis-extras\.js/.test(e));
    if (err.length) bad(`console error: ${err[0].slice(0, 160)}`);
    const nf = page.failed.filter(f => !/ofis-extras/.test(f));
    if (nf.length) bad(`failed request: ${nf[0].slice(0, 120)}`);
    if (page.expected.some(e => /^404 /.test(e))) bad('the endpoint answered 404: this checkout has it');
    out.foreign = foreignOf(page);
    if (out.foreign.length) bad(`a request leaves 127.0.0.1: ${out.foreign[0].slice(0, 100)}`);
    const [bx, by] = await boardAt(page, t.cell);
    await page.mouse.click(bx, by);
    const cd = await until(page, x => x.card.open, 3000, 150);
    if (!cd) bad('a click on the wall of a board that is off opens no card');
    else if (!/--chat-db/.test(cd.card.note.join(' '))) bad(`the card does not say how to start the board: ${cd.card.note.join(' | ')}`);
    out.notes.push(`the answer "off" read once (${s.poll.requests} request), none in the next 20 s, the sign and the card say how to start it`);
    return out;
  } finally { await S.done(); }
}

// =====================================================================================================================================================================
// scene churn: people come and go. Every poster is a new person (a skinned figure with a bone texture of its own, made on its first draw) and each one leaves when the next arrives:
// the GPU textures must stay where they were (a person who leaves must not keep its skeleton's texture). The answers are fed by hand (`o.loungeFeed`), the server has no endpoint.
const CHURN = (from, to) => o3(`(async () => {
  const frames = n => new Promise(r => { const f0 = o.frameNo, k = () => (o.frameNo - f0 >= n ? r() : requestAnimationFrame(k)); k(); });          // n frames of the scene, not of the browser
  for (let i = ${from}; i < ${to}; i++) {
    o.loungeFeed({ state: { state: 'ok' }, messages: [{ seq: i, ts: Date.now(), channel: 'churn', from: 'poster-' + i, to: [], text: 'hello ' + i }], channels: {}, agents: [] });
    await frames(2);                       // the person arrives and is drawn (and the one before it has left)
  }
  return o.info.tex;
})()`);
const CHURN_N = 100, CHURN_WARM = 12, CHURN_SLACK = 12;           // a leak is 1.6 to 2 textures a person: 160 to 200 over the run, against 12 of slack
async function sceneChurn({ root }) {
  const out = { tag: 'churn', problems: [], notes: [] };
  const bad = m => out.problems.push('churn: ' + m);
  const S = await scenario3d(4, { tag: 'lchurn', query: NIGHT, root, reducedMotion: true, fixture: { subs: () => [] }, intercept: hook404 });
  try {
    const { page } = S;
    if (!S.ready.ok) { bad('the scene did not become ready'); return out; }
    await toHub(page, 60);
    if (!(await until(page, x => x.status === 'nofile', 30000))) { bad('the board did not turn off on a 404 (the answers after it are fed by hand)'); return out; }
    const t0 = await page.evaluate(CHURN(0, CHURN_WARM));
    const t1 = await page.evaluate(CHURN(CHURN_WARM, CHURN_WARM + CHURN_N));
    const s = await snap(page);
    out.tex = [t0, t1];
    if (t1 - t0 > CHURN_SLACK) bad(`${CHURN_N} people came and went and the GPU textures grew from ${t0} to ${t1} (${((t1 - t0) / CHURN_N).toFixed(2)} a person): a person who leaves keeps the bone texture of its skeleton`);
    if (s.people.length !== 1 || s.people[0].name !== 'poster-' + (CHURN_WARM + CHURN_N - 1)) bad(`the lounge does not end with the last poster alone (${JSON.stringify(s.people.map(p => p.name))})`);
    const err = page.errors.filter(e => !/\/local\/ofis-extras\.js/.test(e));
    if (err.length) bad(`console error: ${err[0].slice(0, 160)}`);
    out.notes.push(`${CHURN_N} people came and went, textures ${t0} -> ${t1}`);
    return out;
  } finally { await S.done(); }
}

// =====================================================================================================================================================================
// scene stub: the endpoint answered by the QA
// two of the nine posters have markup for a name (one makes an element, one breaks out of an attribute: the card puts a name into a title="..."); both are among the six people
const EVIL = { tag: '<img src=x onerror=_x=3>', attr: 'x" onfocus=a y="&<' };
const NAMES = ['builder', 'reviewer', 'scout', 'lead', EVIL.tag, EVIL.attr, 'ops-bot', 'planner', 'qa-bot'];
// what no text may do on the page: make an element that loads or runs something, or carry an event handler. window.__xss and window._x are set when a handler ran.
const XSS_SCAN = `(() => {
  const bad = [], scope = [...document.querySelectorAll('.of-lounge-card, .of-lp, .of-loungel')];
  for (const root of scope) for (const e of [root, ...root.querySelectorAll('*')]) {
    if (/^(IMG|SCRIPT|IFRAME|OBJECT|EMBED|LINK|STYLE|FORM|INPUT|VIDEO|AUDIO)$/i.test(e.tagName)) bad.push('<' + e.tagName.toLowerCase() + '> in ' + String(root.className).split(' ')[0]);
    for (const a of e.attributes) if (/^on/i.test(a.name)) bad.push(a.name + ' on <' + e.tagName.toLowerCase() + '> in ' + String(root.className).split(' ')[0]);
  }
  return { bad, ran: [window.__xss, window._x].filter(v => v !== undefined), scoped: scope.length };
})()`;
function bodyOf(kind, mains) {
  const now = Date.now();
  if (kind === 'unsupported') return { state: { state: 'unsupported', schema: 'v9', reason: 'unknown table layout' }, messages: [], channels: {}, agents: [] };
  if (kind === 'quiet') return { state: { state: 'ok', schema: 'chat-v1', reason: '' }, messages: [1, 2, 3].map(i => ({ seq: i, ts: now - (2 + i) * 3600e3, channel: 'old', from: NAMES[i], to: [], text: 'from long ago ' + i })), channels: { old: 3 }, agents: [] };
  if (kind === 'malformed') return { state: 7, messages: 'nope', agents: 5, channels: [] };
  const msgs = [];
  for (let i = 0; i < 30; i++) msgs.push({ seq: i + 1, ts: now - (190 + 20 * (29 - i)) * 1000, channel: ['ops', 'tasks', 'review'][i % 3], from: NAMES[i % 9], to: i % 4 ? [NAMES[(i + 1) % 9]] : [], text: `Post number ${i + 1} from ${NAMES[i % 9]}: ` + 'words '.repeat(3 + (i % 9)).trim(), extra: { ignored: true } });
  msgs[28].to = Array.from({ length: 20 }, (_, i) => 'agent-' + i);
  msgs[25].text = `Post number 26 from ${NAMES[25 % 9]}: <img src=x onerror="window.__xss=1"> <script>window.__xss=2</script> & "q" 'q'`;          // markup in a post: text on the wall, the card and nowhere else
  msgs[29] = { seq: 30, ts: now - 190e3, channel: 'ops\u202Dx' + 'y'.repeat(100), from: 'builder', to: ['reviewer'], text: 'A\u202EB\u0007C\u200Bd <img src=x onerror=window.__xss=4> & ' + 'X'.repeat(5000) };
  const seen = now - 5000;
  return { state: { state: 'ok', schema: 'chat-v1', reason: '' }, messages: msgs, channels: { ops: 10, tasks: 10, review: 10 }, agents: [
    { name: 'builder', lastSeenMs: seen, session: mains[0] }, { name: 'reviewer', lastSeenMs: seen - 1000, session: mains[1] }, { name: 'scout', lastSeenMs: seen - 2000, session: 'no-such-chat' }, ...NAMES.slice(3).map((n, i) => ({ name: n, lastSeenMs: seen - (3 + i) * 1000, session: '' })),
  ] };
}
async function sceneStub({ root, shots }) {
  const out = { tag: 'stub', problems: [], notes: [] };
  const bad = m => out.problems.push('stub: ' + m);
  const stub = { mode: 'fail500', hits: [], mains: [] };           // the first answers are server errors
  const intercept = async page => {
    await hook(page);
    await page.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/lounge*' }] });
    page.on(async d => {
      if (d.method !== 'Fetch.requestPaused') return;
      const { requestId } = d.params;
      stub.hits.push(Date.now());
      const reply = (code, body) => page.send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).toString('base64') }).catch(() => {});
      if (stub.mode === 'fail500') await reply(500, 'server error');
      else if (stub.mode === 'garbage') await reply(200, 'this is not json {{{');
      else await reply(200, bodyOf(stub.mode, stub.mains));
    });
  };
  const S = await scenario3d(4, { tag: 'lstub', query: NIGHT, root, fixture: { subs: () => [] }, intercept });
  try {
    const { page, fx } = S;
    if (!S.ready.ok) { bad('the scene did not become ready'); return out; }
    stub.mains = fx.agents.map(a => a.id);
    const c = await toHub(page, 60);

    // the server answers with errors from the first request: the board does not answer, which is not the same as being off (no --chat-db), and a working server is not sent to --chat-db
    const dn = await until(page, x => x.status === 'failed' && x.state === 'failed', 25000);
    if (!dn) { const x = await snap(page); bad(`a server that answers 500 does not turn the board to failed (status ${x.status}, state ${x.state}, sign ${JSON.stringify(x.sign && x.sign.text)})`); return out; }
    if (dn.sign.text !== 'Message board not answering' || dn.sign.tone !== 'warn' || /chat-db|is off/.test(dn.sign.text + dn.sign.hint) || !/GET \/api\/lounge/.test(dn.sign.hint)) bad(`the sign of a board that does not answer is wrong (${JSON.stringify(dn.sign)})`);
    if (!dn.signLabel || /is off/.test(dn.signLabel.text) || !/not answering/.test(dn.signLabel.text)) bad(`the sign over the wall does not say the board does not answer (${dn.signLabel && dn.signLabel.text})`);
    const d0 = await painted(page);
    if (!d0.includes('Message board not answering') || d0.some(t => /chat-db|is off/.test(t))) bad(`the wall of a board that does not answer says ${JSON.stringify(d0)}`);
    if (dn.people.length || dn.wall.length) bad(`${dn.people.length} people and ${dn.wall.length} posts for a board that never answered`);
    if (!dn.boardVisible) bad('the wall draws no face for a board that does not answer: it has something to say');
    {
      const [bx0, by0] = await boardAt(page, dn.cell);
      await page.mouse.click(bx0, by0);
      const cd0 = await until(page, x => x.card.open, 3000, 150);
      if (!cd0) bad('a click on the wall of a board that does not answer opens no card');
      else if (!/not answering/.test(cd0.card.source) || /no \/api\/lounge endpoint/.test(cd0.card.source)) bad(`the card does not say the board does not answer: "${cd0.card.source}"`);
      await key(page, 'Escape', 'Escape', 27); await sleep(700);
    }
    stub.mode = 'ok';
    let s = await until(page, x => x.state === 'ok' && x.wall.length === LIMITS.wallRows && x.people.length >= 6 && x.people.every(p => p.scale > 0.99) && x.people.filter(p => p.session).length >= 2, 25000);          // the first answer came before the QA knew the chats: the second one ties two people
    if (!s) { const x = await snap(page); bad(`the answer of the stub did not reach the wall (${x.wall.length} rows, state ${x.state}, ${x.people.length} people: ${JSON.stringify(x.people.map(p => [p.name, p.session && 'tied', p.scale]))}, chats ${JSON.stringify(stub.mains)})`); return out; }

    // eight rows, newest at the bottom, nothing hostile on the wall
    const drawn = await painted(page);
    const hostile = /[\u202A-\u202E\u2066-\u2069\u200B\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
    if (drawn.filter(d => d !== '\u0000').some(d => hostile.test(d))) bad('a bidi mark or a control character reached the canvas');
    if (drawn.some(d => Array.from(d).length > 2 * LIMITS.lineChars)) bad(`a string of ${Math.max(...drawn.map(d => Array.from(d).length))} characters was drawn (a line has at most ${LIMITS.lineChars}, a header or a who a few more)`);
    const lastRow = s.wall.at(-1);
    if (!/^builder to reviewer/.test(lastRow.who) || lastRow.lines.join('').length > LIMITS.wallText + 2) bad(`the newest post is not the hostile one clipped to ${LIMITS.wallText} characters (${lastRow.who}: ${lastRow.lines.join('|').slice(0, 120)})`);
    if (lastRow.chip.length > LIMITS.channel) bad(`the channel of the newest post is ${lastRow.chip.length} characters (at most ${LIMITS.channel})`);
    if (!s.wall.every((r, i) => i === 0 || r.seq > s.wall[i - 1].seq)) bad('the wall is not in order, newest at the bottom');
    if (s.wall.some(r => r.who.length > 80)) bad('a who line on the wall is longer than the model allows');

    // six people out of nine posters, two tied to chats, one named person with a chat that is not here
    if (s.people.length !== LIMITS.people) bad(`${s.people.length} people (at most ${LIMITS.people}, nine posted lately)`);
    const tied = s.people.filter(p => p.session);
    if (tied.length !== 2 || !tied.every(p => stub.mains.includes(p.session))) bad(`the tied people are ${JSON.stringify(tied.map(p => [p.name, p.session]))} (builder and reviewer, each with a chat of the Office)`);
    if (s.people.some(p => p.name === 'scout' && p.session)) bad('scout, whose session is not in the Office, is tied to a chat');
    for (const nm of [EVIL.tag, EVIL.attr]) { const p = s.people.find(x => x.name === nm); if (!p || p.labelText !== nm) bad(`the poster named ${JSON.stringify(nm)} is not on screen as plain text (${p && JSON.stringify(p.labelText)})`); }
    if (!s.signLabel || !/builder to reviewer: ABCd/.test(s.signLabel.text)) bad(`the sign over the wall does not carry the newest post, cleaned (${s.signLabel && s.signLabel.text})`);
    const scan0 = await page.evaluate(XSS_SCAN);
    if (scan0.bad.length || scan0.ran.length || scan0.scoped < 7) bad(`markup in a name or a post became part of the page: ${JSON.stringify(scan0)}`);

    // the card: twenty posts, newest first, cleaned and clipped
    const [bx, by] = await boardAt(page, s.cell);
    await page.mouse.click(bx, by);
    const cs = await until(page, x => x.card.open && x.card.posts && x.card.posts.length, 4000, 150);
    if (!cs) bad('a click on the wall does not open the card');
    else {
      const cd = cs.card;
      if (cd.posts.length !== LIMITS.cardRows) bad(`the card lists ${cd.posts.length} posts (${LIMITS.cardRows} of the 30)`);
      if (!/^builder to reviewer/.test(cd.posts[0].who) || !cd.posts[0].text.startsWith('AB') && !cd.posts[0].text.startsWith('A B')) bad(`the card does not start with the newest post, cleaned (${cd.posts[0].who}: ${cd.posts[0].text.slice(0, 30)})`);
      if (cd.posts.some(p => Array.from(p.text).length > LIMITS.cardText)) bad(`a post in the card has ${Math.max(...cd.posts.map(p => Array.from(p.text).length))} characters (at most ${LIMITS.cardText})`);
      if (cd.posts.some(p => hostile.test(p.text + p.who + p.chip))) bad('a bidi mark or a control character reached the card');
      if (!cd.posts.every((p, i) => i === 0 || /^Post number (\d+)/.test(p.text) && (i === 1 || +/^Post number (\d+)/.exec(p.text)[1] < +/^Post number (\d+)/.exec(cd.posts[i - 1].text)[1]))) bad('the posts in the card are not newest first');
      if (!/\/api\/lounge/.test(cd.source)) bad(`the card does not say where the data comes from (${cd.source})`);
      if (!cd.posts.some(p => p.text.includes('<img src=x onerror="window.__xss=1">') && p.text.includes('<script>window.__xss=2</script>') && p.text.includes('& "q" \'q\''))) bad('the markup in a post is not shown as the text it is');
      if (!cd.people.includes(EVIL.tag) || !cd.people.includes(EVIL.attr)) bad(`the names with markup are not shown as text in the card (${JSON.stringify(cd.people)})`);
      const scan1 = await page.evaluate(XSS_SCAN);
      if (scan1.bad.length || scan1.ran.length || scan1.scoped < 7) bad(`markup in a name or a post became part of the card: ${JSON.stringify(scan1)}`);
      if (cd.posts.length >= LIMITS.cardRows && cd.scroll && !(cd.scroll.height > cd.scroll.client)) bad(`twenty posts do not scroll (${JSON.stringify(cd.scroll)})`);
      if (shots) { await page.mouse.move(2, 2); await sleep(500); await page.screenshot(join(shots, 'lounge-card-posts.png')); }
      await key(page, 'Escape', 'Escape', 27); await sleep(700);
    }

    // a click on a person tied to a chat opens that chat's card; on a person without one it opens the lounge's
    s = await snap(page);
    const tiedP = s.people.find(p => p.session), plainP = s.people.find(p => !p.session && p.scale > 0.99);
    if (tiedP) {
      const [px, py] = await at(page, tiedP.x, 0.75, tiedP.z);
      await page.mouse.click(px, py);
      await sleep(900);
      const ac = await page.evaluate(o3('v.__ofisUi.card'));
      if (!ac.open || ac.id !== tiedP.session) bad(`a click on ${tiedP.name} does not open the card of its chat (${JSON.stringify({ open: ac.open, id: ac.id })}, want ${tiedP.session})`);
      if ((await snap(page)).card.open) bad('the lounge card and the card of a chat are open together');
      await key(page, 'Escape', 'Escape', 27); await sleep(700);
    } else bad('no person is tied to a chat');
    if (plainP) {
      const [px, py] = await at(page, plainP.x, 0.75, plainP.z);
      await page.mouse.click(px, py);
      const lc = await until(page, x => x.card.open, 3000, 150);
      const ac = await page.evaluate(o3('v.__ofisUi.card'));
      if (!lc) bad(`a click on ${plainP.name}, who has no chat in the Office, opens no lounge card`);
      if (ac.open) bad(`a click on ${plainP.name}, who has no chat in the Office, opens an agent's card`);
      await key(page, 'Escape', 'Escape', 27); await sleep(700);
    }

    // the cadence of real requests, and the wall is not painted again while nothing changes
    const p0 = (await snap(page)).paint.count;
    await sleep(6500);
    const p1 = (await snap(page)).paint.count;
    if (p1 - p0 > 1) bad(`the wall was painted ${p1 - p0} times in 6.5 s while nothing changed (only a change of the model may paint)`);
    const hg = gaps(stub.hits.slice());
    out.hits = { n: stub.hits.length, minGap: Math.round(Math.min(...hg)) };
    if (stub.hits.length < 4) bad(`only ${stub.hits.length} requests reached the endpoint (the page's poll: ${JSON.stringify((await snap(page)).poll)}, errors: ${JSON.stringify(page.errors.slice(0, 3))})`);
    else if (Math.min(...hg) < POLL.min) bad(`two requests ${Math.round(Math.min(...hg))} ms apart (never under ${POLL.min})`);

    // the other answers
    const phase = async (mode, test, what) => { stub.mode = mode; const r = await until(page, test, 11000, 250); if (!r) bad(`${what} (got ${JSON.stringify((await snap(page)).sign)})`); return r; };
    const un = await phase('unsupported', x => x.state === 'unsupported' && x.people.length === 0, 'an unsupported board does not show its sign and send its people home');
    if (un) {
      const d = await painted(page);
      if (!d.includes('Message board format not recognised') || !d.includes('unknown table layout')) bad(`the wall of an unsupported board says ${JSON.stringify(d)}`);
      if (un.wall.length) bad('posts on a board whose format is not recognised');
      if (shots) { await toHub(page, 60); await sleep(500); await page.screenshot(join(shots, 'lounge-unsupported.png')); }
    }
    const qu = await phase('quiet', x => x.state === 'ok' && x.quiet === true, 'a quiet board does not say so');
    if (qu) { const d = await painted(page); if (!d.includes('No posts in the last hour')) bad(`a quiet board's wall says ${JSON.stringify(d)}`); if (qu.wall.length) bad('posts on a quiet board'); }
    const f5 = await phase('fail500', x => x.status === 'failed', 'a server error is not noticed');
    if (f5 && (f5.state !== 'ok' || !f5.quiet)) bad(`after a server error the last answer is gone (${f5.state}, quiet ${f5.quiet})`);
    // the errors go on: a few polls later the quiet board is a board that does not answer, not a quiet one
    const fq = await until(page, x => x.state === 'failed', 30000, 300);
    if (!fq) bad(`a quiet board that keeps answering with errors still says "${(await snap(page)).sign.text}"`);
    else if (fq.sign.text !== 'Message board not answering' || !/^Last answer: .+ ago\./.test(fq.sign.hint) || /chat-db/.test(fq.sign.hint)) bad(`the sign of a quiet board that stopped answering is wrong (${JSON.stringify(fq.sign)})`);
    const gb = await phase('garbage', x => x.status === 'failed' && x.poll.requests > (f5 ? f5.poll.requests : 0), 'garbage is not noticed');
    const ml = await phase('malformed', x => x.status === 'ok' && x.state === 'off', 'a malformed answer does not end as an off board');
    const ok2 = await phase('ok', x => x.state === 'ok' && x.wall.length === LIMITS.wallRows && x.people.length >= 4, 'the board does not come back after the bad answers');

    // the server stops answering with a board full of posts: after more than a few polls the posts stay but are marked old, dimmed, under a warning; the people are not sent home at once
    await sleep(1500);                                        // the posts have faded in
    const inkOk = (await snap(page)).ink;
    stub.mode = 'fail500';
    const st = await until(page, x => x.stale === true, 40000, 300);
    if (!st) bad(`a board with posts that stops answering is not marked old (state ${(await snap(page)).state})`);
    else {
      await sleep(600);
      const st2 = await snap(page);
      if (st2.state !== 'ok' || st2.wall.length !== LIMITS.wallRows) bad(`old posts are not kept on the wall (state ${st2.state}, ${st2.wall.length} rows)`);
      if (!/^Old posts: last answer .+ ago$/.test(st2.sign.text) || st2.sign.tone !== 'warn' || st2.sign.latest) bad(`the sign of old posts is wrong (${JSON.stringify(st2.sign)})`);
      if (!st2.signLabel || !/Old posts/.test(st2.signLabel.text)) bad(`the sign over the wall does not say the posts are old (${st2.signLabel && st2.signLabel.text})`);
      const dd = await painted(page);
      if (!dd.some(t => /^Old posts: last answer/.test(t))) bad(`the wall does not say the posts are old: ${JSON.stringify(dd.slice(0, 4))}`);
      if (!(st2.ink < 0.8 * inkOk)) bad(`the old posts are not dimmed (bright pixels on the wall ${inkOk} -> ${st2.ink})`);
      out.stale = `old posts marked after the errors, dimmed (bright pixels ${inkOk} -> ${st2.ink})`;
    }
    stub.mode = 'ok';
    await phase('ok', x => x.stale === false && x.state === 'ok' && x.status === 'ok' && x.wall.length === LIMITS.wallRows, 'the board does not come back to normal after its errors');
    const err = page.errors.filter(e => !/\/local\/ofis-extras\.js/.test(e));
    if (err.some(e => /exception|console\.error/.test(e))) bad(`the page threw: ${err.filter(e => /exception|console\.error/.test(e))[0].slice(0, 160)}`);
    out.foreign = foreignOf(page);
    if (out.foreign.length) bad(`a request leaves 127.0.0.1: ${out.foreign[0].slice(0, 100)}`);
    out.notes.push(`${stub.hits.length} requests, ${s.wall.length} rows, ${s.people.length} people`);
    return out;
  } finally { await S.done(); }
}

// =====================================================================================================================================================================
const want = new Set((val('scenes') || 'demo,reduced,live,off,churn,stub').split(','));
export async function runLounge({ root, scenes = want, shots = shotsDir } = {}) {
  if (shots) mkdirSync(shots, { recursive: true });
  const runs = [];
  if (scenes.has('live')) runs.push(await sceneLive({ root, shots }));
  if (scenes.has('off')) runs.push(await sceneOff({ root, shots }));
  if (scenes.has('churn')) runs.push(await sceneChurn({ root, shots }));
  if (scenes.has('stub')) runs.push(await sceneStub({ root, shots }));
  if (scenes.has('reduced')) runs.push(await sceneReduced({ root, shots }));
  if (scenes.has('demo')) runs.push(await sceneDemo({ root, shots }));
  const problems = runs.flatMap(r => r.problems);
  const parts = runs.map(r => {
    const bits = [...r.notes];
    if (r.cost) bits.push(`pavilion ${r.cost.pavilion.calls} calls and ${r.cost.pavilion.tris} triangles (at most ${BUDGET.calls} and ${BUDGET.tris}), ${r.cost.people.n} people ${r.cost.people.calls} calls and ${r.cost.people.tris} triangles`);
    if (r.poll) bits.push(`poll: ${r.poll.requests} requests, gaps ${r.poll.minGap}..${r.poll.maxGap} ms`);
    if (r.fade) bits.push(`${r.fade.length} fades of ${r.fade.join(', ')} ms (${DUR.slow})`);
    if (r.pulse) bits.push(`pulse ${r.pulse.join('..')}`);
    if (r.ink != null) bits.push(`${r.ink} bright pixels on the wall, ${r.drawn} strings drawn`);
    if (r.hits) bits.push(`${r.hits.n} requests, closest ${r.hits.minGap} ms`);
    if (r.stale) bits.push(r.stale);
    if (r.foreign) bits.push(`requests that leave 127.0.0.1: ${r.foreign.length}`);
    return `${r.tag}: ${bits.join(', ')}`;
  });
  return [make('lounge', problems.length === 0 && runs.length > 0, parts.join('; ') + (problems.length ? '; PROBLEMS: ' + problems.slice(0, 6).join(' | ') + (problems.length > 6 ? ` (and ${problems.length - 6} more)` : '') : ''))];
}

// ---- mutations: break one line in a copy of the repo and expect the check to fail
const P = 'public/js/lounge-paint.js', M = 'public/js/lounge-model.js', SRC = 'public/js/lounge-source.js', L = 'public/js/ofis-lounge.js', O = 'public/js/ofis.js', C = 'public/js/lounge-card.js';
const MUTATIONS = [
  { name: 'the wall paints no text of the posts', file: P, from: "r.lines.forEach((ln, j) => say(fit(g, ln, X.ageRight - X.text - 130), X.text, base + j * line));", to: 'r.lines.forEach(() => {});', scenes: ['demo'] },
  { name: 'the mode names still shows the text', file: M, from: "const text = mode === 'text' ? clipChars(m.text, limit) : '';", to: 'const text = clipChars(m.text, limit);', scenes: ['demo'] },
  { name: 'the poll runs ten times faster', file: SRC, from: 'export const POLL_MS = 3000;', to: 'export const POLL_MS = 300;', scenes: ['demo'] },
  { name: 'the poll goes on while the tab is hidden', file: L, from: "return visible && !(typeof document !== 'undefined' && document.hidden) && mode() !== 'off' && onScreen();", to: "return visible && mode() !== 'off' && onScreen();", scenes: ['demo'] },
  { name: 'the mode off still polls', file: L, from: "return visible && !(typeof document !== 'undefined' && document.hidden) && mode() !== 'off' && onScreen();", to: "return visible && !(typeof document !== 'undefined' && document.hidden) && onScreen();", scenes: ['demo'] },
  { name: 'nobody comes to the lounge', file: L, from: '      if (!P) addPerson(p);\n', to: '      if (!P) { /* nobody comes */ }\n', scenes: ['demo'] },
  { name: 'a click on the wall opens no card', file: O, from: "if (h.t === 'lounge' || h.t === 'lounger') { lounge.click(h); return; }", to: "if (h.t === 'lounge' || h.t === 'lounger') return;", scenes: ['demo'] },
  { name: 'the card lists five posts', file: M, from: 'cardRows: 20,', to: 'cardRows: 5,', scenes: ['stub'] },
  { name: 'bidi marks reach the wall', file: M, from: '\\u200E\\u200F\\u202A-\\u202E\\u2060-\\u206F', to: '\\u200E\\u200F\\u2060-\\u206F', scenes: ['stub'] },
  { name: 'the pavilion is 40 draw calls heavier', file: L, from: '    parts = g.children.slice(first).filter(m => !m.userData.pick);\n', to: '    for (let i = 0; i < 40; i++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.01, 0.01), new THREE.MeshBasicMaterial()); m.position.set(c.X + 6, 0.5, c.Z + 3); g.add(m); }\n    parts = g.children.slice(first).filter(m => !m.userData.pick);\n', scenes: ['demo'] },
  { name: 'prefers-reduced-motion is ignored', file: L, from: 'const reducedNow = () => !!(decor.follower && decor.follower.reduced);', to: 'const reducedNow = () => false;', scenes: ['reduced'] },
  { name: 'a request leaves the machine', file: L, from: '  const { scene, store, decor, settings } = host;\n', to: "  const { scene, store, decor, settings } = host;\n  try { new Image().src = 'https://cdn.example.com/lounge.png'; } catch { /* no image */ }\n", scenes: ['live'] },
  { name: 'Escape does not close the card', file: C, from: "if (e.key !== 'Escape' || !open) return;", to: "if (e.key !== 'Escape1' || !open) return;", scenes: ['demo'] },
  { name: 'the sign cannot be reached with the Tab key', file: L, from: 'sign.el.tabIndex = 0;', to: 'sign.el.tabIndex = -1;', scenes: ['demo'] },
  { name: 'the pavilion is 8,400 triangles heavier', file: L, from: '    const tris = B.i.length / 3 - t0;', to: "    for (let i = 0; i < 700; i++) B.box(X + 1 + (i % 20) * 0.1, 0.5, Z + 1 + (i >> 5) * 0.1, 0.05, 0.05, 0.05, '#ff00ff');\n    const tris = B.i.length / 3 - t0;", scenes: ['live'] },
  { name: 'the face of the wall is drawn although the board is off', file: L, from: "const boardShown = () => !!view && (view.state === 'ok' || view.state === 'unsupported' || view.state === 'failed');", to: 'const boardShown = () => !!view;', scenes: ['live'] },
  { name: 'the wall is painted again every frame', file: L, from: 'if (view.key !== painted.key) {', to: 'if (true) {', scenes: ['stub'] },
  // the findings of the review: each of these passed the QA before it had the check that catches it
  { name: 'the poll ignores that the board is off', file: SRC, from: "stats.lastStatus === 'ok' && said === 'off' ? offMs : pollMs;", to: "pollMs;", scenes: ['off'] },
  { name: 'a person who leaves keeps the bone texture of its skeleton', file: O, from: ' if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose();', to: '', scenes: ['churn'] },
  { name: 'the pavilion hides 8,400 triangles from its own counter', file: L, from: '    const tris = B.i.length / 3 - t0;', to: "    const tris = B.i.length / 3 - t0;\n    for (let i = 0; i < 700; i++) B.box(X + 1 + (i % 20) * 0.1, 0.5, Z + 1 + (i >> 5) * 0.1, 0.05, 0.05, 0.05, '#ff00ff');", scenes: ['live'] },
  { name: 'a new post does not fade in', file: L, from: "const added = !first && !reducedNow() && view.state === 'ok' ?", to: 'const added = false ?', scenes: ['demo'] },
  { name: 'the fade of a new post lasts twenty times as long', file: L, from: '* 1000) / DUR.slow);', to: '* 1000) / (DUR.slow * 20));', scenes: ['demo'] },
  { name: 'the poll ignores that the lounge is off the screen', file: L, from: '    return x1 > 0 && x0 < vw && y1 > 0 && y0 < vh;', to: '    return true;', scenes: ['demo'] },
  { name: 'the card puts the text of a post into the page as HTML', file: C, from: '<div class="lg-text">${esc(r.text)}</div>', to: '<div class="lg-text">${r.text}</div>', scenes: ['stub'] },
  { name: 'the card puts the names of a post into the page as HTML', file: C, from: 'const who = esc(r.who), text', to: 'const who = r.who, text', scenes: ['stub'] },
  { name: 'the people of the card are put into the page as HTML', file: C, from: '</i>${esc(p.name)}</span>', to: '</i>${p.name}</span>', scenes: ['stub'] },
  { name: 'the label of a person puts its name into the page as HTML', file: L, from: '</i>${esc(P.name)}</div>', to: '</i>${P.name}</div>', scenes: ['stub'] },
  { name: 'the sign puts the newest post into the page as HTML', file: L, from: '<span>${esc(line)}</span>', to: '<span>${line}</span>', scenes: ['stub'] },
  { name: 'the sign does not carry the newest post', file: M, from: 'if (newest && !stale) sign.latest =', to: 'if (false) sign.latest =', scenes: ['demo'] },
  { name: 'a board that answers with errors is called off', file: M, from: "const state = hidden ? 'hidden' : down && !oldPosts ? 'failed' : d.state.state;", to: "const state = hidden ? 'hidden' : d.state.state;", scenes: ['stub'] },
  { name: 'old posts are not marked after a long run of errors', file: M, from: 'const stale = !hidden && down && oldPosts;', to: 'const stale = false;', scenes: ['stub'] },
  { name: 'old posts are not dimmed', file: P, from: '(view.stale ? STALE_ALPHA : 1), dy', to: '1, dy', scenes: ['stub'] },
  { name: 'a server without the endpoint is asked again after three seconds', file: SRC, from: 'export const RETRY_MS = 5 * 60e3;', to: 'export const RETRY_MS = 3000;', scenes: ['live'] },
  { name: 'an unsupported board says it is off', file: M, from: "sign.tone = 'warn'; sign.text = tt('lounge.unsupported', 'Message board format not recognised');", to: "sign.tone = 'warn'; sign.text = tt('lounge.off', 'x');", scenes: ['stub'] },
];

async function runMutations() {
  const rows = [];
  const pick = val('mutation');
  for (const m of MUTATIONS.filter(x => !pick || pick.split(',').some(w => x.name.includes(w)))) {
    const dir = mkdtempSync(join(tmpdir(), 'cco-mut-'));
    try {
      for (const f of readdirSync(ROOT).filter(n => /\.(js|json)$/.test(n) && n !== 'package-lock.json')) cpSync(join(ROOT, f), join(dir, f));      // the server and every module it requires
      cpSync(join(ROOT, 'public'), join(dir, 'public'), { recursive: true });
      const file = join(dir, m.file), text = readFileSync(file, 'utf8');
      if (!text.includes(m.from)) { rows.push({ m, caught: false, detail: 'the line to break was not found' }); console.log(`MUTATION MISSED lounge: ${m.name} -> the line to break was not found`); continue; }
      writeFileSync(file, text.replace(m.from, () => m.to));
      const [res] = await runLounge({ root: dir, scenes: new Set(m.scenes), shots: null });
      const at = res.detail.indexOf('PROBLEMS');
      rows.push({ m, caught: !res.ok, detail: res.ok ? 'PASSED: ' + res.detail.slice(0, 200) : 'FAILED: ' + res.detail.slice(at, at + 260) });
    } catch (e) {
      rows.push({ m, caught: false, detail: 'the run itself broke: ' + String(e.message || e).slice(0, 200) });
    } finally { rmSync(dir, { recursive: true, force: true }); }
    const last = rows[rows.length - 1];
    console.log(`MUTATION ${last.caught ? 'CAUGHT' : 'MISSED'} lounge: ${m.name} -> ${last.detail}`);
  }
  return rows;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  if (args.includes('--mutations')) {
    const rows = await runMutations();
    const missed = rows.filter(r => !r.caught);
    console.log(missed.length ? `MUTATIONS MISSED ${missed.length} of ${rows.length}` : `MUTATIONS ALL CAUGHT (${rows.length})`);
    process.exit(missed.length ? 1 : 0);
  }
  const report = [];
  for (const r of await runLounge()) { report.push(r); console.log(`CHECK ${r.name} ${r.ok ? 'PASS' : 'FAIL'} ${r.detail}`); }
  const bad = report.filter(r => !r.ok);
  console.log(bad.length ? `QA FAIL (${bad.length} of ${report.length} checks)` : `QA PASS (${report.length} checks)`);
  process.exit(bad.length ? 1 : 0);
}
