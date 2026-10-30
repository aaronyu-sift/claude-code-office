// The rule that decides which offices are lit (public/js/ofis-presence.js): the light follows the people. The pure part: it is given where the people are, whose they are and the scene's
// clock, so every case here is a few lines of positions and times, and the walks are real ones (stepWalk of ofis-arrive.js along a route into a box). tools/qa/office3d-walk-qa.mjs
// 3d-walk-lights reads the same rule in the page, against the people the scene really has.
import test from 'node:test';
import assert from 'node:assert/strict';
import { roomLights, inBox, LIGHT_HOLD_S } from '../public/js/ofis-presence.js';
import { stepWalk, pathLength } from '../public/js/ofis-arrive.js';

const H = LIGHT_HOLD_S;

// two offices of one hall: slot 0 at x 0..10, slot 1 at x 12..22, both z 0..6.8 with the hall at z < 0 (the doors are in the wall at z = 0); the entrance is at x 40
const box = (slot, owner, x0) => ({ slot, owner, x0, x1: x0 + 10, z0: 0, z1: 6.8 });
const lane = -2.5;
const routeTo = (x0, doorDx = 9) => [{ x: 40, z: lane }, { x: x0 + doorDx, z: lane }, { x: x0 + doorDx, z: -0.75 }, { x: x0 + doorDx, z: 1.2 }, { x: x0 + 3, z: 3 }];

// one call of the rule at scene time t (seconds): the people as { x, z, chat }
const run = (mem, rooms, people, t = 0) => Object.fromEntries(roomLights(mem, rooms, people, new Map(), people.length, t));

// walk a figure along `path` in frames of dt from scene time t0 and call the rule at every frame; `others(f, t)` says the other people. Returns the frames { t, x, z, lit: { slot: bool } }
function walkWith(mem, roomsAt, path, chat, { dt = 1 / 8, pace = 1, others = () => [], t0 = 0 } = {}) {
  const w = { x: path[0].x, z: path[0].z, path, pi: 1, travelled: 0, plen: pathLength(path) };
  const out = [];
  for (let f = 0; f < 4000; f++) {
    const r = stepWalk(w, dt, { pace });
    const t = t0 + (f + 1) * dt;
    out.push({ t, x: w.x, z: w.z, lit: run(mem, roomsAt(f), [{ x: w.x, z: w.z, chat }, ...others(f, t)], t) });
    if (r.done) return out;
  }
  throw new Error('the walk never ended');
}

test('inBox: the box of an office is its inside, edges included', () => {
  const r = box(0, null, 0);
  assert.ok(inBox(r, 5, 3));
  assert.ok(inBox(r, 0, 0) && inBox(r, 10, 6.8));
  assert.ok(!inBox(r, 5, -0.01), 'the doorway in the wall is not the room');
  assert.ok(!inBox(r, 10.01, 3) && !inBox(r, 5, 6.81));
});

test('a vacant office with nobody in it is dark; somebody inside lights it in that very call, and it is dark again a hold after they have gone', () => {
  const mem = new Map(), rooms = [box(0, null, 0), box(1, null, 12)];
  assert.deepEqual(run(mem, rooms, [], 0), { 0: false, 1: false });
  assert.deepEqual(run(mem, rooms, [{ x: 3, z: 3, chat: 'A' }], 1), { 0: true, 1: false }, 'a person of a chat that has gone, still in the office');
  assert.deepEqual(run(mem, rooms, [{ x: 3, z: -1, chat: 'A' }], 2), { 0: true, 1: false }, 'out of the door: the hold keeps it lit');
  assert.deepEqual(run(mem, rooms, [], 2 + H - 0.01), { 0: true, 1: false }, 'a hair before the hold is over');
  assert.deepEqual(run(mem, rooms, [], 2 + H), { 0: false, 1: false }, 'a hold after the first call that said off: dark');
});

