// QA of the walkers: nothing in the 3D scene appears or disappears inside a room (public/js/ofis.js, public/js/ofis-arrive.js). Headless Chrome with software WebGL in a throw-away
// profile (harness3d.mjs), the server against a fake ~/.claude, one `CHECK <name> PASS|FAIL <detail>` line per check and a final `QA PASS` or `QA FAIL`.
//   node tools/qa/office3d-walk-qa.mjs [--only load|calm|brief|leave|flap|rebuild|hidden|follow|settle|reduced] [--mutations [--mutation <words>|<more words>]] [--verify-mutations]
//
// How it sees: the scene's recorder (s.rec, started the moment the scene exists: harness3d.mjs recordFromStart) has the creation, every frame and the removal of every figure, with the
// frame's step. A check that changes the data itself does it in the page, on the store (a copy of a chat, a sub-agent, a status), and asks the scene to update (s.sync()), so that the
// moment of every change is the check's, not the server's one-second tick; three checks use the real server and the fake ~/.claude files (a closed chat, a finished sub-agent, the load).
//
//   3d-walk-load     the page opens with 10 chats: every figure's first position is at the entrance (within 1 unit of the hall's lane end) and never inside a room, a figure that waits for its
//                    turn is not drawn, they leave the entrance one after the other (0.2 to 0.4 s apart, all within 4 s), everybody is in their seat within about 10 s of the scene's own time
//                    (a queue of more than four is hurried), the doors open for the chief and everybody else, no figure ever moves more than speed x pace x step x 1.5 (no teleport), the camera
//                    does not move, nobody is in the scene twice, the labels and chairs match the figures, and the bounce of the step is there
//   3d-walk-calm     ?arrive=calm: the same page load at the normal pace for everybody
//   3d-walk-brief    a sub-agent whose job ends 0.7 s after it came, a burst of five that end before most of them have left the entrance, a chat that ends 0.5 s and one that ends 2 s after it came,
//                    and one that comes and ends within one sync: each turns around where it stands, walks back out and is removed at the entrance, never seen at its seat, no desk stays taken
//   3d-walk-leave    a chat that closes (the real server) while its chief and two sub-agents sit: they stand up (and stand still while they do), walk the way they came, the door of the office
//                    that is vacant now opens for them, they are removed at the entrance, and a sub-agent that finishes leaves too, after its 4.5 s
//   3d-walk-flap     appears, ends, appears again: a chat and a sub-agent come back while they walk out, one figure each, seated at the end, no stuck desk, no ghost label or chair
//   3d-walk-rebuild  the 20th chat adds a bay and moves the entrance while 30 people are walking in: nobody jumps, nobody is dropped, everybody is seated at the end
//   3d-walk-hidden   the Office view is left while people walk, a chat ends and another comes meanwhile; back in the view nobody jumps and the ended chat walks out instead of vanishing
//   3d-walk-follow   the label, the balloon, the hover tooltip and the click card follow a walking figure, and the camera stays where it is
//   3d-walk-settle   s.settle() ends every walk at once (QA hook), and nothing in the app calls it
//   3d-walk-reduced  with prefers-reduced-motion the figures walk at the same pace and do not bounce
//
// --mutations breaks the code in a copy of the repo, one line at a time, and runs the check that guards that line: every one must FAIL there. Timing is the one thing a busy machine can
// bend (every time here is the scene's own clock, the sum of its steps, so a slow frame rate does not matter, but a check that fails by a small margin is worth running again on its own).
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scenario3d, o3, sleep, ROOT, recordFromStart } from './harness3d.mjs';

const args = process.argv.slice(2);
const val = f => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : undefined; };
const only = val('only');

const WALK_SPEED = 2.2, SLACK = 1.5;                       // units per second (WALK in ofis-arrive.js) and the slack the no-teleport check allows
const LOAD_S = 10, LOAD_SLACK_S = 1.2;                     // everybody seated within about this many seconds of the scene's own time
const OPTIONAL = /\/local\/ofis-extras\.js/;
const errorsOf = page => page.errors.filter(e => !OPTIONAL.test(e));
const make = (name, ok, detail) => ({ name, ok, detail });
const f1 = n => (+n).toFixed(1);
const short = id => String(id).slice(-9);
const notes = {};

// ---- what runs in the page
// q.chat(id) is a copy of the first working chat in a folder of its own, q.sub(chat, id, status) a copy of the first sub-agent, q.remove(id) takes either out (a chat with its sub-agents)
const HELPERS = `(async () => {
  const { store } = await import('/js/main.js');
  const v = document.querySelector('#view-ofis');
  const clone = o => JSON.parse(JSON.stringify(o));
  let seq = 0;
  window.__qa = {
    chat(id, status = 'working') {
      const base = [...store.agents.values()].find(a => a.kind === 'main' && a.status === 'working');
      const a = Object.assign(clone(base), { id, name: id, project: id, title: id, subs: [], started: Date.now() + (++seq), status, since: Date.now(), pid: 0 });
      store.agents.set(id, a);
    },
    sub(chatId, id, status = 'working') {
      const base = [...store.agents.values()].find(a => a.kind === 'sub');
      const a = Object.assign(clone(base), { id, parent: chatId, status, started: Date.now() + (++seq), since: Date.now(), desc: id });
      store.agents.set(id, a);
      store.agents.get(chatId).subs.push(id);
    },
    status(id, status) { store.agents.get(id).status = status; },
    remove(id) {
      const a = store.agents.get(id);
      if (!a) return;
      if (a.kind === 'sub') { const p = store.agents.get(a.parent); if (p) p.subs = p.subs.filter(s => s !== id); } else for (const s of a.subs) store.agents.delete(s);
      store.agents.delete(id);
    },
    sync() { v.__ofis.sync(); },
  };
  return true;
})()`;

const ev = (page, expr) => page.evaluate(o3(expr));
const until = async (fn, ms = 60000, step = 150) => { const t0 = Date.now(); for (;;) { const r = await fn(); if (r) return r; if (Date.now() - t0 > ms) return null; await sleep(step); } };
const idle = (page, ms = 120000) => until(async () => (await ev(page, 's.walking.length')) === 0, ms, 250);
const gone = (page, id, ms = 120000) => until(async () => !(await ev(page, `o.figures().some(f => f.id === ${JSON.stringify(id)})`)), ms, 200);
const qa = (page, code) => page.evaluate(`(() => { const q = window.__qa; ${code} })()`);

// ---- what is read from the recorder: events { k: 'create' | 'frame' | 'remove', id, main, dt, x, z, mode, after, vis, sit, pace, delay, hy, stand, turn }
const byId = list => { const m = new Map(); for (const e of list) { if (!m.has(e.id)) m.set(e.id, []); m.get(e.id).push(e); } return m; };
const near = (off, x, z, tol = 1.0) => off.halls.some(h => Math.hypot(x - off.entryX, z - h.lane) <= tol);
const inRoom = (off, x, z) => off.slots.some(r => x > r.X + 0.1 && x < r.X + r.W - 0.1 && z > r.Z + 0.1 && z < r.Z + r.D - 0.1);
const nearAny = (offs, x, z, tol) => offs.some(o => near(o, x, z, tol));
const sim = (list, upTo = list.length) => { let s = 0; for (let i = 0; i < upTo; i++) if (list[i].k === 'frame') s += list[i].dt; return s; };      // the scene's own time

