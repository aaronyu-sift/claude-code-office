// QA of the lounge on the plaza of the 3D office (public/js/ofis-lounge.js and the modules it uses: lounge-model.js, lounge-plan.js, lounge-paint.js, lounge-source.js, lounge-card.js):
// headless Chrome with software WebGL in a throw-away profile, the server against a fake ~/.claude, one `CHECK lounge PASS|FAIL <detail>` line and a final `QA PASS` or `QA FAIL`.
//   node tools/qa/office3d-lounge-qa.mjs [--scenes demo,reduced,live,stub] [--mutations [--mutation <words>[,<words>]]] [--shots <dir>]
//
//   lounge  four scenes
//     demo     ?lounge=demo at 22:00 with 4 chats: the wall shows the posts the demo script produced (read from the canvas by the page's own fillText calls and by its pixels), the
//              people are in the lounge (named, on the deck, the first two tied to the chats of the Office, the figures of the Office are unchanged), a click on the wall opens the card
//              with its posts newest first and a line that says where the data comes from, Escape closes it, the sign is reachable and openable from the keyboard, the pointer changes over the
//              wall, the poll never runs faster than every 3 seconds and stops when the tab is hidden, the setting names shows no text, off shows nothing and stops the poll, the pavilion
//              costs at most 4 draw calls and 8,000 triangles, the ambient pulse moves, nothing leaves 127.0.0.1
//     reduced  the same with prefers-reduced-motion: the pulse is still, no post animates, the people do not pop
//     live     no ?lounge= and a server without the endpoint (a 404): the board says it is off, with its hint, one request only, no people, no error
//     stub     the endpoint answered by the QA (Chrome's Fetch domain): 30 posts of which some are hostile (bidi marks, control characters, 5000 characters, a long channel), 9 posters, two of
//              them tied to chats of the Office: eight rows on the wall, twenty in the card, newest first, every text cleaned and clipped, six people at most, a click on a person tied to a
//              chat opens that chat's card; then `unsupported`, a quiet board, a server error (the last answer stays), garbage, and the wall is not painted again while nothing changes
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

const args = process.argv.slice(2);
const val = f => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : undefined; };
const shotsDir = val('shots');

const BUDGET = { calls: 4, tris: 8000 };           // what the lounge adds to the building (the people are counted on their own)
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