test('an office that a chat has taken stays dark until a person of that chat is inside, and lit afterwards', () => {
  const mem = new Map(), rooms = [box(0, 'A', 0)];
  assert.deepEqual(run(mem, rooms, [], 0), { 0: false }, 'taken, nobody there yet');
  assert.deepEqual(run(mem, rooms, [{ x: 9, z: -0.75, chat: 'A' }], 5), { 0: false }, 'the chief is outside the door: a dark office is not held, and not lit');
  assert.deepEqual(run(mem, rooms, [{ x: 9, z: 0.05, chat: 'A' }], 6), { 0: true }, 'the chief has come through the door: lit in that very call');
  assert.deepEqual(run(mem, rooms, [{ x: 3, z: 3, chat: 'A' }], 7), { 0: true });
});

test('while the chat has the office it stays lit, whoever stands up, leaves or is out of the box for a moment, for longer than any hold', () => {
  const mem = new Map(), rooms = [box(0, 'A', 0)];
  run(mem, rooms, [{ x: 3, z: 3, chat: 'A' }, { x: 4, z: 3, chat: 'A' }], 0);
  assert.deepEqual(run(mem, rooms, [{ x: 3, z: 3, chat: 'A' }], 1), { 0: true }, 'a finished sub-agent has left');
  assert.deepEqual(run(mem, rooms, [{ x: 9, z: -0.75, chat: 'A' }], 2), { 0: true }, 'the chief is out by the door for a moment (a walk to another seat)');
  assert.deepEqual(run(mem, rooms, [], 3), { 0: true }, 'nobody in the scene for a frame');
  assert.deepEqual(run(mem, rooms, [], 3 + 10 * H), { 0: true }, 'nor for ten holds: the chat has the office and has been inside, that is the latch, not the hold');
  assert.deepEqual(run(mem, rooms, [{ x: 3, z: 3, chat: 'A' }], 40), { 0: true });
});

test('the chat closes: the office is lit while the last person that was in it is still inside, and dark a hold after it is out', () => {
  const mem = new Map();
  run(mem, [box(0, 'A', 0)], [{ x: 3, z: 3, chat: 'A' }, { x: 5, z: 4, chat: 'A' }, { x: 6, z: 2, chat: 'A' }], 0);
  const vacant = [box(0, null, 0)];
  assert.deepEqual(run(mem, vacant, [{ x: 3, z: 3, chat: 'A' }, { x: 5, z: 4, chat: 'A' }, { x: 6, z: 2, chat: 'A' }], 1), { 0: true }, 'all three stand up');
  assert.deepEqual(run(mem, vacant, [{ x: 8, z: 0.5, chat: 'A' }, { x: 5, z: 4, chat: 'A' }, { x: 9, z: -3, chat: 'A' }], 2), { 0: true }, 'one is out, one at the door, one still at its seat');
  assert.deepEqual(run(mem, vacant, [{ x: 9, z: -1, chat: 'A' }, { x: 5.5, z: 3.5, chat: 'A' }], 10), { 0: true }, 'the sub-agent is the last one in the room');
  assert.deepEqual(run(mem, vacant, [{ x: 9, z: -1, chat: 'A' }, { x: 9, z: -0.2, chat: 'A' }], 11), { 0: true }, 'the last one is through the door: the hold begins');
  assert.deepEqual(run(mem, vacant, [{ x: 9, z: -2, chat: 'A' }, { x: 9, z: -1.5, chat: 'A' }], 11 + H - 0.01), { 0: true }, 'still held');
  assert.deepEqual(run(mem, vacant, [{ x: 9, z: -2.5, chat: 'A' }, { x: 9, z: -2, chat: 'A' }], 11 + H), { 0: false }, 'and then dark');
  assert.deepEqual(run(mem, vacant, [{ x: 3, z: 3, chat: 'A' }], 20), { 0: true }, 'nothing remembers the old chat: a person inside lights even a vacant office');
});