// a figure must never move more than speed x pace x step x 1.5 between two events; one that waits at the entrance, not drawn, is not seen and may be moved with the entrance
function jumps(list) {
  const bad = [];
  for (let i = 1; i < list.length; i++) {
    const a = list[i - 1], b = list[i];
    if (a.vis === false || b.vis === false) continue;
    const d = Math.hypot(b.x - a.x, b.z - a.z), max = WALK_SPEED * Math.max(a.pace, b.pace) * b.dt * SLACK + 0.02;
    if (d > max) bad.push(`${short(b.id)} moved ${d.toFixed(2)} in a step of ${b.dt.toFixed(3)} s (at most ${max.toFixed(2)}) at (${f1(b.x)}, ${f1(b.z)}), ${a.k} to ${b.k}`);
  }
  return bad;
}
// the first event of a figure is its creation, at the entrance and not inside a room; the last is its removal (if it has one), at the entrance and not inside a room
function ends(list, offs, { removed = true } = {}) {
  const bad = [], first = list[0], last = list[list.length - 1];
  if (first.k !== 'create') bad.push(`${short(first.id)}: its first event is ${first.k}, not its creation`);
  else if (!nearAny(offs, first.x, first.z, 1.0)) bad.push(`${short(first.id)}: made at (${f1(first.x)}, ${f1(first.z)}), not at the entrance`);
  else if (offs.some(o => inRoom(o, first.x, first.z))) bad.push(`${short(first.id)}: made inside a room`);
  if (removed) {
    if (last.k !== 'remove') bad.push(`${short(first.id)}: never removed (last event ${last.k})`);
    else if (!nearAny(offs, last.x, last.z, 1.3)) bad.push(`${short(first.id)}: removed at (${f1(last.x)}, ${f1(last.z)}), not at the entrance`);
    else if (offs.some(o => inRoom(o, last.x, last.z))) bad.push(`${short(first.id)}: removed inside a room`);
  }
  return bad;
}
// the scene's own books: nobody is in the scene graph twice or after removal, every label, balloon and chair belongs to a figure, and every desk has the figure whose desk it is
async function books(page) {
  const r = await ev(page, '({ roots: o.roots(), desks: o.desks(), figs: o.figures().map(f => ({ id: f.id, main: f.main })) })');
  const bad = [], ids = r.figs.map(f => f.id), set = new Set(ids), chiefs = new Set(r.figs.filter(f => f.main).map(f => f.id));
  const same = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
  if (new Set(r.roots.ids).size !== r.roots.ids.length) bad.push('a figure is in the scene twice');
  const orphan = r.roots.where.filter(w => !w.own);
  if (orphan.length) bad.push(`${orphan.length} figures stay in the scene after they were removed (${orphan.slice(0, 2).map(w => `${short(w.id)} at ${f1(w.x)}, ${f1(w.z)}`).join('; ')})`);
  if (!same(r.roots.ids, ids)) bad.push(`the scene holds ${r.roots.ids.length} figures, the data ${ids.length} (${[...new Set([...r.roots.ids.filter(i => !set.has(i)), ...ids.filter(i => !r.roots.ids.includes(i))])].map(short).slice(0, 3).join(', ')})`);
  if (!same(r.roots.tags, ids)) bad.push(`${r.roots.tags.length} name labels for ${ids.length} figures`);
  if (r.roots.balloons.length !== ids.length) bad.push(`${r.roots.balloons.length} balloons for ${ids.length} figures`);
  if (!same(r.roots.chairs, [...chiefs])) bad.push(`${r.roots.chairs.length} chairs for ${chiefs.size} chiefs`);
  for (const room of r.desks.rooms) room.seats.forEach((id, i) => {
    if (!id) return;
    const f = r.desks.figures.find(x => x.id === id);
    if (!f || f.slot !== i || f.room !== room.id) bad.push(`desk ${i} of ${short(room.id)} is taken by ${short(id)}, who ${f ? `has desk ${f.slot} of ${short(f.room)}` : 'is gone'}`);
  });
  for (const f of r.desks.figures) if (f.slot >= 0) {
    const room = r.desks.rooms.find(x => x.id === f.room);
    if (!room || room.seats[f.slot] !== f.id) bad.push(`${short(f.id)} has desk ${f.slot} that is not marked as its own`);
  }
  return bad;
}
// every figure of the page is seated at the seat its route leads to
async function seated(page) {
  const r = await ev(page, 'o.figures().map(f => ({ id: f.id, mode: f.mode, after: f.after, x: f.x, z: f.z, seat: o.seatOf(f.id) }))');
  return r.filter(f => f.mode !== 'seated' || !f.seat || Math.hypot(f.x - f.seat.x, f.z - f.seat.z) > 0.1).map(f => `${short(f.id)} is ${f.mode}${f.after ? ' ' + f.after : ''} at (${f1(f.x)}, ${f1(f.z)}), seat ${f.seat ? `(${f1(f.seat.x)}, ${f1(f.seat.z)})` : 'unknown'}`);
}
const report = (name, problems, text) => make(name, problems.length === 0, `${text}${problems.length ? '; PROBLEMS: ' + problems.slice(0, 5).join(' | ') + (problems.length > 5 ? ` (and ${problems.length - 5} more)` : '') : ''}`);

// ---- 3d-walk-load
// While the figures walk in, the page is read every 120 ms: the camera, and the doors next to a walking chief (the chief's own door must be open when it is in the doorway).
async function runLoad(ctx) {
  const problems = [];
  const S = await scenario3d(10, { tag: 'wload', root: ctx.root, width: 1100, height: 700, settle: false, intercept: recordFromStart });
  try {
    const { page } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    const cam0 = await ev(page, '[s.zoom, ...s.project(0, 0, 0)]');
    let cam = cam0, camMoved = 0, doorSamples = 0, doorOpen = 0, samples = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      const r = await ev(page, '({ walking: s.walking.length, cam: [s.zoom, ...s.project(0, 0, 0)], doors: o.doors(), figs: o.figures().map(f => [f.id, f.main, f.mode, f.x, f.z, f.vis]) })');
      samples++;
      cam = r.cam;
      if (cam.some((v, i) => Math.abs(v - cam0[i]) > 0.01)) camMoved++;
      for (const d of r.doors) {
        const chief = r.figs.find(f => f[0] === d.id && f[1] && f[2] === 'walk' && f[5]);
        if (chief && Math.abs(chief[3] - d.x) < 0.6 && Math.abs(chief[4] - d.z) < 0.8) { doorSamples++; if (d.open >= 0.3) doorOpen++; }
      }
      if (!r.walking) break;
      await sleep(120);
    }
    const st = await ev(page, '({ office: o.office(), rec: s.rec.take(), paces: s.pace, walking: s.walking.length })');
    if (st.walking) problems.push(`${st.walking} figures were still walking after 2 minutes`);
    const lists = byId(st.rec);
    const off = st.office;
    const all = [...lists.values()];
    for (const l of all) { problems.push(...ends(l, [off], { removed: false })); problems.push(...jumps(l)); }
    // a figure that waits for its turn is not drawn
    for (const l of all) { const shown = l.filter(e => e.delay > 0 && e.vis !== false); if (shown.length) problems.push(`${short(l[0].id)}: drawn at the entrance while it waited (${shown.length} events)`); }
    // they leave the entrance one after the other
    const delays = all.map(l => l[0].delay).sort((a, b) => a - b), gaps = delays.slice(1).map((d, i) => d - delays[i]);
    if (all.length < 8) problems.push(`only ${all.length} figures were recorded`);
    if (gaps.some(g => g < 0.2 || g > 0.4)) problems.push(`the figures leave the entrance ${f1(Math.min(...gaps) * 1000)} to ${f1(Math.max(...gaps) * 1000)} ms apart (want 200 to 400 ms)`);
    if (delays[delays.length - 1] > 4.05) problems.push(`the last figure leaves the entrance after ${delays[delays.length - 1].toFixed(2)} s (want within 4)`);
    // everybody is in their seat in about 10 s of the scene's own time, counted from the first frame
    const arrive = all.map(l => { const i = l.findIndex(e => e.mode === 'seated'); return i < 0 ? Infinity : sim(l, i + 1); });
    const lastArrival = Math.max(...arrive);
    if (!(lastArrival <= LOAD_S + LOAD_SLACK_S)) problems.push(`the last figure sat down after ${lastArrival.toFixed(1)} s of the scene's time (want about ${LOAD_S}, at most ${LOAD_S + LOAD_SLACK_S})`);
    const hurried = Object.values(st.paces).filter(p => p > 1).length;
    if (all.length > 4 && !hurried) problems.push('a queue of more than four was not hurried');
    if (Math.max(...Object.values(st.paces)) > 3.001) problems.push('a figure walks faster than 3 times the normal pace');
    // the bounce of the step is there in the normal motion mode (the reduced-motion check reads it without)
    const hy = all.flatMap(l => l.filter(e => e.k === 'frame' && e.mode === 'walk' && e.sit < 0.05 && e.vis !== false).map(e => e.hy));
    if (!(Math.max(...hy) - Math.min(...hy) > 0.02)) problems.push(`the step does not bounce (hip height ${Math.min(...hy)} to ${Math.max(...hy)})`);
    if (doorSamples < 3) problems.push(`only ${doorSamples} readings of a chief in a doorway (nothing to judge the doors by)`);
    else if (doorOpen / doorSamples < 0.9) problems.push(`the door was open in ${doorOpen} of ${doorSamples} readings of the chief in its doorway`);
    if (camMoved) problems.push(`the camera moved in ${camMoved} of ${samples} readings`);
    problems.push(...(await books(page)), ...(await seated(page)));
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return [report('3d-walk-load', problems,
      `${all.length} figures (${all.filter(l => l[0].main).length} chiefs) made at the entrance at ${f1(delays[0])} to ${delays[delays.length - 1].toFixed(2)} s, ${f1(Math.min(...gaps) * 1000)} to ${f1(Math.max(...gaps) * 1000)} ms apart, ${hurried} hurried (up to ${Math.max(...Object.values(st.paces)).toFixed(1)} times), `
      + `all seated after ${lastArrival.toFixed(1)} s of the scene's time (earliest ${Math.min(...arrive).toFixed(1)}), ${all.reduce((n, l) => n + l.length, 0)} events and no jump, ${doorOpen} of ${doorSamples} readings with the chief's door open, step bounce ${f1((Math.max(...hy) - Math.min(...hy)) * 100)} cm, the camera stayed`)];
  } finally { await S.done(); }
}

