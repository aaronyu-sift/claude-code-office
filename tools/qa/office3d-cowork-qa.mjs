// QA of the coworking offices of the 3D scene (public/js/ofis-arrange.js plans them, ofis-decor.js draws them, ofis.js seats the people): headless Chrome with software WebGL in
// a throw-away profile, the server against a fake ~/.claude, one `CHECK <name> PASS|FAIL <detail>` line per check and a final `QA PASS` or `QA FAIL`.
//   node tools/qa/office3d-cowork-qa.mjs [--only arrangements|looks|no-chair|paths|seats|folder|slot] [--mutations [--mutation <words>[|<words>]]]
//
//   3d-cowork-arrangements  a building of 20 offices: every named arrangement (the work parts and the soft parts of ofis-arrange.js) is drawn at least once, at least 7 work parts
//                           exist, every office mixes a work part and a soft part, has the 13 seats of the largest class (the chat's own and 12) and seats of a soft kind
//   3d-cowork-looks         no two neighbouring offices share a style or a work arrangement, no two offices look the same (style, work and soft part), all six styles are used
//   3d-cowork-no-chair      no office chair: not a model of the manifest, not loaded, not drawn by any office, and the file is gone from the folder
//   3d-cowork-paths         the walk to every seat of every office (the chat's own too), as the scene gives it (pathFor): inside the room it keeps 0.2 m from every table, seat
//                           and prop that is drawn; three walking people (a desk, a lounge and a stool seat) are followed through a room and keep clear as well
//   3d-cowork-seats         four chats with 10, 6, 3 and 1 working sub-agents: every person sits where the arrangement says (the seat's place, the way it faces, the height of its
//                           cushion), nobody shares a seat, the busiest room has people on seats of every kind its plan has
//   3d-cowork-folder        four chats of one folder get four different looks (four styles, four work arrangements)
//   3d-cowork-slot          the look and the furniture are the slot's: a slot read vacant, with a chat and vacant again is the same room (the plan's hash, its triangles, its look);
//                           its light follows the people (public/js/ofis-presence.js): exactly 0 (and the switch thrown to 0) while it is vacant and while a chat has taken it but its chief is
//                           not through the door yet, then it eases to 1 from the moment the chief is inside (never back down), stays exactly 1 while the chief walks out of the vacant
//                           office after its chat has closed, stays 1 for the hold (1 s of the scene's clock, read on that clock) after the chief is out of the door and then eases to 0 (never back up): vacant == occupied
//                           furniture, the lights the only difference.
//                           The page never times the ease: that is test/ofis-decor-light.test.mjs (a clock it controls: strictly between 0 and 1 on the way, 200 ms, ease-out coming on,
//                           ease-in going off, a step with reduced motion), which --mutations runs against an instant switch and a switch that never moves; the rule itself is
//                           test/ofis-presence.test.mjs, and tools/qa/office3d-walk-qa.mjs 3d-walk-lights reads it against every person of the scene
//
// --mutations breaks the code in a copy of the repo, one line at a time, and runs the check that guards that line: every one must FAIL there.
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, renameSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { scenario3d, o3, sleep, ROOT } from './harness3d.mjs';
import { buildingPlan } from '../../public/js/ofis-layout.js';
import { neighbourSlots, STYLE_IDS } from '../../public/js/ofis-styles.js';
import { WORK_IDS, SOFT_IDS } from '../../public/js/ofis-arrange.js';
import { distToPoly } from '../../public/js/ofis-geom.js';
import { LIGHT_HOLD_S } from '../../public/js/ofis-presence.js';

const args = process.argv.slice(2);
const val = f => { const i = args.indexOf('--' + f); return i >= 0 ? args[i + 1] : undefined; };
const only = val('only');
const NOISE = /\/local\/ofis-extras\.js/;
const make = (name, ok, detail) => ({ name, ok, detail });
const CLEAR = 0.2;                                         // metres a walk keeps from furniture (the router keeps 0.27 from the centre line)
const SEATS_PER_OFFICE = 13;                               // the chat's own seat and the 12 of the largest class
const NEED_WORK = 7;
const OFFICES = 20;
const errorsOf = page => page.errors.filter(e => !NOISE.test(e));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// the walk of one seat against the furniture of its office (room-local metres): the points from the door's outer one to the stand point, sampled every 5 cm
function walkProblems(tag, walk, obstacles, W, D) {
  const bad = [];
  const n = walk.length;
  if (n < 6) return [`${tag}: the walk has ${n} points and none of them is a way through the room (the hall, the door, then at least the point inside the door and the stand point)`];
  for (let i = 2; i + 2 < n; i++) {                        // 0: the hall's entrance, 1: the door on the hall's lane, 2: outside the door; the last leg (stand point to hip) touches its own seat
    const [a, b] = [walk[i], walk[i + 1]], k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05));
    for (let j = 0; j <= k; j++) {
      const x = a[0] + (b[0] - a[0]) * j / k, z = a[1] + (b[1] - a[1]) * j / k;
      if (i > 2 && !(x > 0.1 && x < W - 0.1 && z > 0.1 && z < D - 0.1)) { bad.push(`${tag}: the walk leaves the room at ${x.toFixed(2)}, ${z.toFixed(2)}`); return bad; }
      for (const o of obstacles) {
        const d = distToPoly(x, z, o.poly);
        if (d < CLEAR) { bad.push(`${tag}: the walk is ${d.toFixed(2)} m from ${o.id} at ${x.toFixed(2)}, ${z.toFixed(2)}`); return bad; }
      }
    }
  }
  return bad;
}

