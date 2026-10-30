// QA of the walkers: nothing in the 3D scene appears or disappears inside a room (public/js/ofis.js, public/js/ofis-arrive.js). Headless Chrome with software WebGL in a throw-away
// profile (harness3d.mjs), the server against a fake ~/.claude, one `CHECK <name> PASS|FAIL <detail>` line per check and a final `QA PASS` or `QA FAIL`.
//   node tools/qa/office3d-walk-qa.mjs [--only lights [--part main|readmit|load|reduced]|load|calm|brief|leave|flap|rebuild|growout|seats|turnback|reseat|readmit|hidden|follow|settle|reduced] [--mutations [--mutation <words>|<more words>]] [--verify-mutations]
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
//                    that is vacant now opens for them, they are removed at the entrance, and a sub-agent that finishes leaves too, after its 4.5 s, clear of the furniture
//   3d-walk-flap     appears, ends, appears again: a chat and a sub-agent come back while they walk out, one figure each, seated at the end, no stuck seat, no ghost label; a sub-agent that is wanted again goes back to the seat it left, not the first free one
//   3d-walk-rebuild  the 20th chat adds a bay and moves the entrance while 30 people are walking in: nobody jumps, nobody is dropped, everybody is seated at the end
//   3d-walk-growout  the building grows (the entrance moves 14 units) while a closed chat's chief and sub-agent walk out of their vacant office: they go on to today's entrance
//   3d-walk-seats    a chat with 12 sub-agents (an office with desks, lounge seats and stools): all 13 walk in and sit on their own seat (every reading inside the office keeps 0.2 m from the
//                    furniture, nobody jumps, each ends facing as its seat does with its hip at that seat's cushion, nobody shares a seat); a job ends on each kind of seat while the chat goes
//                    on and the person gets up where it sits and walks out clear of the furniture; the chat closes and all do the same
//   3d-walk-turnback twelve jobs and a chat end while the person is inside the office, each a little deeper in than the one before: the walk back is the way it came in (every reading of it is
//                    on the line the figure had walked in, to within 5 cm), clear of the furniture
//   3d-walk-reseat  a sub-agent walking out of its seat is wanted again, a newcomer has taken that seat: it goes back along the way out and in along the route of another seat, not
//                    straight through the table (a pair of seats of an arrangement where the straight line does cut through furniture)
//   3d-walk-readmit a chat closes, another chat takes its office while its chief walks out, and the first chat is back: it gets another office. Three cases (one hall from inside the office,
//                    another hall from the hall's lane, another hall from inside the office, with a sub-agent that is not wanted on the way out and a further chat that makes a second rebuild):
//                    every reading of the chief is in the old office, outside, or in the new one, never in another office or the lounge, it crosses the walls of the two only at their doors,
//                    keeps 0.2 m from their furniture, nobody jumps or is made again, and it ends on its new seat
//   3d-walk-hidden   the Office view is left while people walk, a chat ends and another comes meanwhile; back in the view nobody jumps and the ended chat walks out instead of vanishing
//   3d-walk-follow   the label, the balloon, the hover tooltip and the click card follow a walking figure, and the camera stays where it is
//   3d-walk-settle   s.settle() ends every walk at once (QA hook), and nothing in the app calls it
//   3d-walk-reduced  with prefers-reduced-motion the figures walk at the same pace and do not bounce
//   3d-walk-lights   the light of every office follows its people (public/js/ofis-presence.js): read frame by frame against every figure of the scene, by a model of the rule of its own.
//                    A chat arrives (its office is dark until the chief is through the door, then eases on), a chat with three sub-agents closes (lit while anybody is inside, off in the frame
//                    the last is out), a brief job never lights its office, a rebuild while a chief walks in does not light it and one while a chief walks out does not darken it (read in
//                    the very task of the rebuild), a chat that is back in another office while its chief walks out of the old one (the new chat of the old office has not been inside: dark
//                    once the old chat's people are out, lit when its own chief is in), a page load with ten chats (dark in the first frame, one office at a time as the chiefs come in),
//                    and prefers-reduced-motion with the lounge's people about (the light is 0 or 1 and no person of the lounge is at an office)
//
// --mutations breaks the code in a copy of the repo, one line at a time, and runs the check that guards that line: every one must FAIL there. Timing is the one thing a busy machine can
// bend (every time here is the scene's own clock, the sum of its steps, so a slow frame rate does not matter, but a check that fails by a small margin is worth running again on its own).
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scenario3d, o3, sleep, ROOT, recordFromStart } from './harness3d.mjs';
import { distToPoly } from '../../public/js/ofis-geom.js';
import { repath, rejoin } from '../../public/js/ofis-arrive.js';
import { SWITCH_MS } from '../../public/js/ofis-light.js';

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
  const r = await ev(page, '({ roots: o.roots(), seats: o.seats(), figs: o.figures().map(f => ({ id: f.id, main: f.main, mode: f.mode, x: f.x, z: f.z })) })');
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
  for (const room of r.seats.rooms) room.seats.forEach((id, i) => {
    if (!id) return;
    const f = r.seats.figures.find(x => x.id === id);
    if (!f || f.slot !== i || f.room !== room.id) bad.push(`seat ${i} of ${short(room.id)} is taken by ${short(id)}, who ${f ? `has seat ${f.slot} of ${short(f.room)}` : 'is gone'}`);
  });
  for (const f of r.seats.figures) if (f.slot >= 0) {
    const room = r.seats.rooms.find(x => x.id === f.room);
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

// While the figures walk in, the page is read every 120 ms: the camera, the doors next to a walking chief (the chief's own door must be open when it is in the doorway), and the chief's own
// screen (dark while the chief walks, on once it has sat: a sub-agent's screen is dark until it sits, and so is the chat's).
async function runLoad(ctx) {
  const problems = [];
  const S = await scenario3d(10, { tag: 'wload', root: ctx.root, width: 1100, height: 700, settle: false, intercept: recordFromStart });
  try {
    const { page } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    const cam0 = await ev(page, '[s.zoom, ...s.project(0, 0, 0)]');
    let cam = cam0, camMoved = 0, doorSamples = 0, doorOpen = 0, subDoorSamples = 0, subDoorOpen = 0, samples = 0, scrWalk = 0, scrLitWhileWalking = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      const r = await ev(page, '({ walking: s.walking.length, cam: [s.zoom, ...s.project(0, 0, 0)], doors: o.doors(), scr: o.screens(), figs: o.figures().map(f => [f.id, f.main, f.mode, f.x, f.z, f.vis]) })');
      samples++;
      // the chief's own screen is dark while the chief walks (the figures and the screens are read in one task: no frame comes between them)
      for (const f of r.figs) if (f[1] && f[2] === 'walk' && f[5]) {
        const mine = r.scr.list.filter(x => x.kind === 'chef' && x.room === f[0]);
        if (!mine.length) continue;
        scrWalk++;
        if (mine.some(x => x.hex !== r.scr.off)) scrLitWhileWalking++;
      }
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
    if (scrWalk < 20) problems.push(`only ${scrWalk} readings of a walking chief and its screen (nothing to judge "dark until the chief has sat" by)`);
    else if (scrLitWhileWalking) problems.push(`the chief's screen was on in ${scrLitWhileWalking} of ${scrWalk} readings of the chief walking in (it stays dark until the chief has sat)`);
    const scrEnd = await ev(page, 'o.screens()');
    const chiefScr = new Map();
    const withChat = new Set(off.slots.filter(x => !x.vacant).map(x => x.id));                 // (a vacant office has the chief's screen too: nobody sits there)
    for (const x of scrEnd.list) if (x.kind === 'chef' && withChat.has(x.room)) chiefScr.set(x.room, (chiefScr.get(x.room) || false) || x.hex !== scrEnd.off);
    const scrOn = [...chiefScr.values()].filter(Boolean).length;
    if (scrOn < chiefScr.size || chiefScr.size < 8) problems.push(`${scrOn} of ${chiefScr.size} chiefs' screens are on once everybody sits (they show the chat's work)`);
    problems.push(...(await books(page)), ...(await seated(page)));
    const q2 = await queues(page);
    problems.push(...q2.problems);
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return [report('3d-walk-load', problems,
      `${all.length} figures (${all.filter(l => l[0].main).length} chiefs) made at the entrance at ${f1(delays[0])} to ${delays[delays.length - 1].toFixed(2)} s, ${f1(Math.min(...gaps) * 1000)} to ${f1(Math.max(...gaps) * 1000)} ms apart, ${hurried} hurried (up to ${Math.max(...Object.values(st.paces)).toFixed(1)} times), `
      + `all seated after ${lastArrival.toFixed(1)} s of the scene's time (earliest ${Math.min(...arrive).toFixed(1)}), ${all.reduce((n, l) => n + l.length, 0)} events and no jump, ${doorOpen} of ${doorSamples} readings with the chief's door open and ${subDoorOpen} of ${subDoorSamples} with a sub-agent's, step bounce ${f1((Math.max(...hy) - Math.min(...hy)) * 100)} cm, the camera stayed, the chief's screen was dark in all ${scrWalk} readings of the chief walking and on for ${scrOn} of ${chiefScr.size} once they sat; ${q2.note}`)];
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
    return [report('3d-walk-brief', problems, `${brief.length} figures (one sub-agent, a burst of five, two chats and a chat that ends within one sync): each was made at the entrance, turned round (${turned} seen turning) and was removed at the entrance, none was ever seated, no jump, all ${vacantNow} offices that are not a chat's are vacant again, no seat stayed taken; a seated sub-agent taken out of the data stood up and walked out`)];
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
    // the chief's balloon (what it is doing) is shown while its chat is open: the control that there is a balloon to switch off
    const balSel = `document.querySelector('.of-l.of-ball[data-id=' + ${JSON.stringify(JSON.stringify(pick.id))} + ']')`;
    const balloon0 = await until(async () => (await ev(page, `(e => (e ? e.style.visibility : null))(${balSel})`)) === 'visible', 15000, 200);
    if (!balloon0) problems.push('the chief\'s balloon was not shown before its chat closed: nothing to judge "a gone agent\'s balloon is switched off" by');
    fx.closeSession(pick.id);
    let doorSamples = 0, doorOpen = 0, subSamples = 0, subOpen = 0, balSamples = 0, balShown = 0, goneAt = null;
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      const r = await ev(page, `({ doors: o.doors(), figs: o.figures().map(f => [f.id, f.main, f.mode, f.x, f.z, f.after]), bal: (e => (e ? e.style.visibility : null))(${balSel}) })`);
      // a chat that is gone from the data has no balloon about work that is over: once the chief has walked out for half a second (a frame or two after the data changed) its balloon is hidden
      const chiefNow = r.figs.find(f => f[0] === pick.id);
      if (chiefNow && chiefNow[5] === 'gone') {
        if (goneAt === null) goneAt = Date.now();
        else if (Date.now() - goneAt > 500) { balSamples++; if (r.bal === 'visible') balShown++; }
      }
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
    if (balloon0 && balSamples < 5) problems.push(`only ${balSamples} readings of the walking chief's balloon after its chat was gone (nothing to judge by)`);
    else if (balShown) problems.push(`the chief's balloon was still shown in ${balShown} of ${balSamples} readings of it walking out after its chat was gone`);
    problems.push(...(await books(page)));
    // a sub-agent that finishes sits for 4.5 s (the check mark), then stands up and walks out
    const other = fx.agents.find(a => a.id !== pick.id), sub = other.subs[0];
    const room2 = await roomOf(page, other.id), keys2 = await seatKeys(page);                   // read while the sub-agent still sits
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
    if (l2.length && keys2.has(sub.id)) problems.push(...crossings(l2, room2, keys2.get(sub.id), 'the finished sub-agent').bad);
    else if (l2.length) problems.push('the finished sub-agent had no seat to compare its walk out with');
    problems.push(...(await books(page)));
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return [report('3d-walk-leave', problems, `the chat closed with its chief and ${pick.subs.length} sub-agents seated: ${stood} of ${mine.length} stood up first (still for 0.25 s or more), walked out clear of the office's furniture and were removed at the entrance with no jump, the vacant office is vacant, ${hinged ? `its door was open in ${doorOpen} of ${doorSamples} readings of the chief in the doorway and ${subOpen} of ${subSamples} of a sub-agent` : 'its door is an opening'}; the chief's balloon was hidden in all ${balSamples} readings of it walking out; a finished sub-agent (its walk out clear of the furniture too) sat ${seatedFor.toFixed(1)} s after the data said it was done, then stood up, walked out and was removed at the entrance (${((Date.now() - tFinish) / 1000).toFixed(0)} s on the wall clock in all)`)];
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
    // a sub-agent that is wanted again while it walks out goes back to the seat it left, when that seat is still free: not to the first free one (seat 0 is free as well here)
    await qa(page, `q.chat('ph-host'); q.sub('ph-host', 'ph0'); q.sub('ph-host', 'ph1'); q.sub('ph-host', 'ph2'); q.sync();`);
    await ev(page, 's.settle()');
    await sleep(900);
    const phSeats = () => ev(page, `o.seats().rooms.find(r => r.id === 'ph-host').seats`);
    const ph0 = await phSeats();
    if (ph0[0] !== 'ph0' || ph0[1] !== 'ph1' || ph0[2] !== 'ph2') problems.push(`the three sub-agents of the chat sit at seats ${JSON.stringify(ph0.slice(0, 4))}, want ph0, ph1, ph2 at 0, 1, 2`);
    await qa(page, `q.remove('ph0'); q.sync();`);                                              // seat 0 is free at once, ph0 walks out
    await qa(page, `q.remove('ph2'); q.sync();`);                                              // ph2 stands up and walks out of seat 2, which is free at once as well
    await sleep(700);
    const ph1 = await ev(page, `(f => (f ? [f.after, f.mode] : null))(o.figures().find(f => f.id === 'ph2'))`);
    if (!ph1 || ph1[0] !== 'gone') problems.push(`ph2 was not walking out when it was wanted again (${JSON.stringify(ph1)})`);
    await qa(page, `q.sub('ph-host', 'ph2'); q.sync();`);                                      // wanted again: seat 2 and seat 0 are both free
    const ph2 = await phSeats();
    if (ph2[2] !== 'ph2' || ph2.indexOf('ph2') !== 2) problems.push(`ph2 was given seat ${ph2.indexOf('ph2')} when it was wanted again, not the seat 2 it left (seat 0 was free too: ${JSON.stringify(ph2.slice(0, 4))})`);
    if (!(await idle(page))) problems.push('somebody was still walking after 2 minutes (the seat case)');
    await sleep(900);
    const ph3 = await ev(page, `({ seats: o.seats().rooms.find(r => r.id === 'ph-host').seats.slice(0, 3), at: o.sitting().find(f => f.id === 'ph2'), room: o.room('ph-host'), arr: o.arrange('ph-host') })`);
    const seat2 = ph3.arr.seats.find(x => x.key === 2);
    if (!ph3.at || ph3.at.mode !== 'seated' || Math.hypot(ph3.at.x - (ph3.room.X + seat2.pos[0]), ph3.at.z - (ph3.room.Z + seat2.pos[1])) > 0.05) problems.push(`ph2 does not sit on the seat it left (${ph3.at ? ph3.at.mode : 'not in the scene'}, seats ${JSON.stringify(ph3.seats)})`);
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    const counts = ['flap-chat', 'flap-sub', 'fast', 'flap-sub-2'].map(id => { const l = lists.get(id) || []; return `${id} made ${l.filter(e => e.k === 'create').length}, removed ${l.filter(e => e.k === 'remove').length}`; }).join('; ');
    return [report('3d-walk-flap', problems, `a chat and a sub-agent flapped with time to walk (end, back 0.5 s later): ${cameBack} of 2 came back while walking out, as the same figure; two flapped within single syncs, still at the entrance (${counts}); all ended seated at their seats, ${st.figs.length} figures in the scene and in the data, no duplicate, label or balloon left over, no seat stuck; a sub-agent wanted again while it walked out went back to the seat it left (seat 2, with seat 0 free as well)`)];
  } finally { await S.done(); }
}

// A figure that waits at the entrance (made, its turn not come) is not drawn, and it cannot be hovered or clicked either: its pick box is not offered to the ray. This reads it in ONE task
// (o.draw() first, so that the figures' pick boxes stand where the rebuild put them: a pick reads the matrices of the last render; then a pointer event sent to the stage as a mouse sends it,
// the tooltip read before any frame): the place of a waiting figure that has no drawn figure within 1.2 units, and, as the control
// that the probe can show a tooltip at all, a figure that walks in the hall. After a growth rebuild the new entrance is 14 units from every figure that walks, so a waiting figure stands alone there.
const HOVER_PROBE = `(() => {
  const rect = v.getBoundingClientRect(), area = v.querySelector('.of-area'), tipEl = document.getElementById('tip'), slots = o.office().slots;
  const hover = (f, h = 0.8) => { const [x, y] = s.project(f.x, h, f.z); area.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', clientX: rect.left + x, clientY: rect.top + y, bubbles: true })); const on = tipEl.classList.contains('on'), text = tipEl.textContent; area.dispatchEvent(new PointerEvent('pointerleave', { bubbles: true })); return { on, text, at: [Math.round(x), Math.round(y)] }; };
  o.draw();
  // (a figure at the entrance is drawn at a sixth of its size, so its pick box is a sixth as tall: hover at three heights of it)
  const hovers = f => { const r = [0.08, 0.13, 0.2].map(h => hover(f, h)); return r.find(x => x.on) || r[0]; };
  const figs = o.figures(), waiting = figs.filter(f => !f.vis), walkers = figs.filter(f => f.vis && f.mode === 'walk');
  const clear = f => walkers.every(g => Math.hypot(g.x - f.x, g.z - f.z) > 1.2);
  const inRoom = f => slots.some(r => f.x > r.X && f.x < r.X + r.W && f.z > r.Z && f.z < r.Z + r.D);
  const w = waiting.find(clear), tried = walkers.filter(f => !inRoom(f) && f.x < o.office().entryX - 3).slice(0, 12).map(f => [f.id.slice(-8), +f.x.toFixed(1), +f.z.toFixed(1), hover(f).on]);
  return { nWaiting: waiting.length, clear: !!w, control: tried.some(t => t[3]) ? { on: true } : null, tried, waited: w ? hovers(w) : null };
})()`;

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
    const probe = await ev(page, `(() => { window.__qa.chat('g16'); window.__qa.sub('g16', 'g16-sub'); window.__qa.sync(); return ${HOVER_PROBE}; })()`);
    if (!probe.clear) problems.push(`no figure waited alone at the new entrance when the building grew (${probe.nWaiting} waiting): nothing to judge "a waiting figure cannot be hovered" by`);
    else if (!probe.control || !probe.control.on) problems.push(`the probe showed no tooltip on any of ${probe.tried.length} figures that walk in the hall (${JSON.stringify(probe.tried.slice(0, 4))}): it proves nothing about the figures that wait`);
    else if (probe.waited.on) problems.push(`hovering the place of a figure that waits at the entrance, not drawn yet, showed a tooltip ("${probe.waited.text.slice(0, 50)}")`);
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
    return [report('3d-walk-rebuild', problems, `${off0.bays} to ${st.office.bays} bays, the entrance moved ${f1(off0.entryX)} to ${f1(grown.office.entryX)} with ${mid.walking} people walking: ${n} figures recorded (${st.figs.length} in the scene at the end, all seated), ${onTheWay.length} of them drawn and on the way when the 20th chat came: none jumped, none was dropped or made twice, all went on to their seats; ${probe.nWaiting} figures waited at the new entrance when it moved, and hovering the place of one of them showed no tooltip (a figure that walks does)`)];
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
// A walk back is the way the figure came in (turnBack): every reading after it turned round lies on the line it had walked until then, from the entrance to the point where it turned. A
// walk steps exactly onto each corner of its path (stepWalk ends a frame on the point it reaches), so the line the readings make IS the path: TRAIL_TOL (5 cm) only absorbs rounding, and
// a corner cut in the hall (0.15 m beside a door in the back wall, more beside a front door) is seen. Returns { bad, n, max }: the readings after the turn that are further than that from
// the trail, how many were read, and the furthest.
const TRAIL_TOL = 0.05;
const segDist = (x, z, a, b) => { const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz, t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / l2)) : 0; return Math.hypot(x - (a[0] + vx * t), z - (a[1] + vz * t)); };
function retrace(list, tag) {
  const t = list.findIndex(e => e.turn);
  if (t < 1) return { bad: [], n: 0, max: 0 };
  const trail = list.slice(0, t + 1).filter(e => e.k !== 'remove' && e.vis !== false).map(e => [e.x, e.z]);
  const bad = []; let n = 0, max = 0;
  for (const e of list.slice(t + 1)) {
    if (e.vis === false) continue;
    let d = Infinity;
    for (let i = 1; i < trail.length; i++) d = Math.min(d, segDist(e.x, e.z, trail[i - 1], trail[i]));
    n++; max = Math.max(max, d);
    if (d > TRAIL_TOL && bad.length < 3) bad.push(`${tag}: ${d.toFixed(2)} m from the way it came in at (${f1(e.x)}, ${f1(e.z)}) walking out`);
  }
  return { bad, n, max };
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
    // a sub-agent's job ends while the chat goes on (leaveRoom, not the vacated office's walk out): one on each kind of seat stands up where it sits and walks the way it came, clear of the
    // furniture, to the entrance
    const leavers = [];
    for (const id of mine.slice(1)) { const seat = room.arr.seats.find(x => x.key === keys.get(id)); if (seat && !leavers.some(p => p.kind === seat.kind)) leavers.push({ id, kind: seat.kind, seat }); }
    await ev(page, 's.rec.take().length');
    await qa(page, `${leavers.map(p => `q.remove('${p.id}');`).join(' ')} q.sync();`);
    for (const p of leavers) if (!(await gone(page, p.id, 180000))) problems.push(`${short(p.id)} (${p.kind} seat) never left when its job ended`);
    const left = byId(await ev(page, 's.rec.take()'));
    let leaverReadings = 0;
    for (const p of leavers) {
      const l = left.get(p.id);
      if (!l) { problems.push(`${short(p.id)}: not recorded when its job ended`); continue; }
      const w = l.filter(e => e.k === 'frame' && e.after === 'gone');
      const at = [room.box.X + p.seat.pos[0], room.box.Z + p.seat.pos[1]];
      if (!w.length) problems.push(`${short(p.id)}: never walked out when its job ended`);
      else if (Math.hypot(w[0].x - at[0], w[0].z - at[1]) > 0.02) problems.push(`${short(p.id)}: it got up ${Math.hypot(w[0].x - at[0], w[0].z - at[1]).toFixed(2)} from its ${p.kind} seat when its job ended (it stands up where it sits)`);
      problems.push(...jumps(l));
      const last = l[l.length - 1];
      if (last.k !== 'remove' || !nearAny([off], last.x, last.z, 1.3)) problems.push(`${short(p.id)}: its walk out when its job ended did not end at the entrance`);
      const c = crossings(l, room, keys.get(p.id), `${short(p.id)} (job ended, ${p.kind} seat)`);
      problems.push(...c.bad);
      leaverReadings += c.inside;
    }
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
    return [report('3d-walk-seats', problems, `a chat with ${SUBS} sub-agents (${room.arr ? room.arr.work + ' + ' + room.arr.soft : '?'}; seats: ${Object.entries(kinds).map(([k, n]) => n + ' ' + k).join(', ')}): ${sat} of ${mine.length} walked in and sat down on their own seat (${inside} readings inside the office, none within ${CLEAR} m of a piece, no jump, facing and cushion height as the seat says, nobody sharing a seat), then ${leavers.length} jobs ended on a ${leavers.map(p => p.kind).join(', ')} seat while the chat went on: each got up where it sat and walked out clear of everything (${leaverReadings} readings inside the office); then the chat closed and all stood up on their seat and walked out (${outside} readings inside the office, clear of everything) to the entrance`)];
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
    let turnedIn = 0, inside = 0, retraced = 0, farthest = 0;
    for (const id of [...subs, 'tb2']) {
      const l = lists.get(id);
      if (!l) { problems.push(`${short(id)}: not recorded`); continue; }
      problems.push(...ends(l, [off, st.office]), ...jumps(l));
      const key = id === 'tb2' ? 'chef' : keys.get(id), r = id === 'tb2' ? rooms.tb2 : rooms.tb;
      const c = crossings(l, r, key, short(id));
      problems.push(...c.bad);
      inside += c.inside;
      const rt = retrace(l, short(id));
      problems.push(...rt.bad);
      retraced += rt.n; farthest = Math.max(farthest, rt.max);
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
    return [report('3d-walk-turnback', problems, `${ended.size} of 13 jobs (12 sub-agents and a chat's chief) ended while the person was inside the office, at depths from 0.35 m to nearly the seat; ${turnedIn} were seen turning round inside it: each walked back out the way it came (${retraced} readings of the walks back, none more than ${farthest.toFixed(2)} m from the line walked in, the limit is ${TRAIL_TOL}), clear of the furniture (${inside} readings inside the office), with no jump, and was removed at the entrance`)];
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

// ---- 3d-walk-readmit
// A chat closes and its chief walks out of its office; another chat takes that office; the first chat is back (a resumed session) before the chief is out, and gets another office. The chief
// is wanted in an office that is not the one it is walking out of, so its walk has to leave the old office by its door and never cross a wall of the offices between, nor their furniture, nor the
// lounge (the straight line to the nearest point of the new route did, through two or three rooms): in one hall it goes back to the lane, along the lane to the new door and in; into another hall
// it goes out to the entrance, along the front of the building to the other entrance and in. The people are read frame by frame against every office of the building and the lounge.
const READMIT = [
  { key: 'a', name: 'one hall, from inside the office, the chat that took the office closes again', before: [], after: [], old: 1, now: 2, where: 'room', sub: true, second: 'close', sameHall: true },
  { key: 'b', name: 'another hall, from the lane, a further chat comes', before: ['f1', 'f2'], after: ['f4'], old: 3, now: 5, where: 'lane', sub: true, second: 'chat', sameHall: false },
  { key: 'c', name: 'another hall, from inside the office, a further chat comes', before: ['f1'], after: [], old: 2, now: 3, where: 'room', second: 'chat', sameHall: false },
];
const insideBox = (r, x, z, m = 0.1) => x > r.X + m && x < r.X + r.W - m && z > r.Z + m && z < r.Z + r.D - m;
async function readmitCase(ctx, c) {
  const problems = [];
  const S = await scenario3d(1, { tag: 'wreadmit' + c.key, root: ctx.root, width: 1100, height: 700, intercept: recordFromStart });
  try {
    const { page } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    await page.evaluate(HELPERS);
    await qa(page, `for (const id of ${JSON.stringify(c.before)}) q.chat(id); q.chat('A'); ${c.sub ? "q.sub('A', 's1');" : ''} for (const id of ${JSON.stringify(c.after)}) q.chat(id); q.sync();`);
    await ev(page, 's.settle()');
    await sleep(900);
    const off = await ev(page, 'o.office()');
    const slotOf = (o, id) => (o.slots.find(x => x.id === id) || {}).slot;
    if (slotOf(off, 'A') !== c.old) problems.push(`A has office ${slotOf(off, 'A')}, want ${c.old}`);
    const oldBox = off.slots.find(x => x.slot === c.old), newBox0 = off.slots.find(x => x.slot === c.now);
    if (!c.sameHall === (oldBox.hall === newBox0.hall)) problems.push(`the offices ${c.old} and ${c.now} are ${oldBox.hall === newBox0.hall ? 'in one hall' : 'in two halls'}: the case is not what it says`);
    const roomOld = await roomOf(page, 'A'), seatA = await ev(page, 'o.seatOf("A")');
    const lane = off.halls[oldBox.hall].lane, doorOld = roomOld.box.X + roomOld.arr.seats[0].walk[1][0];
    await ev(page, 's.rec.take().length');
    await qa(page, `q.remove('A'); q.sync();`);
    // A walks out; the walk is read at the place the case wants it, not at a time
    const at = await until(async () => {
      const f = await ev(page, `o.figures().find(f => f.id === 'A')`);
      if (!f || f.after !== 'gone' || f.mode !== 'walk') return null;
      const inOld = insideBox(roomOld.box, f.x, f.z);
      if (c.where === 'room') return inOld && Math.hypot(f.x - seatA.x, f.z - seatA.z) >= 1.6 ? f : null;
      return !off.slots.some(r => insideBox(r, f.x, f.z)) && Math.abs(f.z - lane) < 0.3 && f.x > doorOld + 1 && f.x < off.entryX - 5 ? f : null;
    }, 60000, 40);
    if (!at) { problems.push(`A was never ${c.where === 'room' ? 'inside its office, walking out' : 'on the hall lane, walking out'}`); return [problems, '']; }
    await qa(page, `q.chat('B'); q.sync();`);                                                      // B takes A's office
    await qa(page, `q.chat('A'); ${c.sub ? "q.sub('A', 's1', 'done');" : ''} q.sync();`);          // A is back, wanted again: its office is taken, the lowest free one is another
    const off2 = await ev(page, 'o.office()');
    if (slotOf(off2, 'B') !== c.old) problems.push(`B has office ${slotOf(off2, 'B')}, want ${c.old} (A's old one)`);
    if (slotOf(off2, 'A') !== c.now) problems.push(`A came back to office ${slotOf(off2, 'A')}, want ${c.now}`);
    const roomNow = await roomOf(page, 'A');
    await sleep(c.second === 'close' ? 600 : 1200);
    if (c.second === 'close') {                                                                     // B closes: the old office is vacant again, and s1 is still walking out of it (its door must open for it)
      await qa(page, `q.remove('B'); q.sync();`);
      await gone(page, 'B', 30000);                                                                 // B's own person is out again: only s1 is left in the vacant office
    }
    if (c.second === 'close') {
      const s1 = await ev(page, `o.figures().find(f => f.id === 's1')`);
      if (!s1 || !insideBox(roomOld.box, s1.x, s1.z)) problems.push('the sub-agent left to leave was not inside the old office when its chat closed: the door proves nothing');
    }
    // a rebuild while A (and s1) are on their way: a further chat (it takes the lowest free office), or, where the old office is to stay vacant, the first chat falling asleep (it leaves its office)
    await qa(page, c.second === 'close' ? `q.status(${JSON.stringify(off.slots.find(x => x.slot === 0).id)}, 'dormant'); q.sync();` : `q.chat('D'); q.sync();`);
    let doorSamples = 0, doorOpen = 0, over = true;
    const t0 = Date.now();
    for (;;) {
      const r = await ev(page, '({ doors: o.doors(), figs: o.figures().map(f => [f.id, f.mode, f.x, f.z]), walking: s.walking.length })');
      if (c.second === 'close') for (const d of r.doors) {
        if (!d.vacant || d.slot !== c.old || d.door !== 'back') continue;
        if (r.figs.some(f => f[0] === 's1' && f[1] === 'walk' && Math.abs(f[2] - d.x) < 0.6 && Math.abs(f[3] - d.z) < 0.8)) { doorSamples++; if (d.open >= 0.3) doorOpen++; }
      }
      if (!r.walking) break;
      if (Date.now() - t0 > 360000) { over = false; break; }
      await sleep(100);
    }
    if (!over) problems.push('somebody was still walking after 6 minutes');
    if (c.second === 'close') {
      if (doorSamples < 2) problems.push(`only ${doorSamples} readings of the sub-agent in the doorway of the office that was vacant again (its door is hinged)`);
      else if (doorOpen / doorSamples < 0.9) problems.push(`the door of the vacant office was open in ${doorOpen} of ${doorSamples} readings of the sub-agent left to leave in its doorway`);
    }
    await sleep(1500);
    const st = await ev(page, '({ rec: s.rec.take(), sit: o.sitting() })');
    const lists = byId(st.rec), l = (lists.get('A') || []).filter(e => e.k === 'frame' || e.k === 'remove' || e.k === 'create');
    const frames = l.filter(e => e.k === 'frame' && e.vis !== false && e.mode !== 'seated');
    if (l.some(e => e.k === 'remove' || e.k === 'create')) problems.push(`A was ${l.some(e => e.k === 'remove') ? 'removed' : 'made again'}: it must walk out of the old office and into the new one as one person`);
    const L = off2.lounge, doors = { [c.old]: doorOld, [c.now]: roomNow.box.X + roomNow.arr.seats[0].walk[1][0] };
    const regionOf = (x, z) => (L && insideBox(L, x, z) ? 'the lounge' : (() => { const r = off2.slots.find(q => insideBox(q, x, z)); return r ? `office ${r.slot}` : 'outside'; })());
    const allowed = new Set(['outside', `office ${c.old}`, `office ${c.now}`]);
    let prev = null, seen = new Set(), strays = new Set(), wrongDoor = [];
    for (const e of frames) {
      const reg = regionOf(e.x, e.z);
      seen.add(reg);
      if (!allowed.has(reg)) strays.add(reg);
      if (prev && prev.reg !== reg) for (const [r, x] of Object.entries(doors)) if ((reg === `office ${r}` || prev.reg === `office ${r}`) && Math.abs((e.x + prev.x) / 2 - x) > 0.8) wrongDoor.push(`office ${r} entered or left at (${f1((e.x + prev.x) / 2)}, ${f1((e.z + prev.z) / 2)}), its door is at x ${f1(x)}`);
      prev = { reg, x: e.x, z: e.z };
    }
    if (strays.size) problems.push(`A walked through ${[...strays].join(' and ')} on its way to office ${c.now}`);
    problems.push(...wrongDoor.slice(0, 2));
    if (!seen.has(`office ${c.old}`) || !seen.has(`office ${c.now}`)) problems.push(`A was not read in both offices (${[...seen].join(', ')})`);
    const ca = crossings(l.filter(e => e.k === 'frame'), roomOld, 'chef', 'A in the old office'), cb = crossings(l.filter(e => e.k === 'frame'), roomNow, 'chef', 'A in the new office');
    problems.push(...ca.bad, ...cb.bad, ...jumps(l.filter(e => e.k === 'frame')));
    if (!frames.some(e => e.after === 'sit')) problems.push('A never turned back toward a seat');
    const sp = st.sit.find(x => x.id === 'A'), seat = roomNow.arr.seats.find(x => x.key === 'chef');
    if (!sp || sp.mode !== 'seated' || Math.hypot(sp.x - (roomNow.box.X + seat.pos[0]), sp.z - (roomNow.box.Z + seat.pos[1])) > 0.03) problems.push(`A does not sit on the chat's seat of office ${c.now} at the end (${sp ? sp.mode + ' ' + f1(sp.x) + ', ' + f1(sp.z) : 'not in the scene'})`);
    if (c.sub) {                                                                                   // s1 was not wanted again: it walks out of the old office by its own route, to the old hall's entrance
      const ls = (lists.get('s1') || []), fs = ls.filter(e => e.k === 'frame' && e.vis !== false), last = ls[ls.length - 1];
      const stray = fs.map(e => regionOf(e.x, e.z)).filter(r => r !== 'outside' && r !== `office ${c.old}`);
      if (!fs.length) problems.push('no readings of the sub-agent that was left to leave');
      if (stray.length) problems.push(`the sub-agent left to leave walked through ${stray[0]}`);
      if (!last || last.k !== 'remove' || Math.hypot(last.x - off.entryX, last.z - lane) > 1.3) problems.push(`the sub-agent left to leave was not removed at the entrance of the old hall (${last ? last.k + ' at ' + f1(last.x) + ', ' + f1(last.z) : 'no events'})`);
      problems.push(...crossings(fs, roomOld, 0, 's1 in the old office').bad, ...jumps(fs));
    }
    problems.push(...(await books(page)));
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return [problems, `${c.name} (office ${c.old} to ${c.now}, read ${c.where === 'room' ? 'inside the office' : 'on the lane'}): ${frames.length} readings of A in ${[...seen].join(', ')}, ${ca.inside + cb.inside} of them in the two offices, none within ${CLEAR} m of a piece, doors only, no jump, never made again, seated on the new seat`];
  } finally { await S.done(); }
}
async function runReadmit(ctx) {
  const problems = [], notes = [];
  for (const c of READMIT) {
    const [p, text] = await readmitCase(ctx, c);
    problems.push(...p.map(x => `[${c.key}] ${x}`));
    notes.push(text);
  }
  return [report('3d-walk-readmit', problems, notes.filter(Boolean).join('; '))];
}

// ---- 3d-walk-lights
// The light of an office follows its people (public/js/ofis-presence.js; the rule alone is test/ofis-presence.test.mjs). Here it is read in the page, against the people the scene really has,
// frame by frame: the scene's recorder carries the number of its frame (`n`) with every figure event, and after every frame the light of every office (`lights`: the frame, the wall clock and
// per office [slot, the number, the number it is going to (the switch), the chat that has the office]). This file's own model of the rule (it knows nothing of the code's) judges every frame
// of every office:
//   - somebody is inside it: the switch has been thrown on, in the very frame the person came in (the pass runs after the walkers have moved, so not a frame later)
//   - nobody is inside it, nor within a wall's width of it: the switch is on exactly when a chat has the office AND a person of that chat has been inside since it took the office (an office
//     a chat has taken stays dark until the chat's own person is through the door; a vacant one is dark in the frame its last person is out; the people of another chat, walking out of an
//     office that a new chat has taken, do not light it for the new chat for good), and off otherwise
//   - the number follows the switch: it has reached it 200 ms after the frame the switch was thrown (the ease is a time on the wall clock, not a number of frames), and in between it only
//     moves toward it
// Named allowances: the 0.1 m band beside a wall (a person there is neither inside nor outside: the rule's own edge is the wall), and the ease (a number below 0.5 with somebody inside is
// fine only within 200 ms of the switch being thrown). Four scenes: the arrivals, closings, a brief job and the rebuilds on one page (`main`), a chat that is back in another office while
// its person walks out of the old one (`readmit`), a page load with ten chats (`load`), and prefers-reduced-motion with the lounge's people on the plaza (`reduced`).
const BAND = 0.1;
const strictIn = (b, p) => p.x > b.X + BAND && p.x < b.X + b.W - BAND && p.z > b.Z + BAND && p.z < b.Z + b.D - BAND;
const nearBox = (b, p) => p.x > b.X - BAND && p.x < b.X + b.W + BAND && p.z > b.Z - BAND && p.z < b.Z + b.D + BAND;
function auditLights(rec, lights, office, chatOf, tag = '') {
  const boxes = new Map(office.slots.map(s => [s.slot, s])), byN = new Map(), problems = [];
  for (const e of rec) if (e.k === 'frame' && e.vis !== false && !(e.delay > 0)) { if (!byN.has(e.n)) byN.set(e.n, []); byN.get(e.n).push(e); }
  const st = { frames: lights.length, inside: 0, vacantLit: 0, darkTaken: 0, swings: 0, scene: 0 };
  const model = new Map(), flip = new Map(), last = new Map();
  const bad = (what, L, slot) => { if (problems.length < 8) problems.push(`${tag}frame ${L.n} office ${slot}: ${what}`); };
  for (const L of lights) {
    const people = byN.get(L.n) || [];
    st.scene += L.dt || 0;
    for (const [slot, lit, tgt, owner] of L.rooms) {
      const b = boxes.get(slot);
      if (!b) continue;
      let m = model.get(slot);
      if (!m || m.owner !== owner) model.set(slot, m = { owner, entered: false });
      const inside = people.filter(p => strictIn(b, p));
      if (owner !== null && inside.some(p => chatOf(p.id) === owner)) m.entered = true;
      if (inside.length) {
        st.inside++;
        if (tgt !== 1) bad(`${inside.length} people inside (${short(inside[0].id)}) and the switch is ${tgt}`, L, slot);
        if (owner === null && tgt === 1) st.vacantLit++;
      } else if (!people.some(p => nearBox(b, p))) {
        const want = owner !== null && m.entered ? 1 : 0;
        if (tgt !== want) bad(want ? 'its chat has been inside and the switch is off' : `nobody is in it${owner === null ? ' (vacant)' : ' and its chat has not been inside'} and the switch is on`, L, slot);
        if (owner !== null && tgt === 0 && !m.entered) st.darkTaken++;
      }
      const f = flip.get(slot);
      if (!f || f.tgt !== tgt) flip.set(slot, { tgt, t0: L.t });
      else {
        const ease = L.t - f.t0, pl = last.get(slot);
        if (ease >= SWITCH_MS + 2 && lit !== tgt) bad(`the light is ${lit} ${ease.toFixed(0)} ms after the switch went to ${tgt}`, L, slot);
        if (inside.length && lit < 0.5 && ease >= SWITCH_MS + 2) bad(`somebody is inside and the light is ${lit}`, L, slot);
        if (pl !== undefined && (tgt === 1 ? lit < pl - 1e-6 : lit > pl + 1e-6)) { st.swings++; bad(`the light moved away from the switch (${pl} to ${lit}, switch ${tgt})`, L, slot); }
      }
      last.set(slot, lit);
    }
  }
  return { problems, st };
}
const chatOfId = real => id => (id === real ? real : String(id).split(':')[0].replace(/-s\d+$/, ''));
const takeLightsRec = async (page, into) => { into.rec.push(...(await ev(page, 's.rec.take()'))); into.lights.push(...(await ev(page, 's.rec.takeLights()'))); };
const targetsOf = 'o.office().slots.map(s => o.litTarget(s.slot)).join("")';
const inAnyRoom = (office, p) => office.slots.some(s => strictIn(s, p));

// `main`: one page, one chat of the page's own in slot 0 (seated, lit). A chat arrives (dark until its chief is through the door); a chat with three sub-agents is seated and closes (lit while
// anybody is inside, dark in the frame the last is out); a brief job (a chat that ends 0.5 s after it came) never lights its office; a rebuild while a chief walks in (the office must stay
// dark, read in the very task of the rebuild, before any frame) and one while a chief walks out (it must stay lit)
async function lightsMain(ctx) {
  const problems = [], got = { rec: [], lights: [] };
  const S = await scenario3d(1, { tag: 'wlights', root: ctx.root, width: 1100, height: 700, intercept: recordFromStart, fixture: { statuses: ['working'], subs: () => ['working'] } });
  try {
    const { page, fx } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    await page.evaluate(HELPERS);
    const real = fx.agents[0].id, slotOf = id => ev(page, `(o.office().slots.find(s => s.id === ${JSON.stringify(id)}) || {}).slot`);
    await ev(page, 's.rec.take().length');
    await ev(page, 's.rec.takeLights().length');
    // a chat arrives: furnished and signed, and dark
    await qa(page, `q.chat('arr'); q.sync();`);
    const arr = await slotOf('arr');
    const a0 = await ev(page, `[o.lit(${arr}), o.litTarget(${arr})]`);
    if (a0[0] !== 0 || a0[1] !== 0) problems.push(`the office of a chat that has just come is lit at once (light ${a0[0]}, switch ${a0[1]})`);
    if (!(await idle(page))) problems.push('the chief of the arriving chat was still walking after 2 minutes');
    await sleep(500);
    await takeLightsRec(page, got);
    if ((await ev(page, `o.lit(${arr})`)) !== 1) problems.push('the office of the arrived chat is not lit once its chief sits');
    // a chat with three sub-agents is seated, then closes: lit while anybody is inside, dark when the last is out
    await qa(page, `q.chat('cl'); q.sub('cl', 'cl-s0'); q.sub('cl', 'cl-s1'); q.sub('cl', 'cl-s2'); q.sync();`);
    const cl = await slotOf('cl');
    if (!(await idle(page))) problems.push('the chat with three sub-agents was still walking in after 2 minutes');
    await sleep(700);
    const seatedCl = await ev(page, `o.figures().filter(f => /^cl/.test(f.id) && f.mode === 'seated').length`);
    if (seatedCl !== 4) problems.push(`${seatedCl} of the 4 people of the chat are seated before it closes`);
    await takeLightsRec(page, got);
    await qa(page, `q.remove('cl'); q.sync();`);
    const c0 = await ev(page, `[o.lit(${cl}), o.litTarget(${cl}), o.office().slots.find(s => s.slot === ${cl}).vacant]`);
    if (c0[2] !== true) problems.push('the office is not vacant right after its chat closed');
    if (c0[0] !== 1 || c0[1] !== 1) problems.push(`the office of a chat that has just closed is dark at once (light ${c0[0]}, switch ${c0[1]}) while its four people are still standing up inside it`);
    if (!(await idle(page))) problems.push('the closed chat\'s people were still walking out after 2 minutes');
    await sleep(900);
    await takeLightsRec(page, got);
    if ((await ev(page, `o.lit(${cl})`)) !== 0) problems.push('the office of the closed chat is not dark once everybody has left');
    // a brief job: the chat ends 0.5 s after it came, long before its chief reaches the door
    await qa(page, `q.chat('brief'); q.sync();`);
    const br = await slotOf('brief');
    await sleep(500);
    await qa(page, `q.remove('brief'); q.sync();`);
    if (!(await idle(page))) problems.push('the brief chat\'s chief was still walking after 2 minutes');
    await sleep(600);
    await takeLightsRec(page, got);
    // a rebuild while a chief walks in: read in the very task of the rebuild, so that no frame comes between it and the reading
    await qa(page, `q.chat('rbi'); q.sync();`);
    const rbi = await slotOf('rbi');
    const way = await until(async () => ev(page, `(f => (f && f.vis && f.mode === 'walk' && f.x < o.office().entryX - 2 ? [f.x, f.z] : null))(o.figures().find(f => f.id === 'rbi'))`), 60000, 40);
    const off1 = await ev(page, 'o.office()');
    if (!way || inAnyRoom(off1, { x: way[0], z: way[1] })) problems.push('the chief walking in was not in the hall, outside every office, for the rebuild: the case was not made');
    const r1 = await ev(page, `(() => { const all = () => ${targetsOf}, f = () => o.figures().find(f => f.id === 'rbi'); const before = [all(), o.litTarget(${rbi})]; o.rebuildNow(); const mid = [all(), o.litTarget(${rbi}), f().mode]; window.__qa.chat('rbi2'); window.__qa.sync(); const after = [all(), o.litTarget(${rbi}), f().mode]; return { before, mid, after }; })()`);
    if (r1.mid[2] !== 'walk' || r1.after[2] !== 'walk') problems.push('the chief was no longer walking when the rebuild was read');
    if (r1.mid[1] !== 0 || r1.after[1] !== 0) problems.push(`a rebuild lit the office of a chat whose chief is still in the hall (switch ${r1.mid[1]} after a rebuild, ${r1.after[1]} after a rebuild for a new chat)`);
    if (r1.before[0] !== r1.mid[0] || r1.before[0] !== r1.after[0]) problems.push(`a rebuild changed the switches of the offices (${r1.before[0]} -> ${r1.mid[0]} -> ${r1.after[0]})`);
    if (!(await idle(page))) problems.push('the chiefs of the rebuild case were still walking after 2 minutes');
    await sleep(700);
    await takeLightsRec(page, got);
    // a rebuild while a chief walks out of an office whose chat has closed: it must stay lit, read in the task of the rebuild
    await qa(page, `q.chat('rbo'); q.sync();`);
    const rbo = await slotOf('rbo');
    if (!(await idle(page))) problems.push('the chief of the chat that closes in the rebuild case was still walking in after 2 minutes');
    await sleep(700);
    await takeLightsRec(page, got);
    const boxO = (await ev(page, 'o.office()')).slots.find(s => s.slot === rbo);
    await qa(page, `q.remove('rbo'); q.sync();`);
    const out = await until(async () => ev(page, `(f => (f && f.after === 'gone' && f.mode === 'walk' && f.x > ${boxO.X + 2 * BAND} && f.x < ${boxO.X + boxO.W - 2 * BAND} && f.z > ${boxO.Z + 2 * BAND} && f.z < ${boxO.Z + boxO.D - 2 * BAND} ? [f.x, f.z] : null))(o.figures().find(f => f.id === 'rbo'))`), 30000, 25);
    if (!out) problems.push('the chief of the closed chat was never read walking out inside its office');
    const r2 = await ev(page, `(() => { const all = () => ${targetsOf}, f = () => o.figures().find(f => f.id === 'rbo'); const before = [all(), o.litTarget(${rbo}), f() && f().mode]; o.rebuildNow(); const mid = [all(), o.litTarget(${rbo}), f() && f().mode]; return { before, mid }; })()`);
    if (r2.before[1] !== 1) problems.push(`the office of the closing chat was dark (switch ${r2.before[1]}) while its chief was walking out inside it`);
    if (r2.mid[1] !== 1) problems.push(`a rebuild darkened an office with its chief still walking out inside it (switch ${r2.mid[1]} after the rebuild)`);
    if (r2.before[0] !== r2.mid[0]) problems.push(`a rebuild changed the switches of the offices (${r2.before[0]} -> ${r2.mid[0]})`);
    if (!(await idle(page))) problems.push('the chief walking out was still walking after 2 minutes');
    await sleep(900);
    await takeLightsRec(page, got);
    const end = await ev(page, 'o.office()');
    // what was read
    const a = auditLights(got.rec, got.lights, end, chatOfId(real));
    problems.push(...a.problems);
    const frames = slot => got.lights.map(L => L.rooms.find(r => r[0] === slot)).filter(Boolean);
    const arrDark = frames(arr).filter(r => r[3] === 'arr' && r[2] === 0).length, brief = frames(br).filter(r => r[3] === 'brief');
    if (arrDark < 30) problems.push(`only ${arrDark} frames of the arrived chat's office dark while its chief walked (nothing to judge "dark until the door" by)`);
    if (a.st.vacantLit < 10) problems.push(`only ${a.st.vacantLit} frames of a vacant office lit with its people walking out (nothing to judge "lit until the last has left" by)`);
    if (brief.length < 2) problems.push(`the brief chat was seen in ${brief.length} frames`);
    else if (brief.some(r => r[1] !== 0 || r[2] !== 0)) problems.push(`the office of the brief chat was lit (light ${Math.max(...brief.map(r => r[1]))}) though its chief never reached the door`);
    if (!got.rec.some(e => e.id === 'brief' && e.k === 'frame' && e.vis !== false)) problems.push('the brief chat\'s chief was never drawn: it is not the case it says');
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return { problems, note: `${a.st.frames} frames (${a.st.scene.toFixed(0)} s of the scene's time) of ${end.slots.length} offices read against the people: a chat arrived (its office dark for ${arrDark} frames while the chief walked, lit in the frame it came through the door), a chat with three sub-agents closed (lit for ${a.st.vacantLit} frames of the vacant office while its people walked out, dark in the frame the last was out), a brief job never lit its office (${brief.length} frames), a rebuild while a chief walks in (still dark, the very task) and while one walks out (still lit), light never moved away from its switch and reached it within 200 ms` };
  } finally { await S.done(); }
}

// `readmit`: A closes and its chief (and a sub-agent) walk out; B takes A's office while A's chief is still inside it; A is back (another office). The old office is lit for A's people while they
// are inside, DARK once the last has gone (B's chief has not come: nobody of B has been inside), and lit again when B's chief is through the door; A's new office is lit when A's chief comes
// through its door
async function lightsReadmit(ctx) {
  const problems = [], got = { rec: [], lights: [] };
  const S = await scenario3d(1, { tag: 'wlreadmit', root: ctx.root, width: 1100, height: 700, intercept: recordFromStart, fixture: { statuses: ['working'], subs: () => ['working'] } });
  try {
    const { page, fx } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    await page.evaluate(HELPERS);
    await qa(page, `q.chat('A'); q.sub('A', 's1'); q.sync();`);
    await ev(page, 's.settle()');
    await sleep(900);
    const real = fx.agents[0].id, off = await ev(page, 'o.office()'), old = off.slots.find(s => s.id === 'A');
    const seatA = await ev(page, 'o.seatOf("A")');
    await ev(page, 's.rec.take().length');
    await ev(page, 's.rec.takeLights().length');
    await qa(page, `q.remove('A'); q.sync();`);
    const at = await until(async () => ev(page, `(f => (f && f.after === 'gone' && f.mode === 'walk' && f.x > ${old.X + 0.3} && f.x < ${old.X + old.W - 0.3} && f.z > ${old.Z + 0.3} && f.z < ${old.Z + old.D - 0.3} && Math.hypot(f.x - ${seatA.x}, f.z - ${seatA.z}) >= 1.6 ? [f.x, f.z] : null))(o.figures().find(f => f.id === 'A'))`), 60000, 30);
    if (!at) problems.push('the chief of the closed chat was never inside its office, walking out');
    await qa(page, `q.chat('B'); q.sync();`);
    await qa(page, `q.chat('A'); q.sub('A', 's1', 'done'); q.sync();`);
    const off2 = await ev(page, 'o.office()'), slotB = (off2.slots.find(s => s.id === 'B') || {}).slot, slotA = (off2.slots.find(s => s.id === 'A') || {}).slot;
    if (slotB !== old.slot) problems.push(`B has office ${slotB}, want ${old.slot} (A's old one)`);
    if (slotA === undefined || slotA === old.slot) problems.push(`A came back to office ${slotA}, want another one than ${old.slot}`);
    const mid = await ev(page, `[o.lit(${old.slot}), o.litTarget(${old.slot})]`);
    if (mid[1] !== 1) problems.push(`the office that B has taken was dark (switch ${mid[1]}) while A's chief and sub-agent were still inside it`);
    if (!(await idle(page, 360000))) problems.push('somebody was still walking after 6 minutes');
    await sleep(1500);
    await takeLightsRec(page, got);
    const end = await ev(page, 'o.office()');
    const a = auditLights(got.rec, got.lights, end, id => (id === "s1" ? "A" : chatOfId(real)(id)));
    problems.push(...a.problems);
    const gap = got.lights.map(L => L.rooms.find(r => r[0] === old.slot)).filter(r => r && r[3] === 'B' && r[2] === 0).length;
    if (gap < 3) problems.push(`only ${gap} frames in which B's office was dark after A's people had left it and before B's chief came (nothing to judge "not lit for nobody" by)`);
    const fin = await ev(page, `[o.lit(${old.slot}), o.lit(${slotA})]`);
    if (fin[0] !== 1 || fin[1] !== 1) problems.push(`at the end B's office is at ${fin[0]} and A's new office at ${fin[1]} (want both lit: their chiefs are seated)`);
    const hid = got.rec.filter(e => e.id === 's1' && e.k === 'frame' && e.vis !== false).length;
    if (hid < 10) problems.push(`only ${hid} readings of the sub-agent left to leave`);
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return { problems, note: `readmit: A's old office ${old.slot} (B's now) lit while A's chief and sub-agent were inside, dark for ${gap} frames once they were out and B's chief had not come, lit again when it did; A's new office ${slotA} lit when A's chief came through its door; ${a.st.frames} frames judged` };
  } finally { await S.done(); }
}

// `load`: the page opens with ten chats and three sub-agents: every office is dark in the first frame, and lights one at a time as its chief comes through its door (the queue is hurried), never
// before; at the end all ten are lit
async function lightsLoad(ctx) {
  const problems = [], got = { rec: [], lights: [] };
  const S = await scenario3d(10, { tag: 'wlload', root: ctx.root, width: 1100, height: 700, settle: false, intercept: recordFromStart, fixture: { statuses: Array(10).fill('working'), subs: i => (i < 3 ? ['working'] : []) } });
  try {
    const { page, fx } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    if (!(await idle(page, 240000))) problems.push('somebody was still walking after 4 minutes');
    await sleep(900);
    await takeLightsRec(page, got);
    const end = await ev(page, 'o.office()');
    const owned = end.slots.filter(s => !s.vacant).map(s => s.slot);
    const a = auditLights(got.rec, got.lights, end, chatOfId(null));
    problems.push(...a.problems);
    const first = got.lights[0];
    if (!first || first.rooms.some(r => r[2] !== 0 || r[1] !== 0)) problems.push('an office was lit in the first frame, before anybody had come through a door');
    const firstOn = new Map();
    for (const L of got.lights) for (const r of L.rooms) if (r[2] === 1 && !firstOn.has(r[0])) firstOn.set(r[0], L.n);
    const frames = [...new Set(owned.map(s => firstOn.get(s)))];
    if (owned.length !== 10 || owned.some(s => !firstOn.has(s))) problems.push(`${owned.filter(s => firstOn.has(s)).length} of ${owned.length} offices with a chat were ever lit`);
    const span = got.lights.filter(L => L.n >= Math.min(...[...firstOn.values()]) && L.n <= Math.max(...[...firstOn.values()])).reduce((s, L) => s + L.dt, 0);
    // (a hurried queue sends the longest walks first so that everybody arrives at about the same time: the chiefs cross their doors within a few seconds, not ten seconds apart)
    if (frames.length < 5 || span < 1.5) problems.push(`the offices lit in ${frames.length} different frames over ${span.toFixed(1)} s of the scene's time (want 5 or more frames and 1.5 s or more: one as each chief comes in, not all at once)`);
    const lit = await ev(page, 'o.office().slots.map(s => [s.vacant, o.lit(s.slot)])');
    if (lit.some(([vac, v]) => v !== (vac ? 0 : 1))) problems.push('at the end an office has the wrong light');
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return { problems, note: `page load with ${owned.length} chats and 3 sub-agents: dark in the first frame, the offices came on in ${frames.length} different frames over ${span.toFixed(1)} s of the scene's time, each in the frame its chief was through the door (${a.st.frames} frames judged, ${a.st.darkTaken} frame-readings of a taken office dark with nobody of its chat in it)` };
  } finally { await S.done(); }
}

// `reduced`: with prefers-reduced-motion the light has no ease (the number is 0 or 1 in every frame) and still follows the people; the lounge's people (`?lounge=demo`) stand on the plaza, in no
// office: the vacant offices stay dark with the same furnishing
async function lightsReduced(ctx) {
  const problems = [], got = { rec: [], lights: [] };
  const S = await scenario3d(4, { tag: 'wlreduced', root: ctx.root, width: 1100, height: 700, query: 'lounge=demo', reducedMotion: true, settle: false, intercept: recordFromStart, fixture: { statuses: Array(4).fill('working'), subs: i => (i === 0 ? ['working'] : []) } });
  try {
    const { page, fx } = S;
    if (!S.ready.ok) problems.push('the scene did not become ready');
    await page.evaluate(HELPERS);
    const folk = [];
    const poll = async () => { const l = await ev(page, 'o.lounge.people.map(p => [p.x, p.z])'); folk.push(...l); return l.length; };
    const t0 = Date.now();
    while (Date.now() - t0 < 120000 && (await ev(page, 's.walking.length'))) { await poll(); await sleep(1500); }
    await qa(page, `q.chat('rm'); q.sync();`);
    while (Date.now() - t0 < 240000 && (await ev(page, 's.walking.length'))) { await poll(); await sleep(1500); }
    await sleep(700);
    await qa(page, `q.remove('rm'); q.sync();`);
    while (Date.now() - t0 < 360000 && (await ev(page, 's.walking.length'))) { await poll(); await sleep(1500); }
    await sleep(700);
    await poll();
    await takeLightsRec(page, got);
    const end = await ev(page, 'o.office()');
    const a = auditLights(got.rec, got.lights, end, chatOfId(null));
    problems.push(...a.problems);
    const between = got.lights.flatMap(L => L.rooms).filter(r => r[1] !== 0 && r[1] !== 1).length;
    if (between) problems.push(`${between} readings of a light between 0 and 1 with prefers-reduced-motion (it switches at once)`);
    if (folk.length < 3) problems.push(`only ${folk.length} readings of people of the lounge (nothing to judge "the lounge's people count for no office" by)`);
    const strays = folk.filter(([x, z]) => end.slots.some(s => nearBox(s, { x, z })));
    if (strays.length) problems.push(`${strays.length} readings of a person of the lounge inside or at an office (at ${strays[0].map(v => v.toFixed(1)).join(', ')})`);
    const vacant = end.slots.filter(s => s.vacant).map(s => s.slot);
    if (errorsOf(page).length) problems.push(`console error: ${errorsOf(page)[0].slice(0, 120)}`);
    return { problems, note: `prefers-reduced-motion with the lounge's people about (${folk.length} readings of them, none at an office): the light was 0 or 1 in every one of ${a.st.frames} frames and followed the people (a chat came and closed too), the ${vacant.length} vacant offices stayed dark (their furnishing is the same)` };
  } finally { await S.done(); }
}

const LIGHT_PARTS = { main: lightsMain, readmit: lightsReadmit, load: lightsLoad, reduced: lightsReduced };
async function runLights(ctx) {
  const parts = ctx.parts || (val('part') ? val('part').split(',') : Object.keys(LIGHT_PARTS));          // (--only lights --part main|readmit|load|reduced runs one scene; a mutation names the scenes that guard its line)
  const problems = [], notes = [];
  for (const k of parts) {
    const r = await LIGHT_PARTS[k](ctx);
    problems.push(...r.problems.map(x => `[${k}] ${x}`));
    notes.push(r.note);
  }
  return [report('3d-walk-lights', problems, notes.join('; '))];
}

const CHECKS = { lights: runLights, load: runLoad, calm: runCalm, brief: runBrief, leave: runLeave, flap: runFlap, rebuild: runRebuild, growout: runGrowOut, seats: runSeats, turnback: runTurnBack, reseat: runReseat, readmit: runReadmit, hidden: runHidden, follow: runFollow, settle: runSettle, reduced: runReduced };
const NAME = { lights: '3d-walk-lights', load: '3d-walk-load', calm: '3d-walk-calm', brief: '3d-walk-brief', leave: '3d-walk-leave', flap: '3d-walk-flap', rebuild: '3d-walk-rebuild', growout: '3d-walk-growout', seats: '3d-walk-seats', turnback: '3d-walk-turnback', reseat: '3d-walk-reseat', readmit: '3d-walk-readmit', hidden: '3d-walk-hidden', follow: '3d-walk-follow', settle: '3d-walk-settle', reduced: '3d-walk-reduced' };

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
  // a chat that is back in another office while its person walks out of the old one (3d-walk-readmit)
  { name: 'a chat that is back in another office is joined to it by the straight line from where the person stands', file: 'public/js/ofis-arrive.js', from: '  if (d < 1) {\n', to: "  if (d < 1) return compact([p, ...m.link, ...repath(newRoute, m.at, 'seat')]);\n  if (false) {\n", fails: 'readmit' },
  { name: 'a person wanted in another hall is joined to it along the lane of its old hall', file: 'public/js/ofis-arrive.js', from: 'if (!sameHall(oldRoute, newRoute) || newRoute.length < 2) return', to: 'if (newRoute.length < 2) return', fails: 'readmit' },
  { name: 'a person walking out of an office that is not its chat\'s now is put on the new office', file: 'public/js/ofis.js', from: "      if (out && c.route && c.cell !== room.slot) { exitVacated(c, null, true); continue; }", to: "", fails: 'readmit' },
  { name: 'the door of a vacant office stays shut for a person of a chat that is in another office', file: 'public/js/ofis.js', from: "if (c.cell >= 0 && (!roomIds.has(c.roomId) || c.after === 'gone')) leavingSlots.add(c.cell);", to: "if (c.cell >= 0 && !roomIds.has(c.roomId)) leavingSlots.add(c.cell);", fails: 'readmit' },
  { name: 'a person is put on its seat from the stand point instead of walking onto it', file: 'public/js/ofis.js', edits: [['    for (const q of s.approach) p.push(q.clone());\n    p.push(s.pos.clone());', '    for (const q of s.approach) p.push(q.clone());'], ["    c.mode = 'seated'; c.after = null; c.th = c.seat ? c.seat.facing : -Math.PI / 2;", "    c.mode = 'seated'; c.after = null; c.th = c.seat ? c.seat.facing : -Math.PI / 2; if (c.seat) { c.root.position.x = c.seat.pos.x; c.root.position.z = c.seat.pos.z; }"]], fails: 'seats' },
  { name: 'a person gets up at the stand point of its seat, not on the seat', file: 'public/js/ofis.js', from: "    const stand = c.sit > 0.5;\n", to: "    const stand = c.sit > 0.5;\n    if (c.seat) c.root.position.set(c.seat.stand.x, 0, c.seat.stand.z);\n", fails: 'seats' },
  { name: 'every seat has the old fixed height of the hip', file: 'public/js/ofis.js', from: 'const seatHip = c => (c.seat && c.seat.hip) || PK_SEAT;', to: 'const seatHip = c => PK_SEAT;', fails: 'seats' },
  { name: 'the seat a person walks to is not recorded: it sits on no seat of its own', file: 'public/js/ofis.js', from: '    c.seat = seatFor(room, seatKey(c, c.slot));\n    c.root.position.set(route[0].x, 0, route[0].z);', to: '    c.root.position.set(route[0].x, 0, route[0].z);', fails: 'seats' },
  { name: '?arrive=calm is ignored', file: 'public/js/ofis.js', from: "{ rush: instant && !CALM_LOAD,", to: "{ rush: instant,", fails: 'calm' },
  // guards that no check had (each was broken in a scratch copy and the walk checks still passed)
  { name: 'the chief\'s screen is on before the chief has sat', file: 'public/js/ofis.js', from: "if (!ch || ch.mode !== 'seated' || ch.sit < 0.85) { col = SCR_OFF; }", to: 'if (!ch) { col = SCR_OFF; }', fails: 'load' },
  { name: 'a figure that waits at the entrance can be hovered and clicked', file: 'public/js/ofis.js', from: 'for (const c of chars.values()) if (c.delay <= 0) objs.push(c.hit);', to: 'for (const c of chars.values()) objs.push(c.hit);', fails: 'rebuild' },
  { name: 'a gone agent\'s balloon stays on above the figure that walks out', file: 'public/js/ofis.js', from: 'if (!a) { c.bal.want = false; continue; }', to: 'if (!a) { continue; }', fails: 'leave' },
  { name: 'a sub-agent that is wanted again takes the first free seat, not the one it left', file: 'public/js/ofis.js', from: 'slot = c.slotWas >= 0 && c.slotWas < room.cap && !room.slotChar[c.slotWas] ? c.slotWas : room.slotChar.indexOf(null);', to: 'slot = room.slotChar.indexOf(null);', fails: 'flap' },
  { name: 'a walk back cuts the corner in the hall instead of taking the way it came in', file: 'public/js/ofis-arrive.js', from: '...path.slice(0, Math.max(0, Math.min(pi, path.length))).reverse()]);', to: '...path.slice(0, Math.max(0, Math.min(pi, path.length))).filter((_, i) => i !== 1).reverse()]);', fails: 'turnback' },
  // the lights follow the people (3d-walk-lights; `parts` are the scenes that guard the line)
  { name: 'the lights follow the data again: an office with a chat is lit at once, a vacant one is dark', file: 'public/js/ofis.js', from: '    for (const [slot, on] of lightOut) decor.setLit(slot, on, instant);', to: '    for (const r of rooms) decor.setLit(r.slot, r.owner !== null, instant);', fails: 'lights', parts: ['main'] },
  { name: 'the lights go off the moment a chat closes, with its people still walking out', file: 'public/js/ofis-presence.js', from: 'out.set(r.slot, inside || (r.owner !== null && st.entered));', to: 'out.set(r.slot, r.owner !== null && (inside || st.entered));', fails: 'lights', parts: ['main'] },
  { name: 'the lights come on when a chat takes the office, before its chief is through the door', file: 'public/js/ofis-presence.js', from: 'out.set(r.slot, inside || (r.owner !== null && st.entered));', to: 'out.set(r.slot, inside || r.owner !== null);', fails: 'lights', parts: ['main'] },
  { name: 'the box of an office reaches 2.5 m into the hall: its light comes on while the chief is still outside the door', file: 'public/js/ofis.js', from: 'x0: r.X, x1: r.X + r.W, z0: r.Z, z1: r.Z + r.D }));', to: 'x0: r.X, x1: r.X + r.W, z0: r.Z - 2.5, z1: r.Z + r.D + 2.5 }));', fails: 'lights', parts: ['main'] },
  { name: 'a rebuild resets the light from the data', file: 'public/js/ofis.js', from: '    lightsFor(instantNext);\n    decor.finish(g);', to: '    lightsFor(instantNext);\n    for (const r of world.lightRooms) decor.setLit(r.slot, r.owner !== null, instantNext);\n    decor.finish(g);', fails: 'lights', parts: ['main'] },
  { name: 'the person of any chat lights an office for the chat that has it: the new chat\'s office stays lit after the old chat\'s chief has left', file: 'public/js/ofis-presence.js', from: 'if (r.owner !== null && p.chat === r.owner) { st.entered = true; break; }', to: 'if (r.owner !== null) { st.entered = true; break; }', fails: 'lights', parts: ['readmit'] },
  { name: 'sub-agents do not hold the light: only chiefs count as people', file: 'public/js/ofis.js', from: 'if (c.force || c.delay > 0) continue;', to: 'if (c.force || c.delay > 0 || !c.main) continue;', fails: 'lights', parts: ['main', 'readmit'] },
  { name: 'the light is read before the walkers move, a frame behind them', file: 'public/js/ofis.js', edits: [['    for (const c of [...chars.values()]) animChar(c, dt, T);\n', '    lightsFor();\n    for (const c of [...chars.values()]) animChar(c, dt, T);\n'], ['    lightsFor();                                          // after the walkers have moved: the light of an office follows who is inside it now\n', '']], fails: 'lights', parts: ['main'] },
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
        try { r = await CHECKS[k]({ root: dir, parts: m.parts }); } catch (e) { await sleep(2000); r = await CHECKS[k]({ root: dir, parts: m.parts }); }        // a run that throws (the harness, the server) is run once more: only a result counts
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