// ---- 3d-walk-calm
async function runCalm(ctx) {
  const problems = [];
  const S = await scenario3d(10, { tag: 'wcalm', root: ctx.root, width: 900, height: 560, query: 'arrive=calm', settle: false, intercept: recordFromStart });
  try {
    const { page } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    const st = await ev(page, '({ paces: s.pace, n: s.walking.length })');
    const paces = Object.values(st.paces);
    if (paces.length < 8) problems.push(`only ${paces.length} figures`);
    if (paces.some(p => p !== 1)) problems.push(`paces ${[...new Set(paces)].join(', ')} (want 1 for everybody)`);
    if (st.n < paces.length) problems.push(`${st.n} of ${paces.length} figures are walking`);
    return [report('3d-walk-calm', problems, `?arrive=calm: ${paces.length} figures, every pace ${[...new Set(paces)].join(', ')}, ${st.n} walking`)];
  } finally { await S.done(); }
}

// ---- 3d-walk-brief
async function runBrief(ctx) {
  const problems = [];
  const S = await scenario3d(4, { tag: 'wbrief', root: ctx.root, width: 1000, height: 640, intercept: recordFromStart, fixture: { statuses: ['working', 'working', 'working', 'working'], subs: i => (i === 0 ? ['working', 'working'] : []) } });
  try {
    const { page, fx } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    await page.evaluate(HELPERS);
    // the sub-agents belong to two chats of the check's own (the server may send a real chat again, and with it its own list of sub-agents)
    const chat0 = 'host0', chat1 = 'host1';
    await qa(page, `q.chat('host0'); q.chat('host1'); q.sub('host0', 'seated-sub'); q.sync();`);
    await ev(page, 's.settle()');
    await sleep(800);
    await ev(page, 's.rec.take().length');                                                     // forget the page load and the hosts' walk
    const off = await ev(page, 'o.office()');
    const seats0 = (await ev(page, 'o.desks()')).rooms.find(r => r.id === chat1).seats;
    const brief = [];
    // a sub-agent that sits and is taken out of the data (not just done): it stands up and walks out, it does not vanish from its desk
    await qa(page, `q.remove('seated-sub'); q.sync();`);
    // a sub-agent whose job ends 0.7 s after it came
    await qa(page, `q.sub(${JSON.stringify(chat0)}, 'brief-sub'); q.sync();`);
    await sleep(700);
    await qa(page, `q.status('brief-sub', 'done'); q.sync();`);
    brief.push('brief-sub');
    // five sub-agents arrive together (the later ones wait their turn at the entrance), and all end 0.35 s later
    for (let i = 0; i < 5; i++) { await qa(page, `q.sub(${JSON.stringify(chat1)}, 'burst-${i}');`); brief.push('burst-' + i); }
    await qa(page, 'q.sync();');
    await sleep(350);
    for (let i = 0; i < 5; i++) await qa(page, `q.status('burst-${i}', 'done');`);
    await qa(page, 'q.sync();');
    // the desk of a figure that turned round is free at once (not when it is out): none of the chat's taken desks is held by a figure that is walking out
    const held = await ev(page, `(() => { const r = o.desks().rooms.find(r => r.id === ${JSON.stringify(chat1)}), fs = o.figures(); return r.seats.filter(Boolean).filter(id => { const f = fs.find(f => f.id === id); return f && f.after === 'gone'; }); })()`);
    if (held.length) problems.push(`${held.length} desks of the chat are held by figures that have turned round (${held.slice(0, 2).join(', ')})`);
    // a chat that ends 0.5 s after it came, and one that ends after 2 s
    await qa(page, `q.chat('brief-chat-a'); q.sync();`);
    await sleep(500);
    await qa(page, `q.remove('brief-chat-a'); q.sync();`);
    brief.push('brief-chat-a');
    await qa(page, `q.chat('brief-chat-b'); q.sub('brief-chat-b', 'brief-chat-b-sub'); q.sync();`);
    await sleep(2000);
    await qa(page, `q.remove('brief-chat-b'); q.sync();`);
    brief.push('brief-chat-b', 'brief-chat-b-sub');
    // one that comes and ends within one sync: it is made at the entrance and turns round on the spot
    await qa(page, `q.chat('flash'); q.sync(); q.remove('flash'); q.sync();`);
    brief.push('flash');
    for (const id of [...brief, 'seated-sub']) if (!(await gone(page, id, 90000))) problems.push(`${id} was never removed`);
    const st = await ev(page, '({ rec: s.rec.take(), office: o.office() })');
    const lists = byId(st.rec);
    const sl = lists.get('seated-sub') || [], sOut = sl.filter(e => e.k === 'frame' && e.after === 'gone');
    if (!sOut.length || !sOut[0].stand) problems.push('the sub-agent that was taken out of the data did not stand up and walk out from its desk');
    else {
      const last = sl[sl.length - 1];
      if (last.k !== 'remove' || !nearAny([off, st.office], last.x, last.z, 1.3)) problems.push(`the sub-agent taken out of the data ended as ${last.k} at (${f1(last.x)}, ${f1(last.z)}), not removed at the entrance`);
      problems.push(...jumps(sl));
    }
    let turned = 0;
    for (const id of brief) {
      const l = lists.get(id);
      if (!l) { if (id !== 'flash') problems.push(`${id}: not recorded`); continue; }
      problems.push(...ends(l, [off, st.office]), ...jumps(l));
      if (l.some(e => e.mode === 'seated')) problems.push(`${short(id)}: seen seated, though its job was over before it reached its seat`);
      if (l.some(e => e.k === 'frame' && e.vis !== false) && !l.some(e => e.after === 'gone')) problems.push(`${short(id)}: it was drawn, and then removed without turning round and walking out`);
      const far = Math.max(...l.map(e => Math.hypot(e.x - l[0].x, e.z - l[0].z)));
      if (far > 12) problems.push(`${short(id)}: got ${f1(far)} units from the entrance in a job of a few seconds`);
      if (l.some(e => e.turn)) turned++;
    }
    if (turned < 4) problems.push(`only ${turned} figures were seen turning round (want 4 or more of the ${brief.length})`);
    const vacantNow = st.office.slots.filter(s => s.vacant).length;
    if (vacantNow !== st.office.slots.length - 6) problems.push(`${vacantNow} vacant offices of ${st.office.slots.length}, want ${st.office.slots.length - 6} (the 4 real chats and the 2 hosts stay)`);
    problems.push(...(await books(page)));
    // no desk stays taken: the next sub-agent of the chat takes the first desk that the first of the burst had
    const free = (await ev(page, 'o.desks()')).rooms.find(r => r.id === chat1).seats;
    if (free.some(Boolean)) problems.push(`the desks of the chat are still taken after the burst: ${JSON.stringify(free)} (before ${JSON.stringify(seats0)})`);
    await qa(page, `q.sub(${JSON.stringify(chat1)}, 'after-burst'); q.sync();`);
    const after = (await ev(page, 'o.desks()')).rooms.find(r => r.id === chat1).seats;
    if (after[0] !== 'after-burst') problems.push(`the next sub-agent sat at desk ${after.indexOf('after-burst')}, not the first (${JSON.stringify(after)})`);
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return [report('3d-walk-brief', problems, `${brief.length} figures (one sub-agent, a burst of five, two chats and a chat that ends within one sync): each was made at the entrance, turned round (${turned} seen turning) and was removed at the entrance, none was ever seated, no jump, all ${vacantNow} offices that are not a chat's are vacant again, no desk stayed taken; a seated sub-agent taken out of the data stood up and walked out`)];
  } finally { await S.done(); }
}

