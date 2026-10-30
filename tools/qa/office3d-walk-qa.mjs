// QA of the walkers: nothing in the 3D scene appears or disappears inside a room (public/js/ofis.js, public/js/ofis-arrive.js). Headless Chrome with software WebGL in a throw-away
// profile (harness3d.mjs), the server against a fake ~/.claude, one `CHECK <name> PASS|FAIL <detail>` line per check and a final `QA PASS` or `QA FAIL`.
//   node tools/qa/office3d-walk-qa.mjs [--only load|calm|brief|leave|flap|rebuild|growout|seats|turnback|reseat|hidden|follow|settle|reduced] [--mutations [--mutation <words>|<more words>]] [--verify-mutations]
//
// How it sees: the scene's recorder (s.rec, started the moment the scene exists: harness3d.mjs recordFromStart) has the creation, every frame and the removal of every figure, with the
// frame's step. A check that changes the data itself does it in the page, on the store (a copy of a chat, a sub-agent, a status), and asks the scene to update (s.sync()), so that the
// moment of every change is the check's, not the server's one-second tick; three checks use the real server and the fake ~/.claude files (a closed chat, a finished sub-agent, the load).
//
//   3d-walk-load     the page opens with 10 chats: every figure's first position is at the entrance (within 1 unit of the hall's lane end) and never inside a room, a figure that waits for its
//                    turn is not drawn, they leave the entrance one after the other (0.2 to 0.4 s apart, all within 4 s), everybody is in their seat within about 10 s of the scene's own time
//                    (a queue of more than four is hurried), the doors open for the chief and everybody else, no figure ever moves more than speed x pace x step x 1.5 (no teleport), the camera
//                    does not move, nobody is in the scene twice, the labels match the figures and nobody shares a seat, and the bounce of the step is there
//   3d-walk-calm     ?arrive=calm: the same page load at the normal pace for everybody
//   3d-walk-brief    a sub-agent whose job ends 0.7 s after it came, a burst of five that end before most of them have left the entrance, a chat that ends 0.5 s and one that ends 2 s after it came,
//                    and one that comes and ends within one sync: each turns around where it stands, walks back out and is removed at the entrance, never seen at its seat, no seat stays taken
//   3d-walk-leave    a chat that closes (the real server) while its chief and two sub-agents sit: they stand up (and stand still while they do), walk the way they came, the door of the office
//                    that is vacant now opens for them, they are removed at the entrance, and a sub-agent that finishes leaves too, after its 4.5 s
//   3d-walk-flap     appears, ends, appears again: a chat and a sub-agent come back while they walk out, one figure each, seated at the end, no stuck seat, no ghost label
//   3d-walk-rebuild  the 20th chat adds a bay and moves the entrance while 30 people are walking in: nobody jumps, nobody is dropped, everybody is seated at the end
//   3d-walk-growout  the building grows (the entrance moves 14 units) while a closed chat's chief and sub-agent walk out of their vacant office: they go on to today's entrance
//   3d-walk-seats    a chat with 12 sub-agents (an office with desks, lounge seats and stools): all 13 walk in and sit on their own seat (every reading inside the office keeps 0.2 m from the
//                    furniture, nobody jumps, each ends facing as its seat does with its hip at that seat's cushion, nobody shares a seat); the chat closes and all stand up on the spot where
//                    they sit and walk out clear of the furniture, to the entrance
//   3d-walk-turnback twelve jobs and a chat end while the person is inside the office, each a little deeper in than the one before: the walk back is the way it came in, clear of the furniture
//   3d-walk-reseat  a sub-agent walking out of its seat is wanted again, a newcomer has taken that seat: it goes back along the way out and in along the route of another seat, not
//                    straight through the table (a pair of seats of an arrangement where the straight line does cut through furniture)
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
import { distToPoly } from '../../public/js/ofis-geom.js';
import { repath, rejoin } from '../../public/js/ofis-arrive.js';

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
  // a figure that waits for its turn at the entrance is not drawn; the first frame it is drawn in is at the entrance too (jumps() does not look at the step from not drawn to drawn)
  const shown = list.find(e => e.vis !== false);
  if (shown && shown !== first && !nearAny(offs, shown.x, shown.z, 1.3)) bad.push(`${short(first.id)}: first drawn at (${f1(shown.x)}, ${f1(shown.z)}), not at the entrance`);
  if (removed) {
    if (last.k !== 'remove') bad.push(`${short(first.id)}: never removed (last event ${last.k})`);
    else if (!nearAny(offs, last.x, last.z, 1.3)) bad.push(`${short(first.id)}: removed at (${f1(last.x)}, ${f1(last.z)}), not at the entrance`);
    else if (offs.some(o => inRoom(o, last.x, last.z))) bad.push(`${short(first.id)}: removed inside a room`);
  }
  return bad;
}
// the scene's own books: nobody is in the scene graph twice or after removal, every label and balloon belongs to a figure, nobody sits on a seat that another figure sits on, and every
// seat in use has the figure whose seat it is (there is no chair of a figure's own any more: the seats are the room's furniture and stay where they are when a person gets up)
async function books(page) {
  const r = await ev(page, '({ roots: o.roots(), desks: o.seats(), figs: o.figures().map(f => ({ id: f.id, main: f.main, mode: f.mode, x: f.x, z: f.z })) })');
  const bad = [], ids = r.figs.map(f => f.id), set = new Set(ids);
  const same = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
  if (new Set(r.roots.ids).size !== r.roots.ids.length) bad.push('a figure is in the scene twice');
  const orphan = r.roots.where.filter(w => !w.own);
  if (orphan.length) bad.push(`${orphan.length} figures stay in the scene after they were removed (${orphan.slice(0, 2).map(w => `${short(w.id)} at ${f1(w.x)}, ${f1(w.z)}`).join('; ')})`);
  if (!same(r.roots.ids, ids)) bad.push(`the scene holds ${r.roots.ids.length} figures, the data ${ids.length} (${[...new Set([...r.roots.ids.filter(i => !set.has(i)), ...ids.filter(i => !r.roots.ids.includes(i))])].map(short).slice(0, 3).join(', ')})`);
  if (!same(r.roots.tags, ids)) bad.push(`${r.roots.tags.length} name labels for ${ids.length} figures`);
  if (r.roots.balloons.length !== ids.length) bad.push(`${r.roots.balloons.length} balloons for ${ids.length} figures`);
  const sitting = r.figs.filter(f => f.mode === 'seated');
  for (let i = 0; i < sitting.length; i++) for (let j = i + 1; j < sitting.length; j++) if (Math.hypot(sitting[i].x - sitting[j].x, sitting[i].z - sitting[j].z) < 0.3) bad.push(`${short(sitting[i].id)} and ${short(sitting[j].id)} sit on the same seat`);
  for (const room of r.desks.rooms) room.seats.forEach((id, i) => {
    if (!id) return;
    const f = r.desks.figures.find(x => x.id === id);
    if (!f || f.slot !== i || f.room !== room.id) bad.push(`seat ${i} of ${short(room.id)} is taken by ${short(id)}, who ${f ? `has seat ${f.slot} of ${short(f.room)}` : 'is gone'}`);
  });
  for (const f of r.desks.figures) if (f.slot >= 0) {
    const room = r.desks.rooms.find(x => x.id === f.room);
    if (!room || room.seats[f.slot] !== f.id) bad.push(`${short(f.id)} has seat ${f.slot} that is not marked as its own`);
  }
  return bad;
}
// every figure of the page is seated on its seat as the room has it (o.seatOf: the room's own geometry, not the end of the figure's route, which is where the figure goes by
// construction: a route that ends 0.8 away from the seat must fail here)
async function seated(page) {
  const r = await ev(page, 'o.figures().map(f => ({ id: f.id, mode: f.mode, after: f.after, x: f.x, z: f.z, seat: o.seatOf(f.id) }))');
  return r.filter(f => f.mode !== 'seated' || !f.seat || Math.hypot(f.x - f.seat.x, f.z - f.seat.z) > 0.1).map(f => `${short(f.id)} is ${f.mode}${f.after ? ' ' + f.after : ''} at (${f1(f.x)}, ${f1(f.z)}), seat ${f.seat ? `(${f1(f.seat.x)}, ${f1(f.seat.z)})` : 'unknown'}`);
}
const report = (name, problems, text) => make(name, problems.length === 0, `${text}${problems.length ? '; PROBLEMS: ' + problems.slice(0, 5).join(' | ') + (problems.length > 5 ? ` (and ${problems.length - 5} more)` : '') : ''}`);