// ---- a building of 20 offices, every one vacant but three: arrangements, looks, no chair, paths
async function runPlan(ctx) {
  const res = [];
  const S = await scenario3d(3, { tag: 'cwplan', root: ctx.root, query: `rooms=${OFFICES}` });
  try {
    const { page } = S;
    const errs = errorsOf(page);
    const st = await page.evaluate(o3('({ office: o.office(), looks: o.looks(), models: o.models, err: v.dataset.hata || null })'));
    const slots = st.office.slots;
    const arr = [];
    for (const sl of slots) arr.push({ sl, a: await page.evaluate(o3(`o.arrange(${JSON.stringify(sl.id || 'vacant-' + sl.slot)})`)) });
    const looks = new Map(st.looks.map(l => [l.slot, l]));
    const ready = S.ready.ok && !st.err && errs.length === 0;

    // arrangements
    const used = { work: new Set(), soft: new Set() }, p1 = [];
    for (const { sl, a } of arr) {
      if (!a) { p1.push(`slot ${sl.slot}: no arrangement`); continue; }
      used.work.add(a.work); used.soft.add(a.soft);
      const kinds = new Set(a.seats.map(s => s.kind));
      if (a.seats.length !== SEATS_PER_OFFICE) p1.push(`slot ${sl.slot}: ${a.seats.length} seats (want ${SEATS_PER_OFFICE})`);
      if (!kinds.has('lounge') || !(kinds.has('desk') || kinds.has('stool'))) p1.push(`slot ${sl.slot} (${a.work}+${a.soft}): seat kinds ${[...kinds].join(',')} (want a lounge seat from the soft part and a work seat)`);
      if (!a.work || !a.soft) p1.push(`slot ${sl.slot}: a part is missing (${a.work} + ${a.soft})`);
    }
    const missW = WORK_IDS.filter(x => !used.work.has(x)), missS = SOFT_IDS.filter(x => !used.soft.has(x));
    if (slots.length < OFFICES) p1.push(`${slots.length} offices (want at least ${OFFICES})`);
    if (WORK_IDS.length < NEED_WORK) p1.push(`only ${WORK_IDS.length} work arrangements are named (want ${NEED_WORK})`);
    if (missW.length) p1.push(`never drawn: work ${missW.join(',')}`);
    if (missS.length) p1.push(`never drawn: soft ${missS.join(',')}`);
    res.push(make('3d-cowork-arrangements', ready && p1.length === 0,
      `${slots.length} offices: ${used.work.size} of ${WORK_IDS.length} work arrangements (${[...used.work].join(' ')}) and ${used.soft.size} of ${SOFT_IDS.length} soft ones (${[...used.soft].join(' ')}) drawn; every office has ${SEATS_PER_OFFICE} seats, a work part and a soft part (console errors ${errs.length})`
      + (p1.length ? '; PROBLEMS: ' + p1.slice(0, 4).join(' | ') + (p1.length > 4 ? ` (and ${p1.length - 4} more)` : '') : '')));

    // looks
    const cells = buildingPlan(st.office.bays).cells, p2 = [];
    let pairs = 0;
    for (const sl of slots) for (const o of neighbourSlots(sl.slot, cells)) {
      if (o <= sl.slot) continue;
      pairs++;
      const a = looks.get(sl.slot), b = looks.get(o);
      if (!a || !b) continue;
      if (a.style === b.style) p2.push(`neighbours ${sl.slot} and ${o} share the style ${a.style}`);
      if (a.work === b.work) p2.push(`neighbours ${sl.slot} and ${o} share the work arrangement ${a.work}`);
    }
    const seen = new Map();
    for (const l of looks.values()) { const k = [l.style, l.work, l.soft].join('+'); if (seen.has(k)) p2.push(`slots ${seen.get(k)} and ${l.slot} look the same (${k})`); else seen.set(k, l.slot); }
    const styles = new Set([...looks.values()].map(l => l.style));
    if (styles.size < STYLE_IDS.length) p2.push(`${styles.size} of ${STYLE_IDS.length} styles are used`);
    res.push(make('3d-cowork-looks', ready && p2.length === 0,
      `${looks.size} offices, ${pairs} pairs of neighbours compared: none shares a style or a work arrangement, no two offices look the same (${seen.size} different looks), ${styles.size} of ${STYLE_IDS.length} styles used`
      + (p2.length ? '; PROBLEMS: ' + p2.slice(0, 4).join(' | ') + (p2.length > 4 ? ` (and ${p2.length - 4} more)` : '') : '')));

    // no office chair
    const drawn = new Set([...looks.values()].flatMap(l => l.models || []));
    const chairy = k => /^chair/i.test(k);
    const p3 = [];
    const loaded = [...st.models.loaded, ...st.models.failed].filter(chairy);
    if (loaded.length) p3.push(`the model of ${loaded.join(',')} is in the manifest`);
    const drawnChairs = [...drawn].filter(chairy);
    if (drawnChairs.length) p3.push(`${drawnChairs.join(',')} is drawn`);
    if (!drawn.size) p3.push('no office reported what it drew');
    if (existsSync(join(ROOT, 'public/models/kenney-furniture/chairDesk.glb'))) p3.push('chairDesk.glb is still in the models folder');
    if (/chairDesk/.test(readFileSync(join(ROOT, 'public/models/kenney-furniture/SHA256SUMS'), 'utf8'))) p3.push('chairDesk.glb is still in SHA256SUMS');
    const seatModels = ['benchCushion', 'loungeChair', 'loungeChairRelax', 'loungeDesignSofa', 'loungeSofa', 'stoolBar'].filter(m => drawn.has(m));
    res.push(make('3d-cowork-no-chair', ready && p3.length === 0,
      `${st.models.loaded.length} models loaded, none an office chair; the ${looks.size} offices drew ${drawn.size} kinds of model, none an office chair; seats are ${seatModels.join(', ')}`
      + (p3.length ? '; PROBLEMS: ' + p3.join(' | ') : '')));

    // paths: every seat of every office, as pathFor gives it
    const p4 = [];
    let walks = 0, samples = 0;
    for (const { sl, a } of arr) {
      if (!a) continue;
      for (const s of a.seats) {
        walks++;
        samples += s.walk.length;
        p4.push(...walkProblems(`slot ${sl.slot} ${a.work}+${a.soft}, seat ${s.key}`, s.walk, a.obstacles, a.W, a.D));
        if (p4.length > 6) break;
      }
    }
    ctx.paths = { walks, samples, problems: p4 };
  } finally { await S.done(); }
  return res;
}

