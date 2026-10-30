// QA of the room boards (public/js/board-text.js, board-setting.js, ofis.js `paintPlaque`, pixel/board.js): headless Chrome in a throw-away profile, the server against a
// fake ~/.claude, one `CHECK <name> PASS|FAIL <detail>` line per check and a final `QA PASS` or `QA FAIL`.
//   node tools/qa/office-board-qa.mjs [--only board-3d|board-pixel|board-setting] [--shots <dir>] [--mutations]
//
//   board-3d       the plaque of the 3D scene (its canvas is read, pixel by pixel): the chat name is the big text, the project folder is absent by default and small in the
//                  bottom-right corner when the setting is on, a waiting room still has its badge, the HTML sign below the zoom limit says the same
//   board-pixel    the pixel scene (isometric and front): one board per room, name bigger than the project, project absent by default and in the bottom-right when on, every board
//                  inside the view and clear of every label, no pointer events of its own, a click on it opens its room's card, legible at every zoom, only a fade in motion (none at all under reduced motion)
//   board-setting  the setting `project`: off by default, stored, the address wins and is not stored, survives a reload, the 3D scene follows the same store
//
// --mutations breaks the code in a copy of the repo, one line at a time, and runs the check that guards that line: every one must FAIL there (a check that cannot fail guards nothing).
// Timing is the one thing a busy machine bends; a failing check is worth running again on its own (--only) before concluding anything.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, px, sleep, waitReady, scenario } from './harness.mjs';
import { scenario3d, lookAtRoom, o3 } from './harness3d.mjs';

const args = process.argv.slice(2);
const val = f => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : undefined; };
const only = val('only'), shotsDir = val('shots');
if (shotsDir) mkdirSync(shotsDir, { recursive: true });
const want = name => !only || only === name;
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`CHECK ${name} ${ok ? 'PASS' : 'FAIL'} ${detail}`);
}
const shot = async (page, name) => { if (shotsDir) await page.screenshot(join(shotsDir, name)); };
// the chat name the board must show, by the rule of board-text.js written out again
const nameOf = a => a.name || a.title || a.project || '';
const mains = agents => agents.filter(a => a.kind === 'main');

// ============================================================================ 3D plaque
// The canvas of a plaque, read in the page. Regions are in canvas px of a plaque of height h (the band is 0.11 h, the text starts at 0.31 h, ends 0.14 h before the right edge):
//   name    x from the text start to 0.55 w, y from 0.1 h to 0.8 h        (the big text; the badge is further right)
//   corner  x from 0.45 w to the end of the text, y from 0.8 h to 0.95 h   (where the small project line goes, clear of the screws and the frame)
//   badge   x from 0.6 w to the frame, y from the frame to 0.38 h          (yellow when it is your turn or a question waits; the yellow frame of a waiting room is left out)
const PLAQUE = id => `(() => {
  const cv = document.querySelector('#view-ofis').__ofisSigns.get(${JSON.stringify(id)});
  const w = cv.width, h = cv.height, d = cv.getContext('2d').getImageData(0, 0, w, h).data;
  const white = i => { const r = d[i], g = d[i + 1], b = d[i + 2]; return 0.2126 * r + 0.7152 * g + 0.0722 * b > 165 && Math.max(r, g, b) - Math.min(r, g, b) < 45; };
  const region = (x0, x1, y0, y1) => {
    const rows = [], cols = [];
    let n = 0;
    for (let y = Math.floor(y0); y < Math.min(h, y1); y++) {
      let c = 0;
      for (let x = Math.floor(x0); x < Math.min(w, x1); x++) if (white((y * w + x) * 4)) { c++; n++; cols.push(x); }
      rows.push(c >= 2 ? 1 : 0);
    }
    const bands = [];
    let start = -1;
    rows.forEach((v, k) => { if (v && start < 0) start = k; if (!v && start >= 0) { bands.push(k - start); start = -1; } });
    if (start >= 0) bands.push(rows.length - start);
    return { ink: n, band: Math.max(0, ...bands), minX: n ? Math.min(...cols) : -1, maxX: n ? Math.max(...cols) : -1 };
  };
  let yellow = 0;
  for (let y = 16; y < h * 0.38; y++) for (let x = Math.floor(w * 0.6); x < w - 16; x++) { const i = (y * w + x) * 4; if (d[i] > 225 && d[i + 1] > 150 && d[i + 2] < 100) yellow++; }
  const x0 = h * 0.31, right = w - h * 0.14;
  return { w, h, right, name: region(x0 - 4, w * 0.55, h * 0.1, h * 0.8), corner: region(w * 0.45, right + 4, h * 0.8, h * 0.95), yellow };
})()`;
// every fillText the plaques make from now on: { text, size (px), small (the project line: right aligned) }
const SPY = `(() => {
  const v = document.querySelector('#view-ofis'), log = window.__fillLog = [];
  const orig = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, x, y, mw) {
    for (const [id, cv] of v.__ofisSigns) if (cv === this.canvas) log.push({ id, text: String(t), size: parseFloat(this.font.match(/(\\d+(?:\\.\\d+)?)px/)[1]), align: this.textAlign, fill: String(this.fillStyle) });
    return orig.apply(this, arguments);
  };
  return true;
})()`;
const setProject = (page, on) => page.evaluate(`import('/js/board-setting.js').then(m => { m.setProject(${on ? "'on'" : "'off'"}); return m.projectOn(); })`);
const FALLBACK = `[...document.querySelectorAll('#view-ofis .of-signl')].map(e => { const b = e.querySelector('b'), sp = e.querySelector('.of-sp'); return { id: e.dataset.id, name: b && b.textContent, nameSize: b && parseFloat(getComputedStyle(b).fontSize), nameWeight: b && getComputedStyle(b).fontWeight, proj: sp ? sp.textContent : null, projSize: sp ? parseFloat(getComputedStyle(sp).fontSize) : null, projAlign: sp ? getComputedStyle(sp).alignSelf : null }; })`;