// ---- 3d-walk-leave (the real server: a chat closes, a sub-agent finishes)
async function runLeave(ctx) {
  const problems = [];
  const S = await scenario3d(3, { tag: 'wleave', root: ctx.root, width: 1000, height: 640, intercept: recordFromStart, fixture: { statuses: ['working', 'working', 'working'], subs: () => ['working', 'working'] } });
  try {
    const { page, fx } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    const off0 = await ev(page, 'o.office()');
    const slotOf = id => off0.slots.find(s => s.id === id);
    const pick = fx.agents.find(a => slotOf(a.id) && slotOf(a.id).door === 'back') || fx.agents[0];          // an office with a hinged door (a front door is an opening)
    const hinged = slotOf(pick.id).door === 'back';
    await ev(page, 's.rec.take().length');
    const seatsBefore = await seated(page);
    if (seatsBefore.length) problems.push(`before the close: ${seatsBefore.length} figures not seated (${seatsBefore[0]})`);
    fx.closeSession(pick.id);
    const mine = [pick.id, ...pick.subs.map(s => s.id)];
    let doorSamples = 0, doorOpen = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      const r = await ev(page, '({ doors: o.doors(), figs: o.figures().map(f => [f.id, f.main, f.mode, f.x, f.z]) })');
      for (const d of r.doors) {
        if (!d.vacant || d.slot !== slotOf(pick.id).slot) continue;
        const chief = r.figs.find(f => f[0] === pick.id && f[2] === 'walk');
        if (chief && Math.abs(chief[3] - d.x) < 0.6 && Math.abs(chief[4] - d.z) < 0.8) { doorSamples++; if (d.open >= 0.3) doorOpen++; }
      }
      if (!r.figs.some(f => mine.includes(f[0]))) break;
      await sleep(100);
    }
    const st = await ev(page, '({ rec: s.rec.take(), office: o.office() })');
    const lists = byId(st.rec);
    let stood = 0;
    for (const id of mine) {
      const l = lists.get(id);
      if (!l) { problems.push(`${short(id)}: not recorded`); continue; }
      const last = l[l.length - 1];
      if (last.k !== 'remove') { problems.push(`${short(id)}: never removed`); continue; }
      if (!nearAny([off0, st.office], last.x, last.z, 1.3) || inRoom(st.office, last.x, last.z)) problems.push(`${short(id)}: removed at (${f1(last.x)}, ${f1(last.z)}), not at the entrance`);
      problems.push(...jumps(l));
      const out = l.filter(e => e.k === 'frame' && e.after === 'gone');
      if (!out.length) { problems.push(`${short(id)}: never walked out`); continue; }
      if (out[0].mode !== 'walk' || !out[0].stand) problems.push(`${short(id)}: it started walking out without standing up first`);
      // it stands still while it stands up: for at least 0.25 s of the scene's time the position does not change
      const still = []; for (const e of out) { if (!e.stand) break; still.push(e); }
      const stillT = still.reduce((s, e) => s + e.dt, 0);
      if (stillT < 0.25 || still.some(e => Math.hypot(e.x - out[0].x, e.z - out[0].z) > 0.02)) problems.push(`${short(id)}: stood still for ${stillT.toFixed(2)} s while getting up (want at least 0.25)`);
      else stood++;
      if (!(out.at(-1).sit < 0.2)) problems.push(`${short(id)}: still sitting when it left (sit ${out.at(-1).sit})`);
      if (!inRoom(off0, out[0].x, out[0].z)) problems.push(`${short(id)}: it got up outside its room at (${f1(out[0].x)}, ${f1(out[0].z)})`);
    }
    if (!st.office.slots[slotOf(pick.id).slot].vacant) problems.push('the office is not vacant after its chat closed');
    if (hinged) { if (doorSamples < 2) problems.push(`only ${doorSamples} readings of the chief in the doorway of the vacant office`); else if (doorOpen / doorSamples < 0.9) problems.push(`the door of the vacant office was open in ${doorOpen} of ${doorSamples} readings of the chief in its doorway`); }
    problems.push(...(await books(page)));
    // a sub-agent that finishes sits for 4.5 s (the check mark), then stands up and walks out
    const other = fx.agents.find(a => a.id !== pick.id), sub = other.subs[0];
    await ev(page, 's.rec.take().length');
    const tFinish = Date.now();
    fx.finishSub(sub.id);
    // the page clock at the moment the data says it is done (the scene sits it out for 4.5 s of that clock, then it stands up)
    let tDone = null;
    await until(async () => {
      const r = await page.evaluate(`(async () => { const { store } = await import('/js/main.js'); const a = store.agents.get(${JSON.stringify(sub.id)}); return a ? { status: a.status, now: performance.now() } : null; })()`);
      if (r && r.status !== 'working') { tDone = r.now; return true; }
      return false;
    }, 90000, 100);
    if (tDone === null) problems.push('the data never said the sub-agent was done');
    if (!(await gone(page, sub.id, 120000))) problems.push('the finished sub-agent never left');
    const st2 = await ev(page, 's.rec.take()');
    const l2 = byId(st2).get(sub.id) || [];
    const out2 = l2.find(e => e.after === 'gone');
    const seatedFor = out2 && tDone !== null ? (out2.t - tDone) / 1000 : 0;
    if (!out2) problems.push('the finished sub-agent never walked out');
    else if (!out2.stand) problems.push('the finished sub-agent started walking out without standing up first');
    else if (seatedFor < 4.3 || seatedFor > 9) problems.push(`the finished sub-agent stood up ${seatedFor.toFixed(1)} s after the data said it was done (want 4.5 s of sitting: 4.3 to 9)`);
    if (l2.length && l2.at(-1).k !== 'remove') problems.push('the finished sub-agent was not removed');
    else if (l2.length && !nearAny([off0, st.office], l2.at(-1).x, l2.at(-1).z, 1.3)) problems.push('the finished sub-agent was removed away from the entrance');
    problems.push(...jumps(l2));
    problems.push(...(await books(page)));
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return [report('3d-walk-leave', problems, `the chat closed with its chief and ${pick.subs.length} sub-agents seated: ${stood} of ${mine.length} stood up first (still for 0.25 s or more), walked out and were removed at the entrance with no jump, the vacant office is vacant, ${hinged ? `its door was open in ${doorOpen} of ${doorSamples} readings of the chief in the doorway` : 'its door is an opening'}; a finished sub-agent sat ${seatedFor.toFixed(1)} s after the data said it was done, then stood up, walked out and was removed at the entrance (${((Date.now() - tFinish) / 1000).toFixed(0)} s on the wall clock in all)`)];
  } finally { await S.done(); }
}