// ---- four chats of one folder, with people at their seats
async function runSeats(ctx) {
  const res = [];
  const SUBS = [10, 6, 3, 1];                                  // (not more: the fixture names a sub-agent from its index padded to 8 characters, so the 2nd and the 11th would share a file)
  const S = await scenario3d(4, { tag: 'cwseats', root: ctx.root, fixture: { sameProject: 'qa-home', statuses: Array(4).fill('working'), subs: i => Array(SUBS[i]).fill('working') } });
  try {
    const { page, agents } = S;
    const want = SUBS.reduce((a, b) => a + b, 0) + 4;
    for (let t = 0; t < 120; t++) { const n = await page.evaluate(o3('o.sitting().filter(c => c.mode === "seated").length')); if (n >= want) break; await sleep(250); }
    await sleep(1200);                                                       // the people settle into their pose
    const st = await page.evaluate(o3('({ sit: o.sitting(), looks: o.looks(), office: o.office(), err: v.dataset.hata || null })'));
    const errs = errorsOf(page);
    const mains = agents.filter(a => a.kind === 'main');
    const rooms = new Map();
    for (const m of mains) rooms.set(m.id, { arr: await page.evaluate(o3(`o.arrange(${JSON.stringify(m.id)})`)), box: await page.evaluate(o3(`o.room(${JSON.stringify(m.id)})`)) });

    // seats
    const p = [], kindsBy = new Map(), taken = new Set();
    let checked = 0;
    for (const f of st.sit) {
      const r = rooms.get(f.room);
      if (!r) { p.push(`${f.id.slice(0, 10)}: no room ${f.room}`); continue; }
      if (f.mode !== 'seated') { p.push(`${f.id.slice(0, 12)} is ${f.mode}, not seated`); continue; }
      const seat = r.arr.seats.find(s => s.key === (f.main ? 'chef' : f.slot));
      if (!seat) { p.push(`${f.id.slice(0, 12)}: the arrangement has no seat ${f.main ? 'chef' : f.slot}`); continue; }
      checked++;
      const dx = f.x - (r.box.X + seat.pos[0]), dz = f.z - (r.box.Z + seat.pos[1]);
      if (Math.hypot(dx, dz) > 0.03) p.push(`${f.id.slice(0, 12)} sits ${Math.hypot(dx, dz).toFixed(2)} m from its seat (${seat.kind} ${seat.key} of ${r.arr.work}+${r.arr.soft})`);
      const dh = Math.abs((((f.heading - seat.facing + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI);       // the angle between two headings, whatever turns the figure has made
      if (dh > 0.1) p.push(`${f.id.slice(0, 12)} faces ${f.heading.toFixed(2)}, its ${seat.kind} seat faces ${seat.facing.toFixed(2)}`);
      if (Math.abs(f.hipY - seat.hip) > 0.04) p.push(`${f.id.slice(0, 12)}'s hip is at ${f.hipY.toFixed(2)} m, the cushion of its ${seat.kind} seat is ${seat.hip.toFixed(2)}`);
      if (f.seat && f.seat.kind !== seat.kind) p.push(`${f.id.slice(0, 12)} thinks it sits on a ${f.seat.kind} seat, the plan says ${seat.kind}`);
      const key = f.room + ':' + seat.key;
      if (taken.has(key)) p.push(`two people share seat ${key}`);
      taken.add(key);
      if (!kindsBy.has(f.room)) kindsBy.set(f.room, new Set());
      kindsBy.get(f.room).add(seat.kind);
    }
    if (checked < want) p.push(`${checked} of ${want} people were checked`);
    const busiest = [...kindsBy.entries()].sort((a, b) => b[1].size - a[1].size)[0];
    const planKinds = k => new Set(rooms.get(k).arr.seats.map(s => s.kind));
    const big = mains[0].id;
    const bigKinds = kindsBy.get(big) || new Set();
    if (bigKinds.size < 2) p.push(`the busiest room (10 sub-agents) has people on ${bigKinds.size} kind of seat (${[...bigKinds].join(',')}), the plan has ${[...planKinds(big)].join(',')}`);
    res.push(make('3d-cowork-seats', S.ready.ok && !st.err && errs.length === 0 && p.length === 0,
      `${checked} people at their seats in 4 rooms (${SUBS.join(', ')} sub-agents and the chiefs): each within 3 cm of its seat, facing as the seat does (within 0.1 rad), the hip at the cushion (within 4 cm), no seat shared; the room with 10 has people on ${[...bigKinds].join(', ')} seats (its plan: ${[...planKinds(big)].join(', ')}), console errors ${errs.length}`
      + (p.length ? '; PROBLEMS: ' + p.slice(0, 4).join(' | ') + (p.length > 4 ? ` (and ${p.length - 4} more)` : '') : '')));

    // folder: four chats of one folder, four different looks
    const L = [...st.looks].filter(l => !l.vacant).sort((a, b) => a.slot - b.slot), pf = [];
    if (L.length !== 4) pf.push(`${L.length} offices with a chat (want 4)`);
    for (const k of ['style', 'work']) if (new Set(L.map(l => l[k])).size !== L.length) pf.push(`the four chats of one folder have ${new Set(L.map(l => l[k])).size} different ${k}s: ${L.map(l => l[k]).join(', ')}`);
    if (new Set(L.map(l => [l.style, l.work, l.soft].join())).size !== L.length) pf.push('two of the four look the same');
    res.push(make('3d-cowork-folder', S.ready.ok && pf.length === 0,
      `four chats of one folder (qa-home): ${L.map(l => `${l.style}/${l.work}/${l.soft}`).join(' | ')}`
      + (pf.length ? '; PROBLEMS: ' + pf.join(' | ') : '')));

    // paths again, for the offices with chats (the scene's own walks), then three people walking through the busiest room
    const pp = [...ctx.paths.problems];
    let walks = ctx.paths.walks;
    for (const [id, r] of rooms) for (const s of r.arr.seats) { walks++; pp.push(...walkProblems(`${r.arr.work}+${r.arr.soft}, seat ${s.key}`, s.walk, r.arr.obstacles, r.arr.W, r.arr.D)); }
    // follow three sub-agents of the busiest room: one on a seat of each kind (as many kinds as it has) walks in from the entrance, and every reading inside the room keeps clear
    const busy = rooms.get(big), box = busy.box, seen = [];
    const pick = [];
    for (const kind of ['desk', 'lounge', 'stool']) { const f = st.sit.find(f => f.room === big && !f.main && f.seat && f.seat.kind === kind && !pick.some(q => q.id === f.id)); if (f) pick.push(f); }
    for (const f of pick) await page.evaluate(o3(`s.replayEnter(${JSON.stringify(f.id)})`));
    const trace = new Map(pick.map(f => [f.id, []]));
    const t0 = Date.now();
    while (pick.length && Date.now() - t0 < 90000) {
      const now = await page.evaluate(o3('o.sitting().map(c => ({ id: c.id, mode: c.mode, x: c.x, z: c.z }))'));
      for (const f of pick) { const c = now.find(x => x.id === f.id); if (c) trace.get(f.id).push(c); }
      if (pick.every(f => { const t = trace.get(f.id); return t.length > 3 && t[t.length - 1].mode === 'seated'; })) break;
      await sleep(100);
    }
    for (const f of pick) {
      const t = trace.get(f.id), seat = busy.arr.seats.find(s => s.key === f.slot), inside = t.filter(c => c.x > box.X + 0.1 && c.x < box.X + box.W - 0.1 && c.z > box.Z + 0.1 && c.z < box.Z + box.D - 0.1);
      const last = t[t.length - 1];
      seen.push(`${seat.kind} seat ${f.slot}: ${inside.length} readings in the room`);
      if (inside.length < 5) pp.push(`${seat.kind} seat ${f.slot}: only ${inside.length} readings inside the room`);
      // the last 0.8 m (stand point to hip) touches its own seat; every earlier reading keeps clear of everything
      for (const c of inside) {
        if (Math.hypot(c.x - (box.X + seat.pos[0]), c.z - (box.Z + seat.pos[1])) < 0.85) continue;
        const bad = busy.arr.obstacles.find(o => distToPoly(c.x - box.X, c.z - box.Z, o.poly) < CLEAR - 0.05);
        if (bad) { pp.push(`the person on ${seat.kind} seat ${f.slot} walks through ${bad.id} at ${(c.x - box.X).toFixed(2)}, ${(c.z - box.Z).toFixed(2)}`); break; }
      }
      if (!last || last.mode !== 'seated' || Math.hypot(last.x - (box.X + seat.pos[0]), last.z - (box.Z + seat.pos[1])) > 0.1) pp.push(`the person on ${seat.kind} seat ${f.slot} ends ${last ? last.mode : 'nowhere'}, not on its seat`);
    }
    if (pick.length < 2) pp.push(`only ${pick.length} kinds of seat had a sub-agent to follow`);
    res.push(make('3d-cowork-paths', pp.length === 0,
      `${plural(walks, 'walk')} from the door to a seat (20 offices of the plan, 4 of the scene), each keeps ${CLEAR} m from every table, seat and prop it draws (${ctx.paths.samples} points); ${plural(pick.length, 'person')} followed through the busiest room (${seen.join('; ')}): clear of everything and on their seat at the end`
      + (pp.length ? '; PROBLEMS: ' + pp.slice(0, 4).join(' | ') + (pp.length > 4 ? ` (and ${pp.length - 4} more)` : '') : '')));
  } finally { await S.done(); }
  return res;
}

// ---- a slot with a chat that comes and goes: the same room, the lights the only difference
async function runSlot(ctx) {
  const dirs = {};
  const S = await scenario3d(6, {
    tag: 'cwslot', root: ctx.root, fixture: { statuses: Array(6).fill('working'), subs: () => [] },
    beforeServer: async (fx, dir) => {
      dirs.dir = dir;
      mkdirSync(join(dir, 'stash'), { recursive: true });
      for (const i of [3, 4, 5]) renameSync(join(dir, 'sessions', fx.pids[i] + '.json'), join(dir, 'stash', fx.pids[i] + '.json'));
    },
  });
  const res = [];
  try {
    const { page, fx } = S;
    const read = () => page.evaluate(o3('({ looks: o.looks(), rooms: s.rooms.length, err: v.dataset.hata || null })'));
    const settle = async (n, more = () => true) => { for (let t = 0; t < 100; t++) { const st = await read().catch(() => null); if (st && st.rooms === n && more(st)) { await sleep(700); return read(); } await sleep(300); } return read(); };
    const at = (st, slot) => st.looks.find(l => l.slot === slot);
    // The light of a room eases over 200 ms from the first frame after the change, and on a loaded machine that frame comes late (the first render after a rebuild blocked for 0.5 to 1 s
    // in software GL): so this check never times the ease. It waits until every light has reached the end its room asks for (an office with a chat whose chief is inside 1, a vacant one
    // 0), then reads. The ease itself (strictly between 0 and 1 on the way, 200 ms, ease-out coming on, ease-in going off) is proven with a clock the test controls in
    // test/ofis-decor-light.test.mjs; here the direction (never back), the end state and WHEN the light moves are asserted, against the chief of the chat, read in the same tick as the
    // light (the pass of the rule and the walkers run in one frame, so a tick between two frames sees a light that agrees with the chief's place).
    const settleLights = async (ok = l => l.lit === (l.vacant ? 0 : 1), tries = 150) => {
      let st = null;
      for (let t = 0; t < tries; t++) { st = await read().catch(() => null); if (st && st.looks.every(ok)) return st; await sleep(100); }
      return st || read();
    };
    // a sampler in the page that writes, every 25 ms, the light of slot 3, the switch's target and where the chief of the chat of slot 3 is against the box of that office: inside it (0.1 m
    // from every wall), outside it (0.1 m beyond a wall), or between the two (a new one replaces the one before)
    const sample = chat => page.evaluate(o3(`(() => { const id = window.__litRun = (window.__litRun || 0) + 1; window.__lit = []; const t0 = performance.now(), tick = () => {
      if (id !== window.__litRun) return;
      const r = o.office().slots.find(q => q.slot === 3), f = o.figures().find(q => q.id === ${JSON.stringify(chat)});
      const at = f && r ? (f.x > r.X + 0.1 && f.x < r.X + r.W - 0.1 && f.z > r.Z + 0.1 && f.z < r.Z + r.D - 0.1 ? 'in' : f.x < r.X - 0.1 || f.x > r.X + r.W + 0.1 || f.z < r.Z - 0.1 || f.z > r.Z + r.D + 0.1 ? 'out' : 'edge') : 'none';
      window.__lit.push([Math.round(performance.now() - t0), o.lit(3), o.litTarget(3), at, f ? f.mode : null, s.sceneTime]);
      if (performance.now() - t0 < 170000) setTimeout(tick, 25); }; tick(); return 1; })()`));
    const p = [];
    const s3 = await settle(3, st => st.looks.length >= 11).then(() => settleLights());
    const v1 = at(s3, 3), v0 = at(s3, 0);
    if (!v1 || !v1.vacant || v1.lit !== 0) p.push(`slot 3 is not vacant with its lights off at 3 chats (light ${v1 && v1.lit})`);
    if (!v0 || v0.vacant || v0.lit !== 1) p.push(`slot 0 is not occupied with its lights on at 3 chats (light ${v0 && v0.lit})`);
    // the lights of every office at 3 chats
    const wrong = s3.looks.filter(l => (l.vacant ? l.lit !== 0 : l.lit !== 1));
    if (wrong.length) p.push(`${wrong.length} offices have the wrong light at 3 chats (slot ${wrong[0].slot}: light ${wrong[0].lit}, ${wrong[0].vacant ? 'vacant' : 'with a chat'})`);

    // a chat takes slot 3: sample its light in the page from the moment the session file appears. The office is furnished and signed from the first frame and stays dark: the chief of
    // the chat is at the entrance and walks the hall (15 to 28 s in software GL); the light comes on when the chief is through the door
    await sample(fx.agents[3].id);
    renameSync(join(dirs.dir, 'stash', fx.pids[3] + '.json'), join(dirs.dir, 'sessions', fx.pids[3] + '.json'));
    await settle(4, st => (at(st, 3) && !at(st, 3).vacant));
    const dark4 = at(await read(), 3);
    if (!dark4 || dark4.vacant || dark4.lit !== 0) p.push(`slot 3 with a chat whose chief has not come yet has its light at ${dark4 && dark4.lit} (want 0: the office is dark until the chief is through the door)`);
    const s4 = await settleLights(l => (l.slot === 3 ? l.lit === 1 : l.lit === (l.vacant ? 0 : 1)), 1200);
    await sleep(300);
    const up = await page.evaluate('window.__lit');
    const o1 = at(s4, 3);
    const same = (a, b, label) => {
      if (!a || !b) { p.push(`${label}: the slot is missing`); return; }
      if (a.sig !== b.sig || a.items !== b.items) p.push(`${label}: the furniture changed (${a.items} items ${a.sig} -> ${b.items} items ${b.sig})`);
      else if (a.tris !== b.tris) p.push(`${label}: the furniture costs ${Math.round(a.tris)} triangles, then ${Math.round(b.tris)}`);
      for (const k of ['style', 'theme', 'work', 'soft']) if (a[k] !== b[k]) p.push(`${label}: its ${k} changed (${a[k]} -> ${b[k]})`);
    };
    same(v1, o1, 'a chat takes slot 3');
    if (!o1 || o1.vacant || o1.lit !== 1) p.push(`slot 3 with a chat has its light at ${o1 && o1.lit} (want 1 once its chief is inside)`);
    // the light came on: exactly 0 and thrown to 0 until the chief is through the door, then from 0, never back down, ending at 1 (its eased shape and time are the unit test's)
    const lv = up.map(x => x[1]);
    const firstIn = up.findIndex(x => x[3] === 'in'), outside = up.slice(0, Math.max(0, firstIn)).filter(x => x[3] === 'out');
    if (firstIn < 1) p.push(`the chief of slot 3 was never read inside its office (${up.length} readings)`);
    else {
      const early = outside.filter(x => x[1] !== 0 || x[2] !== 0);
      if (outside.length < 20) p.push(`only ${outside.length} readings of the chief outside the office before it came in (nothing to judge "dark until the door" by)`);
      if (early.length) p.push(`the light of slot 3 was ${early[0][1]} (switch thrown to ${early[0][2]}) while its chief was still outside the door, ${early.length} of ${outside.length} readings`);
      if (up[firstIn][2] !== 1) p.push(`the switch of slot 3 was not thrown on when the chief was first read inside (target ${up[firstIn][2]})`);
    }
    let down = 0; for (let i = 1; i < lv.length; i++) if (lv[i] < lv[i - 1] - 1e-9) down++;
    if (lv[0] !== 0 || lv[lv.length - 1] !== 1) p.push(`the light of slot 3 went ${lv[0]} -> ${lv[lv.length - 1]} (want 0 -> 1)`);
    if (down) p.push(`the light of slot 3 went down ${down} times while it came on`);

    // the chat leaves: its office is vacant again, the same room; the chief stands up and walks out, the light stays exactly 1 while the chief is inside and for the hold after it is out of the door, then goes down
    const agent = fx.agents[3];
    await sample(agent.id);
    fx.closeSession(agent.id);
    await settle(3, st => (at(st, 3) && at(st, 3).vacant));
    const s3b = await settleLights(undefined, 1200);
    await sleep(300);
    const down2s = await page.evaluate('window.__lit'), down2 = down2s.map(x => x[1]);
    const v2 = at(s3b, 3);
    same(o1, v2, 'the chat leaves slot 3');
    same(v1, v2, 'slot 3 vacant before and after its chat');
    if (!v2 || !v2.vacant || v2.lit !== 0) p.push(`slot 3 vacant again has its light at ${v2 && v2.lit} (want 0)`);
    let up2 = 0, heldN = 0; for (let i = 1; i < down2.length; i++) if (down2[i] > down2[i - 1] + 1e-9) up2++;
    if (down2[0] !== 1 || down2[down2.length - 1] !== 0) p.push(`the light of slot 3 went ${down2[0]} -> ${down2[down2.length - 1]} when its chat left (want 1 -> 0)`);
    if (up2) p.push(`the light of slot 3 went up ${up2} times while it went off`);
    const inside2 = down2s.filter(x => x[3] === 'in'), firstOut = down2s.findIndex(x => x[3] === 'out'), walked = inside2.filter(x => x[4] === 'walk');
    if (walked.length < 5) p.push(`only ${walked.length} readings of the chief walking out inside the vacant office (nothing to judge "lit while the chief is inside" by)`);
    const dimmed = inside2.filter(x => x[1] !== 1 || x[2] !== 1);
    if (dimmed.length) p.push(`the light of slot 3 was ${dimmed[0][1]} (switch thrown to ${dimmed[0][2]}) while the chief of the closed chat was still inside it, ${dimmed.length} of ${inside2.length} readings`);
    if (firstOut < 0) p.push('the chief of the closed chat was never read outside the office');
    else {
      // the light is held for LIGHT_HOLD_S of the scene's clock after the last person is out of the box (ofis-presence.js), read on that clock (the readings carry it): the switch is still on
      // while the chief has been out of the strict inside for less than the hold, and thrown off once it has been out of the box for the hold and a frame (a frame is 0.1 s at most)
      const edge = down2s.findIndex(x => x[3] === 'edge' || x[3] === 'out'), tEdge = down2s[edge][5], tOut = down2s[firstOut][5];
      const held = down2s.slice(edge).filter(x => x[5] - tEdge < LIGHT_HOLD_S - 1e-6), early = held.filter(x => x[2] !== 1), late = down2s.slice(firstOut).filter(x => x[3] === 'out' && x[5] - tOut >= LIGHT_HOLD_S + 0.2 && x[2] !== 0);
      heldN = held.length;
      if (held.length < 10) p.push(`only ${held.length} readings of the hold (a ${LIGHT_HOLD_S} s hold of the scene's clock after the chief left the strict inside)`);
      if (early.length) p.push(`the switch of slot 3 was thrown off ${(early[0][5] - tEdge).toFixed(2)} s after the chief left the inside (the hold is ${LIGHT_HOLD_S} s), ${early.length} of ${held.length} readings`);
      if (late.length) p.push(`the switch of slot 3 was still on ${(late[0][5] - tOut).toFixed(2)} s after the chief was out of the door (the hold is ${LIGHT_HOLD_S} s), ${late.length} readings`);
    }
    const errs = errorsOf(page);
    if (errs.length) p.push(`console errors: ${errs[0].slice(0, 120)}`);
    res.push(make('3d-cowork-slot', S.ready.ok && p.length === 0,
      `slot 3 read vacant, with a chat, vacant again: the same furniture (${v1 && v1.items} items, hash ${v1 && v1.sig}, ${v1 && Math.round(v1.tris)} triangles) and look (${v1 && v1.style}, ${v1 && v1.work}, ${v1 && v1.soft}) each time; its light stayed 0 while the chief of its chat was outside the door (${outside.length} readings), came on 0 -> 1 once the chief was inside (${lv.length} readings, never back down, settled at 1), stayed 1 for ${inside2.length} readings of the chief inside the vacant office after the chat left, stayed 1 for the hold of ${LIGHT_HOLD_S} s of the scene's clock after the chief left the inside (${heldN} readings, and off by ${LIGHT_HOLD_S} s and a frame after it was out of the door) and went 1 -> 0 (${down2.length} readings, never back up, settled at 0); at 3 chats every vacant office is dark and every office with a chat is lit`
      + (p.length ? '; PROBLEMS: ' + p.slice(0, 4).join(' | ') + (p.length > 4 ? ` (and ${p.length - 4} more)` : '') : '')));
  } finally { await S.done(); }
  return res;
}

// ---- mutations: break one line in a copy of the repo and expect the check that guards it to fail
const MUTATIONS = [
  { name: 'every office gets the same work arrangement', file: 'public/js/ofis-arrange.js', from: "const work = pick(WORK_IDS.length, new Set(lower.map(l => l.work)), use.work, hash('work:' + slot), v => pairs.has(style + ':' + v));", to: 'const work = 0;', group: 'plan', fails: '3d-cowork-arrangements' },
  { name: 'only one kind of soft part exists', file: 'public/js/ofis-arrange.js', from: "const soft = pick(SOFT_IDS.length, new Set(), use.soft, hash('soft:' + slot), v => triples.has(style + ':' + work + ':' + v));", to: 'const soft = 0;', group: 'plan', fails: '3d-cowork-arrangements' },
  { name: 'looks are not spread: every slot takes the first look its hash points at, neighbours may read the same', file: 'public/js/ofis-arrange.js', from: 'const pick = (n, banned, uses, pref, avoid = () => false) => {', to: 'const pick = (n, banned, uses, pref, avoid = () => false) => {\n    return pref % n;', group: 'plan', fails: '3d-cowork-looks' },
  { name: 'an office chair is a seat again', file: 'public/js/ofis-arrange.js', from: "const m = o.m || 'loungeChair'", to: "const m = o.m || 'chairDesk'", group: 'plan', fails: '3d-cowork-no-chair' },
  { name: 'the office chair is in the manifest again', file: 'public/js/ofis-rig.js', from: "desk: F + 'desk.glb'", to: "desk: F + 'desk.glb', chair: F + 'chairDesk.glb'", group: 'plan', fails: '3d-cowork-no-chair' },
  { name: 'the walk to a seat skips the way through the room', file: 'public/js/ofis.js', from: 'for (const q of s.approach) p.push(q.clone());', to: '', group: 'seats', fails: '3d-cowork-paths' },
  { name: 'a person sits at the stand point, not on the seat', file: 'public/js/ofis.js', from: '    p.push(s.pos.clone());\n    return p;', to: '    p.push(s.stand.clone());\n    return p;', group: 'seats', fails: '3d-cowork-seats' },
  { name: 'a person faces the wrong way at its seat', file: 'public/js/ofis.js', from: 'seat ? seat.facing : -Math.PI / 2;', to: 'seat ? seat.facing + 1.2 : -Math.PI / 2;', group: 'seats', fails: '3d-cowork-seats' },
  { name: 'every seat is as high as the old office chair', file: 'public/js/ofis.js', from: '(c.seat && c.seat.hip) || PK_SEAT', to: 'PK_SEAT', group: 'seats', fails: '3d-cowork-seats' },
  { name: 'the look follows the chat\'s folder, not the slot', file: 'public/js/ofis.js', from: 'const look = world.looks.get(it.slot);', to: 'const look = world.looks.get(it.vacant ? it.slot : hash(store.agents.get(it.id).project) % world.looks.size);', group: 'seats', fails: '3d-cowork-folder' },
  { name: 'the look follows the chat, not the slot: a chat taking a slot changes its room', file: 'public/js/ofis.js', from: 'const look = world.looks.get(it.slot);', to: 'const look = world.looks.get(it.vacant ? it.slot : (it.slot + 1) % world.looks.size);', group: 'slot', fails: '3d-cowork-slot' },
  { name: 'a vacant office keeps its lights on', file: 'public/js/ofis-presence.js', from: 'out.set(r.slot, st.lit);', to: 'out.set(r.slot, true);', group: 'slot', fails: '3d-cowork-slot' },
  { name: 'the lights switch at once: setLit throws the switch without an ease', file: 'public/js/ofis-decor.js', from: 'switches.set(slot, on, performance.now(), instant || follower.reduced);', to: 'switches.set(slot, on, performance.now(), true);', group: 'unit', fails: 'unit-ofis-decor-light' },
  { name: 'the lights never move: the frame does not step the switches', file: 'public/js/ofis-decor.js', from: 'const moved = switches.step(performance.now());', to: 'const moved = false;', group: 'unit', fails: 'unit-ofis-decor-light' },
  { name: 'the lights stay off when a chat takes the office', file: 'public/js/ofis-presence.js', from: 'out.set(r.slot, st.lit);', to: 'out.set(r.slot, false);', group: 'slot', fails: '3d-cowork-slot' },
  { name: 'the lights come on when a chat takes the office, before its chief is through the door', file: 'public/js/ofis-presence.js', from: 'out.set(r.slot, st.lit);', to: 'out.set(r.slot, st.lit || r.owner !== null);', group: 'slot', fails: '3d-cowork-slot' },
  { name: 'the lights go off the moment the chat closes, with its chief still walking out', file: 'public/js/ofis-presence.js', from: 'out.set(r.slot, st.lit);', to: 'out.set(r.slot, r.owner !== null && st.lit);', group: 'slot', fails: '3d-cowork-slot' },
  { name: 'no hold: the lights go off the moment the chief is out of the door', file: 'public/js/ofis-presence.js', from: 'if (now - st.offAt >= hold) { st.lit = false; st.offAt = null; }', to: '{ st.lit = false; st.offAt = null; }', group: 'slot', fails: '3d-cowork-slot' },
  { name: 'a hold three times as long: the lights stay on for three seconds after the chief is out of the door', file: 'public/js/ofis-presence.js', from: 'if (now - st.offAt >= hold) {', to: 'if (now - st.offAt >= hold * 3) {', group: 'slot', fails: '3d-cowork-slot' },
];

async function runMutations() {
  const rows = [];
  for (const m of MUTATIONS.filter(x => !val('mutation') || val('mutation').split('|').some(w => x.name.includes(w)))) {
    const dir = mkdtempSync(join(tmpdir(), 'cco-cwmut-'));
    try {
      for (const f of readdirSync(ROOT).filter(n => /\.(js|json)$/.test(n) && n !== 'package-lock.json')) cpSync(join(ROOT, f), join(dir, f));
      cpSync(join(ROOT, 'public'), join(dir, 'public'), { recursive: true });
      const file = join(dir, m.file), text = readFileSync(file, 'utf8');
      if (!text.includes(m.from)) { rows.push({ m, caught: false, detail: 'the line to break was not found' }); console.log(`MUTATION MISSED ${m.fails}: ${m.name} -> the line to break was not found`); continue; }
      writeFileSync(file, text.replace(m.from, m.to));
      const ctx = { root: dir };
      let res;
      if (m.group === 'unit') res = [runUnit(dir, 'test/ofis-decor-light.test.mjs')];
      else if (m.group === 'plan') res = await runPlan(ctx);
      else if (m.group === 'seats') { await runPlanPathsOnly(ctx); res = await runSeats(ctx); }
      else res = await runSlot(ctx);
      const row = res.find(x => x.name === m.fails);
      rows.push({ m, caught: !!row && !row.ok, detail: row ? `${m.fails} ${row.ok ? 'PASSED' : 'FAILED'}: ${row.detail.slice(row.ok ? 0 : Math.max(0, row.detail.indexOf('PROBLEMS')), (row.ok ? 0 : Math.max(0, row.detail.indexOf('PROBLEMS'))) + 230)}` : `${m.fails} did not run` });
    } catch (e) {
      rows.push({ m, caught: true, detail: 'the scene did not run: ' + String(e.message || e).slice(0, 160) });
    } finally { rmSync(dir, { recursive: true, force: true }); }
    const last = rows[rows.length - 1];
    console.log(`MUTATION ${last.caught ? 'CAUGHT' : 'MISSED'} ${m.fails}: ${m.name} -> ${last.detail}`);
  }
  return rows;
}
// a unit test file of the copy (a throw-away copy of the repo with one line broken): the check is its exit status
function runUnit(dir, file) {
  cpSync(join(ROOT, 'test'), join(dir, 'test'), { recursive: true });
  const r = spawnSync('node', ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--test', file], { cwd: dir, encoding: 'utf8', timeout: 120000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const failed = out.split('\n').filter(l => /^\s*✖/.test(l)).slice(0, 2).map(l => l.trim().slice(0, 140));
  return make('unit-' + file.replace(/^test\//, '').replace(/\.test\.mjs$/, ''), r.status === 0, r.status === 0 ? 'passed' : 'PROBLEMS: ' + (failed.join(' | ') || out.slice(-200)));
}
// the paths of the 20-office plan are part of 3d-cowork-paths, which is judged after the scene with people: run the plan scene for them, without its other checks being judged
async function runPlanPathsOnly(ctx) { await runPlan(ctx); }

// ---- main
const ctx = { root: undefined };
const report = [];
const show = r => { report.push(r); console.log(`CHECK ${r.name} ${r.ok ? 'PASS' : 'FAIL'} ${r.detail}`); };
if (args.includes('--mutations')) {
  const rows = await runMutations();
  const missed = rows.filter(r => !r.caught);
  console.log(missed.length ? `MUTATIONS MISSED ${missed.length} of ${rows.length}` : `MUTATIONS ALL CAUGHT (${rows.length})`);
  process.exit(missed.length ? 1 : 0);
}
const want = n => !only || only === n;
const planNames = ['arrangements', 'looks', 'no-chair'];
if (!only || planNames.includes(only) || ['paths', 'seats', 'folder'].includes(only)) {
  const r = await runPlan(ctx);
  if (!only || planNames.includes(only)) for (const x of r) show(x);
}
if (!only || ['paths', 'seats', 'folder'].includes(only)) for (const x of await runSeats(ctx)) if (want(x.name.replace('3d-cowork-', ''))) show(x);
if (want('slot')) for (const x of await runSlot(ctx)) show(x);
const bad = report.filter(r => !r.ok);
console.log(bad.length ? `QA FAIL (${bad.length} of ${report.length} checks)` : `QA PASS (${report.length} checks)`);
process.exit(bad.length ? 1 : 0);