test('a chat that takes the office while the first chat\'s person walks out: lit for the person, dark a hold after it is out, lit again for the new chat\'s own chief', () => {
  const mem = new Map();
  run(mem, [box(0, 'A', 0)], [{ x: 3, z: 3, chat: 'A' }], 0);                                 // A's chief is seated: lit
  run(mem, [box(0, null, 0)], [{ x: 3, z: 3, chat: 'A' }], 1);                                // A closed: still lit for the chief
  const taken = [box(0, 'B', 0)];
  assert.deepEqual(run(mem, taken, [{ x: 5, z: 2, chat: 'A' }], 2), { 0: true }, 'B has taken the office, A\'s chief is still inside it');
  assert.deepEqual(run(mem, taken, [{ x: 9, z: -1, chat: 'A' }, { x: 40, z: lane, chat: 'B' }], 3), { 0: true }, 'A\'s chief is out and B\'s has not come: held');
  assert.deepEqual(run(mem, taken, [{ x: 9, z: -2, chat: 'A' }, { x: 30, z: lane, chat: 'B' }], 3 + H - 0.01), { 0: true });
  assert.deepEqual(run(mem, taken, [{ x: 9, z: -2.5, chat: 'A' }, { x: 28, z: lane, chat: 'B' }], 3 + H), { 0: false }, 'the hold is over: dark, not lit for nobody');
  assert.deepEqual(run(mem, taken, [{ x: 9, z: 0.2, chat: 'B' }], 6), { 0: true }, 'B\'s chief is through the door');
  assert.deepEqual(run(mem, taken, [], 7), { 0: true }, 'and the office stays lit for B');
});

test('the hold carries over a change of the chat that has the office: B\'s chief comes in within the hold of A\'s chief leaving, and the light never goes out', () => {
  const mem = new Map();
  run(mem, [box(0, 'A', 0)], [{ x: 3, z: 3, chat: 'A' }], 0);
  run(mem, [box(0, null, 0)], [{ x: 3, z: 3, chat: 'A' }], 1);
  const taken = [box(0, 'B', 0)];
  assert.deepEqual(run(mem, taken, [{ x: 9, z: -1, chat: 'A' }], 2), { 0: true }, 'A\'s chief is out: the hold begins at 2');
  assert.deepEqual(run(mem, taken, [{ x: 9, z: -2, chat: 'A' }, { x: 9, z: -0.75, chat: 'B' }], 2.5), { 0: true }, 'B\'s chief is at the door');
  assert.deepEqual(run(mem, taken, [{ x: 9, z: -2.5, chat: 'A' }, { x: 9, z: 0.1, chat: 'B' }], 2 + H - 0.1), { 0: true }, 'B\'s chief is through the door a hair before the hold ends: lit');
  assert.deepEqual(run(mem, taken, [{ x: 9, z: -3, chat: 'A' }, { x: 9, z: 3, chat: 'B' }], 2 + H), { 0: true }, 'and the hold is over, with a person inside it');
  assert.deepEqual(run(mem, taken, [], 2 + 5 * H), { 0: true }, 'B has entered: it stays lit for the chat');
});

test('a person of another chat inside a taken office does not count as the owner having entered', () => {
  const mem = new Map(), rooms = [box(0, 'B', 0), box(1, 'A', 12)];
  assert.deepEqual(run(mem, rooms, [{ x: 5, z: 2, chat: 'A' }], 0), { 0: true, 1: false }, 'A\'s chief walks out of office 0 (B\'s now) on its way to office 1');
  assert.deepEqual(run(mem, rooms, [{ x: 9, z: -1, chat: 'A' }], 1), { 0: true, 1: false }, 'out of office 0: held for a hold');
  assert.deepEqual(run(mem, rooms, [{ x: 14, z: -2.5, chat: 'A' }], 1 + H), { 0: false, 1: false }, 'then dark: that office was never entered by B');
  assert.deepEqual(run(mem, rooms, [{ x: 20, z: 0.3, chat: 'A' }], 4), { 0: false, 1: true }, 'in at the door of office 1, its own: lit');
});