// ---- 3d-walk-flap
async function runFlap(ctx) {
  const problems = [];
  const S = await scenario3d(3, { tag: 'wflap', root: ctx.root, width: 1000, height: 640, intercept: recordFromStart, fixture: { statuses: ['working', 'working', 'working'], subs: i => (i === 0 ? ['working'] : []) } });
  try {
    const { page, fx } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    await page.evaluate(HELPERS);
    const chat0 = 'host';                                                                      // the sub-agents belong to a chat of the check's own (a real chat may be sent again by the server)
    await qa(page, `q.chat('host'); q.sync();`);
    await ev(page, 's.settle()');
    await sleep(800);
    await ev(page, 's.rec.take().length');
    // a chat: appears, ends 1.5 s later, appears again 0.5 s after that (while its chief walks out)
    await qa(page, `q.chat('flap-chat'); q.sync();`);
    await sleep(1500);
    await qa(page, `q.remove('flap-chat'); q.sync();`);
    await sleep(500);
    await qa(page, `q.chat('flap-chat'); q.sync();`);
    // a sub-agent: working, done after 1.5 s, working again after 0.5 s
    await qa(page, `q.sub(${JSON.stringify(chat0)}, 'flap-sub'); q.sync();`);
    await sleep(1500);
    await qa(page, `q.status('flap-sub', 'done'); q.sync();`);
    await sleep(500);
    await qa(page, `q.status('flap-sub', 'working'); q.sync();`);
    // within one sync: appears, ends, appears
    await qa(page, `q.chat('fast'); q.sync(); q.remove('fast'); q.sync(); q.chat('fast'); q.sync();`);
    // a sub-agent flapping twice more while it is still walking in
    await qa(page, `q.sub(${JSON.stringify(chat0)}, 'flap-sub-2'); q.sync(); q.status('flap-sub-2', 'done'); q.sync(); q.status('flap-sub-2', 'working'); q.sync(); q.status('flap-sub-2', 'done'); q.sync(); q.status('flap-sub-2', 'working'); q.sync();`);
    if (!(await idle(page))) problems.push('somebody was still walking after 2 minutes');
    const st = await ev(page, '({ rec: s.rec.take(), office: o.office(), figs: o.figures().map(f => f.id) })');
    const lists = byId(st.rec);
    // a figure that is back while it still walks out is the same figure, made once and never removed; one that flaps within a single sync, still at the entrance, is made and removed
    // at the entrance as often as the data says, and is there once at the end
    let cameBack = 0;
    for (const id of ['flap-chat', 'flap-sub', 'fast', 'flap-sub-2']) {
      const l = lists.get(id);
      if (!l) { problems.push(`${id}: not recorded`); continue; }
      problems.push(...ends(l, [st.office], { removed: false }), ...jumps(l));
      const creates = l.filter(e => e.k === 'create'), removes = l.filter(e => e.k === 'remove');
      if (creates.length !== removes.length + 1) problems.push(`${id}: made ${creates.length} times and removed ${removes.length} (it is in the data at the end: one more make than removes)`);
      if (['flap-chat', 'flap-sub'].includes(id) && (creates.length !== 1 || removes.length)) problems.push(`${id}: it came back while it walked out, so it is one figure; it was made ${creates.length} times and removed ${removes.length}`);
      for (const e of [...creates, ...removes]) if (!nearAny([st.office], e.x, e.z, 1.3) || inRoom(st.office, e.x, e.z)) problems.push(`${id}: ${e.k === 'create' ? 'made' : 'removed'} at (${f1(e.x)}, ${f1(e.z)}), not at the entrance`);
      if (!st.figs.includes(id)) problems.push(`${id}: not in the scene at the end`);
      if (['flap-chat', 'flap-sub'].includes(id)) {
        const g = l.findIndex(e => e.after === 'gone');
        if (g < 0) problems.push(`${id}: never turned round (the flap was not seen)`);
        else if (l.slice(g).some(e => e.k === 'frame' && e.after === 'sit' && e.mode === 'walk')) cameBack++;
      }
    }
    if (cameBack < 2) problems.push(`only ${cameBack} of the two figures that flapped came back while they walked out`);
    problems.push(...(await books(page)), ...(await seated(page)));
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    const counts = ['flap-chat', 'flap-sub', 'fast', 'flap-sub-2'].map(id => { const l = lists.get(id) || []; return `${id} made ${l.filter(e => e.k === 'create').length}, removed ${l.filter(e => e.k === 'remove').length}`; }).join('; ');
    return [report('3d-walk-flap', problems, `a chat and a sub-agent flapped with time to walk (end, back 0.5 s later): ${cameBack} of 2 came back while walking out, as the same figure; two flapped within single syncs, still at the entrance (${counts}); all ended seated at their seats, ${st.figs.length} figures in the scene and in the data, no duplicate, label, balloon or chair left over, no desk stuck`)];
  } finally { await S.done(); }
}

// ---- 3d-walk-rebuild
// ?rooms=19: the building has 19 offices (10 bays); 14 more chats with a sub-agent each open at once and walk in; 3 s later two more come: the 20th adds a bay to the bar, the bar's hall
// grows to the right and the entrance moves 14 units. Everybody on the way is re-pathed from where they stand.
async function runRebuild(ctx) {
  const problems = [];
  const S = await scenario3d(4, { tag: 'wgrow', root: ctx.root, width: 900, height: 560, query: 'rooms=19', intercept: recordFromStart, fixture: { statuses: ['working', 'working', 'working', 'working'], subs: i => (i === 0 ? ['working'] : []) } });
  try {
    const { page } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    await page.evaluate(HELPERS);
    await ev(page, 's.rec.take().length');
    const off0 = await ev(page, 'o.office()');
    await qa(page, `for (let i = 1; i <= 14; i++) { q.chat('g' + i); q.sub('g' + i, 'g' + i + '-sub'); } q.sync();`);
    await sleep(3000);
    const mid = await ev(page, '({ walking: s.walking.length, builds: o.builds })');
    if (mid.walking < 10) problems.push(`only ${mid.walking} figures were walking when the building grew (want 10 or more)`);
    // while they walk: the 19th chat comes (no new bay) with a sub-agent that still waits its turn at the entrance when the 20th comes 150 ms later and the building grows
    await qa(page, `q.sub('g1', 'late-sub'); q.chat('g15'); q.sub('g15', 'g15-sub'); q.sync();`);
    await sleep(150);
    const onTheWay = await ev(page, 'o.figures().filter(f => f.mode === "walk" && f.vis).map(f => f.id)');
    await qa(page, `q.chat('g16'); q.sub('g16', 'g16-sub'); q.sync();`);
    const grown = await ev(page, '({ office: o.office(), builds: o.builds })');
    if (grown.office.entryX <= off0.entryX + 1) problems.push(`the building did not grow to the right (entrance ${off0.entryX} to ${grown.office.entryX}): nothing was re-pathed`);
    if (grown.builds <= mid.builds) problems.push('the building was not rebuilt');
    if (!(await idle(page))) problems.push('somebody was still walking after 2 minutes');
    const st = await ev(page, '({ rec: s.rec.take(), office: o.office(), figs: o.figures().map(f => f.id) })');
    const lists = byId(st.rec);
    const offs = [off0, grown.office, st.office];
    let n = 0;
    for (const l of lists.values()) {
      n++;
      if (l[0].k === 'create') problems.push(...ends(l, offs, { removed: false }));                // (the four real chats were seated before the record began)
      problems.push(...jumps(l));
      if (l.some(e => e.k === 'remove')) problems.push(`${short(l[0].id)}: removed, though it was in the data`);
      if (l.filter(e => e.k === 'create').length > 1 && l.slice(l.findIndex(e => e.k === 'create') + 1).some(e => e.k === 'create' && e.vis !== false)) problems.push(`${short(l[0].id)}: made twice`);
    }
    if (onTheWay.length < 8) problems.push(`only ${onTheWay.length} figures were on the way, drawn, when the building grew (want 8 or more)`);
    const lost = onTheWay.filter(id => !st.figs.includes(id));
    if (lost.length) problems.push(`${lost.length} of the figures on the way when the building grew are gone (${lost.slice(0, 2).map(short).join(', ')})`);
    const ids = new Set(st.figs);
    for (const id of ['g1', 'g1-sub', 'g14', 'g14-sub', 'g15', 'g15-sub', 'g16', 'g16-sub', 'late-sub']) if (!ids.has(id)) problems.push(`${id} is missing from the scene at the end`);
    problems.push(...(await books(page)), ...(await seated(page)));
    if (st.office.bays <= off0.bays) problems.push(`${st.office.bays} bays (was ${off0.bays}): the building did not grow`);
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return [report('3d-walk-rebuild', problems, `${off0.bays} to ${st.office.bays} bays, the entrance moved ${f1(off0.entryX)} to ${f1(grown.office.entryX)} with ${mid.walking} people walking: ${n} figures recorded (${st.figs.length} in the scene at the end, all seated), ${onTheWay.length} of them drawn and on the way when the 20th chat came: none jumped, none was dropped or made twice, all went on to their seats`)];
  } finally { await S.done(); }
}