// ---- 3d-walk-load
// The entrance clock (public/js/ofis.js): sub-agents of a chat that come over three polls, 0.4 s and 0.3 s apart, are three queues, and the figures of a later queue leave a stagger after
// the last of the one before (a queue's own stagger and pace plan, ofis-arrive.js, know nothing of another). Read on the page once it has settled, from the recorder: the times the five
// figures are first drawn (at least 0.25 s apart: the frames are 0.1 to 0.125 s) and, frame by frame, how close two of them ever are.
async function queues(page) {
  const problems = [];
  await page.evaluate(HELPERS);
  await qa(page, `q.chat('qhost'); q.sync();`);
  await ev(page, 's.settle()');
  await sleep(900);
  await ev(page, 's.rec.take().length');
  await qa(page, `q.sub('qhost', 'qa-0'); q.sub('qhost', 'qa-1'); q.sub('qhost', 'qa-2'); q.sync();`);
  await sleep(400);
  await qa(page, `q.sub('qhost', 'qb-0'); q.sync();`);
  await sleep(300);
  await qa(page, `q.sub('qhost', 'qc-0'); q.sync();`);
  const ids = ['qa-0', 'qa-1', 'qa-2', 'qb-0', 'qc-0'];
  if (!(await idle(page))) problems.push('the sub-agents of the three queues were still walking after 2 minutes');
  const rec = await ev(page, 's.rec.take()');
  const lists = byId(rec);
  const shown = ids.map(id => { const e = (lists.get(id) || []).find(x => x.vis !== false); return e ? e.t : null; });
  if (shown.some(t => t === null)) problems.push(`${shown.filter(t => t === null).length} of the 5 sub-agents of the three queues were never drawn`);
  const ts = shown.filter(t => t !== null).sort((a, b) => a - b), gaps = ts.slice(1).map((t, i) => t - ts[i]);
  if (gaps.length && Math.min(...gaps) < 250) problems.push(`two sub-agents of different queues left the entrance ${f1(Math.min(...gaps))} ms apart (want 250 or more)`);
  // frame by frame: a frame ends where one of the figures comes again
  const frames = []; let cur = new Map();
  for (const e of rec) { if (e.k !== 'frame' || !ids.includes(e.id)) continue; if (cur.has(e.id)) { frames.push(cur); cur = new Map(); } cur.set(e.id, e); }
  frames.push(cur);
  let closest = 9;
  for (const fr of frames) {
    const v = [...fr.values()].filter(e => e.vis !== false && e.mode === 'walk');
    for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) closest = Math.min(closest, Math.hypot(v[i].x - v[j].x, v[i].z - v[j].z));
  }
  if (closest < 0.12) problems.push(`two sub-agents of the three queues walked ${closest.toFixed(2)} units apart (they walk through each other; want 0.12 or more)`);
  for (const id of ids) { const l = lists.get(id); if (l) problems.push(...jumps(l)); }
  problems.push(...(await books(page)), ...(await seated(page)));
  return { problems, note: `three queues (3, 1 and 1 sub-agents, 0.4 s and 0.3 s apart): left the entrance at least ${f1(gaps.length ? Math.min(...gaps) : 0)} ms apart, the closest two were ${closest.toFixed(2)} units apart, all seated` };
}

