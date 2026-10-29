// QA of the floating interface of the three.js Office scene (?scene=3d): the card beside a clicked agent, the shelf card with the zoom buttons under it, the springs and fades of
// docs/motion.md, and the glass bar over a scene that spans the whole view. The same interface as the pixel scene has (pixel-qa.mjs checks 15, 16, 20 and 21), measured on the real
// page in headless Chrome with software WebGL (cdp.mjs: a throw-away profile, never the user's Chrome). Prints one `CHECK <name> PASS|FAIL <detail>` line per check and a final
// `QA PASS` or `QA FAIL`.
//   node tools/qa/office3d-ui-qa.mjs [--only card|shelf|motion|bar|labels] [--shots <dir>]
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { launchChrome, sleep } from './cdp.mjs';
import { makeFixture } from './fixture.mjs';
import { ROOT, VIEW, startServer, apiAgents } from './harness.mjs';

const args = process.argv.slice(2);
const val = f => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : undefined; };
const only = val('only'), shotsDir = val('shots');
const want = name => !only || only === name;
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`CHECK ${name} ${ok ? 'PASS' : 'FAIL'} ${detail}`);
}
// the old scene probes the optional git-ignored file local/ofis-extras.js and expects a 404 when it is absent (public/js/ofis.js)
const OPTIONAL = /\/local\/ofis-extras\.js/;
const errorsOf = page => page.errors.filter(e => !OPTIONAL.test(e)).length + page.failed.filter(e => !OPTIONAL.test(e)).length;
const until = async (fn, ms = 8000, step = 150) => { let r; for (const t0 = Date.now(); Date.now() - t0 < ms; await sleep(step)) { r = await fn().catch(() => null); if (r) return r; } return r; };
const hit = (a, b, m = 0) => a.x < b.x + b.w + m && a.x + a.w > b.x - m && a.y < b.y + b.h + m && a.y + a.h > b.y - m;

// A scenario: n sessions (some asleep, waiting, working) and a number of closed ones, the page opened on the 3D Office. opts: { tag, width, height, query, fixture, reducedMotion }
async function scenario3d(n, opts = {}) {
  const dir = join(tmpdir(), `cco-qa3d-${process.pid}-${n}${opts.tag || ''}`);
  const fx = await makeFixture({ dir, n, ...(opts.fixture || {}) });
  const srv = await startServer(dir);
  const page = await launchChrome({ width: opts.width || VIEW.w, height: opts.height || VIEW.h, reducedMotion: !!opts.reducedMotion });
  const done = async () => { await page.close(); srv.stop(); fx.cleanup(); };
  try {
    const agents = await apiAgents(srv.port);
    const q = new URLSearchParams(opts.query || '');
    q.set('scene', '3d');
    await page.goto(`http://127.0.0.1:${srv.port}/?${q}#ofis`, 800);
    const roomed = agents.filter(a => a.kind === 'main' && a.status !== 'dormant');             // an asleep chat has no room: it is on the shelf
    const ready = await until(async () => page.evaluate(`(() => { const r = document.querySelector('#view-ofis'); return !!r.__ofis && !!r.__ofisUi && r.__ofis.rooms.length >= ${roomed.length} && r.__ofis.chars >= ${roomed.length} && r.__ofisUi.shelf().rows.length > 0; })()`), 25000, 250);
    if (ready) await sleep(1500);                                                                // the first frames, and the fit that the shelf card's arrival asks for
    return { fx, srv, page, agents, roomed, ready: !!ready, done, dir };
  } catch (e) { await done(); throw e; }
}
// the helpers every check uses, bound to one scenario
function tools(S) {
  const ev = e => S.page.evaluate(e);
  const O = e => ev(`(() => { const o = document.querySelector('#view-ofis').__ofis, u = document.querySelector('#view-ofis').__ofisUi; return ${e}; })()`);       // o = the scene's read-out, u = the interface's
  const card = () => O('u.card');
  const shelf = () => O('u.shelf()');
  const rectOf = sel => ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; })()`);
  const centre = async sel => { const r = await rectOf(sel); return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; };
  const click = async sel => { const c = await centre(sel); await S.page.mouse.click(c.x, c.y); };
  const closeCard = async () => { await ev(`(document.querySelector('.of-card:not([hidden]) .oc-x') || { click() {} }).click()`); await until(async () => !(await card()).open, 3000, 100); };
  const view = async () => JSON.stringify(await O('({ zoom: +o.zoom.toFixed(4), origin: o.project(0, 0, 0).map(v => +v.toFixed(2)) })'));       // the camera: zoom and where the origin of the world is on the screen
  const view0 = () => O('({ zoom: o.zoom, origin: o.project(0, 0, 0) })');
  const settle = async () => { await sleep(120); for (let i = 0; i < 40; i++) { const n = await ev(`document.getAnimations().filter(a => (a.playState === 'running' || a.pending) && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.of-card, .of-shelf, .of-shelf-tab, #drawer')).length`); if (!n) return; await sleep(100); } };
  const esc = () => S.page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).then(() => S.page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }));
  // Click an agent: some point of its figure that no label, bar or card covers, found from the scene's own projection of the agent (`charScreen`: its position 0.8 m above the
  // floor), not from the box the card is anchored to, so a wrong anchor cannot hide itself. Returns the point and the anchor box, or null.
  async function openAgent(id) {
    const at = await O(`o.charScreen(${JSON.stringify(id)})`), box = await O(`u.agentBox(${JSON.stringify(id)})`);
    if (!at || !box) return null;
    for (const [dx, dy] of [[0, -14], [0, -26], [0, -4], [8, -12], [-8, -12], [0, 8]]) {
      const x = at[0] + dx, y = at[1] + dy;
      const free = await ev(`(() => { const e = document.elementFromPoint(${x}, ${y}); return !!e && !e.closest('.of-card, .of-side, .of-shelf-tab, .top, #attention, #drawer') && !(e.closest('.of-l') && e.closest('.of-l').dataset.id !== ${JSON.stringify(id)}); })()`);
      if (!free) continue;
      await closeCard();
      await S.page.mouse.click(x, y);
      const c = await until(async () => { const d = await card(); return d.open ? d : null; }, 1500, 100);
      if (c && c.id === id) return { x, y, box };
    }
    return null;
  }
  return { ev, O, card, shelf, rectOf, centre, click, closeCard, view, view0, settle, esc, openAgent };
}

// ---- 3d-bar: the glass bar floats over a scene that spans the whole view, and nothing of the old 3D controls or HUD hides under it
if (want('bar')) {
  const S = await scenario3d(10, { tag: 'bar', query: '?shelf=200', fixture: { closed: 12 } });
  try {
    const T = tools(S);
    const bad = [], rows = [];
    const eq = (what, got, want_) => { if (JSON.stringify(got) !== JSON.stringify(want_)) bad.push(`${what}: ${JSON.stringify(got)} instead of ${JSON.stringify(want_)}`); };
    if (!S.ready) bad.push('the scene did not become ready');
    const geo = () => T.ev(`(() => {
      const r = e => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, r: b.right, b: b.bottom }; };
      const view = document.querySelector('#view-ofis'), top = document.querySelector('.top'), cs = getComputedStyle(top), o = view.__ofis;
      const q = s => view.querySelector(s);
      const under = [...view.querySelectorAll('.of-hud .of-sum, .of-ctl button, .of-shelf, .of-shelf-tab:not([hidden])')].filter(e => e.getClientRects().length).map(e => ({ cls: e.className.toString().slice(0, 14), ...r(e) }));
      const e = document.elementFromPoint(top.getBoundingClientRect().left + 40, top.getBoundingClientRect().top + 14);
      return JSON.stringify({ vw: innerWidth, vh: innerHeight, view: r(view), area: r(q('.of-area')), stage: r(q('.of-stage')), canvas: r(q('.of-stage canvas')), buffer: [q('.of-stage canvas').width, q('.of-stage canvas').height], size: o.size,
        bar: r(top), pos: cs.position, bg: cs.backgroundColor, blur: cs.backdropFilter, border: cs.borderTopColor + ' ' + cs.borderTopWidth, radius: cs.borderTopLeftRadius, barOnTop: !!e && !!e.closest('.top'),
        topH: getComputedStyle(document.documentElement).getPropertyValue('--top-h').trim(), under, hudInArea: !!q('.of-area .of-hud'), ctlInSide: !!q('.of-side .of-ctl'), ctlInArea: !!q('.of-area .of-ctl'), attention: getComputedStyle(document.querySelector('#attention')).display,
        figs: [...document.querySelectorAll('.of-hud')].length, stageBg: getComputedStyle(q('.of-stage')).backgroundColor, viewBg: getComputedStyle(view).backgroundImage.slice(0, 15) });
    })()`).then(JSON.parse);
    for (const w of [360, 700, 1024, 1500, 2560]) {
      await S.page.setViewport(w, 900, 1);
      await sleep(1200);
      const g = await geo(), L = `${w}px`;
      eq(L + ' bar position', g.pos, 'absolute');
      // the pixel scene's grass colour is not behind the clear WebGL canvas of the 3D scene: its own dark view background shows there
      eq(L + ' stage and view background', [g.stageBg, g.viewBg], ['rgba(0, 0, 0, 0)', 'radial-gradient']);
      eq(L + ' bar glass', [g.bg, g.blur, g.border, g.radius], ['rgba(9, 12, 28, 0.8)', 'blur(10px)', 'rgba(196, 208, 255, 0.32) 1px', '18px']);
      if (!(g.bar.y > 0 && g.bar.x > 0 && g.bar.r < g.vw && g.bar.b < g.vh * 0.5)) bad.push(`${L}: the bar does not float inside the view (${g.bar.x.toFixed(0)},${g.bar.y.toFixed(0)} ${g.bar.w.toFixed(0)}x${g.bar.h.toFixed(0)})`);
      if (!g.barOnTop) bad.push(`${L}: something covers the bar`);
      // the scene spans the whole view, whatever the bar does: the view, the scene's box, its stage and its canvas are all the window
      for (const [name, b] of [['view', g.view], ['scene box', g.area], ['stage', g.stage], ['canvas', g.canvas]]) if (Math.abs(b.x) > 0.5 || Math.abs(b.y) > 0.5 || Math.abs(b.w - g.vw) > 1 || Math.abs(b.h - g.vh) > 1) bad.push(`${L}: the ${name} is ${b.w.toFixed(0)}x${b.h.toFixed(0)} at ${b.x.toFixed(0)},${b.y.toFixed(0)} in a ${g.vw}x${g.vh} window`);
      if (g.size[0] !== g.vw || g.size[1] !== g.vh) bad.push(`${L}: the scene draws ${g.size.join('x')} px in a ${g.vw}x${g.vh} window`);
      // the HUD, the zoom buttons and the shelf are below the bar or beside it, never under it
      const covered = g.under.filter(u => hit(u, g.bar));
      if (covered.length) bad.push(`${L}: ${covered.map(u => u.cls).join(', ')} lies under the bar`);
      if (!g.hudInArea || !g.ctlInSide || g.ctlInArea) bad.push(`${L}: the HUD is in the scene (${g.hudInArea}), the zoom buttons in the side column (${g.ctlInSide}) and not in the scene (${!g.ctlInArea})`);
      if (g.attention !== 'none') bad.push(`${L}: the your-turn strip is shown (${g.attention})`);
      if (w >= 761) {            // no agent lies under the bar at "fit"
        const figs = await T.O(`(${JSON.stringify([...S.roomed.map(a => a.id)])}).map(id => u.agentBox(id)).filter(Boolean)`);
        const under = figs.filter(f => f.cy - f.h / 2 < g.bar.b - 0.5);
        if (under.length) bad.push(`${L}: ${under.length} agents lie under the bar (the highest at ${Math.min(...figs.map(f => f.cy - f.h / 2)).toFixed(0)}, the bar ends at ${g.bar.b.toFixed(0)})`);
      }
      rows.push(`${w}: bar ${g.bar.x.toFixed(0)},${g.bar.y.toFixed(0)} ${g.bar.w.toFixed(0)}x${g.bar.h.toFixed(0)} floating, canvas ${g.canvas.w.toFixed(0)}x${g.canvas.h.toFixed(0)} (the window), ${g.under.length} controls below or beside it`);
    }
    await S.page.setViewport(VIEW.w, VIEW.h, 1);
    check('3d-bar', bad.length === 0 && errorsOf(S.page) === 0, `${bad.length ? 'FAILED: ' + bad.slice(0, 6).join('; ') + '; ' : ''}${rows.join('; ')}; console errors (not counting the optional local/ofis-extras.js probe) ${errorsOf(S.page)}`);
  } catch (e) { check('3d-bar', false, `threw: ${(e && e.message) || e}`); } finally { await S.done(); }
}

