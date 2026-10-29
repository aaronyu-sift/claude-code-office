// QA of the task progress of a chat (docs/progress.md): the data from the tracker's snapshot file to the page, the bar element and the card. Same
// harness as pixel-qa.mjs (a fake ~/.claude, the server, headless Chrome in a throw-away profile) and the same output: one `CHECK <name> PASS|FAIL <detail>`
// line per check and a final `QA PASS` or `QA FAIL`.
//   node tools/qa/office-progress-qa.mjs [--only progress-path|progress-data|progress-bar|progress-card]
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeFixture } from './fixture.mjs';
import { startServer, scenario, apiAgents, sleep } from './harness.mjs';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined;
const want = name => !only || only === name;
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok });
  console.log(`CHECK ${name} ${ok ? 'PASS' : 'FAIL'} ${detail}`);
}
const until = async (fn, ms = 8000, step = 200) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return { v, ms: Date.now() - t0 }; if (Date.now() - t0 > ms) return { v: null, ms: Date.now() - t0 }; await sleep(step); } };

const iso = ms => new Date(ms).toISOString();
// a chat's entry of the snapshot: 7 of 12 done, 2 being worked on (the first for 14 minutes), 1 blocked, 2 not started
function entry(extra = {}, T = Date.now()) {
  const items = [];
  for (let i = 1; i <= 7; i++) items.push({ id: 'S' + i, title: 'Finished step ' + i, status: 'done', prio: 'med', complexity: 'S', doingSince: null, doneAt: iso(T - (8 - i) * 600e3) });
  items.push({ id: 'S8', title: 'Wire the bar into the card', status: 'doing', prio: 'high', complexity: 'M', doingSince: iso(T - 14 * 60e3), doneAt: null });
  items.push({ id: 'S9', title: 'Write the docs', status: 'doing', prio: 'med', complexity: 'S', doingSince: iso(T - 3 * 60e3), doneAt: null });
  items.push({ id: 'S10', title: 'Wait for the layout agent', status: 'blocked', prio: 'med', complexity: 'S', doingSince: null, doneAt: null });
  items.push({ id: 'S12', title: 'Polish later', status: 'todo', prio: 'low', complexity: 'S', doingSince: null, doneAt: null });
  items.push({ id: 'S11', title: 'Check it in Chrome', status: 'todo', prio: 'high', complexity: 'S', doingSince: null, doneAt: null });
  return { topic: 'Claude Code Office (pixel scene)', updatedAt: iso(T), total: 12, done: 7, doing: 2, blocked: 1, items, ...extra };
}
const brief = p => (p ? `${p.done}/${p.doing}/${p.blocked} of ${p.total}, ${p.items.length} items` : String(p));

// ---------------------------------------------------------------- progress-path: where the server looks for the file (no browser)
if (want('progress-path')) {
  const base = mkdtempSync(join(tmpdir(), 'cco-progress-path-'));
  const fx = await makeFixture({ dir: join(base, 'claude'), n: 2 });
  const sid = fx.agents[0].id;
  const elsewhere = join(base, 'elsewhere.json'), viaFlag = join(base, 'flag.json');
  const snap = (topic, done) => JSON.stringify({ version: 1, chats: { [sid]: entry({ topic, done }) } });
  const asked = async (env, argv) => {
    const srv = await startServer(fx.dir, env, argv);
    try {
      await sleep(300);
      const api = await (await fetch(`http://127.0.0.1:${srv.port}/api/progress`)).json();
      const agents = await apiAgents(srv.port);
      return { topic: api.chats[sid] && api.chats[sid].topic, count: Object.keys(api.chats).length, onAgent: (agents.find(a => a.id === sid) || {}).progress };
    } finally { srv.stop(); }
  };
  try {
    writeFileSync(fx.progressFile, snap('from the default place', 1));
    writeFileSync(elsewhere, snap('from the environment', 2));
    writeFileSync(viaFlag, snap('from the flag', 3));
    const def = await asked({}, []);
    const env = await asked({ OFFICE_PROGRESS_FILE: elsewhere }, []);
    const flag = await asked({ OFFICE_PROGRESS_FILE: elsewhere }, ['--progress-file', viaFlag]);
    rmSync(fx.progressFile);
    const none = await asked({}, []);
    check('progress-path', def.topic === 'from the default place' && def.onAgent && def.onAgent.done === 1 && env.topic === 'from the environment' && env.onAgent.done === 2
      && flag.topic === 'from the flag' && flag.onAgent.done === 3 && none.count === 0 && none.onAgent === null,
      `default file in the claude dir: "${def.topic}"; OFFICE_PROGRESS_FILE: "${env.topic}"; --progress-file over the variable: "${flag.topic}"; no file: ${none.count} entries and progress ${none.onAgent}`);
  } finally { fx.cleanup(); rmSync(base, { recursive: true, force: true }); }
}