// While the figures walk in, the page is read every 120 ms: the camera, and the doors next to a walking chief (the chief's own door must be open when it is in the doorway).
async function runLoad(ctx) {
  const problems = [];
  const S = await scenario3d(10, { tag: 'wload', root: ctx.root, width: 1100, height: 700, settle: false, intercept: recordFromStart });
  try {
    const { page } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    const cam0 = await ev(page, '[s.zoom, ...s.project(0, 0, 0)]');
    let cam = cam0, camMoved = 0, doorSamples = 0, doorOpen = 0, subDoorSamples = 0, subDoorOpen = 0, samples = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      const r = await ev(page, '({ walking: s.walking.length, cam: [s.zoom, ...s.project(0, 0, 0)], doors: o.doors(), figs: o.figures().map(f => [f.id, f.main, f.mode, f.x, f.z, f.vis]) })');
      samples++;
      cam = r.cam;
      if (cam.some((v, i) => Math.abs(v - cam0[i]) > 0.01)) camMoved++;
      for (const d of r.doors) {
        const chief = r.figs.find(f => f[0] === d.id && f[1] && f[2] === 'walk' && f[5]);
        if (chief && Math.abs(chief[3] - d.x) < 0.6 && Math.abs(chief[4] - d.z) < 0.8) { doorSamples++; if (d.open >= 0.3) doorOpen++; }
        // a sub-agent in a doorway, with no chief near enough to be the one who opened it: the door is open for the sub-agent as well
        const sub = r.figs.find(f => !f[1] && f[2] === 'walk' && f[5] && Math.abs(f[3] - d.x) < 0.6 && Math.abs(f[4] - d.z) < 0.8);
        if (sub && !r.figs.some(f => f[1] && f[2] === 'walk' && f[5] && Math.abs(f[3] - d.x) < 1.8 && Math.abs(f[4] - d.z) < 2.0)) { subDoorSamples++; if (d.open >= 0.3) subDoorOpen++; }
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
    if (subDoorSamples < 3) problems.push(`only ${subDoorSamples} readings of a sub-agent in a doorway (nothing to judge the doors by)`);
    else if (subDoorOpen / subDoorSamples < 0.9) problems.push(`the door was open in ${subDoorOpen} of ${subDoorSamples} readings of a sub-agent in its doorway`);
    if (camMoved) problems.push(`the camera moved in ${camMoved} of ${samples} readings`);
    problems.push(...(await books(page)), ...(await seated(page)));
    const q2 = await queues(page);
    problems.push(...q2.problems);
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return [report('3d-walk-load', problems,
      `${all.length} figures (${all.filter(l => l[0].main).length} chiefs) made at the entrance at ${f1(delays[0])} to ${delays[delays.length - 1].toFixed(2)} s, ${f1(Math.min(...gaps) * 1000)} to ${f1(Math.max(...gaps) * 1000)} ms apart, ${hurried} hurried (up to ${Math.max(...Object.values(st.paces)).toFixed(1)} times), `
      + `all seated after ${lastArrival.toFixed(1)} s of the scene's time (earliest ${Math.min(...arrive).toFixed(1)}), ${all.reduce((n, l) => n + l.length, 0)} events and no jump, ${doorOpen} of ${doorSamples} readings with the chief's door open and ${subDoorOpen} of ${subDoorSamples} with a sub-agent's, step bounce ${f1((Math.max(...hy) - Math.min(...hy)) * 100)} cm, the camera stayed; ${q2.note}`)];
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
    const seats0 = (await ev(page, 'o.seats()')).rooms.find(r => r.id === chat1).seats;
    const brief = [];
    // a sub-agent that sits and is taken out of the data (not just done): it stands up and walks out, it does not vanish from its seat
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
    // the seat of a figure that turned round is free at once (not when it is out): none of the chat's taken seats is held by a figure that is walking out
    const held = await ev(page, `(() => { const r = o.seats().rooms.find(r => r.id === ${JSON.stringify(chat1)}), fs = o.figures(); return r.seats.filter(Boolean).filter(id => { const f = fs.find(f => f.id === id); return f && f.after === 'gone'; }); })()`);
    if (held.length) problems.push(`${held.length} seats of the chat are held by figures that have turned round (${held.slice(0, 2).join(', ')})`);
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
    if (!sOut.length || !sOut[0].stand) problems.push('the sub-agent that was taken out of the data did not stand up and walk out from its seat');
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
    // no seat stays taken: the next sub-agent of the chat takes the first seat that the first of the burst had
    const free = (await ev(page, 'o.seats()')).rooms.find(r => r.id === chat1).seats;
    if (free.some(Boolean)) problems.push(`the seats of the chat are still taken after the burst: ${JSON.stringify(free)} (before ${JSON.stringify(seats0)})`);
    await qa(page, `q.sub(${JSON.stringify(chat1)}, 'after-burst'); q.sync();`);
    const after = (await ev(page, 'o.seats()')).rooms.find(r => r.id === chat1).seats;
    if (after[0] !== 'after-burst') problems.push(`the next sub-agent sat at seat ${after.indexOf('after-burst')}, not the first (${JSON.stringify(after)})`);
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
    const mine = [pick.id, ...pick.subs.map(s => s.id)];
    const room = await roomOf(page, pick.id), keys = await seatKeys(page);                 // the office's furniture and the seat of each of them, read while they sit
    const paces0 = await ev(page, 's.pace');                                                      // (the page load hurried this crowd: they walked in at more than the normal pace)
    if (!mine.some(id => paces0[id] > 1)) problems.push('nobody of the chat was hurried at the page load, so the pace of the walk out proves nothing');
    fx.closeSession(pick.id);
    let doorSamples = 0, doorOpen = 0, subSamples = 0, subOpen = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      const r = await ev(page, '({ doors: o.doors(), figs: o.figures().map(f => [f.id, f.main, f.mode, f.x, f.z]) })');
      for (const d of r.doors) {
        if (!d.vacant || d.slot !== slotOf(pick.id).slot) continue;
        const chief = r.figs.find(f => f[0] === pick.id && f[2] === 'walk');
        if (chief && Math.abs(chief[3] - d.x) < 0.6 && Math.abs(chief[4] - d.z) < 0.8) { doorSamples++; if (d.open >= 0.3) doorOpen++; }
        // the sub-agents of the chat walk out through the same door: it is open for them as well (a reading counts when no chief is near enough to be the one who opened it)
        const sub = r.figs.find(f => f[0] !== pick.id && mine.includes(f[0]) && f[2] === 'walk' && Math.abs(f[3] - d.x) < 0.6 && Math.abs(f[4] - d.z) < 0.8);
        if (sub && !(chief && Math.abs(chief[3] - d.x) < 1.8 && Math.abs(chief[4] - d.z) < 2.0)) { subSamples++; if (d.open >= 0.3) subOpen++; }
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
      problems.push(...crossings(l, room, keys.get(id), short(id)).bad);
      const out = l.filter(e => e.k === 'frame' && e.after === 'gone');
      if (!out.length) { problems.push(`${short(id)}: never walked out`); continue; }
      if (out[0].mode !== 'walk' || !out[0].stand) problems.push(`${short(id)}: it started walking out without standing up first`);
      const fast = out.filter(e => e.pace !== 1);
      if (fast.length) problems.push(`${short(id)}: it walked out at ${fast[0].pace} times the normal pace (it was hurried when it came in on the page load, a walk out is at the normal pace)`);
      // it stands still while it stands up: for at least 0.25 s of the scene's time the position does not change
      const still = []; for (const e of out) { if (!e.stand) break; still.push(e); }
      const stillT = still.reduce((s, e) => s + e.dt, 0);
      if (stillT < 0.25 || still.some(e => Math.hypot(e.x - out[0].x, e.z - out[0].z) > 0.02)) problems.push(`${short(id)}: stood still for ${stillT.toFixed(2)} s while getting up (want at least 0.25)`);
      else stood++;
      if (!(out.at(-1).sit < 0.2)) problems.push(`${short(id)}: still sitting when it left (sit ${out.at(-1).sit})`);
      if (!inRoom(off0, out[0].x, out[0].z)) problems.push(`${short(id)}: it got up outside its room at (${f1(out[0].x)}, ${f1(out[0].z)})`);
    }
    if (!st.office.slots[slotOf(pick.id).slot].vacant) problems.push('the office is not vacant after its chat closed');
    if (hinged) {
      if (doorSamples < 2) problems.push(`only ${doorSamples} readings of the chief in the doorway of the vacant office`); else if (doorOpen / doorSamples < 0.9) problems.push(`the door of the vacant office was open in ${doorOpen} of ${doorSamples} readings of the chief in its doorway`);
      if (subSamples < 2) problems.push(`only ${subSamples} readings of a sub-agent in the doorway of the vacant office`); else if (subOpen / subSamples < 0.9) problems.push(`the door of the vacant office was open in ${subOpen} of ${subSamples} readings of a sub-agent in its doorway`);
    }
    problems.push(...(await books(page)));
    // a sub-agent that finishes sits for 4.5 s (the check mark), then stands up and walks out
    const other = fx.agents.find(a => a.id !== pick.id), sub = other.subs[0];
    await ev(page, 's.rec.take().length');
    const tFinish = Date.now();
    fx.finishSub(sub.id);
    // the page clock at the moment the data says it is done (the scene sits it out for 4.5 s of that clock, then it stands up: the scene's own record of that moment, `doneAt` in the
    // recorder, is what the wait is measured from, so that the lag of this poll can't move it)
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
    const seatedFor = out2 && out2.doneAt ? (out2.t - out2.doneAt) / 1000 : 0;
    if (!out2) problems.push('the finished sub-agent never walked out');
    else if (!out2.stand) problems.push('the finished sub-agent started walking out without standing up first');
    else if (!out2.doneAt) problems.push('the recorder has no time at which the data said the sub-agent was done');
    // the frame-clock sweep (step in ofis.js) stands it up within 0.5 s of its 4.5 s plus a frame: without it the sub-agent sits until the next update from the data (8 s was measured)
    else if (seatedFor < 4.45 || seatedFor > 5.8) problems.push(`the finished sub-agent stood up ${seatedFor.toFixed(2)} s after the data said it was done (want its 4.5 s of sitting plus at most the 0.5 s step of the frame-clock sweep and a frame: 4.45 to 5.8)`);
    if (l2.length && l2.at(-1).k !== 'remove') problems.push('the finished sub-agent was not removed');
    else if (l2.length && !nearAny([off0, st.office], l2.at(-1).x, l2.at(-1).z, 1.3)) problems.push('the finished sub-agent was removed away from the entrance');
    problems.push(...jumps(l2));
    problems.push(...(await books(page)));
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return [report('3d-walk-leave', problems, `the chat closed with its chief and ${pick.subs.length} sub-agents seated: ${stood} of ${mine.length} stood up first (still for 0.25 s or more), walked out clear of the office's furniture and were removed at the entrance with no jump, the vacant office is vacant, ${hinged ? `its door was open in ${doorOpen} of ${doorSamples} readings of the chief in the doorway and ${subOpen} of ${subSamples} of a sub-agent` : 'its door is an opening'}; a finished sub-agent sat ${seatedFor.toFixed(1)} s after the data said it was done, then stood up, walked out and was removed at the entrance (${((Date.now() - tFinish) / 1000).toFixed(0)} s on the wall clock in all)`)];
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
    return [report('3d-walk-flap', problems, `a chat and a sub-agent flapped with time to walk (end, back 0.5 s later): ${cameBack} of 2 came back while walking out, as the same figure; two flapped within single syncs, still at the entrance (${counts}); all ended seated at their seats, ${st.figs.length} figures in the scene and in the data, no duplicate, label or balloon left over, no seat stuck`)];
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
    // the 28 figures leave the entrance 0.35 s apart (a queue that is not hurried keeps its stagger, however long it is): wait until a dozen are drawn and on the way
    await until(async () => (await ev(page, 'o.figures().filter(f => f.mode === "walk" && f.vis).length')) >= 12, 30000, 150);
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

// ---- 3d-walk-growout
// ?rooms=19 with 19 chats; one of them (a chief and a sub-agent) is taken out of the data and the two stand up and walk out of their vacant office, a long walk. While they are on the
// way two more chats open: the 20th adds a bay and the entrance moves 14 units. The route of the two was made for the building as it was (it ends at the old entrance), and their
// office was vacant already at the earlier rebuild, so nothing of it is left but that route: they must walk on to the entrance of the building as it is now and be removed there,
// not 14 units short of it, in the open and at full size.
async function runGrowOut(ctx) {
  const problems = [];
  const S = await scenario3d(4, { tag: 'wgrowout', root: ctx.root, width: 900, height: 560, query: 'rooms=19', intercept: recordFromStart, fixture: { statuses: ['working', 'working', 'working', 'working'], subs: i => (i === 0 ? ['working'] : []) } });
  try {
    const { page } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    await page.evaluate(HELPERS);
    await qa(page, `q.chat('v1'); q.sub('v1', 'v1-sub'); for (let i = 1; i <= 14; i++) q.chat('g' + i); q.sync();`);
    await ev(page, 's.settle()');
    await sleep(900);
    const off0 = await ev(page, 'o.office()');
    const room = await roomOf(page, 'v1'), keys = await seatKeys(page);                       // the office they walk out of, and their seats
    await ev(page, 's.rec.take().length');
    const leaving = ['v1', 'v1-sub'];
    await qa(page, `q.remove('v1'); q.sync();`);
    const up = await until(async () => ev(page, `o.figures().filter(f => ${JSON.stringify(leaving)}.includes(f.id) && f.after === 'gone' && f.mode === 'walk').length === 2`), 20000, 100);
    if (!up) problems.push('the chief and the sub-agent of the closed chat did not both start to walk out');
    await sleep(1800);                                                                         // they are on the hall by now, far from the entrance
    const before = await ev(page, `o.figures().filter(f => ${JSON.stringify(leaving)}.includes(f.id)).map(f => [f.id, f.x, f.z, f.mode, f.after])`);
    await qa(page, `q.chat('x1'); q.chat('x2'); q.sync();`);
    const grown = await ev(page, '({ office: o.office(), builds: o.builds })');
    if (grown.office.entryX <= off0.entryX + 1) problems.push(`the building did not grow to the right (entrance ${f1(off0.entryX)} to ${f1(grown.office.entryX)}): the case was not made`);
    const onTheWay = before.filter(f => f[3] === 'walk' && f[4] === 'gone');
    if (onTheWay.length < 2) problems.push(`${onTheWay.length} of the 2 leavers were walking out when the building grew`);
    if (!(await idle(page))) problems.push('somebody was still walking after 2 minutes');
    const st = await ev(page, '({ rec: s.rec.take(), office: o.office(), figs: o.figures().map(f => f.id) })');
    const lists = byId(st.rec);
    const at = [];
    for (const id of leaving) {
      const l = lists.get(id);
      if (!l) { problems.push(`${id}: not recorded`); continue; }
      const last = l[l.length - 1];
      if (last.k !== 'remove') { problems.push(`${id}: never removed (last event ${last.k})`); continue; }
      at.push(`${short(id)} at ${f1(last.x)}`);
      problems.push(...crossings(l, room, keys.get(id), short(id)).bad);
      if (!near(st.office, last.x, last.z, 1.3)) problems.push(`${short(id)}: removed at (${f1(last.x)}, ${f1(last.z)}), ${f1(st.office.entryX - last.x)} units short of the entrance of the building as it is now (${f1(st.office.entryX)}; it was ${f1(off0.entryX)})`);
      if (inRoom(st.office, last.x, last.z)) problems.push(`${short(id)}: removed inside a room`);
      if (last.x < off0.entryX + 2) problems.push(`${short(id)}: removed at the old entrance (${f1(off0.entryX)})`);
      problems.push(...jumps(l));
    }
    if (st.figs.some(id => leaving.includes(id))) problems.push('a leaver is still in the scene');
    for (const id of ['x1', 'x2']) if (!st.figs.includes(id)) problems.push(`${id} is missing from the scene at the end`);
    problems.push(...(await books(page)));
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return [report('3d-walk-growout', problems, `${off0.bays} to ${st.office.bays} bays, the entrance moved ${f1(off0.entryX)} to ${f1(grown.office.entryX)} while the chief and the sub-agent of a closed chat walked out of their vacant office: both went on to the entrance of today and were removed there (${at.join(', ')}), no jump, and the part of the walk inside the office, which is the route of the old building as it was, kept clear of its furniture`)];
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
    // the free part of the view: the figure is judged only while it is in it. The chief keeps walking, and once it is behind the top bar or off the stage there is no card or label
    // to compare it with (the card sits against the bottom of the bar): a reading there says nothing about the following, and how many such readings the loop took depended on the
    // machine's load, which made this check pass or fail by it
    const free = await ev(page, '(() => { const c = v.__ofisUi.covered(), [w, h] = s.size; return { x0: 20, x1: w - c.right - 20, y0: c.top + 8, y1: h - 20 }; })()');
    const inFree = at => !!at && at[0] >= free.x0 && at[0] <= free.x1 && at[1] >= free.y0 && at[1] <= free.y1;
    const figAt = () => ev(page, `(() => { const f = o.figures().find(f => f.id === ${JSON.stringify(chat.id)}); return f ? [f.x, f.z] : null; })()`);
    const tagSel = id => `.of-l.of-tagl[data-id="${id}"]`, ballSel = id => `.of-l.of-ball[data-id="${id}"]`;
    const readLabel = (id, sel) => page.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(sel(id))}); if (!e) return null; const r = e.getBoundingClientRect(), a = document.querySelector('#view-ofis .of-stage').getBoundingClientRect(); return { visible: e.style.visibility === 'visible', x: r.left + r.width / 2 - a.left, y: r.top + r.height / 2 - a.top }; })()`);
    const labels = { tag: 0, tagOk: 0, ball: 0, ballOk: 0 }, camMoved = [];
    let first = null, last = null;
    for (let i = 0; i < 14; i++) {
      const at = await ev(page, `s.charScreen(${JSON.stringify(chat.id)})`), mode = await ev(page, `(o.figures().find(f => f.id === ${JSON.stringify(chat.id)}) || {}).mode`);
      if (!at || mode !== 'walk' || !inFree(at)) break;
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
    // hover: the tooltip of the agent appears on a walking figure; click: the card opens beside it and follows it. The camera goes 5 units ahead of the chief on its way (two readings
    // of its place tell the way), so that it walks through the middle of the view while the card is open
    const a0 = await figAt();
    await sleep(300);
    const a1 = await figAt();
    let lead = a1 || [pick.x, pick.z];
    if (a0 && a1) { const dx = a1[0] - a0[0], dz = a1[1] - a0[1], d = Math.hypot(dx, dz); if (d > 0.05) lead = [a1[0] + dx / d * 5, a1[1] + dz / d * 5]; }
    await ev(page, `o.view(${lead[0]}, 0.6, ${lead[1]}, 40)`);
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
        if (!c.open || !at || !inFree(at)) break;
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

// ---- the furniture: a walk inside an office keeps clear of every piece, for every walk the people make (the rooms' promise, tools/qa/office3d-cowork-qa.mjs 3d-cowork-paths, which
// reads the route of every seat; here the people are followed on the scene's own frames). o.arrange(id) is the office's own arrangement in office-local metres, o.room(id) its box.
const CLEAR = 0.2, AT_SEAT = 0.85;          // metres a walk keeps from every piece of furniture, and the stretch next to the figure's own seat (the last leg onto it, the first off it) that touches the seat's own furniture
const roomOf = async (page, id) => ({ box: await ev(page, `o.room(${JSON.stringify(id)})`), arr: await ev(page, `o.arrange(${JSON.stringify(id)})`) });
const seatPoint = (arr, key) => { const s = arr.seats.find(x => x.key === key); return s ? s.pos : null; };
const seatKeys = async page => {                                    // figure id -> the key of its seat in o.arrange: 'chef' for the chat's own, the slot of a sub-agent (read while it still has one)
  const d = await ev(page, 'o.seats()'), m = new Map();
  for (const r of d.rooms) m.set(r.id, 'chef');
  for (const f of d.figures) if (f.slot >= 0) m.set(f.id, f.slot);
  return m;
};
// the readings of one figure inside the office that come nearer than CLEAR to a piece of furniture (not next to a seat of its own, `key`: one or more seat keys; not while it sits):
// { bad: [text], inside: how many readings of it walking were in the office }
function crossings(list, room, key, tag) {
  const bad = [], seats = [].concat(key).map(k => seatPoint(room.arr, k)).filter(Boolean);
  let inside = 0;
  for (const e of list) {
    if (e.k !== 'frame' || e.vis === false || e.mode === 'seated') continue;
    const x = e.x - room.box.X, z = e.z - room.box.Z;
    if (!(x > 0.1 && x < room.box.W - 0.1 && z > 0.1 && z < room.box.D - 0.1)) continue;
    inside++;
    if (seats.some(seat => Math.hypot(x - seat[0], z - seat[1]) < AT_SEAT)) continue;
    for (const o of room.arr.obstacles) {
      const d = distToPoly(x, z, o.poly);
      if (d < CLEAR - 0.05) { bad.push(`${tag}: ${d.toFixed(2)} m from ${o.id} at ${x.toFixed(2)}, ${z.toFixed(2)} (${e.after === 'gone' ? 'walking out' : 'walking in'})`); break; }
    }
    if (bad.length) break;
  }
  return { bad, inside };
}
const turnDiff = (a, b) => Math.abs((((a - b + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);      // the angle between two headings, whatever turns the figure has made

// ---- 3d-walk-seats
// One chat with 12 working sub-agents opens: its office seats 13 people on every kind of seat it plans (desks, lounge seats, stools). They walk in, one after the other, and sit: every
// walk inside the office keeps clear of the furniture, nobody jumps onto a seat (the last leg from the stand point is walked), each ends on its seat facing as the seat faces, with its
// hip at the cushion of that kind of seat, nobody shares one. Then the chat closes: everybody stands up where they sit (the first step out is from the seat itself, no jump to the stand
// point), and walks the way out, which keeps clear of the furniture as well, to the entrance.
async function runSeats(ctx) {
  const problems = [];
  const S = await scenario3d(2, { tag: 'wseats', root: ctx.root, width: 1100, height: 700, intercept: recordFromStart });
  try {
    const { page } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    await page.evaluate(HELPERS);
    await ev(page, 's.settle()');
    await sleep(800);
    await ev(page, 's.rec.take().length');
    const SUBS = 12, mine = ['sc', ...Array.from({ length: SUBS }, (_, i) => 'sc-' + i)];
    await qa(page, `q.chat('sc'); for (let i = 0; i < ${SUBS}; i++) q.sub('sc', 'sc-' + i); q.sync();`);
    const off = await ev(page, 'o.office()');
    const room = await roomOf(page, 'sc'), keys = await seatKeys(page);
    if (!room.arr || room.arr.seats.length < SUBS + 1) problems.push(`the office has ${room.arr ? room.arr.seats.length : 0} seats, want ${SUBS + 1}`);
    if (!(await idle(page, 240000))) problems.push('the 13 people were still walking after 4 minutes');
    await sleep(2500);                                                                         // the last one settles into its pose
    const st = await ev(page, '({ rec: s.rec.take(), sit: o.sitting(), figs: o.figures().map(f => ({ id: f.id, pack: f.pack })) })');
    const lists = byId(st.rec), kinds = {};
    let inside = 0, sat = 0;
    for (const id of mine) {
      const l = lists.get(id), key = keys.get(id), seat = room.arr.seats.find(x => x.key === key), sp = st.sit.find(x => x.id === id);
      if (!l || !seat || !sp) { problems.push(`${short(id)}: ${!l ? 'not recorded' : !seat ? 'no seat ' + key : 'not in the scene at the end'}`); continue; }
      kinds[seat.kind] = (kinds[seat.kind] || 0) + 1;
      problems.push(...ends(l, [off], { removed: false }), ...jumps(l));
      const c = crossings(l, room, key, short(id));
      problems.push(...c.bad);
      inside += c.inside;
      const at = [room.box.X + seat.pos[0], room.box.Z + seat.pos[1]];
      const k = l.findIndex(e => e.mode === 'seated');
      if (k < 1) problems.push(`${short(id)}: never sat down`);
      else {
        sat++;
        if (Math.hypot(l[k].x - at[0], l[k].z - at[1]) > 0.02) problems.push(`${short(id)}: its first seated position is ${Math.hypot(l[k].x - at[0], l[k].z - at[1]).toFixed(2)} from its ${seat.kind} seat (the walk ends on the seat, not at the stand point)`);
        const w = l.slice(0, k).filter(e => e.k === 'frame').at(-1);
        if (w && w.sit > 0.2) problems.push(`${short(id)}: it was sitting already (sit ${w.sit}) before it reached its ${seat.kind} seat`);
      }
      if (sp.mode !== 'seated' || Math.hypot(sp.x - at[0], sp.z - at[1]) > 0.03) problems.push(`${short(id)}: ends ${sp.mode} ${Math.hypot(sp.x - at[0], sp.z - at[1]).toFixed(2)} m from its ${seat.kind} seat`);
      if (turnDiff(sp.heading, seat.facing) > 0.1) problems.push(`${short(id)}: faces ${sp.heading.toFixed(2)}, its ${seat.kind} seat faces ${seat.facing.toFixed(2)}`);
      if (Math.abs(sp.hipY - seat.hip) > 0.04) problems.push(`${short(id)}: its hip is at ${sp.hipY.toFixed(2)} m, the cushion of its ${seat.kind} seat is ${seat.hip.toFixed(2)}`);
      if (!sp.seat || sp.seat.kind !== seat.kind) problems.push(`${short(id)}: it thinks it sits on a ${sp.seat ? sp.seat.kind : 'no'} seat, the plan says ${seat.kind}`);
    }
    problems.push(...(await books(page)));
    if (Object.keys(kinds).length < 2 || !(kinds.lounge || kinds.stool)) problems.push(`the 13 people sit on ${Object.entries(kinds).map(([k, n]) => n + ' ' + k).join(', ')}: want more than one kind of seat, a lounge seat or a stool among them`);
    // the chat closes: everybody stands up on the seat and walks out
    await ev(page, 's.rec.take().length');
    await qa(page, `q.remove('sc'); q.sync();`);
    for (const id of mine) if (!(await gone(page, id, 180000))) problems.push(`${short(id)} never left`);
    const out = byId(await ev(page, 's.rec.take()'));
    const off2 = await ev(page, 'o.office()');
    let outside = 0;
    for (const id of mine) {
      const l = out.get(id), key = keys.get(id), seat = room.arr.seats.find(x => x.key === key);
      if (!l || !seat) continue;
      const w = l.filter(e => e.k === 'frame' && e.after === 'gone');
      if (!w.length) { problems.push(`${short(id)}: never walked out`); continue; }
      const at = [room.box.X + seat.pos[0], room.box.Z + seat.pos[1]];
      if (Math.hypot(w[0].x - at[0], w[0].z - at[1]) > 0.02) problems.push(`${short(id)}: it got up ${Math.hypot(w[0].x - at[0], w[0].z - at[1]).toFixed(2)} from its ${seat.kind} seat (it stands up where it sits)`);
      problems.push(...jumps(l));
      const last = l[l.length - 1];
      if (last.k !== 'remove' || !nearAny([off, off2], last.x, last.z, 1.3)) problems.push(`${short(id)}: its walk out did not end at the entrance`);
      const c = crossings(l, room, key, short(id));
      problems.push(...c.bad);
      outside += c.inside;
    }
    problems.push(...(await books(page)));
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return [report('3d-walk-seats', problems, `a chat with ${SUBS} sub-agents (${room.arr ? room.arr.work + ' + ' + room.arr.soft : '?'}; seats: ${Object.entries(kinds).map(([k, n]) => n + ' ' + k).join(', ')}): ${sat} of ${mine.length} walked in and sat down on their own seat (${inside} readings inside the office, none within ${CLEAR} m of a piece, no jump, facing and cushion height as the seat says, nobody sharing a seat), then the chat closed and all stood up on their seat and walked out (${outside} readings inside the office, clear of everything) to the entrance`)];
  } finally { await S.done(); }
}

// ---- 3d-walk-turnback
// A job that ends while the person is inside the office turns it round where it stands, and the way back is the way it came in. Twelve sub-agents walk into one office; each one's job
// ends when it is a little deeper in the room than the one before (a twelfth of the way in, then a sixth ... nearly at the seat), and a second chat is closed while its chief is in the room: every
// turn is from another point of a route, and every walk back keeps clear of the furniture and ends at the entrance.
async function runTurnBack(ctx) {
  const problems = [];
  const S = await scenario3d(2, { tag: 'wturn', root: ctx.root, width: 1100, height: 700, intercept: recordFromStart });
  try {
    const { page } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    await page.evaluate(HELPERS);
    await ev(page, 's.settle()');
    await sleep(800);
    await ev(page, 's.rec.take().length');
    const SUBS = 12, subs = Array.from({ length: SUBS }, (_, i) => 'tb-' + i);
    await qa(page, `q.chat('tb'); for (let i = 0; i < ${SUBS}; i++) q.sub('tb', 'tb-' + i); q.chat('tb2'); q.sync();`);
    const off = await ev(page, 'o.office()');
    const rooms = { tb: await roomOf(page, 'tb'), tb2: await roomOf(page, 'tb2') }, keys = await seatKeys(page);
    // how deep into the office each figure is when its job ends: a share of the farthest point of its own route from the door
    const depth = id => { const r = rooms[id.startsWith('tb2') ? 'tb2' : 'tb'], seat = r.arr.seats.find(x => x.key === keys.get(id)), inner = seat.walk[3]; return { r, inner, far: Math.max(...seat.walk.slice(3).map(p => Math.hypot(p[0] - inner[0], p[1] - inner[1]))) }; };
    const target = new Map(subs.map((id, i) => [id, Math.max(0.35, ((i + 0.5) / SUBS) * depth(id).far * 0.95)]));
    target.set('tb2', Math.max(0.5, depth('tb2').far * 0.5));
    const pending = new Set([...subs, 'tb2']), ended = new Set();
    const t0 = Date.now();
    while (pending.size && Date.now() - t0 < 200000) {
      const figs = await ev(page, 'o.figures().filter(f => f.mode === "walk" && f.after !== "gone" && f.vis).map(f => [f.id, f.x, f.z])');
      const now = [];
      for (const [id, x, z] of figs) {
        if (!pending.has(id)) continue;
        const { r, inner } = depth(id), lx = x - r.box.X, lz = z - r.box.Z;
        if (!(lx > 0.1 && lx < r.box.W - 0.1 && lz > 0.1 && lz < r.box.D - 0.1)) continue;                  // not in the office yet
        if (Math.hypot(lx - inner[0], lz - inner[1]) >= target.get(id)) { now.push(id); pending.delete(id); ended.add(id); }
      }
      if (now.length) await qa(page, now.map(id => (id === 'tb2' ? `q.remove('tb2');` : `q.status(${JSON.stringify(id)}, 'done');`)).join('') + 'q.sync();');
      await sleep(40);
    }
    if (ended.size < 8) problems.push(`only ${ended.size} of 13 jobs ended inside the office (want 8 or more): the others sat down first`);
    // whoever sat down first leaves the usual way, so that nobody is left in the scene
    await qa(page, `for (const id of ${JSON.stringify(subs)}) { try { q.status(id, 'done'); } catch (e) {} } q.remove('tb2'); q.sync();`);
    for (const id of [...subs, 'tb2']) if (!(await gone(page, id, 240000))) problems.push(`${short(id)} never left`);
    const st = await ev(page, '({ rec: s.rec.take(), office: o.office() })');
    const lists = byId(st.rec);
    let turnedIn = 0, inside = 0;
    for (const id of [...subs, 'tb2']) {
      const l = lists.get(id);
      if (!l) { problems.push(`${short(id)}: not recorded`); continue; }
      problems.push(...ends(l, [off, st.office]), ...jumps(l));
      const key = id === 'tb2' ? 'chef' : keys.get(id), r = id === 'tb2' ? rooms.tb2 : rooms.tb;
      const c = crossings(l, r, key, short(id));
      problems.push(...c.bad);
      inside += c.inside;
      const t = l.find(e => e.turn);
      if (t) {
        const lx = t.x - r.box.X, lz = t.z - r.box.Z;
        if (lx > 0.1 && lx < r.box.W - 0.1 && lz > 0.1 && lz < r.box.D - 0.1) turnedIn++;
      }
      if (l.some(e => e.mode === 'seated') && ended.has(id)) problems.push(`${short(id)}: seated, though its job ended before its seat`);
    }
    if (turnedIn < 7) problems.push(`only ${turnedIn} figures were seen turning round inside the office (want 7 or more)`);
    problems.push(...(await books(page)));
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return [report('3d-walk-turnback', problems, `${ended.size} of 13 jobs (12 sub-agents and a chat's chief) ended while the person was inside the office, at depths from 0.35 m to nearly the seat; ${turnedIn} were seen turning round inside it: each walked back out the way it came, clear of the furniture (${inside} readings inside the office), with no jump, and was removed at the entrance`)];
  } finally { await S.done(); }
}