test('a brief job: a chat that takes an office and ends before its chief reaches the door never lights it, and the hold has nothing to hold', () => {
  const mem = new Map(), hall = [{ x: 40, z: lane }, { x: 15, z: lane }, { x: 15, z: -0.75 }];
  const taken = [box(0, 'A', 0), box(1, null, 12)];
  let seen = false;
  // A comes in along the hall and turns round at the door's outside point; the chat ends when it is there (the office is vacant from then on)
  const there = walkWith(mem, () => taken, hall, 'A');
  for (const f of there) seen = seen || f.lit[0] || f.lit[1];
  assert.equal(seen, false, 'a chief at the door, outside it, lit nothing');
  const back = walkWith(mem, () => [box(0, null, 0), box(1, null, 12)], [...hall].reverse(), 'A', { t0: there[there.length - 1].t });
  assert.ok(back.every(f => !f.lit[0] && !f.lit[1]), 'the walk back lights nothing, and the vacant office was never lit');
});

test('a job that turns back after its chief has crossed the door lights the office while the chief is inside, and for a hold after it is out, and then darkens it', () => {
  for (const depth of [0.3, 1]) {
    const mem = new Map(), dt = 1 / 30, door = 9;
    const inFrames = walkWith(mem, () => [box(0, 'A', 0)], [{ x: 40, z: lane }, { x: door, z: lane }, { x: door, z: -0.75 }, { x: door, z: depth }], 'A', { dt });
    assert.ok(inFrames[inFrames.length - 1].lit[0], `lit with the chief ${depth} m inside the door`);
    assert.ok(!inFrames.find(f => f.z < 0).lit[0], 'and not before it was through');
    // the chat ends: the chief turns back and walks out of the door and on to the entrance; the office is vacant now
    const back = walkWith(mem, () => [box(0, null, 0)], [{ x: door, z: depth }, { x: door, z: -0.75 }, { x: 40, z: lane }], 'A', { t0: inFrames[inFrames.length - 1].t, dt });
    const left = back.findIndex(f => f.z < 0);
    assert.ok(left > 0, 'the chief did leave the box');
    assert.ok(back.slice(0, left).every(f => f.lit[0]), 'lit while it walks out inside the office');
    const tLeft = back[left].t;
    assert.ok(back.slice(left).every(f => f.lit[0] === (f.t - tLeft < H)), `lit for the hold (${H} s) after it is out of the door, and dark from then on`);
    assert.ok(back[back.length - 1].t - tLeft > H, 'and the walk is long enough to see it go dark');
  }
});

test('a real walk in: the light comes on in the frame that takes the chief through the door and not one before; the walk out puts it out a hold after the frame that takes it out', () => {
  for (const [dt, pace] of [[1 / 8, 1], [1 / 30, 1], [0.1, 3]]) {
    const mem = new Map(), taken = [box(0, 'A', 0)], route = routeTo(0);
    const inFrames = walkWith(mem, () => taken, route, 'A', { dt, pace });
    const first = inFrames.findIndex(f => f.lit[0]);
    assert.ok(first > 0, 'it did come on');
    assert.ok(inFrames[first].z >= 0 && inFrames[first - 1].z < 0, `lit in the first frame at z >= 0 (${inFrames[first].z.toFixed(2)}), dark in the one before (${inFrames[first - 1].z.toFixed(2)})`);
    assert.ok(inFrames.slice(first).every(f => f.lit[0]), 'and it stays on to the seat');
    // the way out: the same route reversed, the chat has closed (vacant)
    const vacant = [box(0, null, 0)], out = walkWith(mem, () => vacant, [...route].reverse(), 'A', { dt, pace, t0: inFrames[inFrames.length - 1].t });
    const left = out.findIndex(f => f.z < 0);
    assert.ok(left > 0 && out[left - 1].z >= 0, `the first frame outside (${out[left].z.toFixed(2)}) follows one inside (${out[left - 1].z.toFixed(2)})`);
    assert.ok(out.slice(0, left).every(f => f.lit[0]), 'lit all the way out of the room');
    const tLeft = out[left].t, held = out.slice(left).filter(f => f.t - tLeft < H), dark = out.slice(left).filter(f => f.t - tLeft >= H);
    assert.ok(held.length > 0 && dark.length > 0, 'the walk out of the door is longer than the hold');
    assert.ok(held.every(f => f.lit[0]), `lit for the hold (${H} s) after the frame that takes it out`);
    assert.ok(dark.every(f => !f.lit[0]), 'and dark in the first frame after the hold, and for the rest of the walk');
  }
});