// ---- the draw calls and triangles of the lounge: the scene drawn with all of it, without the people, and without anything of it that is a mesh of its own (the wall's face, the strip of
// light, anything else the lounge adds to the building). The furniture is in the building's batch, so its triangles are the ones the lounge counted as it put them there.
async function cost(page) {
  const draw = async (on, part) => { await page.evaluate(o3(`o.loungeVisible(${on}, ${part ? JSON.stringify(part) : 'undefined'})`)); await sleep(150); return page.evaluate(o3('o.draw()')); };
  const all = await draw(true), noPeople = await draw(false, 'people'), none = await draw(false);
  await draw(true);
  const s = await snap(page), lights = s.built.tris - s.built.staticTris - 4;           // the lamps and candles are in ofis-decor's shared meshes: counted from their shape
  return {
    pavilion: { calls: noPeople.calls - none.calls, tris: noPeople.tris - none.tris + s.built.staticTris + lights }, people: { calls: all.calls - noPeople.calls, tris: all.tris - noPeople.tris, n: s.people.length },
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
    if (!(k.people.calls >= s.people.length && k.people.tris > 100 * s.people.length)) bad(`the people do not draw (${s.people.length} people: ${JSON.stringify(k.people)})`);

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
    const sg = (await snap(page)).signLabel;
    if (!sg || !sg.shown || sg.tabIndex !== 0 || sg.role !== 'button' || !/lounge/i.test(sg.label || '')) bad(`the sign is not a keyboard button (${JSON.stringify(sg)})`);
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

    // the setting names: no text of a post anywhere; off: nothing, and no poll; text again: it all comes back
    const set = v => page.evaluate(o3(`v.__office.settings.set('lounge', ${JSON.stringify(v)})`));
    const lines = DEMO_SCRIPT.flatMap(e => splitLines(clipChars(e[4], LIMITS.wallText)));          // every line of text the script can put on the wall
    await set('names');
    const nm = await until(page, x => x.mode === 'names' && x.paint.texts.length && !x.paint.texts.some(t => lines.includes(t)), 6000, 200);
    if (!nm) bad(`the setting names still draws the text of the posts (${JSON.stringify((await snap(page)).paint.texts.slice(0, 8))})`);
    else if (!nm.paint.texts.some(t => /^(lead|builder|scout|reviewer|tester|docs)/.test(t))) bad('the setting names draws no names');
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
// scene live: a server without the endpoint
async function sceneLive({ root, shots }) {
  const out = { tag: 'live', problems: [], notes: [] };
  const bad = m => out.problems.push('live: ' + m);
  const S = await scenario3d(4, { tag: 'llive', query: NIGHT, root, fixture: { subs: () => [] }, intercept: hook });
  try {
    const { page } = S;
    if (!S.ready.ok) { bad('the scene did not become ready'); return out; }
    const c = await toHub(page, 60);
    const s = await until(page, x => x.status === 'nofile' && x.state === 'off', 15000);
    if (!s) { bad(`the board did not turn off on a 404 (${JSON.stringify((await snap(page)).state)})`); return out; }
    await sleep(9000);
    const t = await snap(page);
    if (t.boardVisible) bad('the wall draws its face although the board is off (a lounge with nothing to say adds no draw call)');
    const k = await cost(page);
    out.cost = k;
    if (k.pavilion.calls !== 0) bad(`a board that is off adds ${k.pavilion.calls} draw calls to the building (none: the pavilion is in the building's batch and the face of the wall is not drawn)`);
    if (k.pavilion.tris > BUDGET.tris || k.pavilion.tris < 500) bad(`the pavilion is ${k.pavilion.tris} triangles (500 to ${BUDGET.tris})`);
    if (!t.signLabel || !/Agent message board is off/.test(t.signLabel.text)) bad(`the sign does not say the board is off (${t.signLabel && t.signLabel.text})`);
    if (t.people.length) bad(`${t.people.length} people in a lounge whose board is off`);
    if (t.wall.length) bad('posts on a board that is off');
    if (t.stripVisible || t.pulse > 0.001) bad(`the strip of light is on for a board that is off (${t.pulse})`);
    if (loungeHits(page) !== 1) bad(`${loungeHits(page)} requests to /api/lounge in ${Math.round(((t.poll.starts.at(-1) || 0) - (t.poll.starts[0] || 0)) / 1000) + 9} s: a server without the endpoint is asked once (then every 5 minutes)`);
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
    out.notes.push('1 request, its 404 answer and console line expected, the face of the wall not drawn');
    return out;
  } finally { await S.done(); }
}

// =====================================================================================================================================================================
// scene stub: the endpoint answered by the QA
const NAMES = ['builder', 'reviewer', 'scout', 'lead', 'tester', 'docs', 'ops-bot', 'planner', 'qa-bot'];
function bodyOf(kind, mains) {
  const now = Date.now();
  if (kind === 'unsupported') return { state: { state: 'unsupported', schema: 'v9', reason: 'unknown table layout' }, messages: [], channels: {}, agents: [] };
  if (kind === 'quiet') return { state: { state: 'ok', schema: 'chat-v1', reason: '' }, messages: [1, 2, 3].map(i => ({ seq: i, ts: now - (2 + i) * 3600e3, channel: 'old', from: NAMES[i], to: [], text: 'from long ago ' + i })), channels: { old: 3 }, agents: [] };
  if (kind === 'malformed') return { state: 7, messages: 'nope', agents: 5, channels: [] };
  const msgs = [];
  for (let i = 0; i < 30; i++) msgs.push({ seq: i + 1, ts: now - (190 + 20 * (29 - i)) * 1000, channel: ['ops', 'tasks', 'review'][i % 3], from: NAMES[i % 9], to: i % 4 ? [NAMES[(i + 1) % 9]] : [], text: `Post number ${i + 1} from ${NAMES[i % 9]}: ` + 'words '.repeat(3 + (i % 9)).trim(), extra: { ignored: true } });
  msgs[28].to = Array.from({ length: 20 }, (_, i) => 'agent-' + i);
  msgs[29] = { seq: 30, ts: now - 190e3, channel: 'ops\u202Dx' + 'y'.repeat(100), from: 'builder', to: ['reviewer'], text: 'A\u202EB\u0007C\u200Bd ' + 'X'.repeat(5000) };
  const seen = now - 5000;
  return { state: { state: 'ok', schema: 'chat-v1', reason: '' }, messages: msgs, channels: { ops: 10, tasks: 10, review: 10 }, agents: [
    { name: 'builder', lastSeenMs: seen, session: mains[0] }, { name: 'reviewer', lastSeenMs: seen - 1000, session: mains[1] }, { name: 'scout', lastSeenMs: seen - 2000, session: 'no-such-chat' }, ...NAMES.slice(3).map((n, i) => ({ name: n, lastSeenMs: seen - (3 + i) * 1000, session: '' })),
  ] };
}
async function sceneStub({ root, shots }) {
  const out = { tag: 'stub', problems: [], notes: [] };
  const bad = m => out.problems.push('stub: ' + m);
  const stub = { mode: 'ok', hits: [], mains: [] };
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
    const gb = await phase('garbage', x => x.status === 'failed' && x.poll.requests > (f5 ? f5.poll.requests : 0), 'garbage is not noticed');
    const ml = await phase('malformed', x => x.status === 'ok' && x.state === 'off', 'a malformed answer does not end as an off board');
    const ok2 = await phase('ok', x => x.state === 'ok' && x.wall.length === LIMITS.wallRows && x.people.length >= 4, 'the board does not come back after the bad answers');
    const err = page.errors.filter(e => !/\/local\/ofis-extras\.js/.test(e));
    if (err.some(e => /exception|console\.error/.test(e))) bad(`the page threw: ${err.filter(e => /exception|console\.error/.test(e))[0].slice(0, 160)}`);
    out.foreign = foreignOf(page);
    if (out.foreign.length) bad(`a request leaves 127.0.0.1: ${out.foreign[0].slice(0, 100)}`);
    out.notes.push(`${stub.hits.length} requests, ${s.wall.length} rows, ${s.people.length} people`);
    return out;
  } finally { await S.done(); }
}

// =====================================================================================================================================================================
const want = new Set((val('scenes') || 'demo,reduced,live,stub').split(','));
export async function runLounge({ root, scenes = want, shots = shotsDir } = {}) {
  if (shots) mkdirSync(shots, { recursive: true });
  const runs = [];
  if (scenes.has('live')) runs.push(await sceneLive({ root, shots }));
  if (scenes.has('stub')) runs.push(await sceneStub({ root, shots }));
  if (scenes.has('reduced')) runs.push(await sceneReduced({ root, shots }));
  if (scenes.has('demo')) runs.push(await sceneDemo({ root, shots }));
  const problems = runs.flatMap(r => r.problems);
  const parts = runs.map(r => {
    const bits = [...r.notes];
    if (r.cost) bits.push(`pavilion ${r.cost.pavilion.calls} calls and ${r.cost.pavilion.tris} triangles (at most ${BUDGET.calls} and ${BUDGET.tris}), ${r.cost.people.n} people ${r.cost.people.calls} calls and ${r.cost.people.tris} triangles`);
    if (r.poll) bits.push(`poll: ${r.poll.requests} requests, gaps ${r.poll.minGap}..${r.poll.maxGap} ms`);
    if (r.pulse) bits.push(`pulse ${r.pulse.join('..')}`);
    if (r.ink != null) bits.push(`${r.ink} bright pixels on the wall, ${r.drawn} strings drawn`);
    if (r.hits) bits.push(`${r.hits.n} requests, closest ${r.hits.minGap} ms`);
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
  { name: 'the face of the wall is drawn although the board is off', file: L, from: "const boardShown = () => !!view && (view.state === 'ok' || view.state === 'unsupported');", to: 'const boardShown = () => !!view;', scenes: ['live'] },
  { name: 'the wall is painted again every frame', file: L, from: 'if (view.key !== painted.key) {', to: 'if (true) {', scenes: ['stub'] },
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