// ---- 3d-walk-reseat
// A sub-agent that is walking out of its seat is wanted again, and the seat it left is taken by a newcomer meanwhile: it turns back and walks to another seat of the same office. The walk
// is not the straight line to the nearest point of the new route (a table is in the way, for some pairs of seats), it goes back along the way out to where the two routes part and in along
// the other. The pair of seats is picked, from the arrangements of the offices, as one where the straight line does cut through furniture.
const pickReseat = arr => {
  const seats = arr.seats.filter(s => s.key !== 'chef'), at = (p, q) => ({ x: p[0], z: p[1], ...q });
  for (const a of seats) for (const b of seats) {
    if (b.key <= a.key || a.walk.length < 5 || b.walk.length < 5 || b.key === 3 || b.key === 6) continue;          // (b sub-agents make an office of 3, 6 or 12 seats: seat b has to exist, so not 3 and 6)
    const rt = k => k.walk.map(p => ({ x: p[0], z: p[1] }));
    const from = at(a.stand), way = repath(rt(b), from, 'seat'), good = rejoin(rt(a), rt(b), from);
    const hits = path => {
      for (let i = 1; i < path.length; i++) {
        const p = path[i - 1], q = path[i], n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.z - p.z) / 0.05));
        for (let j = 0; j <= n; j++) {
          const x = p.x + (q.x - p.x) * j / n, z = p.z + (q.z - p.z) * j / n;
          if (Math.hypot(x - b.pos[0], z - b.pos[1]) < AT_SEAT || Math.hypot(x - a.pos[0], z - a.pos[1]) < 0.3) continue;
          if (arr.obstacles.some(o => distToPoly(x, z, o.poly) < CLEAR - 0.05)) return true;
        }
      }
      return false;
    };
    if (hits(way) && !hits(good)) return { a: a.key, b: b.key };
  }
  return null;
};
async function runReseat(ctx) {
  const problems = [];
  const S = await scenario3d(1, { tag: 'wreseat', root: ctx.root, width: 1100, height: 700, intercept: recordFromStart });
  try {
    const { page } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    await page.evaluate(HELPERS);
    // the arrangements of the offices that are free: the pair of seats is picked from them
    const off0 = await ev(page, 'o.office()');
    let pick = null;
    for (const sl of off0.slots.filter(x => x.vacant).sort((a, b) => a.slot - b.slot)) {
      const arr = await ev(page, `o.arrange(${JSON.stringify('vacant-' + sl.slot)})`);
      const p = arr && pickReseat(arr);
      if (p) { pick = { slot: sl.slot, ...p, work: arr.work, soft: arr.soft }; break; }
    }
    if (!pick) { problems.push('no office has a pair of seats where the straight line cuts through furniture: nothing to prove the walk by'); return [report('3d-walk-reseat', problems, '')]; }
    // fillers take every slot of the office below the pair, so that the chat of the check gets the office of that slot (a chat takes the lowest free one)
    const first = off0.slots.filter(x => !x.vacant).length, fillers = pick.slot - first;
    await qa(page, `for (let i = 0; i < ${Math.max(0, fillers)}; i++) q.chat('fill' + i); q.chat('rs'); q.sync();`);
    const got = await ev(page, 'o.office().slots.find(s => s.id === "rs")');
    if (!got || got.slot !== pick.slot) problems.push(`the chat of the check got the office of slot ${got ? got.slot : '?'}, want ${pick.slot}`);
    const room = await roomOf(page, 'rs');
    // sub-agents for the seats 0 .. b - 1: A at seat a (the pair's first), the others fill the other seats below b; seat b is the one free seat. C will take A's seat while A walks out, and A is wanted again: its own is taken, the free one is b
    const names = Array.from({ length: pick.b }, (_, i) => (i === pick.a ? 'A' : 'f' + i));
    await qa(page, `for (const id of ${JSON.stringify(names)}) q.sub('rs', id); q.sync();`);
    await ev(page, 's.settle()');
    await sleep(900);
    const seatsNow = (await ev(page, 'o.seats()')).rooms.find(r => r.id === 'rs').seats;
    if (seatsNow[pick.a] !== 'A') problems.push(`A sits at seat ${seatsNow.indexOf('A')}, want ${pick.a}`);
    if (seatsNow.length <= pick.b) problems.push(`the office has ${seatsNow.length} seats in use, seat ${pick.b} does not exist`);
    await ev(page, 's.rec.take().length');
    await qa(page, `q.status('A', 'done'); q.sync();`);                                          // A sits out its 4.5 s, then stands up and walks out of its seat
    const stand = room.arr.seats.find(x => x.key === pick.a).stand, standAt = [room.box.X + stand[0], room.box.Z + stand[1]];
    const up = await until(async () => ev(page, `(() => { const f = o.figures().find(f => f.id === 'A'); return f && f.after === 'gone' && f.mode === 'walk' && Math.hypot(f.x - ${standAt[0]}, f.z - ${standAt[1]}) < 0.3; })()`), 40000, 40);
    if (!up) problems.push('A never walked out of its seat to the stand point');
    await qa(page, `q.sub('rs', 'C'); q.sync(); q.status('A', 'working'); q.sync();`);          // C takes A's seat (the lowest free one), then A is wanted again: it can't have its own
    const seatsAfter = (await ev(page, 'o.seats()')).rooms.find(r => r.id === 'rs').seats;
    if (seatsAfter[pick.a] !== 'C' || seatsAfter[pick.b] !== 'A') problems.push(`after the change A has seat ${seatsAfter.indexOf('A')} and C seat ${seatsAfter.indexOf('C')}, want ${pick.b} and ${pick.a}`);
    if (!(await idle(page, 240000))) problems.push('somebody was still walking after 4 minutes');
    await sleep(2000);
    const st = await ev(page, '({ rec: s.rec.take(), sit: o.sitting() })');
    const lists = byId(st.rec), l = lists.get('A') || [];
    const c = crossings(l, room, [pick.a, pick.b], 'A');
    problems.push(...c.bad, ...jumps(l));
    const back = l.find(e => e.k === 'frame' && e.after === 'sit' && e.mode === 'walk');
    if (!back) problems.push('A never turned back toward a seat');
    for (const [id, key] of [['A', pick.b], ['C', pick.a]]) {
      const sp = st.sit.find(x => x.id === id), seat = room.arr.seats.find(x => x.key === key);
      if (!sp || sp.mode !== 'seated' || Math.hypot(sp.x - (room.box.X + seat.pos[0]), sp.z - (room.box.Z + seat.pos[1])) > 0.03) problems.push(`${id} does not sit on seat ${key} at the end (${sp ? sp.mode + ' ' + sp.x.toFixed(1) + ', ' + sp.z.toFixed(1) : 'not in the scene'})`);
    }
    problems.push(...(await books(page)));
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return [report('3d-walk-reseat', problems, `office of slot ${pick.slot} (${pick.work} + ${pick.soft}): A left seat ${pick.a}, a newcomer took it, A was wanted again and went to seat ${pick.b} (the straight line from its stand point to the new route cuts through furniture in this arrangement): ${c.inside} readings of A inside the office, none within ${CLEAR} m of a piece, no jump, both ended on their seats`)];
  } finally { await S.done(); }
}