test('the hold: a gap shorter than the hold never reaches the switch, a longer one switches off at the hold and on at the next person, and the dark is the gap less the hold', () => {
  const rooms = [box(0, null, 0)], person = { x: 3, z: 3, chat: 'A' }, away = { x: 3, z: -3, chat: 'A' };
  for (const gap of [0.2, 0.5, H - 0.05]) {
    const mem = new Map(), seen = [];
    run(mem, rooms, [person], 0);
    for (let t = 0.05; t < gap + 0.04; t += 0.05) seen.push(run(mem, rooms, [away], t)[0]);         // out of the box for `gap`
    seen.push(run(mem, rooms, [person], gap + 0.05)[0]);                                              // a person is inside again
    assert.ok(seen.every(Boolean), `a gap of ${gap} s: lit in every call`);
  }
  for (const gap of [H + 0.3, 2 * H, 5]) {
    const mem = new Map(), dark = [];
    run(mem, rooms, [person], 0);
    for (let t = 0.05; t < gap; t += 0.05) if (!run(mem, rooms, [away], t)[0]) dark.push(t);
    assert.ok(dark.length > 0, `a gap of ${gap} s: it did go off`);
    assert.ok(Math.abs(dark[0] - (0.05 + H)) < 0.051, `at the hold after the first call that said off (${dark[0].toFixed(2)})`);
    assert.ok(Math.abs((gap - dark[0]) - (gap - 0.05 - H)) < 0.051, 'the dark lasts the gap less the hold');
    assert.equal(run(mem, rooms, [person], gap)[0], true, 'lit in the call a person is inside again');
  }
});

test('the hold counts from the first call that said off, not from the last that said on, and a person who comes back cancels it: the next dip has a whole hold of its own', () => {
  const rooms = [box(0, null, 0)], person = { x: 3, z: 3, chat: 'A' }, away = { x: 3, z: -3, chat: 'A' };
  const mem = new Map();
  run(mem, rooms, [person], 0);
  run(mem, rooms, [person], 5);
  assert.equal(run(mem, rooms, [away], 5.5)[0], true, 'out at 5.5 (the last call inside was at 5)');
  assert.equal(run(mem, rooms, [away], 5.5 + H - 0.01)[0], true, 'not off at 5 + hold either');
  assert.equal(run(mem, rooms, [person], 5.5 + H - 0.01 + 0.02)[0], true, 'a person is back a hair before the end of the hold');
  assert.equal(run(mem, rooms, [away], 7)[0], true, 'out again at 7: the first dip is cancelled, so this one starts a hold of its own');
  assert.equal(run(mem, rooms, [away], 7 + H - 0.01)[0], true, 'and the old hold, which would have ended long ago, does not switch it off');
  assert.equal(run(mem, rooms, [away], 7 + H)[0], false, 'a whole hold after the second dip began');
});