// ---------------------------------------------------------------- progress-data, progress-bar and progress-card share one scenario
if (['progress-data', 'progress-bar', 'progress-card'].some(want)) {
  // 0 and 1 are asleep (they are on the shelf, so a card can be opened from a row), 2 waits, 3 works and has a subagent
  const S = await scenario(6, { tag: '-progress', fixture: { statuses: ['dormant', 'dormant', 'waiting', 'working', 'waiting', 'working'] } });
  try {
    if (!S.ready) throw new Error('scene did not become ready');
    const mains = S.fx.agents, [A, D, C, B] = mains;
    const sub = B.subs[0];
    if (!sub) throw new Error('the fixture has no subagent to test');
    const ev = expr => S.page.evaluate(expr);
    // what the page's own store holds for these agents: the progress object, null, or 'absent' when the agent is not there
    const stored = ids => ev(`import('/js/main.js').then(m => JSON.stringify(${JSON.stringify(ids)}.map(id => { const a = m.store.agents.get(id); return a ? (a.progress === undefined ? 'undefined' : a.progress) : 'absent'; })))`).then(JSON.parse);

    if (want('progress-data')) {
      const before = await stored([A.id, B.id, C.id, D.id, sub.id]);
      const figuresBefore = await ev(`document.querySelector('#view-ofis').__pixel.figures().length`);
      // the snapshot has entries for two chats, one for a chat that is not open, and one keyed like a subagent
      const T = Date.now();
      S.fx.writeProgress({ [A.id]: entry({}, T), [B.id]: entry({ topic: 'Second chat', done: 2, doing: 1, blocked: 0, total: 5 }, T), 'no-such-chat': entry({}, T), [sub.id]: entry({}, T) });
      const got = await until(async () => { const r = await stored([A.id, B.id]); return r[0] && r[0] !== 'undefined' && r[1] && r[1] !== 'undefined' ? r : null; });
      const after = await stored([A.id, B.id, C.id, D.id, sub.id, 'no-such-chat']);
      const api = await (await fetch(`http://127.0.0.1:${S.srv.port}/api/progress`)).json();
      const wire = (await apiAgents(S.srv.port)).filter(a => a.progress).map(a => a.id);
      const sane = got.v && got.v[0].total === 12 && got.v[0].done === 7 && got.v[0].doing === 2 && got.v[0].blocked === 1 && got.v[0].items.length === 12 && got.v[0].topic === 'Claude Code Office (pixel scene)'
        && got.v[1].total === 5 && got.v[1].done === 2 && got.v[1].topic === 'Second chat';
      const shown = after[2] === null && after[3] === null && after[4] === null && after[5] === 'absent' && wire.length === 2 && wire.includes(A.id) && wire.includes(B.id) && Object.keys(api.chats).length === 4;
      // the snapshot changes: the page has the new numbers within the poll interval
      S.fx.writeProgress({ [A.id]: entry({ done: 8, doing: 1 }, T), [B.id]: entry({ topic: 'Second chat', done: 2, doing: 1, blocked: 0, total: 5 }, T) });
      const upd = await until(async () => { const r = await stored([A.id]); return r[0] && r[0].done === 8 && r[0].doing === 1 ? r[0] : null; });
      // a file that is not JSON, then a good one again: no progress meanwhile, the page keeps working
      S.fx.writeProgress('{"version":1,"chats":{"' + A.id + '":{"total":3,');
      const broken = await until(async () => { const r = await stored([A.id, B.id]); return r[0] === null && r[1] === null ? r : null; });
      const alive = await ev(`document.querySelector('#view-ofis').__pixel.figures().length`);
      const stateOk = (await apiAgents(S.srv.port)).length === S.agents.length;
      S.fx.writeProgress({ [A.id]: entry({ done: 9, doing: 0 }, T) });
      const back = await until(async () => { const r = await stored([A.id, B.id]); return r[0] && r[0].done === 9 && r[1] === null ? r : null; });
      check('progress-data', !!sane && shown && !!upd.v && !!broken.v && alive === figuresBefore && stateOk && !!back.v && S.page.errors.length === 0,
        `before the file: ${before.map(x => (x === null ? 'null' : x)).join('/')}; entries for 2 chats arrived in ${got.ms} ms (${got.v ? got.v.map(brief).join(' | ') : 'none'}); chats without an entry (waiting, asleep, a subagent keyed like one) have null, an unknown chat adds no agent, ${wire.length} agents carry progress on /api/state, ${Object.keys(api.chats).length} entries on /api/progress; `
        + `an updated file reached the page in ${upd.ms} ms${upd.v ? '' : ' (NOT within 8 s)'}; a broken file took progress away in ${broken.ms} ms${broken.v ? '' : ' (NOT)'} and left ${alive}/${figuresBefore} figures and ${S.page.errors.length} console errors; a good file again in ${back.ms} ms${back.v ? '' : ' (NOT)'}`);
    }

    if (want('progress-bar')) {
      const T = Date.now();
      const hostile = '<img src=x onerror="window.__pwn=1">';
      const report = await ev(`import('/js/progress-bar.js').then(async mod => {
        const P = ${JSON.stringify(entry({}, T))}, now = ${T};
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:20px;top:20px;width:300px;background:rgb(12,16,36);z-index:99999';
        document.body.append(host);
        const bar = mod.progressBarEl(P, { now });
        host.append(bar);
        const track = bar.querySelector('.cco-prog-track'), segs = [...track.querySelectorAll('.cco-prog-seg')];
        const tr = track.getBoundingClientRect(), cs = e => getComputedStyle(e);
        const out = {
          root: bar.className, role: track.getAttribute('role'), min: track.getAttribute('aria-valuemin'), max: track.getAttribute('aria-valuemax'), now: track.getAttribute('aria-valuenow'),
          valuetext: track.getAttribute('aria-valuetext'), label: track.getAttribute('aria-label'),
          kinds: segs.map(s => s.className.replace('cco-prog-seg ', '')), styleWidths: segs.map(s => s.style.width), widths: segs.map(s => s.getBoundingClientRect().width), trackW: tr.width, gap: parseFloat(cs(track).columnGap),
          text: (bar.querySelector('.cco-prog-text') || {}).textContent, textHidden: (bar.querySelector('.cco-prog-text') || { getAttribute: () => null }).getAttribute('aria-hidden'),
          nowRow: (bar.querySelector('.cco-prog-now') || {}).textContent, nowKind: (bar.querySelector('.cco-prog-now') || { dataset: {} }).dataset.kind, since: (bar.querySelector('.cco-prog-now .el') || { dataset: {} }).dataset.since,
          colours: segs.map(s => cs(s).backgroundColor), sizes: [...bar.querySelectorAll('.cco-prog-text, .k, .id, .t, .el')].map(e => parseFloat(cs(e).fontSize)),
          fonts: Object.fromEntries(['.cco-prog-text', '.k', '.id', '.t', '.el'].map(q => [q, cs(bar.querySelector(q) || bar).color])),
          height: tr.height, overflowX: bar.scrollWidth > bar.clientWidth,
        };
        // the text-less form (a small label) keeps the bar and its accessible text
        const small = mod.progressBarEl(P, { now, text: false });
        out.small = { rows: small.querySelectorAll('.cco-prog-text, .cco-prog-now').length, role: small.querySelector('[role=progressbar]').getAttribute('aria-valuetext') };
        // no list, no bar
        out.none = [null, undefined, {}, { total: 0 }, 'x'].map(x => mod.progressBarEl(x)).every(x => x === null);
        // the next item (nothing being worked on) names the open item with the highest priority and shows no running time
        const nx = mod.progressBarEl({ ...P, doing: 0, items: P.items.map(i => (i.status === 'doing' ? { ...i, status: 'done' } : i)) }, { now });
        out.next = { text: nx.querySelector('.cco-prog-now').textContent, kind: nx.querySelector('.cco-prog-now').dataset.kind, clock: !!nx.querySelector('.cco-prog-now .el') };
        // a narrow place and the longest strings the server lets through
        const long = mod.progressBarEl({ ...P, topic: 'T'.repeat(120), items: [{ id: 'S'.repeat(24), title: 'long '.repeat(28).trim(), status: 'doing', prio: 'high', doingSince: now - 90e3 }] }, { now });
        const narrow = document.createElement('div'); narrow.style.cssText = 'position:fixed;left:20px;top:200px;width:200px;z-index:99999'; narrow.append(long); document.body.append(narrow);
        out.longOverflow = long.scrollWidth > long.clientWidth + 1;
        // strings are text, whichever way the bar is put in: as an element, and as markup through outerHTML (how the card does it)
        const evil = mod.progressBarEl({ ...P, topic: ${JSON.stringify(hostile)}, items: [{ id: ${JSON.stringify(hostile)}, title: ${JSON.stringify(hostile)}, status: 'doing', doingSince: now }] }, { now });
        const a = document.createElement('div'); a.append(evil);
        const b = document.createElement('div'); b.innerHTML = evil.outerHTML;
        document.body.append(a, b);
        await new Promise(r => setTimeout(r, 300));
        out.evil = { imgsElement: a.querySelectorAll('img').length, imgsMarkup: b.querySelectorAll('img').length, pwn: window.__pwn === undefined, shown: a.querySelector('.cco-prog-now .t').textContent === ${JSON.stringify(hostile)}, aria: evil.querySelector('[role=progressbar]').getAttribute('aria-label') };
        host.remove(); narrow.remove(); a.remove(); b.remove();
        return JSON.stringify(out);
      })`).then(JSON.parse);
      const near = (x, y, tol) => Math.abs(x - y) <= tol;
      const exact = [7 / 12, 2 / 12, 1 / 12, 2 / 12];
      const usable = report.trackW - report.gap * (report.widths.length - 1);
      const lum = c => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const contrast = c => { const l = lum(c), d = lum('rgb(12,16,36)'); return (Math.max(l, d) + 0.05) / (Math.min(l, d) + 0.05); };
      const minContrast = Math.min(...Object.values(report.fonts).map(contrast));
      const ok = report.role === 'progressbar' && report.min === '0' && report.max === '12' && report.now === '7' && report.valuetext === '7 of 12 done · 2 doing · 1 blocked' && report.label === 'Progress: Claude Code Office (pixel scene)'
        && report.kinds.join() === 'done,doing,blocked,rest' && report.styleWidths.join() === '58.33%,16.67%,8.33%,16.67%'
        && report.widths.every((w, i) => near(w, exact[i] * usable, 1.5)) && near(report.widths.reduce((s, w) => s + w, 0) + report.gap * 3, report.trackW, 1.5)
        && report.text === '7 of 12 done · 2 doing · 1 blocked' && report.textHidden === 'true'
        && report.nowKind === 'doing' && /Now\s*S8\s*Wire the bar into the card\s*14m/.test(report.nowRow) && report.since === String(T - 14 * 60e3)
        && report.colours[0] === 'rgb(34, 197, 94)' && report.colours[1] === 'rgb(143, 176, 255)' && report.colours[2] === 'rgb(250, 178, 25)' && report.colours[3] === 'rgba(0, 0, 0, 0)'
        && report.sizes.length === 5 && report.sizes.every(s => s >= 12) && minContrast >= 4.5 && report.height >= 6
        && report.small.rows === 0 && report.small.role === report.valuetext && report.none
        && report.next.kind === 'next' && /Next\s*S11\s*Check it in Chrome/.test(report.next.text) && !report.next.clock
        && !report.overflowX && !report.longOverflow
        && report.evil.imgsElement === 0 && report.evil.imgsMarkup === 0 && report.evil.pwn && report.evil.shown && report.evil.aria.includes('<img');
      check('progress-bar', ok,
        `segments ${report.kinds.join('/')} with widths ${report.styleWidths.join(' ')} (drawn ${report.widths.map(w => w.toFixed(1)).join('/')} px of ${usable.toFixed(0)} usable, ${report.trackW.toFixed(0)} px track, bar ${report.height} px high); role ${report.role} ${report.now}/${report.max}, text "${report.valuetext}" (visible line aria-hidden ${report.textHidden}); `
        + `current item "${(report.nowRow || '').trim()}" with since ${report.since === String(T - 14 * 60e3) ? 'right' : 'WRONG'}; next item "${report.next.text}"; colours ${report.colours.join(' ')}; text sizes ${report.sizes.join('/')} px, lowest contrast ${minContrast.toFixed(1)}:1; text-less form rows ${report.small.rows}; no list gives no bar ${report.none}; `
        + `overflow at 200 px with the longest strings ${report.longOverflow}; markup in strings: ${report.evil.imgsElement}+${report.evil.imgsMarkup} img elements, script ran ${!report.evil.pwn}, shown as text ${report.evil.shown}`);
    }

    if (want('progress-card')) {
      // the card of a chat with an entry shows the bar under its name; the card of one without shows none; it updates while open
      const T = Date.now();
      S.fx.writeProgress({ [A.id]: entry({}, T) });
      await until(async () => { const [p] = await stored([A.id]); return p && p.done === 7; });          // the page has this file, not the one the check before left
      const rowCentre = id => ev(`(() => { const li = document.querySelector('.sh-list li[data-id="${id}"]'); if (!li) return null; li.scrollIntoView({ block: 'nearest' }); const b = li.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
      const cardState = () => ev(`(() => { const c = document.querySelector('.of-card:not([hidden])'); if (!c) return null; const bar = c.querySelector('.cco-prog'); const world = c.querySelector('.oc-world');
        return { id: c.dataset.id, has: !!bar, text: bar && bar.querySelector('.cco-prog-text').textContent, valuenow: bar && bar.querySelector('[role=progressbar]').getAttribute('aria-valuenow'), afterWorld: !!bar && world.nextElementSibling === bar, clock: bar && (bar.querySelector('.cco-prog-now .el') || {}).textContent };
      })()`);
      const closeCard = async () => { await ev(`(document.querySelector('.of-card:not([hidden]) .oc-x') || { click() {} }).click()`); await sleep(200); };
      const ra = await rowCentre(A.id);
      await S.page.mouse.click(ra.x, ra.y);
      const open = await until(async () => { const c = await cardState(); return c && c.id === A.id ? c : null; });
      await sleep(300);
      const withBar = await cardState();
      // the numbers change while the card is open
      S.fx.writeProgress({ [A.id]: entry({ done: 9, doing: 1, blocked: 0 }, T) });
      const upd = await until(async () => { const c = await cardState(); return c && c.valuenow === '9' ? c : null; });
      await closeCard();
      const rd = await rowCentre(D.id);
      await S.page.mouse.click(rd.x, rd.y);
      const none = await until(async () => { const c = await cardState(); return c && c.id === D.id ? c : null; });
      await closeCard();
      check('progress-card', !!open.v && withBar.has && withBar.afterWorld && withBar.text === '7 of 12 done · 2 doing · 1 blocked' && /^\d+m$/.test(withBar.clock) && !!upd.v && upd.v.text === '9 of 12 done · 1 doing'
        && !!none.v && none.v.has === false && S.page.errors.length === 0,
        `card of the chat with an entry: bar ${withBar.has} right after the chat name ${withBar.afterWorld}, "${withBar.text}", running ${withBar.clock}; after the file changed with the card open: "${upd.v ? upd.v.text : 'no update'}" in ${upd.ms} ms; card of a chat without an entry: bar ${none.v ? none.v.has : 'no card'}; console errors ${S.page.errors.length}`);
    }
  } finally { await S.done(); }
}

const failed = results.filter(r => !r.ok);
console.log(failed.length ? `QA FAIL (${failed.length} of ${results.length} checks failed: ${failed.map(f => f.name).join(', ')})` : `QA PASS (${results.length} checks)`);
process.exit(failed.length ? 1 : 0);