const CHECKS = { load: runLoad, calm: runCalm, brief: runBrief, leave: runLeave, flap: runFlap, rebuild: runRebuild, growout: runGrowOut, seats: runSeats, turnback: runTurnBack, reseat: runReseat, hidden: runHidden, follow: runFollow, settle: runSettle, reduced: runReduced };
const NAME = { load: '3d-walk-load', calm: '3d-walk-calm', brief: '3d-walk-brief', leave: '3d-walk-leave', flap: '3d-walk-flap', rebuild: '3d-walk-rebuild', growout: '3d-walk-growout', seats: '3d-walk-seats', turnback: '3d-walk-turnback', reseat: '3d-walk-reseat', hidden: '3d-walk-hidden', follow: '3d-walk-follow', settle: '3d-walk-settle', reduced: '3d-walk-reduced' };

// ---- mutations: break one line in a copy of the repo and expect the check that guards it to fail
const MUTATIONS = [
  { name: 'a figure is made at its seat instead of at the entrance', file: 'public/js/ofis.js', from: 'c.root.position.set(route[0].x, 0, route[0].z);', to: 'c.root.position.set(route[route.length - 1].x, 0, route[route.length - 1].z);', fails: ['load', 'brief'] },
  { name: 'a figure that waits for its turn is drawn at the entrance', file: 'public/js/ofis.js', from: 'c.root.visible = c.delay <= 0;', to: 'c.root.visible = true;', fails: 'load' },
  { name: 'the figures all leave the entrance at once', file: 'public/js/ofis-arrive.js', from: '(_, rank) => Math.max(0, start) + rank * st);', to: '(_, rank) => 0);', fails: 'load' },
  { name: 'a big queue is not hurried', file: 'public/js/ofis-arrive.js', from: 'if (rush && n > calm) {', to: 'if (false && n > calm) {', fails: 'load' },
  { name: 'the walk is faster than its pace', file: 'public/js/ofis-arrive.js', from: 'const stp = speed * pace * rampFactor', to: 'const stp = speed * pace * 2.2 * rampFactor', fails: 'load' },
  { name: 'the door does not open for the chief', file: 'public/js/ofis.js', from: "if (c.mode !== 'walk' || c.delay > 0) continue;", to: "if (c.mode !== 'walk' || c.delay > 0 || c.main) continue;", fails: 'load' },
  { name: 'a figure whose job ends before its seat is removed on the spot', file: 'public/js/ofis.js', from: "if (c.mode === 'walk' && c.after === 'sit') { turnAround(c); continue; }", to: "if (c.mode === 'walk' && c.after === 'sit') { removeChar(c); continue; }", fails: ['brief', 'hidden'] },
  { name: 'a turned-round figure keeps its seat', file: 'public/js/ofis.js', from: "    const room = world.rooms.get(c.roomId), pos = c.root.position;\n    if (room && c.slot >= 0 && room.slotChar[c.slot] === c) room.slotChar[c.slot] = null;\n    if (c.slot >= 0) c.slotWas = c.slot;\n    c.slot = -1;\n    // a walk still", to: "    const room = world.rooms.get(c.roomId), pos = c.root.position;\n    if (c.slot >= 0) c.slotWas = c.slot;\n    c.slot = -1;\n    // a walk still", fails: 'brief' },
  { name: 'a chat that ends is taken out of its vacant office on the spot', file: 'public/js/ofis.js', from: "if (!room) { exitVacated(c, old,", to: "if (!room) { removeChar(c); continue; } if (!room) { exitVacated(c, old,", fails: ['brief', 'leave'] },
  { name: 'a seated figure whose agent is gone is removed on the spot', file: 'public/js/ofis.js', from: "      else leaveRoom(c);\n    }\n  }", to: "      else removeChar(c);\n    }\n  }", fails: 'brief' },
  { name: 'a seated figure walks out without standing up first', file: 'public/js/ofis.js', from: 'if (c.path) c.standT = stand ? STAND_S : 0;', to: 'if (c.path) c.standT = 0;', fails: ['brief', 'leave'] },
  { name: 'the door of a vacant office stays a drawn box while its person walks out', file: 'public/js/ofis.js', from: 'buildShell(B, g, X, Z, W, D, th, it.door, vac && !open)', to: 'buildShell(B, g, X, Z, W, D, th, it.door, vac)', fails: 'leave' },
  { name: 'a figure that comes back while it walks out is left to leave', file: 'public/js/ofis.js', from: "      } else if (chef.after === 'gone') comeBack(chef, room);", to: "      } else if (false) comeBack(chef, room);", fails: 'flap' },
  { name: 'a sub-agent that is working again is left to leave', file: 'public/js/ofis.js', from: "if (c.after === 'gone') comeBack(c, room);", to: "if (false) comeBack(c, room);", fails: 'flap' },
  { name: 'a rebuild seats the people who are still walking', file: 'public/js/ofis.js', from: "      if (walking) {\n        if (moved) startWalk(c, out ? leadOut(way, pos, c.path, c.pi) : rejoin(was, route, pos, c.path, c.pi), c.after);\n        continue;\n      }", to: "      if (walking) {\n        if (!out) { const e = route[route.length - 1]; pos.x = e.x; pos.z = e.z; c.path = null; c.mode = 'seated'; c.after = null; }\n        continue;\n      }", fails: 'rebuild' },
  { name: 'a rebuild drops the people whose walk changed', file: 'public/js/ofis.js', from: "        if (moved) startWalk(c, out ? leadOut(way, pos, c.path, c.pi) : rejoin(was, route, pos, c.path, c.pi), c.after);", to: "        if (moved) { removeChar(c); continue; }", fails: 'rebuild' },
  { name: 'a sub-agent taken out of the data while it walks in is removed on the spot', file: 'public/js/ofis.js', from: "      else if (c.mode === 'walk' && c.path) turnAround(c);", to: "      else if (c.mode === 'walk' && c.path) removeChar(c);", fails: 'hidden' },
  { name: 'the name label stays where the figure was made', file: 'public/js/ofis.js', from: '    if (c.tag) { c.tag.off = c.bal.off = sc < 0.7 || c.delay > 0; c.tag.pos.set(pos.x, 0, pos.z); }', to: "    if (c.tag) { c.tag.off = c.bal.off = sc < 0.7 || c.delay > 0; if (c.mode !== 'walk') c.tag.pos.set(pos.x, 0, pos.z); }", fails: 'follow' },
  { name: 'the card is not placed again after each frame', file: 'public/js/ofis.js', from: "        placeLabels();\n        ui.card.place();", to: "        placeLabels();", fails: 'follow' },
  { name: 'a walk out keeps the pace of the page load', file: 'public/js/ofis.js', from: "if (after === 'gone') c.pace = 1;", to: "", fails: 'leave' },
  { name: 'a walk out of a vacated office is made for the old entrance', file: 'public/js/ofis.js', from: "else if (c.route) path = leadOut(c.route = rebaseRoute(c.route, c.cell), pos, c.path, c.pi);", to: "else if (c.route) path = leadOut(c.route, pos, c.path, c.pi);", fails: 'growout' },
  { name: 'a sub-agent ends 0.8 units from its seat', file: 'public/js/ofis.js', from: '    p.push(s.pos.clone());\n    return p;', to: "    p.push(slot === 'chef' ? s.pos.clone() : s.pos.clone().add(V(0.8, 0, 0)));\n    return p;", fails: 'load' },
  { name: 'a chief ends 0.8 units from its seat', file: 'public/js/ofis.js', from: '    p.push(s.pos.clone());\n    return p;', to: "    p.push(slot === 'chef' ? s.pos.clone().add(V(0.8, 0, 0)) : s.pos.clone());\n    return p;", fails: 'load' },
  { name: 'a figure comes into view 6 units inside the hall when its turn comes', file: 'public/js/ofis.js', from: 'if (c.delay <= 0) { c.delay = 0; c.root.visible = true; lastRelease = sceneT; }', to: 'if (c.delay <= 0) { c.delay = 0; c.root.visible = true; lastRelease = sceneT; pos.x -= 6; }', fails: 'load' },
  { name: 'the door does not open for a sub-agent', file: 'public/js/ofis.js', from: "if (c.mode !== 'walk' || c.delay > 0) continue;", to: "if (c.mode !== 'walk' || c.delay > 0 || !c.main) continue;", fails: ['load', 'leave'] },
  { name: 'the frame-clock sweep of finished sub-agents is gone', file: 'public/js/ofis.js', from: 'if (T - lastDoneSweep > 0.5) {', to: 'if (false && T - lastDoneSweep > 0.5) {', fails: 'leave' },
  { name: 'the entrance clock is ignored: a later queue starts at once', file: 'public/js/ofis.js', from: 'start: entranceFreeIn() });', to: 'start: 0 });', fails: 'load' },
  { name: 'settle does nothing', file: 'public/js/ofis.js', from: '        n++;\n        finishWalk(c);', to: '        n++;', fails: 'settle' },
  { name: 'the app calls settle', file: 'public/js/ofis.js', from: "    if (born.length) {\n      for (const b of born)", to: "    if (born.length) {\n      setTimeout(() => root.__ofis.settle(), 60000);\n      for (const b of born)", fails: 'settle' },
  { name: 'reduced motion keeps the bounce of the step', file: 'public/js/ofis.js', from: "pose === 'walk' && !atmosphere.state.reducedMotion ?", to: "pose === 'walk' ?", fails: 'reduced' },
  // the seats the rooms' arrangements give (the merge with the coworking offices): the walks keep to the routes, the people sit on the seat, not at the stand point
  { name: 'a walk out of an office cuts straight to the entrance', file: 'public/js/ofis.js', from: "startWalk(c, turnBack(c.route, c.route.length, c.root.position), 'gone');", to: "startWalk(c, [{ x: c.root.position.x, z: c.root.position.z }, { x: c.route[0].x, z: c.route[0].z }], 'gone');", fails: ['seats', 'leave'] },
  { name: 'a turn-back cuts straight to the entrance', file: 'public/js/ofis.js', from: "startWalk(c, c.path[0] === c.route[0] ? turnBack(c.path, c.pi, pos) : leadOut(c.route, pos, c.path, c.pi), 'gone');", to: "startWalk(c, [{ x: pos.x, z: pos.z }, { x: c.route[0].x, z: c.route[0].z }], 'gone');", fails: 'turnback' },
  { name: 'a person who is wanted at another seat goes straight to the nearest point of its route', file: 'public/js/ofis.js', from: 'way = rejoin(c.route, route, c.root.position, c.path, c.pi);', to: 'way = rejoin(null, route, c.root.position);', fails: 'reseat' },
  { name: 'a person is put on its seat from the stand point instead of walking onto it', file: 'public/js/ofis.js', edits: [['    for (const q of s.approach) p.push(q.clone());\n    p.push(s.pos.clone());', '    for (const q of s.approach) p.push(q.clone());'], ["    c.mode = 'seated'; c.after = null; c.th = c.seat ? c.seat.facing : -Math.PI / 2;", "    c.mode = 'seated'; c.after = null; c.th = c.seat ? c.seat.facing : -Math.PI / 2; if (c.seat) { c.root.position.x = c.seat.pos.x; c.root.position.z = c.seat.pos.z; }"]], fails: 'seats' },
  { name: 'a person gets up at the stand point of its seat, not on the seat', file: 'public/js/ofis.js', from: "    const stand = c.sit > 0.5;\n", to: "    const stand = c.sit > 0.5;\n    if (c.seat) c.root.position.set(c.seat.stand.x, 0, c.seat.stand.z);\n", fails: 'seats' },
  { name: 'every seat has the old fixed height of the hip', file: 'public/js/ofis.js', from: 'const seatHip = c => (c.seat && c.seat.hip) || PK_SEAT;', to: 'const seatHip = c => PK_SEAT;', fails: 'seats' },
  { name: 'the seat a person walks to is not recorded: it sits on no seat of its own', file: 'public/js/ofis.js', from: '    c.seat = seatFor(room, seatKey(c, c.slot));\n    c.root.position.set(route[0].x, 0, route[0].z);', to: '    c.root.position.set(route[0].x, 0, route[0].z);', fails: 'seats' },
  { name: '?arrive=calm is ignored', file: 'public/js/ofis.js', from: "{ rush: instant && !CALM_LOAD,", to: "{ rush: instant,", fails: 'calm' },
];