if (want('board-3d')) {
  const S = await scenario3d(6, { tag: 'bd3d' });
  try {
    if (!S.ready.ok) throw new Error('3D scene did not become ready: ' + JSON.stringify(S.ready.last));
    const ms = mains(S.agents), working = ms.find(a => a.status === 'working'), waiting = ms.find(a => a.status === 'waiting'), ask = ms.find(a => a.status === 'ask');
    const longest = ms.reduce((b, a) => (nameOf(a).length > nameOf(b).length ? a : b));
    const rooms = [working, waiting, longest].filter((a, i, l) => l.indexOf(a) === i);
    await S.page.evaluate(SPY);
    const pick = async () => Object.fromEntries(await Promise.all(rooms.map(async a => [a.id, await S.page.evaluate(PLAQUE(a.id))])));
    // default: the project folder is off. Flip it on and off once so that every plaque paints again with the spy installed.
    const off0 = await pick();
    await setProject(S.page, true);
    const on = await pick(), logOn = await S.page.evaluate('window.__fillLog.splice(0)');
    await shot(S.page, '3d-fit-on.png');
    await setProject(S.page, false);
    const off = await pick(), logOff = await S.page.evaluate('window.__fillLog.splice(0)');
    const bad = [];
    const rows = [];
    for (const a of rooms) {
      const lo = off[a.id], hi = on[a.id], lo0 = off0[a.id];
      const isName = l => l.id === a.id && l.align !== 'right' && l.fill === '#ffffff' && l.size > 20 && !/^\+\d+$/.test(l.text);       // not the project line, not a "+N" chip
      const nameFonts = log => log.filter(isName).map(l => l.size);
      const projFonts = log => log.filter(l => l.id === a.id && l.align === 'right').map(l => l.size);
      const lines = logOn.filter(isName).map(l => l.text);
      const squeeze = t => t.replace(/\s+/g, '').replace(/…$/, '');
      if (lo0.corner.ink !== 0 || lo.corner.ink !== 0) bad.push(`${a.project}: project pixels with the setting off (${lo0.corner.ink}/${lo.corner.ink})`);
      if (logOff.some(l => l.id === a.id && l.text === a.project) || logOff.some(l => l.id === a.id && l.align === 'right')) bad.push(`${a.project}: the project line was painted with the setting off`);
      if (hi.corner.ink < 30 || hi.corner.maxX < hi.right - 25) bad.push(`${a.project}: no small project text at the bottom right (ink ${hi.corner.ink}, x ${hi.corner.minX}..${hi.corner.maxX} of ${hi.w}, text ends at ${Math.round(hi.right)})`);
      if (!(hi.name.band >= 1.25 * hi.corner.band) || hi.corner.band === 0) bad.push(`${a.project}: name band ${hi.name.band} px is not clearly taller than the project band ${hi.corner.band} px`);
      const nf = Math.max(...nameFonts(logOn)), pf = Math.max(...projFonts(logOn));
      if (!(nf > pf)) bad.push(`${a.project}: name font ${nf} px is not bigger than project font ${pf} px`);
      if (!squeeze(nameOf(a)).startsWith(squeeze(lines.join(' '))) || lines.length < 1 || lines.length > 2) bad.push(`${a.project}: the name painted as ${JSON.stringify(lines)} is not the chat name`);
      if (!logOn.some(l => l.id === a.id && l.align === 'right' && l.text === a.project)) bad.push(`${a.project}: the corner text is not the project folder`);
      rows.push(`${a.project}: name ${JSON.stringify(lines)} at ${nf} px (ink band ${hi.name.band}), project ${pf} px (band ${hi.corner.band}, x ${hi.corner.minX}..${hi.corner.maxX} of ${hi.w}), project ink with the setting off ${lo.corner.ink}`);
    }
    // badges: the waiting room keeps its yellow badge in both states, a working room has none
    if (waiting) { const y = [off[waiting.id].yellow, on[waiting.id].yellow]; if (y.some(n => n < 300)) bad.push(`waiting room: badge pixels ${y.join('/')} (need 300)`); }
    if (working && (on[working.id].yellow > 0 || off[working.id].yellow > 0)) bad.push('a working room shows a yellow badge');
    // the HTML sign that replaces the wall text when zoomed far out
    await S.page.evaluate(o3('(() => { const r = s.rooms[Math.floor(s.rooms.length / 2)]; return o.view(r.X + 3, 1.5, r.Z + 3, 14); })()'));
    await sleep(500);
    const fbOff = await S.page.evaluate(FALLBACK);
    await setProject(S.page, true);
    await sleep(300);
    await shot(S.page, '3d-fallback-sign-on.png');
    const fbOn = await S.page.evaluate(FALLBACK);
    for (const a of ms.filter(x => fbOn.some(f => f.id === x.id))) {
      const o = fbOff.find(f => f.id === a.id), n = fbOn.find(f => f.id === a.id);
      if (o.name !== nameOf(a) || o.proj !== null) bad.push(`sign ${a.project}: off shows ${JSON.stringify([o.name, o.proj])}`);
      if (n.name !== nameOf(a) || n.proj !== a.project || !(n.nameSize > n.projSize) || +n.nameWeight < 600 || n.projAlign !== 'flex-end') bad.push(`sign ${a.project}: on shows ${JSON.stringify(n)}`);
    }
    await setProject(S.page, false);
    // pictures
    if (shotsDir) {
      const at = { x: 3.6, y: 1.4, z: 0.2 };
      const take = async (a, name, on) => { if (!a) return; await setProject(S.page, on); await lookAtRoom(S.page, a.id, 80, at); await sleep(700); await shot(S.page, name); };
      await take(working, '3d-plaque-off.png', false);
      await take(working, '3d-plaque-on.png', true);
      await take(waiting, '3d-plaque-waiting-on.png', true);
      await take(ask, '3d-plaque-ask-on.png', true);
      await take(longest, '3d-plaque-long-name-on.png', true);
      await take(longest, '3d-plaque-long-name-off.png', false);
      await take(ms.find(a => a.status === 'dormant'), '3d-plaque-asleep-on.png', true);
    }
    check('board-3d', bad.length === 0 && S.page.errors.filter(e => !/ofis-extras/.test(e)).length === 0,
      `${rooms.length} plaques read from their canvas (${ms.length} rooms): ${bad.length ? 'PROBLEMS ' + bad.join('; ') + ' | ' : ''}${rows.join(' | ')}; setting off: no project pixels in the bottom-right strip of any plaque (${rooms.map(a => off[a.id].corner.ink).join('/')}); waiting room badge pixels off/on ${waiting ? off[waiting.id].yellow + '/' + on[waiting.id].yellow : '-'}; HTML sign (${fbOn.length} signs): name in bold, project small at the right only when on; console errors ${S.page.errors.filter(e => !/ofis-extras/.test(e)).length}`);
  } finally { await S.done(); }
}