// ---- 3d-card: a click on an agent (its figure or its label) opens the glass card beside that agent, anchored to its projected place and following it through pan and zoom; the
// agent is marked in the scene; the card closes with its cross, Esc and a click on the empty scene; another agent moves it; "All details" opens the side card and no click on an
// agent reaches the old drawer
if (want('card')) {
  const S = await scenario3d(10, { tag: 'card', query: '?shelf=200', fixture: { closed: 12 } });
  try {
    const T = tools(S);
    const bad = [];
    const eq = (what, got, want_) => { if (JSON.stringify(got) !== JSON.stringify(want_)) bad.push(`${what}: ${JSON.stringify(got)} instead of ${JSON.stringify(want_)}`); };
    if (!S.ready) throw new Error('the scene did not become ready');
    // a link of the card must never be followed in the QA browser: vscode://, claude:// and claude-cli:// would start real programs
    await T.ev(`document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.of-card a')) e.preventDefault(); }, true)`);
    let drawerEver = false;
    await T.ev(`window.__drawerSeen = false; new MutationObserver(() => { if (document.querySelector('#drawer').classList.contains('on')) window.__drawerSeen = true; }).observe(document.querySelector('#drawer'), { attributes: true, attributeFilter: ['class'] })`);
    const mains = S.roomed;
    const around = async (id, c) => {                   // where the card is against its agent: { gap (px between the card's edge and the agent's box), covers }
      const box = await T.O(`u.agentBox(${JSON.stringify(id)})`), r = c.rect;
      const b = { x: box.cx - box.w / 2, y: box.cy - box.h / 2, w: box.w, h: box.h };
      const gap = c.side === 'right' ? r.x - (b.x + b.w) : c.side === 'left' ? b.x - (r.x + r.w) : c.side === 'below' ? r.y - (b.y + b.h) : c.side === 'above' ? b.y - (r.y + r.h) : NaN;
      return { box, b, gap, covers: hit(r, b) };
    };

    // 1. a click on an agent opens the card beside it, in the Atlas style, with nothing dimmed and no drawer
    let A = null, B = null;
    for (const a of mains) {
      const o = await T.openAgent(a.id);
      if (o && !A) A = { agent: a, ...o };
      else if (o && !B && a.id !== A.agent.id) { B = { agent: a, ...o }; break; }
    }
    if (!A || !B) throw new Error('fewer than two agents can be clicked without a label, the bar or a control over them');
    await T.closeCard();
    const v0 = await T.view();
    await S.page.mouse.click(A.x, A.y);
    const c1 = await until(async () => { const d = await T.card(); return d.open ? d : null; }, 3000, 100);
    await T.settle();
    const c1s = await T.card(), a1 = await around(A.agent.id, c1s);
    const look = await T.ev(`(() => { const c = document.querySelector('.of-card'), cs = getComputedStyle(c), d = document.querySelector('#drawer'), r = document.querySelector('#view-ofis').getBoundingClientRect();
      const corner = (x, y) => { const e = document.elementFromPoint(x, y); return e ? (e.closest('.of-stage') ? 'stage' : e.className.toString().slice(0, 20) || e.tagName) : 'none'; };
      return JSON.stringify({ bg: cs.backgroundColor, blur: cs.backdropFilter, border: cs.borderTopColor + ' ' + cs.borderTopWidth, radius: cs.borderTopLeftRadius, scrim: !!document.querySelector('#scrim'), drawer: d.classList.contains('on'),
        corners: [corner(r.left + 4, r.bottom - 4), corner(r.left + 4, r.top + 80)], role: c.getAttribute('role'), label: c.getAttribute('aria-label') }); })()`).then(JSON.parse);
    const inside = (r, m = 0) => r.x >= m && r.y >= m && r.x + r.w <= VIEW.w - m && r.y + r.h <= VIEW.h - m;
    // the anchor is the figure's projection: an independent projection of the agent's position (0.8 m above the floor) lies in the box the card is anchored to
    const mid = await T.O(`o.charScreen(${JSON.stringify(A.agent.id)})`);
    const anchored = Math.abs(mid[0] - a1.box.cx) <= a1.box.w / 2 && mid[1] >= a1.box.cy - a1.box.h / 2 - 1 && mid[1] <= a1.box.cy + a1.box.h / 2 + 1;
    eq('card opens for the clicked agent', [!!c1, c1s.id], [true, A.agent.id]);
    if (!['right', 'left'].includes(c1s.side)) bad.push(`the card is ${c1s.side} of its agent`);
    if (!(a1.gap >= 6 && a1.gap <= 40)) bad.push(`the gap between the card and its agent is ${a1.gap.toFixed(0)} px`);
    if (a1.covers) bad.push('the card covers its agent');
    if (!inside(c1s.rect)) bad.push('the card leaves the window');
    if (!anchored) bad.push(`the card is not anchored to the agent's projected place (agent ${mid.map(v => v.toFixed(0))}, box ${a1.box.cx.toFixed(0)},${a1.box.cy.toFixed(0)} ${a1.box.w.toFixed(0)}x${a1.box.h.toFixed(0)})`);
    eq('title and button', [c1s.title, c1s.mainText], [A.agent.name, 'Open in VS Code']);
    eq('glass', [look.bg, look.blur, look.border, look.radius, look.role, look.label], ['rgba(9, 12, 28, 0.8)', 'blur(10px)', 'rgba(196, 208, 255, 0.32) 1px', '18px', 'dialog', A.agent.name]);
    eq('no scrim, no drawer', [look.scrim, look.drawer], [false, false]);
    eq('the corners of the scene are still the scene', look.corners, ['stage', 'stage']);
    // the agent is marked in the scene (the ring the hover gives), at its feet, and only while its card is open
    const sel1 = await T.O('o.selection');
    const markOk = !!sel1 && sel1.id === A.agent.id && Math.abs(sel1.at[0] - a1.box.cx) <= a1.box.w / 2 + 4 && sel1.at[1] >= a1.box.cy && sel1.at[1] <= a1.box.cy + a1.box.h / 2 + 24;
    if (!markOk) bad.push(`the open agent is not marked: ${JSON.stringify(sel1)}`);
    eq('nothing moved the map', await T.view(), v0);

    // 2. it follows the agent: drag the scene, then zoom about the agent; the card keeps its place beside the agent
    const rel0 = { dx: c1s.rect.x - a1.box.cx, dy: c1s.rect.y - a1.box.cy, side: c1s.side };
    const grass = { x: 24, y: 520 };                                   // an empty part of the scene (the left edge: grass and river)
    const emptyAt = await T.ev(`(() => { const e = document.elementFromPoint(${grass.x}, ${grass.y}); return !!e && !!e.closest('.of-stage') && !e.closest('.of-l'); })()`);
    if (!emptyAt) bad.push('the point used to drag the scene is not empty');
    await S.page.mouse.drag(grass.x, grass.y, grass.x + 70, grass.y - 45);
    const followed = await until(async () => {
      const c = await T.card(), x = await around(A.agent.id, c);
      return c.open && !c.away && (c.side !== rel0.side || (Math.abs((c.rect.x - x.box.cx) - rel0.dx) <= 3 && Math.abs((c.rect.y - x.box.cy) - rel0.dy) <= 3)) && Math.hypot(x.box.cx - a1.box.cx, x.box.cy - a1.box.cy) > 30 ? { c, x } : null;
    }, 4000, 150);
    if (!followed) bad.push('after a drag of the scene the card did not follow its agent');
    const moved = followed ? Math.hypot(followed.x.box.cx - a1.box.cx, followed.x.box.cy - a1.box.cy) : 0;
    const z0 = await T.O('o.zoom'), at = followed ? followed.x.box : a1.box;
    await S.page.mouse.wheel(at.cx, at.cy, -320);
    const zoomed = await until(async () => {
      const z = await T.O('o.zoom'), c = await T.card(), x = await around(A.agent.id, c);
      return z > z0 * 1.2 && c.open && !c.away && !x.covers && x.gap >= 6 && x.gap <= 40 && inside(c.rect) ? { z, c, x } : null;
    }, 4000, 150);
    if (!zoomed) bad.push('after a zoom about the agent the card is not beside it');
    // zoomed in close and dragged far: the agent is out of the view, the card waits (hidden) for it, and is back with it
    await S.page.mouse.wheel(zoomed ? zoomed.x.box.cx : at.cx, zoomed ? zoomed.x.box.cy : at.cy, -700);
    await sleep(900);
    await S.page.mouse.drag(grass.x, grass.y + 100, grass.x + 1400, grass.y + 100, 12);
    await sleep(900);
    const gone = await T.card(), goneBox = await T.O(`u.agentBox(${JSON.stringify(A.agent.id)})`);
    const goneOut = goneBox.cx + goneBox.w / 2 < 0 || goneBox.cx - goneBox.w / 2 > VIEW.w || goneBox.cy + goneBox.h / 2 < 0 || goneBox.cy - goneBox.h / 2 > VIEW.h;
    await T.click('.of-ctl button[data-z="fit"]');
    const back = await until(async () => { const c = await T.card(); return c.open && !c.away ? c : null; }, 4000, 150);
    if (!(goneOut ? gone.away : true)) bad.push('the card did not wait for its agent while it was out of the view');
    if (!back) bad.push('the card did not come back with its agent after "fit"');

    // 3. a click on another agent moves the card to it; a click on a label opens that agent's card
    await T.closeCard();
    await T.settle();
    const bOpen = await T.openAgent(B.agent.id);
    await T.settle();
    const cB = await T.card(), aB = bOpen ? await around(B.agent.id, cB) : null;
    if (!bOpen || cB.id !== B.agent.id || aB.covers) bad.push('a click on another agent did not open its card beside it');
    const aOpen = await T.openAgent(A.agent.id);                          // with B's card open: the card moves to A
    if (!aOpen) bad.push('a click on an agent while another card is open did not move the card to it');
    // the labels are laid out around the card (none under it), so they move when it closes: read the label once the card is gone and the label has stopped moving
    await T.closeCard();
    const labelAt = () => T.ev(`(() => { const l = [...document.querySelectorAll('.of-l.of-tagl[data-id]')].filter(e => e.style.visibility === 'visible' && e.dataset.id === ${JSON.stringify(B.agent.id)})[0]; if (!l) return null; const r = l.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    let labelOf = null, prev = null;
    for (let i = 0; i < 30; i++) {
      await sleep(250);
      labelOf = await labelAt();
      if (labelOf && prev && Math.abs(labelOf.x - prev.x) < 0.5 && Math.abs(labelOf.y - prev.y) < 0.5) break;
      prev = labelOf;
    }
    let labelOk = true;
    if (labelOf) {
      await S.page.mouse.click(labelOf.x, labelOf.y);
      const cl = await until(async () => { const d = await T.card(); return d.open ? d : null; }, 2000, 100);
      labelOk = !!cl && cl.id === B.agent.id;
      if (!labelOk) bad.push(`a click on the label of ${B.agent.id} opened ${cl ? cl.id : 'nothing'}`);
    } else bad.push('no label of the second agent is shown');

    // 4. the Open button and its menu are the pixel scene's (the card is the same module): Esc closes the menu first and then the card
    if (!(await T.openAgent(A.agent.id))) bad.push('could not open the card again');
    const caret = await T.centre('.of-card .oc-caret');
    await S.page.mouse.click(caret.x, caret.y); await sleep(250);
    const menu = await T.card();
    await T.esc(); await sleep(250);
    const afterEsc1 = await T.card();
    await T.esc(); await sleep(250);
    const afterEsc2 = await T.card();
    eq('Esc closes the menu first, then the card', [menu.menuOpen, afterEsc1.open && !afterEsc1.menuOpen, afterEsc2.open], [true, true, false]);
    eq('the menu', menu.items.map(i => i.kind).join(), 'vscode,desktop,terminal,copy-cmd,copy-id');
    await sleep(400);
    eq('the ring is gone when the card closed', await T.O('o.selection'), null);

    // 5. the cross, and a click on the empty scene
    await T.openAgent(A.agent.id);
    await T.click('.of-card .oc-x');
    const afterX = await until(async () => { const d = await T.card(); return !d.open ? d : null; }, 2500, 100);
    await T.openAgent(A.agent.id);
    await T.settle();
    const v1 = await T.view();
    await S.page.mouse.click(grass.x, grass.y + 40);
    const afterEmpty = await until(async () => { const d = await T.card(); return !d.open ? d : null; }, 2500, 100);
    await T.settle();
    eq('closed by the cross and by a click on the empty scene', [!!afterX, !!afterEmpty], [true, true]);
    eq('a click on the empty scene moved nothing', await T.view(), v1);

    // 6. "All details" opens the side card (the drawer element, styled as a glass card) and closes the floating card; none of the clicks above was the old drawer
    drawerEver = await T.ev('window.__drawerSeen');
    if (drawerEver) bad.push('a click on an agent, a label or the empty scene opened the old drawer');
    await T.openAgent(A.agent.id);
    await T.click('.of-card .oc-more');
    await sleep(900);
    const dcard = await T.ev(`(() => { const d = document.querySelector('#drawer'), r = d.getBoundingClientRect(), cs = getComputedStyle(d), c = document.querySelector('.of-card'); return JSON.stringify({ on: d.classList.contains('on'), id: d.dataset.id, w: r.width, x: r.left, vw: innerWidth, bg: cs.backgroundColor, blur: cs.backdropFilter, radius: cs.borderTopLeftRadius, scrim: !!document.querySelector('#scrim'), cardGone: !c || c.hidden, open: !!d.querySelector('.oc-go') }); })()`).then(JSON.parse);
    const detailsOk = dcard.on && dcard.id === A.agent.id && dcard.w <= 431 && dcard.x + dcard.w <= dcard.vw - 10 && /rgba\(9, 12, 28, 0\.8\)/.test(dcard.bg) && /blur\(10px\)/.test(dcard.blur) && dcard.radius === '18px' && !dcard.scrim && dcard.cardGone && dcard.open;
    if (!detailsOk) bad.push(`"All details" did not open the glass side card: ${JSON.stringify(dcard)}`);
    await T.click('#dw-close');
    await sleep(500);

    // 7. leaving the Office closes the card, and the Office comes back without one
    await T.openAgent(A.agent.id);
    await T.ev(`document.querySelector('.top .seg button[data-view="pano"]').click()`);
    await sleep(800);
    const awayState = await T.ev(`JSON.stringify({ hidden: document.querySelector('#view-ofis').hidden, cardOpen: document.querySelector('#view-ofis').__ofisUi.card.open })`).then(JSON.parse);
    await T.ev(`document.querySelector('.top .seg button[data-view="ofis"]').click()`);
    await sleep(1800);
    const backState = await T.ev(`JSON.stringify({ hidden: document.querySelector('#view-ofis').hidden, cardOpen: document.querySelector('#view-ofis').__ofisUi.card.open, cardShown: !document.querySelector('.of-card').hidden, chars: document.querySelector('#view-ofis').__ofis.chars, ring: document.querySelector('#view-ofis').__ofis.selection })`).then(JSON.parse);
    eq('leaving the Office closes the card', [awayState.hidden, awayState.cardOpen], [true, false]);
    eq('back in the Office: no card, no ring, the scene is alive', [backState.hidden, backState.cardOpen, backState.cardShown, backState.chars >= S.roomed.length, backState.ring], [false, false, false, true, null]);

    check('3d-card', bad.length === 0 && errorsOf(S.page) === 0,
      `${bad.length ? 'FAILED: ' + bad.slice(0, 6).join('; ') + '; ' : ''}click on "${A.agent.name.slice(0, 30)}": card on the ${c1s.side} of the agent for the right id, ${a1.gap.toFixed(0)} px from its box, not covering it, inside the window, anchored to the projected figure ${anchored}, glass ${look.bg} ${look.blur} ${look.radius}, no scrim and no drawer; ` +
      `the open agent is marked in the scene (ring at ${sel1 ? sel1.at.map(v => v.toFixed(0)) : '-'}) and unmarked after closing; the map did not move; ` +
      `drag: the agent moved ${moved.toFixed(0)} px and the card ${followed ? 'went with it' : 'DID NOT follow'}; zoom ${z0.toFixed(1)} → ${zoomed ? zoomed.z.toFixed(1) : '?'}: ${zoomed ? `gap ${zoomed.x.gap.toFixed(0)} px, not covering` : 'NOT beside the agent'}; out of the view the card waits (${gone.away}) and returns after fit (${!!back}); ` +
      `another agent moves it ${!!bOpen && !!aOpen}, a label opens its agent ${labelOk}; Esc closes the menu then the card, the cross ${!!afterX}, a click on the empty scene ${!!afterEmpty}; "All details" opens the glass side card (${dcard.w.toFixed(0)} px) ${detailsOk}; the old drawer was never opened by a click on an agent ${!drawerEver}; console errors ${errorsOf(S.page)}`);
  } catch (e) { check('3d-card', false, `threw: ${(e && e.message) || e}`); } finally { await S.done(); }
}

// ---- 3d-shelf: the shelf card of the asleep and closed chats: rows, the cap with its footer (the button adds ten rows, or what is left), a row opens the card beside it, the zoom buttons right under it in the same
// column, the folded state with the buttons in the corner, and nothing of the scene (figure or label) under the card or the buttons at 1024 and 1500 px
if (want('shelf')) {
  const S = await scenario3d(10, { tag: 'shelf', query: '?shelf=5', fixture: { closed: 12 } });
  try {
    const T = tools(S);
    const bad = [];
    const short = x => { const t = JSON.stringify(x); return t.length > 110 ? t.slice(0, 110) + '…' : t; };
    const eq = (what, got, want_) => { if (JSON.stringify(got) !== JSON.stringify(want_)) bad.push(`${what}: ${short(got)} instead of ${short(want_)}`); };
    if (!S.ready) throw new Error('the scene did not become ready');
    await T.ev(`document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.of-card a')) e.preventDefault(); }, true)`);
    const live = S.agents.filter(a => a.kind === 'main'), asleep = live.filter(a => a.status === 'dormant'), waiting = live.filter(a => a.status === 'waiting' || a.status === 'ask');
    const expected = [...S.fx.closed.map(c => ({ id: c.id, at: c.closedAt, name: c.name, kind: 'closed' })), ...asleep.map(a => ({ id: a.id, at: a.updated || a.since, name: a.name, kind: 'dormant' }))].sort((p, q) => q.at - p.at || (p.id < q.id ? -1 : 1));
    const TOTAL = expected.length, ids = sh => sh.rows.map(r => r.id).join(), want_ = n => expected.slice(0, n).map(e => e.id).join();
    await until(async () => (await T.shelf()).total === TOTAL, 15000, 250);
    const v0 = await T.view();
    // where the zoom buttons are: their gaps to the right and bottom edges of the view, and (card open) the room between the card's bottom edge and the top of the buttons
    const cornerOf = TT => TT.ev(`(() => { const v = document.querySelector('#view-ofis').getBoundingClientRect(), bs = [...document.querySelectorAll('.of-ctl button')].map(b => b.getBoundingClientRect()), last = bs[bs.length - 1], top = Math.min(...bs.map(b => b.top)), h = document.querySelector('.of-shelf'), hb = h.hidden ? null : h.getBoundingClientRect();
      return JSON.stringify({ gapR: +(v.right - last.right).toFixed(2), gapB: +(v.bottom - last.bottom).toFixed(2), cardGap: hb ? +(top - hb.bottom).toFixed(2) : null }); })()`).then(JSON.parse);
    const sameCorner = (what, open, folded, want) => {
      if (Math.abs(open.gapR - folded.gapR) > 0.5 || Math.abs(open.gapB - folded.gapB) > 0.5) bad.push(`${what}: the zoom buttons are ${open.gapR}/${open.gapB} px from the right/bottom edge with the shelf open and ${folded.gapR}/${folded.gapB} folded (they must not move)`);
      if (Math.abs(folded.gapR - want) > 1.5 || Math.abs(folded.gapB - want) > 1.5) bad.push(`${what}: the zoom buttons are ${folded.gapR}/${folded.gapB} px from the corner, not ${want}`);
      if (open.cardGap == null || open.cardGap < 9.5) bad.push(`${what}: the card does not end above the buttons with the gap (${open.cardGap} px between them)`);
    };
    const cornerRows = [];

    // 1. ?shelf=5: exactly the 5 newest, the footer says so and offers ten more; the asleep chat has no room; waiting chats are in their rooms
    const a = await T.shelf();
    eq('total', a.total, TOTAL); eq('rows with ?shelf=5', a.rows.length, 5); eq('the rows are the 5 newest by time', ids(a), want_(5)); eq('header', [a.title, a.count], ['Asleep and closed', '5 chats']);
    eq('footer', [a.foot.hidden, a.foot.text, a.foot.button], [false, `Showing the newest 5 of ${TOTAL}`, `Show ${Math.min(10, TOTAL - 5)} more`]);
    const inCard = r => r.x >= a.rect.x - 0.5 && r.x + r.w <= a.rect.x + a.rect.w + 0.5 && r.y >= a.rect.y - 0.5 && r.y + r.h <= a.rect.y + a.rect.h + 0.5;
    const last = a.rows[a.rows.length - 1];
    if (!inCard(a.foot.rect) || !inCard(a.foot.buttonRect) || a.foot.rect.y < last.rect.y + last.rect.h - 0.5) bad.push('the footer or its button is outside the card, or over the list');
    const inScene = await T.O(`({ rooms: o.rooms.map(r => r.id), chars: o.chars, asleep: ${JSON.stringify(asleep.map(x => x.id))}.map(id => o.charScreen(id)) })`);
    eq('rooms: the live chats that are awake', inScene.rooms.sort(), S.roomed.map(x => x.id).sort());
    eq('the asleep chat has no figure in the scene', inScene.asleep.filter(Boolean).length, 0);
    eq('waiting chats are in rooms and not on the shelf', [waiting.every(w => inScene.rooms.includes(w.id)), waiting.some(w => a.rows.some(r => r.id === w.id))], [true, false]);
    const figs = a.rows.filter(r => !r.figure || r.figure.w < 20 || r.figure.h < 30 || r.figure.ink < 150);
    if (figs.length) bad.push(`${figs.length} rows have no figure drawn`);
    eq('the shown rows say when they closed', a.rows.every(r => /^(closed|idle) (\d+[dhms] ?)+ago$/.test(r.when)), true);

    // 2. the zoom buttons are right under the card in the same column, outside the scene's box
    const col = await T.ev(`(() => { const h = document.querySelector('.of-shelf'), c = document.querySelector('.of-ctl'), hb = h.getBoundingClientRect(), cb = c.getBoundingClientRect(), sb = document.querySelector('.of-side').getBoundingClientRect();
      return JSON.stringify({ sibling: h.nextElementSibling === c, inSide: h.parentElement.classList.contains('of-side') && c.parentElement === h.parentElement, inArea: !!document.querySelector('.of-area').contains(c), below: cb.top - hb.bottom, within: cb.left >= hb.left - 0.5 && cb.right <= hb.right + 0.5 && hb.right <= sb.right + 0.5 }); })()`).then(JSON.parse);
    if (!col.sibling || !col.inSide || col.inArea || col.below < 9.5 || !col.within) bad.push(`the zoom buttons are not under the card in its column, with the gap: ${JSON.stringify(col)}`);
    const openCorner = await cornerOf(T);

    // 3. the button adds ten rows (here the 8 that are left) and the footer is gone when nothing is left out
    await T.click('.sh-more-btn');
    await sleep(500);
    const b = await T.shelf();
    eq('rows after the footer button', [b.rows.length, ids(b), b.foot.hidden, b.count], [TOTAL, want_(TOTAL), true, `${TOTAL} chats`]);
    // the figure of a row is the 3D scene's avatar in the project's colour: "Zz" for an asleep chat, a check mark for a closed one (so the two differ), the colour of the project in both
    const avatar = async id => T.ev(`(() => { const c = document.querySelector('.sh-list li[data-id="${id}"] canvas.sh-fig'), g = c.getContext('2d'), w = c.width, h = c.height, d = g.getImageData(0, 0, w, h).data;
      let r = 0, gr = 0, bl = 0, n = 0, white = 0, mask = '';
      for (let y = Math.floor(h * 0.3); y < Math.floor(h * 0.85); y++) for (let x = Math.floor(w * 0.15); x < Math.floor(w * 0.85); x++) { const i = (y * w + x) * 4; if (d[i + 3] < 200) { mask += '0'; continue; } if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) { white++; mask += '1'; } else { r += d[i]; gr += d[i + 1]; bl += d[i + 2]; n++; mask += '0'; } }
      return JSON.stringify({ mask, rgb: n ? [r / n, gr / n, bl / n].map(Math.round) : null, white }); })()`).then(JSON.parse);
    const sleeper = b.rows.find(r => r.kind === 'dormant'), closer = b.rows.find(r => r.kind === 'closed');
    if (!sleeper || !closer) bad.push('the shelf has no asleep row or no closed row to compare');
    else {
      const [as, cl] = [await avatar(sleeper.id), await avatar(closer.id)];
      if (as.mask === cl.mask || as.white < 15 || cl.white < 15) bad.push(`the glyphs of an asleep and a closed chat's avatar do not differ or are missing (white pixels ${as.white} and ${cl.white})`);
      if (!as.rgb || !cl.rgb) bad.push('an avatar is empty');
    }

    // 4. a row opens the card beside it (to its left, the shelf is at the right edge), with the closed chat's details; Esc closes it
    const target = expected.filter(e => e.kind === 'closed')[2];
    await T.ev(`document.querySelector('.sh-list li[data-id="${target.id}"]').scrollIntoView({ block: 'nearest' })`);
    await T.click(`.sh-list li[data-id="${target.id}"] .sh-item`);
    const fromRow = await until(async () => { const d = await T.card(); return d.open && d.id === target.id ? d : null; }, 3000, 100);
    await T.settle();
    const rowCard = await T.card(), rowRect = await T.rectOf(`.sh-list li[data-id="${target.id}"] .sh-item`);
    const rowOk = !!fromRow && rowCard.side === 'left' && rowCard.rect.x + rowCard.rect.w <= rowRect.x + 0.5 && rowCard.rect.x + rowCard.rect.w >= rowRect.x - 40 && rowCard.title === target.name && /closed/.test(rowCard.pillClass || '') && rowCard.mainText === 'Open in VS Code' && rowCard.mainHref === `vscode://anthropic.claude-code/open?session=${target.id}`;
    if (!rowOk) bad.push(`a row did not open its card beside it: ${short({ side: rowCard.side, title: rowCard.title, href: rowCard.mainHref, card: rowCard.rect, row: rowRect })}`);
    eq('the card of a row marks no agent in the scene', await T.O('o.selection'), null);
    await T.esc(); await sleep(300);
    eq('Esc closes the card of a row', (await T.card()).open, false);

    // 5. the shelf is fixed beside the scene: the wheel on its list scrolls the list and never the map; folding and unfolding it never move the map
    const sh1 = await T.shelf(), listR = sh1.listRect;
    await S.page.mouse.wheel(listR.x + listR.w / 2, listR.y + listR.h / 2, 260);
    await sleep(350);
    const scrolled = await T.shelf();
    eq('the map after the wheel on the list', await T.view(), v0);
    await T.click('.sh-hide');
    await until(async () => (await T.shelf()).mode === 'collapsed', 3000, 100);
    await T.settle();
    const folded = await T.shelf(), foldedGeo = await T.ev(`(() => { const v = document.querySelector('#view-ofis').getBoundingClientRect(), bs = [...document.querySelectorAll('.of-ctl button')].map(b => b.getBoundingClientRect()), last = bs[bs.length - 1], a = document.querySelector('.of-area').getBoundingClientRect(); return JSON.stringify({ gapR: v.right - last.right, gapB: v.bottom - last.bottom, area: a.width, view: v.width, inArea: bs.some(b => document.querySelector('.of-area').contains(document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)) && !document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2).closest('.of-ctl')) }); })()`).then(JSON.parse);
    eq('folded', [folded.mode, folded.hidden, folded.tabHidden, folded.tab], ['collapsed', true, false, `Shelf · ${TOTAL}`]);
    sameCorner('1500px', openCorner, await cornerOf(T), 16);
    if (Math.abs(foldedGeo.area - foldedGeo.view) > 1) bad.push(`folded: the scene is ${foldedGeo.area.toFixed(0)} of ${foldedGeo.view.toFixed(0)} px wide`);
    eq('the map after folding', await T.view(), v0);
    eq('the fold is remembered', await T.ev(`localStorage.getItem('ajan-ofisi.shelf')`), 'closed');
    await T.click('.of-shelf-tab');
    await until(async () => (await T.shelf()).mode === 'open', 3000, 100);
    await T.settle();
    eq('the map after unfolding', await T.view(), v0);

    // 6. nothing of the scene under the card, the buttons or the bar at 1024 and 1500 px: "fit" frames the offices in what they leave free
    const geoRows = [];
    for (const w of [1024, 1500]) {
      await S.page.setViewport(w, 900, 1);
      await sleep(1500);
      const g = await T.ev(`(() => {
        const r = e => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }, o = document.querySelector('#view-ofis').__ofis, u = document.querySelector('#view-ofis').__ofisUi;
        const host = document.querySelector('.of-shelf'), btns = [...document.querySelectorAll('.of-ctl button')].map(r), bx = Math.min(...btns.map(b => b.x)), by = Math.min(...btns.map(b => b.y));
        const labels = [...document.querySelectorAll('.of-l')].filter(e => e.style.visibility === 'visible').map(e => ({ cls: e.className.replace('of-l ', ''), ...r(e) }));
        const figs = ${JSON.stringify(S.roomed.map(x => x.id))}.map(id => u.agentBox(id)).filter(Boolean).map(f => ({ x: f.cx - Math.max(f.w, 24) / 2, y: f.cy - Math.max(f.h, 24) / 2, w: Math.max(f.w, 24), h: Math.max(f.h, 24) }));
        return JSON.stringify({ host: r(host), btns: { x: bx, y: by, w: Math.max(...btns.map(b => b.x + b.w)) - bx, h: Math.max(...btns.map(b => b.y + b.h)) - by }, bar: r(document.querySelector('.top')), labels, figs, mode: document.querySelector('#view-ofis').dataset.shelf, zoom: o.zoom }); })()`).then(JSON.parse);
      const under = (o, what) => [['the card', g.host], ['the buttons', g.btns], ['the bar', g.bar]].filter(([n, r]) => hit(o, r) && !(n === 'the bar' && what === 'label')).map(([n]) => n).join(' and ');
      const hits = [...g.figs.map(o => ({ what: 'figure', o })), ...g.labels.map(o => ({ what: 'label', o }))].filter(({ o, what }) => under(o, what));
      if (g.mode !== 'open') bad.push(`${w}px: the shelf is ${g.mode}`);
      if (hits.length) bad.push(`${w}px: ${hits.length} figures or labels lie under the card, the buttons or the bar: ${hits.slice(0, 3).map(({ what, o }) => `${what}${o.cls ? ' ' + o.cls : ''} at ${o.x.toFixed(0)},${o.y.toFixed(0)} ${o.w.toFixed(0)}x${o.h.toFixed(0)} under ${under(o, what)}`).join('; ')}`);
      const cOpen = await cornerOf(T);
      await T.click('.sh-hide'); await until(async () => (await T.shelf()).mode === 'collapsed', 3000, 100); await T.settle();
      const cFold = await cornerOf(T);
      await T.click('.of-shelf-tab'); await until(async () => (await T.shelf()).mode === 'open', 3000, 100); await T.settle();
      sameCorner(`${w}px`, cOpen, cFold, 16);
      cornerRows.push(`${w}: ${cOpen.gapR}/${cOpen.gapB} open, ${cFold.gapR}/${cFold.gapB} folded`);
      geoRows.push(`${w}: card ${g.host.x.toFixed(0)}..${(g.host.x + g.host.w).toFixed(0)} x ${g.host.y.toFixed(0)}..${(g.host.y + g.host.h).toFixed(0)}, ${g.figs.length} figures and ${g.labels.length} labels shown, ${hits.length} of them under the card, the buttons or the bar, zoom ${g.zoom.toFixed(1)}`);
    }
    await S.page.setViewport(VIEW.w, VIEW.h, 1);

    // 7. narrow windows (the breakpoints of the pixel scene): the shelf starts folded, a tab at the edge of the scene, the buttons in the corner (8 px from it at 640 px or less, 16 px
    // above that); the tab brings the card back, over the scene, and unfolding never moves the map
    const narrowRows = [];
    for (const w of [700, 360]) {
      const N = await scenario3d(10, { tag: 'shelfw' + w, width: w, query: '?shelf=5', fixture: { closed: 12 } });
      try {
        const TN = tools(N);
        if (!N.ready) { bad.push(`${w}px: the scene did not become ready`); continue; }
        await until(async () => (await TN.shelf()).total === TOTAL, 15000, 250);
        await sleep(600);
        const g0 = await TN.shelf(), nv0 = await TN.view();
        const corner = await TN.ev(`(() => { const v = document.querySelector('#view-ofis').getBoundingClientRect(), bs = [...document.querySelectorAll('.of-ctl button')].map(b => b.getBoundingClientRect()), last = bs[bs.length - 1]; return JSON.stringify({ gapR: v.right - last.right, gapB: v.bottom - last.bottom, area: document.querySelector('.of-area').getBoundingClientRect().width, view: v.width }); })()`).then(JSON.parse);
        const wantGap = w <= 640 ? 8 : 16;
        eq(`${w}px: starts folded`, [g0.mode, g0.hidden, g0.tabHidden, g0.tab], ['collapsed', true, false, `Shelf · ${TOTAL}`]);
        if (Math.abs(corner.gapR - wantGap) > 1.5 || Math.abs(corner.gapB - wantGap) > 1.5 || Math.abs(corner.area - corner.view) > 1) bad.push(`${w}px: the buttons are ${corner.gapR.toFixed(1)}/${corner.gapB.toFixed(1)} px from the corner (want ${wantGap}), the scene is ${corner.area.toFixed(0)} of ${corner.view.toFixed(0)} px wide`);
        await TN.click('.of-shelf-tab');
        await until(async () => (await TN.shelf()).mode === 'open', 3000, 100);
        await TN.settle();
        const g1 = await TN.shelf(), over = await TN.ev(`(() => { const r = document.querySelector('.of-shelf').getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + 40), b = document.querySelector('.of-ctl button').getBoundingClientRect(), f = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return JSON.stringify({ card: !!e && !!e.closest('.of-shelf'), buttons: !!f && !!f.closest('.of-ctl'), x: r.left, r: r.right, vw: innerWidth }); })()`).then(JSON.parse);
        eq(`${w}px: the tab opens the card`, [g1.mode, g1.hidden, g1.tabHidden, g1.rows.length], ['open', false, true, 5]);
        if (!over.card || !over.buttons || over.x < -0.5 || over.r > over.vw + 0.5) bad.push(`${w}px: the opened card or the buttons are covered or leave the window: ${JSON.stringify(over)}`);
        eq(`${w}px: the map after unfolding`, await TN.view(), nv0);
        sameCorner(`${w}px`, await cornerOf(TN), { gapR: corner.gapR, gapB: corner.gapB }, wantGap);
        cornerRows.push(`${w}: ${corner.gapR.toFixed(0)}/${corner.gapB.toFixed(0)} folded, ${(await cornerOf(TN)).gapR}/${(await cornerOf(TN)).gapB} open`);
        narrowRows.push(`${w}: folded at first, tab "${g0.tab}", buttons ${corner.gapR.toFixed(0)}/${corner.gapB.toFixed(0)} px from the corner, the tab opens a card ${over.r - over.x > 0 ? (over.r - over.x).toFixed(0) : '?'} px wide over the scene`);
        if (errorsOf(N.page)) bad.push(`${w}px: ${errorsOf(N.page)} console errors`);
      } finally { await N.done(); }
    }

    check('3d-shelf', bad.length === 0 && errorsOf(S.page) === 0,
      `${bad.length ? 'FAILED: ' + bad.slice(0, 6).join('; ') + '; ' : ''}${live.length} live (${asleep.length} asleep) + ${S.fx.closed.length} closed chats = ${TOTAL} on the shelf; ?shelf=5: ${a.rows.length} rows, the 5 newest by time ${ids(a) === want_(5)}, "${a.count}", footer "${a.foot.text}" with "${a.foot.button}"; the asleep chat has no room (${inScene.rooms.length} rooms for ${live.length - asleep.length} awake chats), waiting chats stay in theirs; figures drawn in every row (${a.rows[0].figure.w}x${a.rows[0].figure.h} px); ` +
      `the zoom buttons ${col.below.toFixed(0)} px below the card in the same column, always in the corner (${openCorner.gapR}/${openCorner.gapB} px from the right/bottom edge, open and folded); "${a.foot.button}" → ${b.rows.length} rows, no footer; a row opens the card to its left (${rowCard.side}) for "${(rowCard.title || '').slice(0, 30)}" with the VS Code link of its id ${rowOk}; the wheel on the list scrolled it to ${scrolled.scroll.top.toFixed(0)} and left the map alone; folded: tab "${folded.tab}", buttons ${foldedGeo.gapR.toFixed(0)}/${foldedGeo.gapB.toFixed(0)} px from the corner, map unchanged by folding and unfolding; ${geoRows.join('; ')}; narrow windows: ${narrowRows.join('; ')}; the zoom buttons' gaps to the right/bottom edge (px) do not change when the shelf opens or folds: ${cornerRows.join('; ')}; console errors ${errorsOf(S.page)}`);
  } catch (e) { check('3d-shelf', false, `threw: ${(e && e.message) || e}`); } finally { await S.done(); }
}

// ---- 3d-motion: the rules of docs/motion.md hold on the card, the side card and the shelf of the 3D scene, through the same helpers as the pixel scene (21-motion in
// pixel-qa.mjs): the card comes out of its agent on the enter spring (a click has no momentum: no overshoot) with the base-ease fade, glides to another agent on the glide spring,
// leaves on the quicker leave spring and takes no clicks while it leaves; the details card and the shelf card use the same springs; the camera (pan and zoom) is exactly the same
// after every one of these; reduced motion leaves only a short fade
if (want('motion')) {
  const { DUR, EASE, SPRING, SLIDE, SCALE } = await import('../../public/js/motion.js');
  const S = await scenario3d(10, { tag: 'motion', query: '?shelf=200', fixture: { closed: 12 } });
  try {
    const T = tools(S);
    const bad = [];
    const eq = (what, got, want_) => { if (JSON.stringify(got) !== JSON.stringify(want_)) bad.push(`${what}: ${JSON.stringify(got)} instead of ${JSON.stringify(want_)}`); };
    const norm = s => String(s).replace(/\s+/g, '');
    const lin = str => { const m = /linear\(([^)]*)\)/.exec(str); return m ? m[1].split(',').map(x => parseFloat(x.trim())) : []; };
    const sameCurve = (got, spring) => { const a = lin(got), b = lin(spring.css); return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-3); };
    if (!S.ready) throw new Error('the scene did not become ready');
    await T.ev(`document.addEventListener('click', e => { if (e.target.closest && e.target.closest('.of-card a')) e.preventDefault(); }, true)`);
    const anims = sel => T.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return '[]'; return JSON.stringify(e.getAnimations().map(a => ({ name: a.animationName || 'waapi', duration: a.effect.getTiming().duration, easing: a.effect.getTiming().easing, kf: a.effect.getKeyframes().map(k => ({ opacity: k.opacity, translate: k.translate, scale: k.scale })) }))); })()`).then(JSON.parse);
    const style = (sel, props) => T.ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}), c = getComputedStyle(e); return JSON.stringify(Object.fromEntries(${JSON.stringify(props)}.map(p => [p, c[p]]))); })()`).then(JSON.parse);
    const atRest = o => (o.translate === 'none' || o.translate === '0px' || o.translate === '0px 0px') && (o.scale === 'none' || o.scale === '1');
    const vecOf = t => { const [x = 0, y = 0] = String(t || '0px 0px').split(' ').map(v => parseFloat(v) || 0); return [x, y]; };
    const moveOf = list => list.find(a => a.kf[0] && a.kf[0].translate !== undefined);
    const fadeOf = list => list.find(a => a.kf[0] && a.kf[0].opacity !== undefined && a.kf[0].translate === undefined);

    // 1. the tokens the 3D page uses are the ones of motion.js (the same app.css as the pixel scene)
    const names = ['enter', 'leave', 'glide', 'pop'];
    const tokens = await T.ev(`(() => { const c = getComputedStyle(document.documentElement); return JSON.stringify(Object.fromEntries(['--m-hover', '--m-fast', '--ease-out', '--ease-in', '--slide', '--scale-from', ...${JSON.stringify(names)}.flatMap(n => ['--spring-' + n, '--spring-' + n + '-ms'])].map(k => [k, c.getPropertyValue(k).trim()]))); })()`).then(JSON.parse);
    eq('token --m-hover', tokens['--m-hover'], DUR.hover + 'ms'); eq('token --m-fast', tokens['--m-fast'], DUR.fast + 'ms');
    eq('token --ease-out', norm(tokens['--ease-out']), norm(EASE.out)); eq('token --ease-in', norm(tokens['--ease-in']), norm(EASE.in));
    eq('token --slide', tokens['--slide'], SLIDE + 'px'); eq('token --scale-from', Number(tokens['--scale-from']), SCALE);
    for (const n of names) { eq(`token --spring-${n}-ms`, tokens[`--spring-${n}-ms`], SPRING[n].ms + 'ms'); if (!sameCurve(tokens['--spring-' + n], SPRING[n])) bad.push(`token --spring-${n} differs from motion.js`); }

    // two agents whose card can be opened without a label, the bar or a control over them (B is not under A's card, so a glide can start from a click on it)
    const spots = [];
    for (const a of S.roomed) { const o = await T.openAgent(a.id); if (o) spots.push({ agent: a, ...o }); if (spots.length >= 4) break; }
    await T.closeCard(); await T.settle();
    if (spots.length < 2) throw new Error('fewer than two agents can be clicked');
    const [A] = spots;
    const v0 = await T.view();

    // 2. a click on an agent: the card comes out of its agent: it fades in (base ease) while it travels and grows on the enter spring, which does not overshoot
    await S.page.mouse.click(A.x, A.y);
    await until(async () => (await T.card()).open, 2000, 40);
    const inA = await anims('.of-card'), inFade = fadeOf(inA), inMove = moveOf(inA);
    const side = await T.ev(`document.querySelector('.of-card').dataset.side`);
    let pts = [0];
    if (!inFade || !inMove) bad.push(`the card has no enter animation (${inA.length} animations)`);
    else {
      eq('card enter fade', [inFade.duration, norm(inFade.easing), Number(inFade.kf[0].opacity), Number(inFade.kf[1].opacity)], [DUR.fast, norm(EASE.out), 0, 1]);
      eq('card enter spring duration', inMove.duration, SPRING.enter.ms);
      if (!sameCurve(inMove.easing, SPRING.enter)) bad.push(`card enter easing is not the enter spring: ${inMove.easing.slice(0, 60)}`);
      const [dx, dy] = vecOf(inMove.kf[0].translate); pts = lin(inMove.easing);
      eq('card enter size', [Math.hypot(dx, dy), Number(inMove.kf[0].scale)], [SLIDE, SCALE]);
      eq('card enter ends in place', [vecOf(inMove.kf[1].translate), Number(inMove.kf[1].scale)], [[0, 0], 1]);
      if (!(pts[12] > 0.5 && Math.max(...pts) <= 1.0001)) bad.push(`the enter curve is not a spring without overshoot (a quarter through: ${pts[12]}, peak ${Math.max(...pts)})`);
      const comes = { right: dx < 0, left: dx > 0, below: dy < 0, above: dy > 0, dock: dy > 0 }[side];
      if (!comes) bad.push(`the card on the ${side} of its agent travels from (${dx}, ${dy}), not out of the agent`);
      const o = await T.ev(`(() => { const c = document.querySelector('.of-card'), s = getComputedStyle(c); return JSON.stringify({ tail: c.dataset.tail, w: c.offsetWidth, h: c.offsetHeight, origin: s.transformOrigin, at: parseFloat(s.getPropertyValue('--tail')) }); })()`).then(JSON.parse);
      const [ox, oy] = o.origin.split(' ').map(parseFloat), near = (u, w) => Math.abs(u - w) < 1.5;
      const originOk = { left: near(ox, 0) && near(oy, o.at), right: near(ox, o.w) && near(oy, o.at), top: near(oy, 0) && near(ox, o.at), bottom: near(oy, o.h) && near(ox, o.at) }[o.tail] ?? true;
      if (!originOk) bad.push(`the card does not grow out of its tail (${o.tail} at ${o.at}, origin ${o.origin})`);
    }
    await T.settle();
    eq('map after the card opened', await T.view(), v0);
    const rest = await style('.of-card', ['opacity', 'translate', 'scale']);
    eq('card at rest', [rest.opacity, atRest(rest)], ['1', true]);

    // 3. it glides to another agent on the glide spring (a transition on its position); the map still does not move
    const cardRect = await T.ev(`document.querySelector('.of-card').getBoundingClientRect().toJSON()`);
    const B = spots.find(q => q !== A && !(q.x > cardRect.left - 14 && q.x < cardRect.right + 14 && q.y > cardRect.top - 14 && q.y < cardRect.bottom + 14));
    if (!B) bad.push('every other agent is under the open card, so the glide could not be started');
    else {
      await S.page.mouse.click(B.x, B.y);
      await until(async () => (await T.card()).id === B.agent.id, 2000, 40);
      const gl = await style('.of-card', ['transitionDuration', 'transitionProperty', 'transitionTimingFunction']);
      eq('card glide', [await T.ev(`document.querySelector('.of-card').classList.contains('glide')`), gl.transitionDuration, gl.transitionProperty], [true, SPRING.glide.ms / 1000 + 's', 'transform']);
      if (!sameCurve(gl.transitionTimingFunction, SPRING.glide)) bad.push('the glide easing is not the glide spring');
      await T.settle(); await sleep(SPRING.glide.ms);
      eq('map after the card moved to another agent', await T.view(), v0);
    }

    // 4. the Open menu pops in on the pop spring; the cross: the card leaves (fade, then a quick spring back toward its agent, no bounce) and is hidden afterwards
    await T.ev(`document.querySelector('.of-card .oc-caret').click()`);
    const menu = await style('.of-card .oc-menu', ['animationName', 'animationDuration', 'animationTimingFunction']);
    eq('menu pop', [menu.animationName, menu.animationDuration], ['m-pop-move, m-pop-fade', `${SPRING.pop.ms / 1000}s, ${DUR.fast / 1000}s`]);
    if (!sameCurve(menu.animationTimingFunction, SPRING.pop)) bad.push('the menu does not move on the pop spring');
    await T.ev(`document.querySelector('.of-card .oc-x').click()`);
    const outA = await anims('.of-card'), outFade = fadeOf(outA), outMove = moveOf(outA);
    if (!outFade || !outMove) bad.push('the card has no leave animation');
    else {
      eq('card leave fade', [outFade.duration, norm(outFade.easing)], [DUR.fast, norm(EASE.in)]);
      eq('card leave spring duration', outMove.duration, SPRING.leave.ms);
      if (!sameCurve(outMove.easing, SPRING.leave)) bad.push('the card leaves on another curve than the leave spring');
      if (Math.max(...lin(outMove.easing)) > 1.0001) bad.push('the leave spring bounces');
    }
    eq('a leaving card takes no clicks (data-motion)', await T.ev(`document.querySelector('.of-card').dataset.motion`), 'out');
    await T.settle(); await sleep(250);
    eq('card hidden after it left', await T.ev(`document.querySelector('.of-card').hidden`), true);
    eq('map after the card closed', await T.view(), v0);

    // 5. the details card: closed, it waits 20 px to the right and a little smaller; "All details" brings it in on the enter spring, the cross sends it out on the leave spring
    const dClosed = await style('#drawer', ['translate', 'scale', 'visibility']);
    eq('details card closed', [dClosed.translate, Number(dClosed.scale), dClosed.visibility], [SLIDE + 'px', SCALE, 'hidden']);
    await S.page.mouse.click(A.x, A.y); await until(async () => (await T.card()).open, 2000, 40); await T.settle();
    await T.ev(`document.querySelector('.of-card .oc-more').click()`);
    await sleep(80);
    const dOpen = await style('#drawer', ['transitionProperty', 'transitionDuration', 'transitionTimingFunction']);
    eq('details card enter', dOpen.transitionDuration.split(',').map(x => x.trim()), [SPRING.enter.ms / 1000 + 's', SPRING.enter.ms / 1000 + 's', DUR.fast / 1000 + 's']);
    if (!sameCurve(dOpen.transitionTimingFunction, SPRING.enter)) bad.push('the details card does not arrive on the enter spring');
    await T.settle(); await sleep(SPRING.enter.ms);
    const dRest = await style('#drawer', ['translate', 'scale', 'opacity', 'visibility']);
    eq('details card at rest', [dRest.opacity, dRest.visibility, atRest(dRest)], ['1', 'visible', true]);
    eq('map after the details card opened', await T.view(), v0);
    await T.ev(`document.querySelector('#dw-close').click()`);
    const dLeave = await style('#drawer', ['transitionDuration', 'transitionTimingFunction']);
    eq('details card leave', dLeave.transitionDuration.split(',').slice(0, 2).map(x => x.trim()), [SPRING.leave.ms / 1000 + 's', SPRING.leave.ms / 1000 + 's']);
    if (!sameCurve(dLeave.transitionTimingFunction, SPRING.leave)) bad.push('the details card does not leave on the leave spring');
    await sleep(SPRING.leave.ms + 200);
    eq('details card hidden after it left', await style('#drawer', ['visibility']).then(x => x.visibility), 'hidden');
    eq('map after the details card closed', await T.view(), v0);

    // 6. the shelf card goes out to the right edge and comes back on the same springs; folding and unfolding never move the map
    await T.ev(`document.querySelector('.sh-hide').click()`);
    const shOut = await anims('.of-shelf');
    if (!fadeOf(shOut) || !moveOf(shOut)) bad.push('the shelf card has no leave animation');
    else eq('shelf leave', [fadeOf(shOut).duration, moveOf(shOut).duration, sameCurve(moveOf(shOut).easing, SPRING.leave)], [DUR.fast, SPRING.leave.ms, true]);
    await T.settle(); await sleep(250);
    eq('shelf card hidden after it left', await T.ev(`document.querySelector('.of-shelf').hidden`), true);
    eq('map after the shelf folded', await T.view(), v0);
    await T.ev(`document.querySelector('.of-shelf-tab').click()`);
    const shIn = await anims('.of-shelf');
    if (!fadeOf(shIn) || !moveOf(shIn)) bad.push('the shelf card has no enter animation');
    else eq('shelf enter', [fadeOf(shIn).duration, moveOf(shIn).duration, sameCurve(moveOf(shIn).easing, SPRING.enter), Number(moveOf(shIn).kf[0].scale)], [DUR.fast, SPRING.enter.ms, true, SCALE]);
    await T.settle();
    eq('map after the shelf unfolded', await T.view(), v0);

    // 7. a click on a shelf row opens the card on the same springs, and the map stays; the menu of the Open button too
    const row = (await T.shelf()).rows[0];
    await T.click(`.sh-list li[data-id="${row.id}"] .sh-item`);
    await until(async () => (await T.card()).open, 2000, 40);
    const rowIn = await anims('.of-card');
    if (!fadeOf(rowIn) || !moveOf(rowIn) || !sameCurve(moveOf(rowIn).easing, SPRING.enter)) bad.push('the card of a shelf row does not arrive on the enter spring');
    await T.settle();
    eq('map after a shelf row opened a card', await T.view(), v0);
    await T.ev(`document.querySelector('.of-card .oc-x').click()`); await T.settle(); await sleep(250);

    // 8. less motion on request: only a short fade, no travel, no spring, no menu pop
    await S.page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await sleep(200);
    await S.page.mouse.click(A.x, A.y);
    await until(async () => (await T.card()).open, 2000, 40);
    const inR = await anims('.of-card');
    if (!fadeOf(inR)) bad.push('reduced motion: the card has no fade'); else eq('reduced motion card', [fadeOf(inR).duration, moveOf(inR) === undefined], [DUR.hover, true]);
    await T.ev(`document.querySelector('.of-card .oc-caret').click()`);
    eq('reduced motion menu', (await style('.of-card .oc-menu', ['animationName'])).animationName, 'none');
    await T.ev(`document.querySelector('.of-card .oc-x').click()`);
    await S.page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

    check('3d-motion', bad.length === 0 && errorsOf(S.page) === 0,
      bad.length ? `FAILED: ${bad.join('; ')}` :
      `tokens equal motion.js (${names.map(n => `${n} ${SPRING[n].duration} s/bounce ${SPRING[n].bounce} = ${SPRING[n].ms} ms`).join(', ')}); the card comes out of its agent (${side} side) on the enter spring: ${inMove.duration} ms, travel ${SLIDE} px and growth from ${SCALE}, a quarter of the way through the curve it is at ${pts[12].toFixed(2)} and it peaks at ${Math.max(...pts).toFixed(3)}, fade ${inFade.duration} ms; it glides to another agent on the glide spring (${SPRING.glide.ms} ms); the menu pops on the pop spring; the card leaves on the leave spring (${outMove.duration} ms, no bounce) and takes no clicks while it leaves; the details card and the shelf card use the same springs, as does the card of a shelf row; the camera (zoom and the place of the world on the screen, ${v0}) was identical after every one of these; reduced motion: ${fadeOf(inR).duration} ms fade, no travel, no menu pop; console errors ${errorsOf(S.page)}`);
  } catch (e) { check('3d-motion', false, `threw: ${(e && e.message) || e}`); } finally { await S.done(); }
}