const editsOf = m => m.edits || [[m.from, m.to]];            // a mutation is one line broken, or a few (edits: [[from, to], ...]) that only make a break together

async function runMutations() {
  const rows = [];
  for (const m of MUTATIONS.filter(x => !val('mutation') || val('mutation').split('|').some(w => x.name.includes(w)))) {
    const dir = mkdtempSync(join(tmpdir(), 'cco-mutw-'));
    try {
      for (const f of readdirSync(ROOT).filter(n => /\.(js|json)$/.test(n) && n !== 'package-lock.json')) cpSync(join(ROOT, f), join(dir, f));
      cpSync(join(ROOT, 'public'), join(dir, 'public'), { recursive: true });
      const file = join(dir, m.file);
      let text = readFileSync(file, 'utf8');
      if (editsOf(m).some(([from]) => !text.includes(from))) { rows.push({ m, caught: false, detail: 'the line to break was not found' }); console.log(`MUTATION MISSED ${m.fails}: ${m.name} -> the line to break was not found`); continue; }
      for (const [from, to] of editsOf(m)) text = text.replace(from, () => to);
      writeFileSync(file, text);
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
    for (const [from] of editsOf(m)) {
      const n = readFileSync(join(ROOT, m.file), 'utf8').split(from).length - 1;
      if (n !== 1) { bad++; console.log(`MUTATION LINE ${n === 0 ? 'NOT FOUND' : 'FOUND ' + n + ' TIMES'}: ${m.name}`); }
    }
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