// ============================================================================ pixel boards
// Everything about the boards in the page, in CSS px of the page: the four corners of each plate (the computed transform of the sheared element, applied about its origin), what is
// inside it, and whether any point of it lies under a label (sampled on a grid, independent of the script's own test).
const BOARDS = `(() => {
  const v = document.querySelector('#view-ofis'), p = v.__pixel, ar = v.querySelector('.of-area').getBoundingClientRect();
  const labs = p.labelRects().filter(l => l.shown).map(l => ({ id: l.id, x: l.x + ar.left, y: l.y + ar.top, w: l.w, h: l.h }));
  const figs = p.figures().map(id => p.agentCss(id)).filter(Boolean).map(f => ({ x: f.x + ar.left, y: f.y + ar.top }));
  return [...v.querySelectorAll('.px-board')].map(el => {
    const w = el.offsetWidth, h = el.offsetHeight, cs = getComputedStyle(el), m = new DOMMatrix(cs.transform), L = el.parentElement.getBoundingClientRect();
    const pt = (x, y) => ({ x: L.left + w / 2 + m.a * (x - w / 2) + m.c * (y - h) + m.e, y: L.top + h + m.b * (x - w / 2) + m.d * (y - h) + m.f });
    const quad = [pt(0, h), pt(w, h), pt(w, 0), pt(0, 0)], xs = quad.map(q => q.x), ys = quad.map(q => q.y);
    let under = 0, samples = 0;
    for (let i = 0; i <= 24; i++) for (let j = 0; j <= 6; j++) {
      const q = pt(w * i / 24, h * j / 6); samples++;
      if (labs.some(l => q.x > l.x - 1 && q.x < l.x + l.w + 1 && q.y > l.y - 1 && q.y < l.y + l.h + 1)) under++;
    }
    const free = [];
    for (const [u, k] of [[0.5, 0.5], [0.4, 0.5], [0.6, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.35], [0.5, 0.65], [0.2, 0.5], [0.8, 0.5]]) {
      const q = pt(w * u, h * k);
      if (!labs.some(l => q.x > l.x - 4 && q.x < l.x + l.w + 4 && q.y > l.y - 4 && q.y < l.y + l.h + 4) && !figs.some(f => Math.abs(q.x - f.x) < 22 && Math.abs(q.y - f.y) < 22) && q.x > ar.left + 4 && q.x < ar.right - 4 && q.y > ar.top + 80 && q.y < ar.bottom - 4) free.push(q);
    }
    const name = el.querySelector('.pb-name'), proj = el.querySelector('.pb-proj'), ncs = getComputedStyle(name);
    return {
      id: el.dataset.id, on: el.classList.contains('on'), w, h, quad, bbox: { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }, rect: el.getBoundingClientRect().toJSON(),
      nameText: name.textContent, nameFont: parseFloat(ncs.fontSize), nameLines: Math.round(name.getBoundingClientRect().height / (parseFloat(ncs.lineHeight) || 1) / Math.max(0.01, Math.hypot(m.a, m.b))),
      projText: proj ? proj.textContent : null, projFont: proj ? parseFloat(getComputedStyle(proj).fontSize) : null, projAlign: proj ? getComputedStyle(proj).textAlign : null,
      projBelow: proj ? proj.offsetTop >= name.offsetTop + name.offsetHeight - 1 : null, projLast: proj ? el.lastElementChild === proj : null, projHalf: proj ? (proj.offsetTop + proj.offsetHeight / 2) / h : null,
      pe: cs.pointerEvents, layerPe: getComputedStyle(el.parentElement).pointerEvents, chips: [...el.querySelectorAll('.pb-badge')].map(b => b.textContent),
      trans: cs.transitionProperty + ' ' + cs.transitionDuration, anim: cs.animationName, under, samples, free: free.map(q => [q.x, q.y]),
      band: cs.getPropertyValue('--bc').trim(),
    };
  });
})()`;
const LABEL_PROJ = `[...document.querySelectorAll('#view-ofis .px-l.px-main .px-proj')].map(e => getComputedStyle(e).display)`;