test('a dark office is not held and a first look is not held: the hold only keeps a light on', () => {
  const rooms = [box(0, 'A', 0), box(1, null, 12)], away = { x: 3, z: -3, chat: 'A' };
  assert.deepEqual(run(new Map(), rooms, [away], 100), { 0: false, 1: false }, 'at the first look nothing is lit (a page that opens with chats does not light a room for a hold)');
  assert.deepEqual(run(new Map(), rooms, [{ x: 3, z: 3, chat: 'A' }], 100), { 0: true, 1: false }, 'at the first look a person inside lights it');
  const mem = new Map();
  run(mem, rooms, [], 0);
  assert.deepEqual(run(mem, rooms, [away], 0.01), { 0: false, 1: false }, 'a person outside, a second after: still dark');
  assert.deepEqual(run(mem, rooms, [{ x: 20, z: 2, chat: 'A' }], 0.02), { 0: false, 1: true }, 'a person inside the vacant office: lit in that very call, however soon after');
});

test('the scene clock is required, and a hold of 0 is the rule without one', () => {
  assert.throws(() => roomLights(new Map(), [box(0, null, 0)], []), /scene clock/);
  assert.throws(() => roomLights(new Map(), [box(0, null, 0)], [], new Map(), 0, NaN), /scene clock/);
  const mem = new Map(), rooms = [box(0, null, 0)], out = new Map();
  roomLights(mem, rooms, [{ x: 3, z: 3, chat: 'A' }], out, 1, 0, 0);
  assert.equal(out.get(0), true);
  roomLights(mem, rooms, [{ x: 3, z: -3, chat: 'A' }], out, 1, 0.01, 0);
  assert.equal(out.get(0), false, 'dark at once');
});

test('a rebuild reads the same rule from the people: nothing is reset to the data', () => {
  // walk in: a rebuild (new room objects, same slots and owners) while the chief is outside must not light the office
  const mem = new Map();
  const fresh = () => [{ slot: 0, owner: 'A', x0: 0, x1: 10, z0: 0, z1: 6.8 }];
  assert.deepEqual(run(mem, fresh(), [{ x: 9, z: -0.75, chat: 'A' }], 0), { 0: false });
  assert.deepEqual(run(mem, fresh(), [{ x: 9, z: -0.75, chat: 'A' }], 0), { 0: false }, 'rebuilt: still dark, the chief is still outside');
  run(mem, fresh(), [{ x: 3, z: 3, chat: 'A' }], 1);
  assert.deepEqual(run(mem, fresh(), [{ x: 3, z: 3, chat: 'A' }], 1), { 0: true }, 'rebuilt: still lit');
  // walk out: the chat has closed, a rebuild while the chief is inside must not darken the office, and one after it has left must not light it
  const vacant = () => [{ slot: 0, owner: null, x0: 0, x1: 10, z0: 0, z1: 6.8 }];
  assert.deepEqual(run(mem, vacant(), [{ x: 5, z: 2, chat: 'A' }], 2), { 0: true });
  assert.deepEqual(run(mem, vacant(), [{ x: 5, z: 2, chat: 'A' }], 2), { 0: true }, 'rebuilt while the chief is still inside: still lit');
  assert.deepEqual(run(mem, vacant(), [{ x: 9, z: -3, chat: 'A' }], 3), { 0: true }, 'out: held');
  assert.deepEqual(run(mem, vacant(), [{ x: 9, z: -3, chat: 'A' }], 3), { 0: true }, 'rebuilt in the same instant: the hold is not restarted and not cut');
  assert.deepEqual(run(mem, vacant(), [{ x: 9, z: -3, chat: 'A' }], 3 + H), { 0: false }, 'a hold after the first call that said off, rebuilds between or not');
  // a page that has no memory yet (a first build, or a scene that was left and is back) reads it from the people too
  assert.deepEqual(run(new Map(), fresh(), [{ x: 3, z: 3, chat: 'A' }], 9), { 0: true }, 'seated in an office at the first look: lit');
  assert.deepEqual(run(new Map(), fresh(), [], 9), { 0: false }, 'taken and empty at the first look: dark');
  assert.deepEqual(run(new Map(), vacant(), [{ x: 3, z: 3, chat: 'A' }], 9), { 0: true }, 'vacant with a person walking out of it at the first look: lit');
});