// ---- 3d-labels: every live agent and sub-agent has a label under it with what the pixel scene's label says (a main agent: project with the your-turn chip, chat name, what it does,
// what it just said; a sub-agent: its short description, and what it does while it works), in the same states; no label overlaps another, lies outside the view or sits under the
// card, the shelf card or the zoom buttons; the main agents keep their label at every zoom (there is no fallback sign any more)
if (want('labels')) {
  const S = await scenario3d(6, { tag: 'labels', query: '?shelf=10', fixture: { closed: 12 } });
  try {
    const T = tools(S);
    const bad = [], rows = [];
    if (!S.ready) throw new Error('the scene did not become ready');
    const clip = (str, n) => (String(str || '').length > n ? String(str).slice(0, n - 1) + '…' : String(str || ''));
    // what the page has now: the live agents with a character in the scene, from the server's own list (not from the code under test)
    const live = async () => {
      const all = await apiAgents(S.srv.port), mains = all.filter(a => a.kind === 'main' && a.status !== 'dormant');
      const subs = all.filter(a => a.kind === 'sub' && mains.some(m => m.id === a.parent));
      const withChar = [];
      for (const a of [...mains, ...subs]) if (await T.O(`o.charScreen(${JSON.stringify(a.id)})`)) withChar.push(a);
      return withChar;
    };
    const labelsNow = () => T.ev(`(() => JSON.stringify([...document.querySelectorAll('#view-ofis .of-l.of-tagl[data-id]')].map(el => {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el), px = el.querySelector('.px-l'), norm = e => e ? e.textContent.replace(/\\s+/g, ' ').trim() : '';
      return { id: el.dataset.id, shown: cs.visibility === 'visible', x: r.left, y: r.top, w: r.width, h: r.height, text: norm(el), cls: px ? px.className : '', proj: norm(el.querySelector('.px-proj')), name: norm(el.querySelector('.px-name')),
        chip: norm(el.querySelector('.of-chip.w')), doing: norm(el.querySelector('.px-doing')), say: norm(el.querySelector('.px-say')), since: !!el.querySelector('.of-chip.w [data-since]'), sw: !!el.querySelector('.sw') };
    })))()`).then(JSON.parse);
    const blockedNow = () => T.O('u.blocked()');
    const area = await T.rectOf('.of-area');
    const inView = l => l.x >= -0.5 && l.y >= -0.5 && l.x + l.w <= area.w + 0.5 && l.y + l.h <= area.h + 0.5;
    const stateChecks = (all, labs, where) => {          // the text and state of each label against the agent's own data
      for (const a of all) {
        const L = labs.find(l => l.id === a.id);
        if (!L) { bad.push(`${where}: ${a.kind} ${a.id} (${a.status}) has no label`); continue; }
        if (!L.shown) { bad.push(`${where}: the label of ${a.kind} ${a.id} (${a.status}) is not shown`); continue; }
        if (!L.cls.split(/\s+/).includes(a.status) || !L.cls.split(/\s+/).includes(a.kind === 'main' ? 'px-main' : 'px-sub')) bad.push(`${where}: ${a.kind} ${a.id} label classes "${L.cls}" for status ${a.status}`);
        if (!L.sw) bad.push(`${where}: ${a.id} has no colour swatch`);
        const doing = a.status === 'working' && a.doing ? `${a.doing.n} · ${clip(a.doing.l, 46)}` : '';
        if (a.kind === 'main') {
          const name = a.name || a.title || a.project;
          if (L.proj !== a.project) bad.push(`${where}: main ${a.id} project "${L.proj}" instead of "${a.project}"`);
          if (L.name !== name) bad.push(`${where}: main ${a.id} name "${L.name}" instead of "${name}"`);
          const wait = a.status === 'waiting' ? 'Your turn' : a.status === 'ask' ? 'Needs answer' : '';
          if (wait ? !(L.chip.startsWith(wait + ' · ') && L.since) : L.chip) bad.push(`${where}: main ${a.id} (${a.status}) chip "${L.chip}"`);
          if (L.doing !== doing) bad.push(`${where}: main ${a.id} doing "${L.doing}" instead of "${doing}"`);
          if (a.say ? !L.say.endsWith(clip(a.say.text, 56)) : L.say) bad.push(`${where}: main ${a.id} say "${L.say}"`);
        } else {
          const desc = String(a.desc || a.atype || 'Subagent').trim().replace(/\s+/g, ' ');
          const first = desc.split(' ')[0];
          if (!L.text.startsWith(first) || L.text.length > 18 + doing.length + 4) bad.push(`${where}: sub ${a.id} text "${L.text}" for description "${desc}"`);
          if (L.doing !== doing) bad.push(`${where}: sub ${a.id} (${a.status}) doing "${L.doing}" instead of "${doing}"`);
          if (L.chip || L.say) bad.push(`${where}: sub ${a.id} shows a chip or a say line`);
        }
      }
    };
    const layoutChecks = (labs, blocked, where) => {      // no label overlaps another, leaves the view or lies under what floats over the scene
      const shown = labs.filter(l => l.shown);
      for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) if (hit(shown[i], shown[j])) bad.push(`${where}: labels of ${shown[i].id} and ${shown[j].id} overlap`);
      for (const l of shown) {
        if (!inView(l)) bad.push(`${where}: the label of ${l.id} leaves the view (${l.x.toFixed(0)},${l.y.toFixed(0)} ${l.w.toFixed(0)}x${l.h.toFixed(0)} in ${area.w.toFixed(0)}x${area.h.toFixed(0)})`);
        const under = blocked.filter(b => hit(l, b));
        if (under.length) bad.push(`${where}: the label of ${l.id} lies under the card, the shelf or the buttons`);
      }
    };

    // 1. every live agent and sub-agent at "fit", card closed
    await until(async () => { const l = await labelsNow(); return l.length >= (await live()).length && l.every(x => x.shown); }, 6000, 300);
    const all = await live(), mains = all.filter(a => a.kind === 'main'), subs = all.filter(a => a.kind === 'sub');
    const subsWorking = subs.filter(a => a.status === 'working' && a.doing), subsDone = subs.filter(a => a.status !== 'working');
    if (mains.length < 4 || subsWorking.length < 2 || !mains.some(a => a.status === 'waiting' || a.status === 'ask') || !mains.some(a => a.status === 'working' && a.doing)) bad.push(`the fixture lacks the cases: ${mains.length} mains, ${subsWorking.length} working sub-agents`);
    let labs = await labelsNow();
    const chip0 = labs.find(l => l.chip && /\d+s$/.test(l.chip)) || null, waitingMain = chip0 ? { id: chip0.id } : null, t0 = Date.now();      // a chip in seconds, so that it can tick within the check
    stateChecks(all, labs, 'fit');
    layoutChecks(labs, await blockedNow(), 'fit');
    if (await T.ev(`[...document.querySelectorAll('#view-ofis .of-signl')].filter(e => getComputedStyle(e).visibility === 'visible').length`)) bad.push('the HTML sign for the far zoom is shown next to the label of its main agent');
    rows.push(`at fit: ${mains.length} main agents (${mains.filter(a => a.status === 'waiting' || a.status === 'ask').length} waiting for you) and ${subs.length} sub-agents (${subsWorking.length} working with a doing line, ${subsDone.length} not) all with a shown label of the right text and state; ${labs.filter(l => l.shown).length} labels shown, ${(await blockedNow()).length} blocked areas, none overlapping`);

    // 2. a card open beside an agent: no label under it, and the labels that are not near it stay
    const target = mains.find(a => a.status === 'working') || mains[0];
    const o = await T.openAgent(target.id);
    if (!o) bad.push('the card did not open on ' + target.id);
    await T.settle();
    await S.page.mouse.move(8, 880);
    await sleep(500);
    const c = await T.card();
    labs = await labelsNow();
    const blocked = await blockedNow();
    if (!c.open || !blocked.some(b => Math.abs(b.x - c.rect.x) < 2 && Math.abs(b.y - c.rect.y) < 2)) bad.push('the card is not among the blocked areas');
    layoutChecks(labs, blocked, 'card open');
    const shownCard = labs.filter(l => l.shown);
    for (const l of shownCard) if (c.open && hit(l, c.rect)) bad.push(`card open: the label of ${l.id} overlaps the card`);
    // a main agent's label is never hidden, whatever the card covers; a sub-agent's label may be (it lies under the card)
    for (const a of mains) if (!labs.find(l => l.id === a.id && l.shown)) bad.push(`card open: the label of main ${a.id} is hidden`);
    // the hidden ones are only those that would lie under the card: they come back when it closes
    await T.closeCard();
    await T.settle();
    await until(async () => (await labelsNow()).filter(l => l.shown).length === all.length, 4000, 200);
    labs = await labelsNow();
    if (labs.filter(l => l.shown).length !== all.length) bad.push(`after the card closed ${labs.filter(l => l.shown).length} of ${all.length} labels are shown`);
    rows.push(`with the card open on ${target.id.slice(0, 8)}: ${shownCard.length} of ${all.length} labels shown, none overlapping the card (${c.rect.w.toFixed(0)}x${c.rect.h.toFixed(0)}), the rest back after it closed`);

    // 3. zoomed out as far as it goes: every main agent keeps its label (the fallback sign is gone), none lies under the shelf card or the buttons
    const zoom0 = await T.O('o.zoom');
    for (let i = 0; i < 30 && !(await T.ev(`document.querySelector('.of-ctl [data-z="out"]').disabled`)); i++) { await T.click('.of-ctl [data-z="out"]'); await sleep(150); }
    await sleep(800);
    const zoomMin = await T.O('o.zoom');
    labs = await labelsNow();
    for (const a of mains) { const l = labs.find(x => x.id === a.id); if (!l || !l.shown) bad.push(`zoomed out (${zoomMin.toFixed(1)}): main ${a.id} has no shown label`); }
    const blockedFar = await blockedNow();
    for (const l of labs.filter(x => x.shown)) if (blockedFar.some(b => hit(l, b))) bad.push(`zoomed out: the label of ${l.id} lies under the shelf or the buttons`);
    rows.push(`zoomed out from ${zoom0.toFixed(1)} to ${zoomMin.toFixed(1)}: ${mains.filter(a => labs.find(x => x.id === a.id && x.shown)).length} of ${mains.length} main labels shown, ${labs.filter(l => l.shown && subs.some(a => a.id === l.id)).length} of ${subs.length} sub-agent labels`);

    // 4. a sub-agent's label sits near its agent: within the reach the scene allows
    await T.click('.of-ctl [data-z="fit"]');
    await sleep(900);
    labs = await labelsNow();
    let farthest = 0;
    for (const a of subs) {
      const l = labs.find(x => x.id === a.id), box = await T.O(`u.agentBox(${JSON.stringify(a.id)})`);
      if (!l || !l.shown || !box) continue;
      const dx = Math.max(0, Math.abs(l.x + l.w / 2 - box.cx) - (l.w + box.w) / 2), dy = Math.max(0, Math.abs(l.y + l.h / 2 - box.cy) - (l.h + box.h) / 2);
      farthest = Math.max(farthest, dx, dy);
      if (Math.max(dx, dy) > 80) bad.push(`sub ${a.id}: its label is ${Math.max(dx, dy).toFixed(0)} px from its agent`);
    }
    rows.push(`the farthest sub-agent label is ${farthest.toFixed(0)} px from its agent (limit 80)`);

    // the your-turn chip ticks: its time is not the one it had when the label was made
    if (!chip0) bad.push('no waiting chat with a chip in seconds to watch tick');
    else {
      if (Date.now() - t0 < 3000) await sleep(3000 - (Date.now() - t0));
      const later = (await labelsNow()).find(l => l.id === waitingMain.id);
      if (!later || later.chip === chip0.chip) bad.push(`the chip of ${waitingMain.id} still says "${chip0.chip}" ${((Date.now() - t0) / 1000).toFixed(1)} s later`);
      else rows.push(`the your-turn chip ticks ("${chip0.chip}" then "${later.chip}")`);
    }

    // 5. the state follows the agent: a working sub-agent that finishes shows its description in the finished state and no "what it does" line
    const fin = subsWorking[0];
    S.fx.finishSub(fin.id);
    const doneLabel = await until(async () => { const l = (await labelsNow()).find(x => x.id === fin.id); return l && l.shown && l.cls.split(/\s+/).includes('done') ? l : null; }, 10000, 300);
    if (!doneLabel) bad.push(`the label of the finished sub-agent ${fin.id} did not turn to the done state`);
    else if (doneLabel.doing) bad.push(`the finished sub-agent ${fin.id} still shows "${doneLabel.doing}"`);
    else rows.push(`a sub-agent that finished shows "${doneLabel.text}" in the done state without a doing line`);
    check('3d-labels', bad.length === 0 && errorsOf(S.page) === 0, bad.length ? `FAILED: ${bad.slice(0, 8).join('; ')}${bad.length > 8 ? `; and ${bad.length - 8} more` : ''}` : `${rows.join('; ')}; console errors ${errorsOf(S.page)}`);
  } catch (e) { check('3d-labels', false, `threw: ${(e && e.message) || e}`); } finally { await S.done(); }
}