async function pixelCase(proj, { quick = false, ...extra } = {}) {
  const S = await scenario(6, { proj, season: 'summer', tag: 'bp-' + proj, ...extra });
  const out = { proj, bad: [], notes: [] };
  const bad = out.bad;
  try {
    if (!S.ready) throw new Error('pixel scene did not become ready');
    const P = e => S.page.evaluate(px(e));
    const rooms = mains(S.agents).filter(a => a.status !== 'dormant');                // an asleep chat is on the shelf: no room, no board
    const expectName = Object.fromEntries(rooms.map(a => [a.id, nameOf(a)])), expectProj = Object.fromEntries(rooms.map(a => [a.id, a.project]));
    const view = await S.page.evaluate(`document.querySelector('#view-ofis .of-area').getBoundingClientRect().toJSON()`);
    const tag = s => `${proj}: ${s}`;

    // ---- the default: setting off
    const a = await S.page.evaluate(BOARDS);
    out.a = a;
    if (a.length !== rooms.length || new Set(a.map(b => b.id)).size !== rooms.length || !rooms.every(r => a.some(b => b.id === r.id))) bad.push(tag(`${a.length} boards for ${rooms.length} rooms`));
    if (a.filter(b => b.on).length < rooms.length - 1) bad.push(tag(`only ${a.filter(b => b.on).length} of ${rooms.length} boards are shown at the first view (a board gives way to a label that it would touch, at most one here)`));
    for (const b of a) if (b.nameText !== expectName[b.id]) bad.push(tag(`board ${b.id.slice(0, 7)} says ${JSON.stringify(b.nameText)}, not the chat name`));
    if (a.some(b => b.projText !== null)) bad.push(tag('a board has a project line by default'));
    if (a.some(b => b.nameFont < 12)) bad.push(tag(`a name under 12 px (${Math.min(...a.map(b => b.nameFont))})`));
    const shownA = a.filter(b => b.on);
    const outside = shownA.filter(b => b.bbox.x0 < view.left - 0.5 || b.bbox.x1 > view.right + 0.5 || b.bbox.y0 < view.top - 0.5 || b.bbox.y1 > view.bottom + 0.5);
    if (outside.length) bad.push(tag(`${outside.length} boards outside the view`));
    const covered = a.filter(b => b.on && b.under > 0);
    if (covered.length) bad.push(tag(`${covered.length} shown boards lie under a label (${covered.map(b => b.under + '/' + b.samples).join(',')})`));
    if (a.some(b => b.pe !== 'none' || b.layerPe !== 'none')) bad.push(tag('a board takes pointer events'));
    // the matrix arithmetic of this check against the browser: the box of my four corners is the element's own box
    const drift = Math.max(...a.filter(b => b.on).map(b => Math.max(Math.abs(b.bbox.x0 - b.rect.left), Math.abs(b.bbox.x1 - b.rect.right), Math.abs(b.bbox.y0 - b.rect.top), Math.abs(b.bbox.y1 - b.rect.bottom))));
    if (!(drift < 1.5)) bad.push(tag(`the corners computed here are ${drift.toFixed(1)} px from the browser's box`));
    const labelsOff = await S.page.evaluate(LABEL_PROJ);
    if (!labelsOff.length || labelsOff.some(d => d !== 'none')) bad.push(tag(`a label shows the project folder by default (${labelsOff.join(',')})`));
    const sk = a[0] && a[0].quad ? Math.atan2(a[0].quad[1].y - a[0].quad[0].y, a[0].quad[1].x - a[0].quad[0].x) * 180 / Math.PI : 0;
    if (proj === 'iso' ? Math.abs(sk - 26.57) > 0.6 : Math.abs(sk) > 0.2) bad.push(tag(`the plate's slope is ${sk.toFixed(2)} degrees`));
    out.notes.push(`${a.length} boards, ${a.filter(b => b.on).length} shown, names ${a.map(b => b.nameFont).join('/')} px at zoom ${await P('p.zoom')}, slope ${sk.toFixed(1)} deg, project lines ${a.filter(b => b.projText !== null).length}, labels' project rows ${labelsOff[0]}`);
    await S.page.mouse.move(2, 2);
    await shot(S.page, `pixel-${proj}-off-fit.png`);

    // ---- the setting on: the project folder, small, at the bottom right
    if (quick) { const mo0 = (await S.page.evaluate(BOARDS))[0]; out.motion = mo0 ? { trans: mo0.trans, anim: mo0.anim } : null; return out; }
    await P(`p.setSetting('project', 'on')`);
    await sleep(500);
    const b = await S.page.evaluate(BOARDS);
    out.b = b;
    for (const x of b) {
      if (!x.on) continue;
      if (x.projText !== expectProj[x.id]) bad.push(tag(`board ${x.id.slice(0, 7)} shows ${JSON.stringify(x.projText)} as project, not ${JSON.stringify(expectProj[x.id])}`));
      else if (!(x.nameFont > x.projFont)) bad.push(tag(`name ${x.nameFont} px is not bigger than the project ${x.projFont} px`));
      else if (x.projAlign !== 'right' || !x.projBelow || !x.projLast || x.projHalf < 0.5) bad.push(tag(`the project line is not at the bottom right (align ${x.projAlign}, below the name ${x.projBelow}, last ${x.projLast}, centre at ${x.projHalf && x.projHalf.toFixed(2)} of the height)`));
      if (x.nameText !== expectName[x.id]) bad.push(tag(`the name changed with the setting on: ${JSON.stringify(x.nameText)}`));
    }
    if (b.filter(x => x.on).length < rooms.length - 1) bad.push(tag(`only ${b.filter(x => x.on).length} of ${rooms.length} boards are shown with the setting on`));
    if (b.some(x => x.on && x.under > 0)) bad.push(tag('a board lies under a label with the setting on'));
    const outsideOn = b.filter(x => x.on && (x.bbox.x0 < view.left - 0.5 || x.bbox.x1 > view.right + 0.5 || x.bbox.y0 < view.top - 0.5 || x.bbox.y1 > view.bottom + 0.5));
    if (outsideOn.length) bad.push(tag(`${outsideOn.length} boards outside the view with the setting on`));
    const labelsOn = await S.page.evaluate(LABEL_PROJ);
    if (!labelsOn.length || labelsOn.some(d => d === 'none')) bad.push(tag('the labels did not show the project folder with the setting on'));
    out.notes.push(`on: ${b.length} project lines, name ${Math.min(...b.map(x => x.nameFont))} px against ${Math.max(...b.map(x => x.projFont || 0))} px, labels' project rows ${labelsOn[0]}`);
    await S.page.mouse.move(2, 2);
    await shot(S.page, `pixel-${proj}-on-fit.png`);

    // ---- a click on a board opens its room's card (the board itself takes no events: the page below it answers)
    const clickable = b.filter(x => x.on && x.free.length);
    let clicked = null;
    for (const x of clickable) {
      await S.page.evaluate(`(document.querySelector('.of-card:not([hidden]) .oc-x') || { click() {} }).click()`);
      await sleep(80);
      const [cx, cy] = x.free[0];
      const el = await S.page.evaluate(`(() => { const e = document.elementFromPoint(${cx}, ${cy}); return e ? (e.closest('.px-board') ? 'board' : e.tagName) : null; })()`);
      await S.page.mouse.click(cx, cy);
      await sleep(350);
      const card = await S.page.evaluate(`(() => { const d = document.querySelector('.of-card'); return d && !d.hidden ? d.dataset.id : null; })()`);
      clicked = { room: x.id, got: card, under: el };
      if (el === 'board') bad.push(tag('the point on the board belongs to the board, not to the page under it'));
      if (card !== x.id) bad.push(tag(`a click on the board of ${x.id.slice(0, 7)} opened ${card ? card.slice(0, 7) : 'nothing'} (the page under the point: ${el})`));
      break;
    }
    if (!clicked) bad.push(tag('no board had a free point to click'));
    await S.page.evaluate(`(document.querySelector('.of-card:not([hidden]) .oc-x') || { click() {} }).click()`);
    out.notes.push(`click on the board of ${clicked ? clicked.room.slice(0, 7) : '-'} opened ${clicked && clicked.got ? clicked.got.slice(0, 7) : 'nothing'}`);

    // ---- zoom: legible at every level, bigger with the room, never past the cap
    const fonts = {};
    for (const z of [1, 2, 3, 4]) {
      await P(`p.setZoom(${z})`);
      await sleep(350);
      const r = await S.page.evaluate(BOARDS);
      fonts[z] = { shown: r.filter(x => x.on).length, min: Math.min(...r.filter(x => x.on).map(x => x.nameFont), 99), max: Math.max(...r.filter(x => x.on).map(x => x.nameFont), 0), proj: Math.max(...r.filter(x => x.on).map(x => x.projFont || 0), 0) };
      if (z === 2 || z === 3) { await P(`p.centerOnRoom(${JSON.stringify((rooms.find(q => q.status === 'waiting') || rooms[0]).id)})`); await sleep(500); await S.page.mouse.move(2, 2); await shot(S.page, `pixel-${proj}-on-zoom${z}-waiting.png`); }
      if (z === 3) { const long = rooms.reduce((m, q) => (nameOf(q).length > nameOf(m).length ? q : m)); await P(`p.centerOnRoom(${JSON.stringify(long.id)})`); await sleep(500); await S.page.mouse.move(2, 2); await shot(S.page, `pixel-${proj}-on-zoom3-long-name.png`); }
    }
    if (Object.values(fonts).some(f => f.shown > 0 && f.min < 12)) bad.push(tag(`a name under 12 px at some zoom: ${JSON.stringify(fonts)}`));
    if (!(fonts[1].max <= fonts[2].max && fonts[2].max <= fonts[3].max && fonts[3].max > fonts[1].max)) bad.push(tag(`the name does not grow with the zoom: ${JSON.stringify(fonts)}`));
    if (Object.values(fonts).some(f => f.proj >= f.max && f.shown > 0)) bad.push(tag(`the project is not smaller than the name at some zoom: ${JSON.stringify(fonts)}`));
    out.notes.push(`zoom 1-4: boards shown ${[1, 2, 3, 4].map(z => fonts[z].shown).join('/')}, name px ${[1, 2, 3, 4].map(z => fonts[z].max).join('/')}, project px ${[1, 2, 3, 4].map(z => fonts[z].proj).join('/')}`);

    // ---- motion: only a fade (opacity and visibility), with the token durations; nothing is animated by keyframes
    const mo = (await S.page.evaluate(BOARDS))[0];
    out.motion = mo ? { trans: mo.trans, anim: mo.anim } : null;
    const reduced = !!extra.reducedMotion;
    if (!mo || mo.anim !== 'none' || (reduced ? !/^none /.test(mo.trans) : !/^opacity, visibility /.test(mo.trans))) bad.push(tag(`the board moves with ${mo && mo.trans} / ${mo && mo.anim}${reduced ? ' under reduced motion' : ''}`));
    return out;
  } finally { await S.done(); }
}