test('page load with ten chats: each office lights in the frame its own chief comes through the door, in the order the chiefs cross', () => {
  const mem = new Map(), n = 10;
  const rooms = Array.from({ length: n }, (_, i) => box(i, 'c' + i, i * 12));
  // the chiefs leave the entrance 0.3 s apart and walk to their office along the hall's lane (each along its own route)
  const walks = rooms.map((r, i) => ({ chat: 'c' + i, w: { x: 40, z: lane, path: routeTo(r.x0), pi: 1, travelled: 0, plen: pathLength(routeTo(r.x0)) }, delay: i * 0.3, done: false }));
  const lit = new Map(), crossed = new Map();
  const dt = 1 / 8;
  const people = [];
  let frame = 0;
  for (; frame < 3000 && walks.some(k => !k.done); frame++) {
    people.length = 0;
    for (const k of walks) {
      if (k.delay > 0) { k.delay -= dt; continue; }
      if (!k.done) k.done = stepWalk(k.w, dt, { pace: 1.4 }).done;
      people.push({ x: k.w.x, z: k.w.z, chat: k.chat });
    }
    const out = Object.fromEntries(roomLights(mem, rooms, people, new Map(), people.length, (frame + 1) * dt));
    walks.forEach((k, i) => {
      const inside = k.delay <= 0 && k.w.z >= 0 && k.w.x >= rooms[i].x0 && k.w.x <= rooms[i].x1;
      if (inside && !crossed.has(i)) crossed.set(i, frame);
      if (out[i] && !lit.has(i)) lit.set(i, frame);
      assert.equal(out[i], crossed.has(i), `office ${i} frame ${frame}: lit exactly from the frame its chief is inside`);
    });
  }
  assert.equal(lit.size, n, 'all ten came on');
  assert.deepEqual([...lit.entries()].sort((a, b) => a[0] - b[0]), [...crossed.entries()].sort((a, b) => a[0] - b[0]), 'each lit in the frame its chief crossed, not before and not after');
  const order = [...lit.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0]).map(e => e[0]);
  assert.deepEqual(order, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].sort((a, b) => crossed.get(a) - crossed.get(b) || a - b), 'in the order the chiefs cross');
});

test('two chiefs that come through their doors in the same frame light both offices in that frame (a hurried queue does this on the page)', () => {
  const mem = new Map(), rooms = [box(0, 'A', 0), box(1, 'B', 12)];
  assert.deepEqual(run(mem, rooms, [{ x: 9, z: -0.1, chat: 'A' }, { x: 21, z: -0.1, chat: 'B' }], 1), { 0: false, 1: false });
  assert.deepEqual(run(mem, rooms, [{ x: 9, z: 0.2, chat: 'A' }, { x: 21, z: 0.2, chat: 'B' }], 1.1), { 0: true, 1: true }, 'both in the one frame');
});

test('the people of the lounge are never in an office: a person in the plaza lights nothing, and a vacant office stays dark with the same furnishing', () => {
  const mem = new Map(), rooms = [box(0, null, 0), box(1, 'A', 12)];
  const lounge = [{ x: 30, z: 3, chat: 'A' }, { x: 31, z: 4, chat: null }, { x: 6, z: -3, chat: null }];
  assert.deepEqual(run(mem, rooms, lounge, 0), { 0: false, 1: false }, 'a lounge person of the chat that has office 1 is not in office 1');
});

test('only the first `count` people are read, and a slot that is no longer a room is forgotten', () => {
  const mem = new Map(), out = new Map(), people = [{ x: 30, z: 3, chat: null }, { x: 3, z: 3, chat: 'A' }];
  roomLights(mem, [box(0, null, 0)], people, out, 1, 0);
  assert.equal(out.get(0), false, 'the second person is not read');
  roomLights(mem, [box(0, null, 0)], people, out, 2, 0.1);
  assert.equal(out.get(0), true);
  assert.equal(mem.size, 1);
  roomLights(mem, [box(5, 'A', 0)], [], out, 0, 0.2);
  assert.deepEqual([...mem.keys()], [5], 'slot 0 is forgotten with its room');
  assert.deepEqual([...out.keys()], [5]);
});