// ---- 3d-walk-hidden
async function runHidden(ctx) {
  const problems = [];
  const S = await scenario3d(3, { tag: 'whidden', root: ctx.root, width: 1000, height: 640, intercept: recordFromStart, fixture: { statuses: ['working', 'working', 'working'], subs: i => (i === 0 ? ['working'] : []) } });
  try {
    const { page } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    await page.evaluate(HELPERS);
    await ev(page, 's.rec.take().length');
    await qa(page, `q.chat('h1'); q.chat('h3'); q.sub('h3', 'h3-sub'); q.sub('h3', 'h3-x'); q.sync();`);
    await sleep(2500);
    const before = await ev(page, 'o.figures().filter(f => f.mode === "walk").map(f => [f.id, f.x, f.z])');
    await page.evaluate(`location.hash = '#pano'`);
    await sleep(900);
    await qa(page, `q.remove('h1'); q.chat('h2'); q.sub('h3', 'h-sub'); q.status('h3-sub', 'done'); q.remove('h3-x');`);      // while nobody looks (the scene does not update while hidden)
    await sleep(1200);
    await page.evaluate(`location.hash = '#ofis'`);
    await sleep(800);
    if (!(await idle(page))) problems.push('somebody was still walking after 2 minutes');
    const st = await ev(page, '({ rec: s.rec.take(), office: o.office(), figs: o.figures().map(f => f.id) })');
    const lists = byId(st.rec);
    if (before.length < 2) problems.push(`only ${before.length} figures were walking when the view was left`);
    for (const l of lists.values()) problems.push(...jumps(l));
    for (const id of ['h1', 'h2', 'h-sub', 'h3-sub', 'h3-x']) {
      const l = lists.get(id);
      if (!l) { problems.push(`${id}: not recorded`); continue; }
      problems.push(...ends(l, [st.office], { removed: id === 'h1' || id === 'h3-sub' || id === 'h3-x' }));
      if (['h1', 'h3-sub', 'h3-x'].includes(id) && !l.some(e => e.after === 'gone')) problems.push(`${id}: it was removed without walking out`);
    }
    if (!st.figs.includes('h2') || !st.figs.includes('h-sub') || !st.figs.includes('h3')) problems.push('a figure that is in the data is missing from the scene');
    if (st.figs.includes('h1')) problems.push('h1 (its chat ended while the view was hidden) is still in the scene');
    problems.push(...(await books(page)), ...(await seated(page)));
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return [report('3d-walk-hidden', problems, `the view was left for 2 s with ${before.length} people walking, a chat ended, a sub-agent finished, one was taken out of the data and a chat and a sub-agent came meanwhile: back in the view nobody jumped, the three that were over walked out (turning round where they still walked in) and were removed at the entrance, the new ones were made at the entrance and sat down, ${st.figs.length} figures in the scene`)];
  } finally { await S.done(); }
}