// ---- --shots <dir>: pictures for a look by eye (the card beside an agent, the shelf and the buttons at 1024 and 1500 px, folded, narrow, the side card, the selection ring close up)
if (shotsDir) {
  mkdirSync(shotsDir, { recursive: true });
  const S = await scenario3d(10, { tag: 'shots', query: '?shelf=10', fixture: { closed: 12 } });
  try {
    const T = tools(S);
    const snap = async (file, clip) => { await sleep(500); await S.page.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip: { ...clip, scale: 1 } } : {}) }).then(r => import('node:fs').then(fs => fs.writeFileSync(join(shotsDir, file), Buffer.from(r.data, 'base64')))); console.log('SHOT', join(shotsDir, file)); };
    if (!S.ready) throw new Error('the scene did not become ready');
    await snap('3d-ui-1-fit-1500.png');
    // the labels close up: one step of the zoom button in, then back to "fit" (the pictures after it are taken at fit again)
    await T.click('.of-ctl [data-z="in"]'); await T.click('.of-ctl [data-z="in"]'); await sleep(900);
    await snap('3d-ui-12-labels-zoomed-in.png');
    await T.click('.of-ctl [data-z="fit"]'); await sleep(900);
    const waiting = S.roomed.find(a => a.status === 'waiting' || a.status === 'ask'), working = S.roomed.find(a => a.status === 'working');
    const o = await T.openAgent((working || S.roomed[0]).id);
    await T.settle(); await S.page.mouse.move(8, 880); await sleep(600);
    await snap('3d-ui-2-card-beside-agent.png');
    if (o) { const box = await T.O(`u.agentBox(${JSON.stringify((working || S.roomed[0]).id)})`); await snap('3d-ui-3-selection-ring-closeup.png', { x: Math.max(0, box.cx - 110), y: Math.max(0, box.cy - 90), width: 220, height: 200 }); }
    await T.ev(`document.querySelector('.of-card .oc-caret').click()`); await sleep(500);
    await snap('3d-ui-4-open-menu.png');
    await T.esc(); await T.esc(); await sleep(400);
    if (waiting) { await T.openAgent(waiting.id); await T.settle(); await S.page.mouse.move(8, 880); await sleep(500); await snap('3d-ui-5-waiting-agent-card.png'); }
    const row = (await T.shelf()).rows[1];
    await T.click(`.sh-list li[data-id="${row.id}"] .sh-item`); await T.settle(); await S.page.mouse.move(8, 880); await sleep(500);
    await snap('3d-ui-6-shelf-row-card.png');
    await T.ev(`document.querySelector('.of-card .oc-more').click()`); await sleep(900);
    await snap('3d-ui-7-all-details-side-card.png');
    await T.click('#dw-close'); await sleep(600);
    await T.click('.sh-hide'); await T.settle(); await sleep(500);
    await snap('3d-ui-8-shelf-folded-corner-buttons.png');
    await T.click('.of-shelf-tab'); await T.settle();
    await S.page.setViewport(1024, 900, 1); await sleep(1800);
    await snap('3d-ui-9-shelf-1024.png');
    await S.page.setViewport(700, 900, 1); await sleep(1800);
    await T.ev(`document.querySelector('#view-ofis').__ofisUi.setShelfFolded(true)`); await sleep(900);
    await snap('3d-ui-10-narrow-700-folded.png');
    await T.ev(`document.querySelector('#view-ofis').__ofisUi.setShelfFolded(false)`); await sleep(900);
    await snap('3d-ui-11-narrow-700-shelf.png');
    await S.page.setViewport(VIEW.w, VIEW.h, 1);
  } catch (e) { check('3d-shots', false, `threw: ${(e && e.message) || e}`); } finally { await S.done(); }
}

const failed = results.filter(r => !r.ok);
console.log(failed.length ? `QA FAIL (${failed.length} of ${results.length} checks failed: ${failed.map(f => f.name).join(', ')})` : `QA PASS (${results.length} checks)`);
process.exit(failed.length ? 1 : 0);