if (want('board-pixel')) {
  const iso = await pixelCase('iso'), front = await pixelCase('front');
  const rm = await pixelCase('iso', { quick: true, reducedMotion: true, tag: 'rm' });
  const rmDur = rm.motion ? rm.motion.trans : '', normalDur = iso.motion ? iso.motion.trans : '';
  const bad = [...iso.bad, ...front.bad, ...rm.bad];
  const fade = s => { const m = String(s).match(/([\d.]+)s/); return m ? Math.round(+m[1] * 1000) : NaN; };
  if (fade(normalDur) !== 200) bad.push(`the fade is ${fade(normalDur)} ms, not the 200 ms token`);

  check('board-pixel', bad.length === 0, `${bad.length ? 'PROBLEMS ' + bad.join('; ') + ' | ' : ''}iso: ${iso.notes.join('; ')} | front: ${front.notes.join('; ')} | reduced motion: transition "${rmDur}" and no animation (normal: "${normalDur}")`);
}

// ============================================================================ the setting
async function reload(S, query, expectFigures) {
  await S.page.goto(`http://127.0.0.1:${S.srv.port}/${query ? '?' + query : ''}#ofis`, 800);
  await waitReady(S.page, expectFigures);
}
if (want('board-setting')) {
  const S = await scenario(4, { proj: 'iso', season: 'summer', tag: 'bset' });
  const bad = [], notes = [];
  try {
    if (!S.ready) throw new Error('pixel scene did not become ready');
    const figures = mains(S.agents).filter(a => a.status !== 'dormant').length;
    const state = () => S.page.evaluate(`(() => { const p = document.querySelector('#view-ofis').__pixel; return { value: p.settings.project, from: p.settingsFrom.project, stored: localStorage.getItem('ajan-ofisi.settings'), lines: document.querySelectorAll('.px-board .pb-proj').length, boards: document.querySelectorAll('.px-board').length }; })()`);
    const storedProject = s => { try { return (JSON.parse(s) || {}).project; } catch { return undefined; } };
    const base = { proj: 'iso', season: 'summer' };
    const q = extra => new URLSearchParams({ ...base, ...extra }).toString();
    // 1. a fresh profile
    const s0 = await state();
    if (s0.value !== 'off' || s0.from !== 'default' || s0.stored !== null || s0.lines !== 0 || s0.boards !== figures) bad.push(`fresh profile: ${JSON.stringify(s0)}`);
    // 2. the user turns it on: applied at once, kept
    const ok = await S.page.evaluate(px(`p.setSetting('project', 'on')`));
    await sleep(300);
    const s1 = await state();
    if (!ok || s1.value !== 'on' || s1.from !== 'user' || storedProject(s1.stored) !== 'on' || s1.lines !== figures) bad.push(`after turning it on: ${JSON.stringify(s1)}`);
    const refused = await S.page.evaluate(px(`p.setSetting('project', 'sometimes')`));
    const s1b = await state();
    if (refused !== false || s1b.value !== 'on') bad.push(`a bad value was taken: ${refused} ${JSON.stringify(s1b)}`);
    // 3. a reload: remembered
    await reload(S, q({}), figures);
    const s2 = await state();
    if (s2.value !== 'on' || s2.from !== 'stored' || s2.lines !== figures) bad.push(`after a reload: ${JSON.stringify(s2)}`);
    // 4. the address wins and is not stored
    await reload(S, q({ project: 'off' }), figures);
    const s3 = await state();
    if (s3.value !== 'off' || s3.from !== 'url' || storedProject(s3.stored) !== 'on' || s3.lines !== 0) bad.push(`?project=off over a stored on: ${JSON.stringify(s3)}`);
    // 5. a bad address value is ignored
    await reload(S, q({ project: 'maybe' }), figures);
    const s4 = await state();
    if (s4.value !== 'on' || s4.from !== 'stored') bad.push(`?project=maybe: ${JSON.stringify(s4)}`);
    // 6. the address turns it on for a visit without storing it
    await S.page.evaluate(`localStorage.removeItem('ajan-ofisi.settings')`);
    await reload(S, q({ project: 'on' }), figures);
    const s5 = await state();
    if (s5.value !== 'on' || s5.from !== 'url' || s5.stored !== null || s5.lines !== figures) bad.push(`?project=on on a fresh store: ${JSON.stringify(s5)}`);
    await reload(S, q({}), figures);
    const s6 = await state();
    if (s6.value !== 'off' || s6.lines !== 0) bad.push(`back to the plain address: ${JSON.stringify(s6)}`);
    notes.push(`pixel: fresh ${s0.value}/${s0.from}; on ${s1.value}/${s1.from}, stored ${storedProject(s1.stored)}; reload ${s2.value}/${s2.from}; ?project=off ${s3.value}/${s3.from} (store kept ${storedProject(s3.stored)}); ?project=maybe ${s4.value}/${s4.from}; ?project=on ${s5.value}/${s5.from} (stored ${s5.stored}); plain again ${s6.value}`);
    // 7. the 3D scene follows the same store: stored on shows the project in the corner of the plaque, the address overrides
    const probe = async (query, stored) => {
      await S.page.evaluate(stored == null ? `localStorage.removeItem('ajan-ofisi.settings')` : `localStorage.setItem('ajan-ofisi.settings', JSON.stringify({ project: '${stored}' }))`);
      await S.page.goto(`http://127.0.0.1:${S.srv.port}/?${new URLSearchParams({ scene: '3d', ...query })}#ofis`, 800);
      const t0 = Date.now();
      let r = null;
      while (Date.now() - t0 < 30000 && !r) { r = await S.page.evaluate(o3('s && s.rooms.length ? s.rooms[0].id : null')).catch(() => null); if (!r) await sleep(300); }
      await sleep(900);
      let pl = null;
      for (let i = 0; i < 40 && r; i++) { pl = await S.page.evaluate(PLAQUE(r)).catch(() => null); if (pl && pl.name.ink > 0) break; await sleep(300); }
      return pl && pl.name.ink > 0 ? pl.corner.ink : -1;                         // -1: the plaque was not painted at all (so a zero would mean nothing)
    };
    const c0 = await probe({}, null), c1 = await probe({}, 'on'), c2 = await probe({ project: 'off' }, 'on'), c3 = await probe({ project: 'on' }, 'off'), c4 = await probe({}, 'off');
    if (c0 !== 0) bad.push(`3D: project pixels by default (${c0})`);
    if (!(c1 >= 30)) bad.push(`3D: stored on shows no project (${c1})`);
    if (c2 !== 0) bad.push(`3D: ?project=off over a stored on still shows it (${c2})`);
    if (!(c3 >= 30)) bad.push(`3D: ?project=on over a stored off shows no project (${c3})`);
    if (c4 !== 0) bad.push(`3D: stored off shows the project (${c4})`);
    notes.push(`3D plaque corner ink: default ${c0}, stored on ${c1}, ?project=off over on ${c2}, ?project=on over off ${c3}, stored off ${c4}`);
    check('board-setting', bad.length === 0 && S.page.errors.filter(e => !/ofis-extras/.test(e)).length === 0, `${bad.length ? 'PROBLEMS ' + bad.join('; ') + ' | ' : ''}${notes.join(' | ')}; console errors ${S.page.errors.filter(e => !/ofis-extras/.test(e)).length}`);
  } finally { await S.done(); }
}