// ---- 3d-walk-follow
async function runFollow(ctx) {
  const problems = [];
  const S = await scenario3d(3, { tag: 'wfollow', root: ctx.root, width: 1100, height: 700, settle: false, fixture: { statuses: ['working', 'working', 'working'], subs: i => (i === 0 ? ['working', 'working', 'working'] : []) } });
  try {
    const { page, fx } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    const chat = fx.agents[0];
    const off = await ev(page, 'o.office()');
    // the chief of the first chat, once it is walking along its hall and no longer shrunk by the entrance
    const pick = await until(async () => ev(page, `(() => { const f = o.figures().find(f => f.id === ${JSON.stringify(chat.id)}); return f && f.vis && f.mode === 'walk' && f.x < ${off.entryX - 9} && f.x > ${off.entryX - 14} ? { x: f.x, z: f.z } : null; })()`), 60000, 100);
    if (!pick) { problems.push('the chief was never seen walking along the hall'); return [report('3d-walk-follow', problems, '')]; }
    await ev(page, `o.view(${pick.x}, 0.6, ${pick.z}, 40)`);
    await sleep(250);
    const cam0 = await ev(page, '[s.zoom, ...s.project(0, 0, 0)]');
    const tagSel = id => `.of-l.of-tagl[data-id="${id}"]`, ballSel = id => `.of-l.of-ball[data-id="${id}"]`;
    const readLabel = (id, sel) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel(id))}); if (!e) return null; const r = e.getBoundingClientRect(), a = document.querySelector('#view-ofis .of-stage').getBoundingClientRect(); return { visible: e.style.visibility === 'visible', x: r.left + r.width / 2 - a.left, y: r.top + r.height / 2 - a.top }; })()`);
    const labels = { tag: 0, tagOk: 0, ball: 0, ballOk: 0 }, camMoved = [];
    let first = null, last = null;
    for (let i = 0; i < 14; i++) {
      const at = await ev(page, `s.charScreen(${JSON.stringify(chat.id)})`), mode = await ev(page, `(o.figures().find(f => f.id === ${JSON.stringify(chat.id)}) || {}).mode`);
      if (!at || mode !== 'walk') break;
      first = first || at; last = at;
      const t = await readLabel(chat.id, tagSel), b = await readLabel(chat.id, ballSel);
      if (t) { labels.tag++; if (t.visible && Math.hypot(t.x - at[0], t.y - at[1]) < 200) labels.tagOk++; }
      if (b) { labels.ball++; if (b.visible && Math.hypot(b.x - at[0], b.y - at[1]) < 200 && b.y < at[1]) labels.ballOk++; }
      const cam = await ev(page, '[s.zoom, ...s.project(0, 0, 0)]');
      if (cam.some((v, k) => Math.abs(v - cam0[k]) > 0.01)) camMoved.push(i);
      await sleep(130);
    }
    const travelled = first && last ? Math.hypot(last[0] - first[0], last[1] - first[1]) : 0;
    if (labels.tag < 6 || labels.tagOk / labels.tag < 0.9) problems.push(`the name label stayed with the walking chief in ${labels.tagOk} of ${labels.tag} readings`);
    if (labels.ball < 6 || labels.ballOk / labels.ball < 0.9) problems.push(`the balloon stayed above the walking chief in ${labels.ballOk} of ${labels.ball} readings`);
    if (travelled < 40) problems.push(`the chief moved only ${f1(travelled)} px on the screen in the readings (nothing to follow)`);
    if (camMoved.length) problems.push(`the camera moved in ${camMoved.length} readings`);
    // hover: the tooltip of the agent appears on a walking figure; click: the card opens beside it and follows it
    await ev(page, `o.view(${pick.x}, 0.6, ${pick.z}, 40)`);
    const target = await until(async () => {
      const m = await ev(page, `(() => { const f = o.figures().find(f => f.id === ${JSON.stringify(chat.id)}); return f && f.mode === 'walk' ? s.charScreen(f.id) : null; })()`);
      return m;
    }, 20000, 100);
    let hoverText = '', opened = null;
    if (target) {
      await page.mouse.move(target[0], target[1] - 12);
      await sleep(120);
      const t2 = await ev(page, `s.charScreen(${JSON.stringify(chat.id)})`);
      await page.mouse.move(t2[0], t2[1] - 12);
      await sleep(150);
      hoverText = await page.evaluate(`(() => { const t = document.querySelector('#tip'); return t && t.classList.contains('on') ? t.textContent : ''; })()`);
      for (const dy of [-12, -22, -4, -30]) {
        const at = await ev(page, `s.charScreen(${JSON.stringify(chat.id)})`);
        if (!at) break;
        await page.mouse.click(at[0], at[1] + dy);
        opened = await until(async () => { const c = await page.evaluate(`document.querySelector('#view-ofis').__ofisUi.card`); return c.open && c.id === chat.id ? c : null; }, 1200, 100);
        if (opened) break;
      }
    }
    if (!hoverText.includes(chat.project) && !hoverText.includes(chat.name.slice(0, 12))) problems.push(`hovering the walking chief showed "${hoverText.slice(0, 60)}", not its tooltip`);
    if (!opened) problems.push('clicking the walking chief did not open its card');
    else {
      const rel = [], fig = [];
      await sleep(450);                                                  // (the card comes in with a short scale: measure it once it has settled)
      for (let i = 0; i < 14; i++) {
        const { c, at } = await ev(page, `({ c: v.__ofisUi.card, at: s.charScreen(${JSON.stringify(chat.id)}) })`);       // one reading: no frame comes between the card and the figure
        if (!c.open || !at) break;
        rel.push([c.rect.x - at[0], at[1] - c.rect.y, c.rect.h]); fig.push(at);
        await sleep(160);
      }
      // the card may still be coming in (its spring) or the chief turning a corner at the first readings: measure from the first reading that is within 4 px of the one before
      const k = rel.findIndex((r, i) => i > 0 && Math.abs(r[0] - rel[i - 1][0]) < 4);
      const early = k > 0 ? k : 0;
      rel.splice(0, early); fig.splice(0, early);
      const move = fig.length > 1 ? Math.hypot(fig.at(-1)[0] - fig[0][0], fig.at(-1)[1] - fig[0][1]) : 0;
      // the card is as tall as the view allows and the page keeps it inside the view, so its height can't follow the figure's: along the screen it follows to within a few px, and the
      // figure stays beside it (inside its height) the whole time
      const drift = rel.length ? Math.max(...rel.map(r => Math.abs(r[0] - rel[0][0]))) : 999;
      const beside = rel.filter(r => r[1] >= -30 && r[1] <= r[2] + 30).length;                 // (30 px of slack: the card sits against the top of the free area while the chief walks up the screen)
      if (rel.length && beside < rel.length) problems.push(`the walking chief was beside its card in only ${beside} of ${rel.length} readings`);
      if (rel.length < 6) problems.push(`the card was open in only ${rel.length} readings`);
      if (move < 30) problems.push(`the walking chief moved only ${f1(move)} px while the card was open`);
      if (drift > 40) problems.push(`the card drifted ${f1(drift)} px sideways from the walking chief`);
      notes.card = `${f1(move)} px, sideways drift ${f1(drift)} px, beside it in ${beside} of ${rel.length} readings`;
    }
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return [report('3d-walk-follow', problems, `the walking chief of "${chat.name.slice(0, 24)}" (${f1(travelled)} px across the screen): its name label was next to it in ${labels.tagOk} of ${labels.tag} readings, its balloon above it in ${labels.ballOk} of ${labels.ball}, hovering it showed its tooltip, clicking it opened its card (followed it: ${notes.card || 'n/a'}), the camera stayed`)];
  } finally { await S.done(); }
}

// ---- 3d-walk-settle
async function runSettle(ctx) {
  const problems = [];
  const S = await scenario3d(4, { tag: 'wsettle', root: ctx.root, width: 900, height: 560, settle: false, intercept: recordFromStart, fixture: { statuses: ['working', 'working', 'working', 'working'], subs: i => (i === 0 ? ['working', 'working'] : []) } });
  try {
    const { page } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    await page.evaluate(HELPERS);
    const n0 = await ev(page, 's.walking.length'), figs0 = await ev(page, 'o.figures().length');
    if (n0 < 4) problems.push(`only ${n0} figures were walking after the page load (nothing to settle)`);
    const ended = await ev(page, 's.settle()');
    const after = await ev(page, '({ walking: s.walking.length, figs: o.figures().length })');
    if (ended !== n0 || after.walking !== 0 || after.figs !== figs0) problems.push(`settle ended ${ended} of ${n0} walks, ${after.walking} are still walking, ${after.figs} figures of ${figs0}`);
    await sleep(600);
    problems.push(...(await seated(page)), ...(await books(page)));
    if ((await ev(page, 's.settle()')) !== 0) problems.push('a second settle found walks to end');
    // a walk out ends in the removal of the figure at the entrance
    await qa(page, `q.chat('s-chat'); q.sub('s-chat', 's-chat-sub'); q.sync();`);
    await ev(page, 's.settle()');
    await sleep(700);
    await qa(page, `q.remove('s-chat'); q.sync();`);
    await sleep(900);
    const out = await ev(page, 's.walking.length');
    const ended2 = await ev(page, 's.settle()');
    const after2 = await ev(page, 'o.figures().filter(f => f.id.startsWith("s-chat")).length');
    if (!out || ended2 !== out || after2) problems.push(`the walk out of the closed chat: ${out} walking, settle ended ${ended2}, ${after2} of its figures are left`);
    problems.push(...(await books(page)));
    // the app itself never calls it (the pixel scene's own boards.settle(avoid) takes an argument and is another thing)
    const calls = [];
    const walk = dir => { for (const f of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, f.name); if (f.isDirectory()) walk(p); else if (/\.js$/.test(f.name) && !p.includes('/vendor/')) { const t = readFileSync(p, 'utf8'); for (const m of t.matchAll(/\.settle\s*\(\s*\)/g)) calls.push(`${p.slice((ctx.root || ROOT).length)}:${t.slice(0, m.index).split('\n').length}`); } } };
    walk(join(ctx.root || ROOT, 'public'));
    if (calls.length) problems.push(`the app calls settle: ${calls.join(', ')}`);
    return [report('3d-walk-settle', problems, `after the page load ${n0} of ${figs0} figures were walking: settle ended them all (everybody seated at their seat, no figure lost), a second call found none, and the walk out of a closed chat ended in ${ended2} removals; no call of settle in public/`)];
  } finally { await S.done(); }
}

// ---- 3d-walk-reduced
async function runReduced(ctx) {
  const problems = [];
  const S = await scenario3d(4, { tag: 'wreduced', root: ctx.root, width: 900, height: 560, reducedMotion: true, settle: false, intercept: recordFromStart, fixture: { statuses: ['working', 'working', 'working', 'working'], subs: i => (i === 0 ? ['working', 'working'] : []) } });
  try {
    const { page } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    const t0 = Date.now();
    await sleep(3000);
    const st0 = await ev(page, 's.rec.take()');
    if (!(await idle(page))) problems.push('somebody was still walking after 2 minutes');
    const st = await ev(page, 's.rec.take()');
    const rec = [...st0, ...st];
    const walkFrames = rec.filter(e => e.k === 'frame' && e.mode === 'walk' && e.sit < 0.05 && e.vis !== false);
    const hy = walkFrames.map(e => e.hy);
    if (walkFrames.length < 30) problems.push(`only ${walkFrames.length} walking frames`);
    if (Math.max(...hy) - Math.min(...hy) > 0.001) problems.push(`the step bounces with reduced motion (hip height ${Math.min(...hy)} to ${Math.max(...hy)})`);
    // the pace is the same: in the middle of a walk a step is speed x pace x dt
    const lists = [...byId(rec).values()];
    let mid = 0, ok = 0;
    for (const l of lists) for (let i = 1; i < l.length; i++) {
      const a = l[i - 1], b = l[i];
      if (b.k !== 'frame' || a.vis === false || b.vis === false || b.mode !== 'walk' || b.stand || b.turn || b.delay > 0 || !b.dt) continue;
      const v = Math.hypot(b.x - a.x, b.z - a.z) / b.dt / (WALK_SPEED * b.pace);
      if (v > 0.99) { mid++; if (v < 1.01) ok++; }
    }
    if (mid < 20 || ok / mid < 0.9) problems.push(`only ${ok} of ${mid} full-speed steps are at the pace of the normal motion`);
    for (const l of lists) problems.push(...jumps(l));
    return [report('3d-walk-reduced', problems, `with prefers-reduced-motion ${walkFrames.length} walking frames: hip height ${Math.min(...hy)} to ${Math.max(...hy)} (no bounce), ${ok} of ${mid} full-speed steps exactly at speed x pace x step, no jump (${((Date.now() - t0) / 1000).toFixed(0)} s)`)];
  } finally { await S.done(); }
}

const CHECKS = { load: runLoad, calm: runCalm, brief: runBrief, leave: runLeave, flap: runFlap, rebuild: runRebuild, hidden: runHidden, follow: runFollow, settle: runSettle, reduced: runReduced };
const NAME = { load: '3d-walk-load', calm: '3d-walk-calm', brief: '3d-walk-brief', leave: '3d-walk-leave', flap: '3d-walk-flap', rebuild: '3d-walk-rebuild', hidden: '3d-walk-hidden', follow: '3d-walk-follow', settle: '3d-walk-settle', reduced: '3d-walk-reduced' };

// ---- mutations: break one line in a copy of the repo and expect the check that guards it to fail
const MUTATIONS = [
  { name: 'a figure is made at its seat instead of at the entrance', file: 'public/js/ofis.js', from: 'c.root.position.set(route[0].x, 0, route[0].z);', to: 'c.root.position.set(route[route.length - 1].x, 0, route[route.length - 1].z);', fails: ['load', 'brief'] },
  { name: 'a figure that waits for its turn is drawn at the entrance', file: 'public/js/ofis.js', from: 'c.root.visible = c.delay <= 0;', to: 'c.root.visible = true;', fails: 'load' },
  { name: 'the figures all leave the entrance at once', file: 'public/js/ofis-arrive.js', from: 'const delay = rank * st;', to: 'const delay = 0;', fails: 'load' },
  { name: 'a big queue is not hurried', file: 'public/js/ofis-arrive.js', from: 'if (rush && n > calm) {', to: 'if (false && n > calm) {', fails: 'load' },
  { name: 'the walk is faster than its pace', file: 'public/js/ofis-arrive.js', from: 'const stp = speed * pace * rampFactor', to: 'const stp = speed * pace * 2.2 * rampFactor', fails: 'load' },
  { name: 'the door does not open for the chief', file: 'public/js/ofis.js', from: "if (c.mode !== 'walk' || c.delay > 0) continue;", to: "if (c.mode !== 'walk' || c.delay > 0 || c.main) continue;", fails: 'load' },
  { name: 'a figure whose job ends before its seat is removed on the spot', file: 'public/js/ofis.js', from: "if (c.mode === 'walk' && c.after === 'sit') { turnAround(c); continue; }", to: "if (c.mode === 'walk' && c.after === 'sit') { removeChar(c); continue; }", fails: ['brief', 'hidden'] },
  { name: 'a turned-round figure keeps its desk', file: 'public/js/ofis.js', from: "    const room = world.rooms.get(c.roomId), pos = c.root.position;\n    if (room && c.slot >= 0 && room.slotChar[c.slot] === c) room.slotChar[c.slot] = null;\n    if (c.slot >= 0) c.slotWas = c.slot;\n    c.slot = -1;\n    // a walk still", to: "    const room = world.rooms.get(c.roomId), pos = c.root.position;\n    if (c.slot >= 0) c.slotWas = c.slot;\n    c.slot = -1;\n    // a walk still", fails: 'brief' },
  { name: 'a chat that ends is taken out of its vacant office on the spot', file: 'public/js/ofis.js', from: "if (!room) { exitVacated(c, old,", to: "if (!room) { removeChar(c); continue; } if (!room) { exitVacated(c, old,", fails: ['brief', 'leave'] },
  { name: 'a seated figure whose agent is gone is removed on the spot', file: 'public/js/ofis.js', from: "      else leaveRoom(c);\n    }\n  }", to: "      else removeChar(c);\n    }\n  }", fails: 'brief' },
  { name: 'a seated figure walks out without standing up first', file: 'public/js/ofis.js', from: 'if (c.path) c.standT = stand ? STAND_S : 0;', to: 'if (c.path) c.standT = 0;', fails: ['brief', 'leave'] },
  { name: 'the door of a vacant office stays a drawn box while its person walks out', file: 'public/js/ofis.js', from: 'buildShell(B, g, X, Z, W, D, th, it.door, !open)', to: 'buildShell(B, g, X, Z, W, D, th, it.door, true)', fails: 'leave' },
  { name: 'a figure that comes back while it walks out is left to leave', file: 'public/js/ofis.js', from: "      } else if (chef.after === 'gone') comeBack(chef, room);", to: "      } else if (false) comeBack(chef, room);", fails: 'flap' },
  { name: 'a sub-agent that is working again is left to leave', file: 'public/js/ofis.js', from: "if (c.after === 'gone') comeBack(c, room);", to: "if (false) comeBack(c, room);", fails: 'flap' },
  { name: 'a rebuild seats the people who are still walking', file: 'public/js/ofis.js', from: "      if (walking) {\n        if (moved) startWalk(c, repath(route, pos, out ? 'entrance' : 'seat'), c.after);\n        continue;\n      }", to: "      if (walking) {\n        if (!out) { const e = route[route.length - 1]; pos.x = e.x; pos.z = e.z; c.path = null; c.mode = 'seated'; c.after = null; }\n        continue;\n      }", fails: 'rebuild' },
  { name: 'a rebuild drops the people whose walk changed', file: 'public/js/ofis.js', from: "        if (moved) startWalk(c, repath(route, pos, out ? 'entrance' : 'seat'), c.after);", to: "        if (moved) { removeChar(c); continue; }", fails: 'rebuild' },
  { name: 'a sub-agent taken out of the data while it walks in is removed on the spot', file: 'public/js/ofis.js', from: "      else if (c.mode === 'walk' && c.path) turnAround(c);", to: "      else if (c.mode === 'walk' && c.path) removeChar(c);", fails: 'hidden' },
  { name: 'the name label stays where the figure was made', file: 'public/js/ofis.js', from: '    c.tag.pos.set(pos.x, 0, pos.z);\n    if (c.pk) applyPack(c);', to: "    if (c.mode !== 'walk') c.tag.pos.set(pos.x, 0, pos.z);\n    if (c.pk) applyPack(c);", fails: 'follow' },
  { name: 'the card is not placed again after each frame', file: 'public/js/ofis.js', from: "        placeLabels();\n        ui.card.place();", to: "        placeLabels();", fails: 'follow' },
  { name: 'settle does nothing', file: 'public/js/ofis.js', from: '        n++;\n        finishWalk(c);', to: '        n++;', fails: 'settle' },
  { name: 'the app calls settle', file: 'public/js/ofis.js', from: "    if (born.length) {\n      for (const b of born)", to: "    if (born.length) {\n      setTimeout(() => root.__ofis.settle(), 60000);\n      for (const b of born)", fails: 'settle' },
  { name: 'reduced motion keeps the bounce of the step', file: 'public/js/ofis.js', from: "pose === 'walk' && !atmosphere.state.reducedMotion ?", to: "pose === 'walk' ?", fails: 'reduced' },
  { name: '?arrive=calm is ignored', file: 'public/js/ofis.js', from: "{ rush: instant && !CALM_LOAD }", to: "{ rush: instant }", fails: 'calm' },
];

async function runMutations() {
  const rows = [];
  for (const m of MUTATIONS.filter(x => !val('mutation') || val('mutation').split('|').some(w => x.name.includes(w)))) {
    const dir = mkdtempSync(join(tmpdir(), 'cco-mutw-'));
    try {
      for (const f of readdirSync(ROOT).filter(n => /\.(js|json)$/.test(n) && n !== 'package-lock.json')) cpSync(join(ROOT, f), join(dir, f));
      cpSync(join(ROOT, 'public'), join(dir, 'public'), { recursive: true });
      const file = join(dir, m.file), text = readFileSync(file, 'utf8');
      if (!text.includes(m.from)) { rows.push({ m, caught: false, detail: 'the line to break was not found' }); console.log(`MUTATION MISSED ${m.fails}: ${m.name} -> the line to break was not found`); continue; }
      writeFileSync(file, text.replace(m.from, m.to));
      const want = [].concat(m.fails), got = [];
      for (const k of want) {
        let r;
        try { r = await CHECKS[k]({ root: dir }); } catch (e) { await sleep(2000); r = await CHECKS[k]({ root: dir }); }        // a run that throws (the harness, the server) is run once more: only a result counts
        got.push(r.find(x => x.name === NAME[k]));
      }
      rows.push({ m, caught: got.every(r => r && !r.ok), detail: got.map((r, i) => (r ? `${NAME[want[i]]} ${r.ok ? 'PASSED' : 'FAILED'}: ${r.detail.slice(r.ok ? 0 : Math.max(0, r.detail.indexOf('PROBLEMS')), (r.ok ? 0 : Math.max(0, r.detail.indexOf('PROBLEMS'))) + 200)}` : `${NAME[want[i]]} did not run`)).join(' || ') });
    } catch (e) {
      rows.push({ m, caught: false, detail: `the run threw twice, so nothing was read: ${String(e.message || e).slice(0, 160)}` });
    } finally { rmSync(dir, { recursive: true, force: true }); }
    const last = rows[rows.length - 1];
    console.log(`MUTATION ${last.caught ? 'CAUGHT' : 'MISSED'} ${m.fails}: ${m.name} -> ${last.detail}`);
  }
  return rows;
}

// ---- main
if (args.includes('--verify-mutations')) {            // every line to break is there exactly once (no QA run: after a change to ofis.js that moves or rewrites one)
  let bad = 0;
  for (const m of MUTATIONS) {
    const n = readFileSync(join(ROOT, m.file), 'utf8').split(m.from).length - 1;
    if (n !== 1) { bad++; console.log(`MUTATION LINE ${n === 0 ? 'NOT FOUND' : 'FOUND ' + n + ' TIMES'}: ${m.name}`); }
  }
  console.log(bad ? `MUTATION LINES BAD ${bad} of ${MUTATIONS.length}` : `MUTATION LINES OK (${MUTATIONS.length})`);
  process.exit(bad ? 1 : 0);
}
const report2 = [];
const show = r => { report2.push(r); console.log(`CHECK ${r.name} ${r.ok ? 'PASS' : 'FAIL'} ${r.detail}`); };
if (args.includes('--mutations')) {
  const rows = await runMutations();
  const missed = rows.filter(r => !r.caught);
  console.log(missed.length ? `MUTATIONS MISSED ${missed.length} of ${rows.length}` : `MUTATIONS ALL CAUGHT (${rows.length})`);
  process.exit(missed.length ? 1 : 0);
}
for (const k of Object.keys(CHECKS)) if (!only || only === k) for (const r of await CHECKS[k]({ root: undefined })) show(r);
const bad = report2.filter(r => !r.ok);
console.log(bad.length ? `QA FAIL (${bad.length} of ${report2.length} checks)` : `QA PASS (${report2.length} checks)`);
process.exit(bad.length ? 1 : 0);