test('the chat that has the office changes: the old chat\'s entry does not light the new one', () => {
  const mem = new Map();
  run(mem, [box(0, 'A', 0)], [{ x: 3, z: 3, chat: 'A' }], 0);                               // A entered
  assert.deepEqual(run(mem, [box(0, 'B', 0)], [], 1), { 0: true }, 'B has the office now, nobody is in it: the light is held for a hold, whatever A did');
  assert.deepEqual(run(mem, [box(0, 'B', 0)], [], 1 + H), { 0: false }, 'then dark: B has not been inside, and A\'s latch is gone');
  assert.deepEqual(run(mem, [box(0, 'A', 0)], [], 5), { 0: false }, 'and A back in it is dark again until its own figure is inside');
});

// The hold against real walks: a chat closes and another takes the same office d seconds later. The old chief walks out of a seat near the entrance, the new chief walks in from the
// entrance: the rule must keep the light on for every gap shorter than the hold and put it out for a gap of g - H after that. (The scene's own frame is 1/30 s here.)
test('a handover with real walks: for every delay of the new chat the dark gap is the gap between the two people less the hold, or none, and nobody is ever in the dark', () => {
  const dt = 1 / 30, x0 = 30, route = routeTo(x0), out = [...route].reverse();
  const results = [];
  for (let d = 0; d <= 6.01; d += 0.25) {
    const mem = new Map();
    run(mem, [box(0, 'A', x0)], [{ x: x0 + 3, z: 3, chat: 'A' }], 0);                      // A's chief is seated, the office is lit
    const wa = { x: out[0].x, z: out[0].z, path: out, pi: 1, travelled: 0, plen: pathLength(out) };
    const wb = { x: route[0].x, z: route[0].z, path: route, pi: 1, travelled: 0, plen: pathLength(route) };
    let tLeft = null, tCross = null, dark = 0, inDark = 0;
    for (let f = 1; f < 3000; f++) {
      const t = f * dt, people = [];
      if (wa.pi < wa.path.length) stepWalk(wa, dt);                                                                  // A closed at 0: its chief walks out
      people.push({ x: wa.x, z: wa.z, chat: 'A' });
      const bHere = t >= d;                                                                // B takes the office at d and its chief walks in from the entrance
      if (bHere) { if (wb.pi < wb.path.length) stepWalk(wb, dt); people.push({ x: wb.x, z: wb.z, chat: 'B' }); }
      const lit = run(mem, [box(0, bHere ? 'B' : null, x0)], people, t)[0];
      const aIn = wa.z >= 0, bIn = bHere && wb.z >= 0;
      if (tLeft === null && !aIn) tLeft = t;
      if (tCross === null && bIn) tCross = t;
      if (!lit) { dark += dt; if (aIn || bIn) inDark++; }
      if (tCross !== null && tLeft !== null && t > Math.max(tCross, tLeft) + 1.5) break;
    }
    const gap = tCross - tLeft;
    results.push({ d, gap, dark });
    assert.equal(inDark, 0, `d ${d}: somebody was inside and the office was dark`);
    if (gap < H - 2 * dt) assert.equal(dark, 0, `d ${d}: a gap of ${gap.toFixed(2)} s is shorter than the hold: no dark at all (${dark.toFixed(2)} s)`);
    else if (gap > H + 2 * dt) assert.ok(Math.abs(dark - (gap - H)) < 3 * dt, `d ${d}: a gap of ${gap.toFixed(2)} s leaves ${dark.toFixed(2)} s of dark (want ${(gap - H).toFixed(2)})`);
  }
  assert.ok(results.some(r => r.gap > 0 && r.gap < H - 0.1), 'the sweep has gaps shorter than the hold (the blinks of before)');
  assert.ok(results.some(r => r.gap > H + 0.5), 'and gaps longer than it');
});
