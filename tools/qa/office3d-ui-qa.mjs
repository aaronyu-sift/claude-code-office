// QA of the floating interface of the three.js Office scene (?scene=3d): the card beside a clicked agent, the shelf card with the zoom buttons under it, the springs and fades of
// docs/motion.md, and the glass bar over a scene that spans the whole view. The same interface as the pixel scene has (pixel-qa.mjs checks 15, 16, 20 and 21), measured on the real
// page in headless Chrome with software WebGL (cdp.mjs: a throw-away profile, never the user's Chrome). Prints one `CHECK <name> PASS|FAIL <detail>` line per check and a final
// `QA PASS` or `QA FAIL`.
//   node tools/qa/office3d-ui-qa.mjs [--only card|shelf|motion|bar] [--shots <dir>]
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
  // Click an agent: some point of its figure that no label, bar or card covers. Returns the point, or null. A click on its floor or label opens it too.
  async function openAgent(id, notThese = []) {
    const box = await O(`u.agentBox(${JSON.stringify(id)})`);
    if (!box) return null;
    for (const [dx, dy] of [[0, -0.18], [0, -0.3], [0, 0], [0.18, -0.1], [-0.18, -0.1], [0, 0.18]]) {
      const x = box.cx + dx * box.w, y = box.cy + dy * box.h;
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
        figs: [...document.querySelectorAll('.of-hud')].length });
    })()`).then(JSON.parse);
    for (const w of [360, 700, 1024, 1500, 2560]) {
      await S.page.setViewport(w, 900, 1);
      await sleep(1200);
      const g = await geo(), L = `${w}px`;
      eq(L + ' bar position', g.pos, 'absolute');
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
  } finally { await S.done(); }
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
    const labelOf = await T.ev(`(() => { const l = [...document.querySelectorAll('.of-l.of-tagl[data-id]')].filter(e => e.style.visibility === 'visible' && e.dataset.id === ${JSON.stringify(B.agent.id)})[0]; if (!l) return null; const r = l.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    let labelOk = true;
    if (labelOf) {
      await T.closeCard();
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

    check('3d-card', bad.length === 0 && errorsOf(S.page) === 0,
      `${bad.length ? 'FAILED: ' + bad.slice(0, 6).join('; ') + '; ' : ''}click on "${A.agent.name.slice(0, 30)}": card on the ${c1s.side} of the agent for the right id, ${a1.gap.toFixed(0)} px from its box, not covering it, inside the window, anchored to the projected figure ${anchored}, glass ${look.bg} ${look.blur} ${look.radius}, no scrim and no drawer; ` +
      `the open agent is marked in the scene (ring at ${sel1 ? sel1.at.map(v => v.toFixed(0)) : '-'}) and unmarked after closing; the map did not move; ` +
      `drag: the agent moved ${moved.toFixed(0)} px and the card ${followed ? 'went with it' : 'DID NOT follow'}; zoom ${z0.toFixed(1)} → ${zoomed ? zoomed.z.toFixed(1) : '?'}: ${zoomed ? `gap ${zoomed.x.gap.toFixed(0)} px, not covering` : 'NOT beside the agent'}; out of the view the card waits (${gone.away}) and returns after fit (${!!back}); ` +
      `another agent moves it ${!!bOpen && !!aOpen}, a label opens its agent ${labelOk}; Esc closes the menu then the card, the cross ${!!afterX}, a click on the empty scene ${!!afterEmpty}; "All details" opens the glass side card (${dcard.w.toFixed(0)} px) ${detailsOk}; the old drawer was never opened by a click on an agent ${!drawerEver}; console errors ${errorsOf(S.page)}`);
  } finally { await S.done(); }
}

const failed = results.filter(r => !r.ok);
console.log(failed.length ? `QA FAIL (${failed.length} of ${results.length} checks failed: ${failed.map(f => f.name).join(', ')})` : `QA PASS (${results.length} checks)`);
process.exit(failed.length ? 1 : 0);