// ============================================================================ mutations
// one line broken in a copy of the repo, the check that guards it must fail there
const MUTATIONS = [
  { name: 'the small project line is bigger than the name (3D plaque)', file: 'public/js/ofis.js', from: 'const sfs = Math.min(Math.round(h * 0.15), Math.round(fit.fs * 0.62));', to: 'const sfs = Math.round(h * 0.5);', fails: ['board-3d'] },
  { name: 'the project is shown by default (setting default on)', file: 'public/js/pixel/settings.js', from: "shelf: DEFAULT_CAP, project: 'off', lounge", to: "shelf: DEFAULT_CAP, project: 'on', lounge", fails: ['board-3d', 'board-pixel', 'board-setting'] },
  { name: 'the project is bigger than the name (pixel board)', file: 'public/js/pixel/board.js', from: 'small: Math.max(9, Math.round(name * 0.62))', to: 'small: Math.round(name * 1.3)', fails: ['board-pixel'] },
  { name: 'a click on a board does nothing', file: 'public/js/pixel/index.js', from: 'if (onBoard) return { t: \'agent\', id: onBoard };', to: '', fails: ['board-pixel'] },
  { name: 'the address is ignored by the 3D scene', file: 'public/js/board-setting.js', from: 'merge(load(storage), fromQuery(search))', to: 'merge(load(storage), {})', fails: ['board-setting'] },
  { name: 'the labels show the project folder whatever the setting says', file: 'public/app.css', from: '.view-ofis[data-project="off"] .px-l .px-proj { display: none; }', to: '', fails: ['board-pixel'] },
  { name: 'a board takes pointer events', file: 'public/app.css', from: 'position: absolute; left: 0; top: 0; box-sizing: border-box; pointer-events: none; transform-origin: 50% 100%;', to: 'position: absolute; left: 0; top: 0; box-sizing: border-box; pointer-events: auto; transform-origin: 50% 100%;', fails: ['board-pixel'] },
  { name: 'the setting is never stored (the key is refused)', file: 'public/js/pixel/settings.js', from: "project: v => { const t = typeof v === 'string' ? v.trim().toLowerCase() : ''; return t === 'on' || t === 'off' ? t : null; },", to: 'project: () => null,', fails: ['board-pixel', 'board-setting'] },
];
if (args.includes('--mutations')) {
  const which = val('mutation');
  const rows = [];
  for (const [k, m] of MUTATIONS.entries()) {
    if (which != null && String(k) !== which) continue;
    const dir = mkdtempSync(join(tmpdir(), 'cco-board-mut-'));
    try {
      for (const f of readdirSync(ROOT)) if (/\.(js|json)$/.test(f)) cpSync(join(ROOT, f), join(dir, f));
      cpSync(join(ROOT, 'public'), join(dir, 'public'), { recursive: true });
      mkdirSync(join(dir, 'tools'), { recursive: true });
      cpSync(join(ROOT, 'tools/qa'), join(dir, 'tools/qa'), { recursive: true });
      const file = join(dir, m.file), text = readFileSync(file, 'utf8');
      if (!text.includes(m.from)) { rows.push({ m, caught: [], detail: 'the line to break was not found' }); console.log(`MUTATION MISSED ${m.name}: the line to break was not found`); continue; }
      writeFileSync(file, text.replace(m.from, m.to));
      const caught = [], seen = {};
      for (const name of m.fails) {
        const r = spawnSync('node', [join(dir, 'tools/qa/office-board-qa.mjs'), '--only', name], { encoding: 'utf8', timeout: 900000 });
        const line = (r.stdout || '').split('\n').find(l => l.startsWith(`CHECK ${name} `)) || '';
        seen[name] = line.startsWith(`CHECK ${name} FAIL`) ? 'FAIL' : line.startsWith(`CHECK ${name} PASS`) ? 'PASS' : 'no result';
        if (seen[name] === 'FAIL') caught.push(name);
        if (seen[name] === 'FAIL') seen[name] += ': ' + line.replace(/^CHECK \S+ FAIL /, '').slice(0, 200);
      }
      rows.push({ m, caught });
      console.log(`MUTATION ${caught.length === m.fails.length ? 'CAUGHT' : 'MISSED'} ${m.name}: ${m.fails.map(n => `${n} ${seen[n]}`).join(' | ')}`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const missed = rows.filter(r => r.caught.length !== r.m.fails.length);
  console.log(missed.length ? `MUTATIONS MISSED ${missed.length} of ${rows.length}` : `MUTATIONS ALL CAUGHT (${rows.length})`);
  process.exit(missed.length ? 1 : 0);
}

const bad = results.filter(r => !r.ok);
console.log(bad.length ? `QA FAIL (${bad.length} of ${results.length} checks)` : `QA PASS (${results.length} checks)`);
process.exit(bad.length ? 1 : 0);
