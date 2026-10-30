// The rule that decides which offices are lit (public/js/ofis-presence.js): the light follows the people. The pure part: it is given where the people are and whose they are, so every
// case here is a few lines of positions, and the walks are real ones (stepWalk of ofis-arrive.js along a route into a box). tools/qa/office3d-walk-qa.mjs 3d-walk-lights reads the same
// rule in the page, against the people the scene really has.
import test from 'node:test';
import assert from 'node:assert/strict';
import { roomLights, inBox } from '../public/js/ofis-presence.js';
import { stepWalk, pathLength } from '../public/js/ofis-arrive.js';

// two offices of one hall: slot 0 at x 0..10, slot 1 at x 12..22, both z 0..6.8 with the hall at z < 0 (the doors are in the wall at z = 0); the entrance is at x 40
const box = (slot, owner, x0) => ({ slot, owner, x0, x1: x0 + 10, z0: 0, z1: 6.8 });
const lane = -2.5;
const routeTo = (x0, doorDx = 9) => [{ x: 40, z: lane }, { x: x0 + doorDx, z: lane }, { x: x0 + doorDx, z: -0.75 }, { x: x0 + doorDx, z: 1.2 }, { x: x0 + 3, z: 3 }];

// one frame of a rule run: the people as { x, z, chat }
const run = (mem, rooms, people) => Object.fromEntries(roomLights(mem, rooms, people));

// walk a figure along `path` in frames of dt and call the rule at every frame; `at(frame)` says the other people. Returns the frames { x, z, lit: { slot: bool } }
function walkWith(mem, roomsAt, path, chat, { dt = 1 / 8, pace = 1, others = () => [] } = {}) {
  const w = { x: path[0].x, z: path[0].z, path, pi: 1, travelled: 0, plen: pathLength(path) };
  const out = [];
  for (let f = 0; f < 4000; f++) {
    const r = stepWalk(w, dt, { pace });
    out.push({ x: w.x, z: w.z, lit: run(mem, roomsAt(f), [{ x: w.x, z: w.z, chat }, ...others(f)]) });
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

test('a vacant office with nobody in it is dark; somebody inside lights it and it is dark again when they have gone', () => {
  const mem = new Map(), rooms = [box(0, null, 0), box(1, null, 12)];
  assert.deepEqual(run(mem, rooms, []), { 0: false, 1: false });
  assert.deepEqual(run(mem, rooms, [{ x: 3, z: 3, chat: 'A' }]), { 0: true, 1: false }, 'a person of a chat that has gone, still in the office');
  assert.deepEqual(run(mem, rooms, [{ x: 3, z: -1, chat: 'A' }]), { 0: false, 1: false }, 'out of the door: dark at once, nothing is waiting for anybody');
});

test('an office that a chat has taken stays dark until a person of that chat is inside, and lit afterwards', () => {
  const mem = new Map(), rooms = [box(0, 'A', 0)];
  assert.deepEqual(run(mem, rooms, []), { 0: false }, 'taken, nobody there yet');
  assert.deepEqual(run(mem, rooms, [{ x: 9, z: -0.75, chat: 'A' }]), { 0: false }, 'the chief is outside the door');
  assert.deepEqual(run(mem, rooms, [{ x: 9, z: 0.05, chat: 'A' }]), { 0: true }, 'the chief has come through the door');
  assert.deepEqual(run(mem, rooms, [{ x: 3, z: 3, chat: 'A' }]), { 0: true });
});

test('while the chat has the office it stays lit, whoever stands up, leaves or is out of the box for a moment', () => {
  const mem = new Map(), rooms = [box(0, 'A', 0)];
  run(mem, rooms, [{ x: 3, z: 3, chat: 'A' }, { x: 4, z: 3, chat: 'A' }]);
  assert.deepEqual(run(mem, rooms, [{ x: 3, z: 3, chat: 'A' }]), { 0: true }, 'a finished sub-agent has left');
  assert.deepEqual(run(mem, rooms, [{ x: 9, z: -0.75, chat: 'A' }]), { 0: true }, 'the chief is out by the door for a moment (a walk to another seat)');
  assert.deepEqual(run(mem, rooms, []), { 0: true }, 'nobody in the scene for a frame');
  assert.deepEqual(run(mem, rooms, [{ x: 3, z: 3, chat: 'A' }]), { 0: true });
});

test('the chat closes: the office is lit while the last person that was in it is still inside, and dark when it is out', () => {
  const mem = new Map();
  run(mem, [box(0, 'A', 0)], [{ x: 3, z: 3, chat: 'A' }, { x: 5, z: 4, chat: 'A' }, { x: 6, z: 2, chat: 'A' }]);
  const vacant = [box(0, null, 0)];
  assert.deepEqual(run(mem, vacant, [{ x: 3, z: 3, chat: 'A' }, { x: 5, z: 4, chat: 'A' }, { x: 6, z: 2, chat: 'A' }]), { 0: true }, 'all three stand up');
  assert.deepEqual(run(mem, vacant, [{ x: 8, z: 0.5, chat: 'A' }, { x: 5, z: 4, chat: 'A' }, { x: 9, z: -3, chat: 'A' }]), { 0: true }, 'one is out, one at the door, one still at its seat');
  assert.deepEqual(run(mem, vacant, [{ x: 9, z: -1, chat: 'A' }, { x: 5.5, z: 3.5, chat: 'A' }]), { 0: true }, 'the sub-agent is the last one in the room');
  assert.deepEqual(run(mem, vacant, [{ x: 9, z: -1, chat: 'A' }, { x: 9, z: -0.2, chat: 'A' }]), { 0: false }, 'the last one is through the door');
  assert.deepEqual(run(mem, vacant, [{ x: 3, z: 3, chat: 'A' }]), { 0: true }, 'nothing remembers the old chat: a person inside lights even a vacant office');
});

test('a chat that takes the office while the first chat\'s person walks out: lit for the person, dark after, lit again for the new chat\'s own chief', () => {
  const mem = new Map();
  run(mem, [box(0, 'A', 0)], [{ x: 3, z: 3, chat: 'A' }]);                                    // A's chief is seated: lit
  run(mem, [box(0, null, 0)], [{ x: 3, z: 3, chat: 'A' }]);                                   // A closed: still lit for the chief
  const taken = [box(0, 'B', 0)];
  assert.deepEqual(run(mem, taken, [{ x: 5, z: 2, chat: 'A' }]), { 0: true }, 'B has taken the office, A\'s chief is still inside it');
  assert.deepEqual(run(mem, taken, [{ x: 9, z: -1, chat: 'A' }, { x: 40, z: lane, chat: 'B' }]), { 0: false }, 'A\'s chief is out and B\'s has not come: the office is dark, not lit for nobody');
  assert.deepEqual(run(mem, taken, [{ x: 9, z: 0.2, chat: 'B' }]), { 0: true }, 'B\'s chief is through the door');
  assert.deepEqual(run(mem, taken, []), { 0: true }, 'and the office stays lit for B');
});

test('a person of another chat inside a taken office does not count as the owner having entered', () => {
  const mem = new Map(), rooms = [box(0, 'B', 0), box(1, 'A', 12)];
  assert.deepEqual(run(mem, rooms, [{ x: 5, z: 2, chat: 'A' }]), { 0: true, 1: false }, 'A\'s chief walks out of office 0 (B\'s now) on its way to office 1');
  assert.deepEqual(run(mem, rooms, [{ x: 9, z: -1, chat: 'A' }]), { 0: false, 1: false }, 'out of office 0: that office was never entered by B');
  assert.deepEqual(run(mem, rooms, [{ x: 20, z: 0.3, chat: 'A' }]), { 0: false, 1: true }, 'in at the door of office 1, its own: lit');
});

test('a brief job: a chat that takes an office and ends before its chief reaches the door never lights it', () => {
  const mem = new Map(), hall = [{ x: 40, z: lane }, { x: 15, z: lane }, { x: 15, z: -0.75 }];
  const taken = [box(0, 'A', 0), box(1, null, 12)];
  let seen = false;
  // A comes in along the hall and turns round at the door's outside point; the chat ends when it is there (the office is vacant from then on)
  const there = walkWith(mem, () => taken, hall, 'A');
  for (const f of there) seen = seen || f.lit[0] || f.lit[1];
  assert.equal(seen, false, 'a chief at the door, outside it, lit nothing');
  const back = walkWith(mem, () => [box(0, null, 0), box(1, null, 12)], [...hall].reverse(), 'A');
  assert.ok(back.every(f => !f.lit[0] && !f.lit[1]), 'the walk back lights nothing, and the vacant office was never lit');
});

test('a real walk in: the light comes on in the frame that takes the chief through the door and not one before; the walk out puts it out in the frame that takes it out', () => {
  for (const [dt, pace] of [[1 / 8, 1], [1 / 30, 1], [0.1, 3]]) {
    const mem = new Map(), taken = [box(0, 'A', 0)], route = routeTo(0);
    const inFrames = walkWith(mem, () => taken, route, 'A', { dt, pace });
    const first = inFrames.findIndex(f => f.lit[0]);
    assert.ok(first > 0, 'it did come on');
    assert.ok(inFrames[first].z >= 0 && inFrames[first - 1].z < 0, `lit in the first frame at z >= 0 (${inFrames[first].z.toFixed(2)}), dark in the one before (${inFrames[first - 1].z.toFixed(2)})`);
    assert.ok(inFrames.slice(first).every(f => f.lit[0]), 'and it stays on to the seat');
    // the way out: the same route reversed, the chat has closed (vacant)
    const vacant = [box(0, null, 0)], out = walkWith(mem, () => vacant, [...route].reverse(), 'A', { dt, pace });
    const last = out.findLastIndex(f => f.lit[0]);
    assert.ok(out[last].z >= 0 && out[last + 1].z < 0, `lit up to the last frame inside (${out[last].z.toFixed(2)}), dark in the first one outside (${out[last + 1].z.toFixed(2)})`);
    assert.ok(out.slice(last + 1).every(f => !f.lit[0]), 'and dark for the rest of the walk');
  }
});

test('a rebuild reads the same rule from the people: nothing is reset to the data', () => {
  // walk in: a rebuild (new room objects, same slots and owners) while the chief is outside must not light the office
  const mem = new Map();
  const fresh = () => [{ slot: 0, owner: 'A', x0: 0, x1: 10, z0: 0, z1: 6.8 }];
  assert.deepEqual(run(mem, fresh(), [{ x: 9, z: -0.75, chat: 'A' }]), { 0: false });
  assert.deepEqual(run(mem, fresh(), [{ x: 9, z: -0.75, chat: 'A' }]), { 0: false }, 'rebuilt: still dark, the chief is still outside');
  run(mem, fresh(), [{ x: 3, z: 3, chat: 'A' }]);
  assert.deepEqual(run(mem, fresh(), [{ x: 3, z: 3, chat: 'A' }]), { 0: true }, 'rebuilt: still lit');
  // walk out: the chat has closed, a rebuild while the chief is inside must not darken the office, and one after it has left must not light it
  const vacant = () => [{ slot: 0, owner: null, x0: 0, x1: 10, z0: 0, z1: 6.8 }];
  assert.deepEqual(run(mem, vacant(), [{ x: 5, z: 2, chat: 'A' }]), { 0: true });
  assert.deepEqual(run(mem, vacant(), [{ x: 5, z: 2, chat: 'A' }]), { 0: true }, 'rebuilt while the chief is still inside: still lit');
  assert.deepEqual(run(mem, vacant(), [{ x: 9, z: -3, chat: 'A' }]), { 0: false });
  // a page that has no memory yet (a first build, or a scene that was left and is back) reads it from the people too
  assert.deepEqual(run(new Map(), fresh(), [{ x: 3, z: 3, chat: 'A' }]), { 0: true }, 'seated in an office at the first look: lit');
  assert.deepEqual(run(new Map(), fresh(), []), { 0: false }, 'taken and empty at the first look: dark');
  assert.deepEqual(run(new Map(), vacant(), [{ x: 3, z: 3, chat: 'A' }]), { 0: true }, 'vacant with a person walking out of it at the first look: lit');
});

test('page load with ten chats: every office lights in the frame its own chief comes through the door, one at a time, in the order they arrive', () => {
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
    const out = Object.fromEntries(roomLights(mem, rooms, people));
    walks.forEach((k, i) => {
      const inside = k.delay <= 0 && k.w.z >= 0 && k.w.x >= rooms[i].x0 && k.w.x <= rooms[i].x1;
      if (inside && !crossed.has(i)) crossed.set(i, frame);
      if (out[i] && !lit.has(i)) lit.set(i, frame);
      assert.equal(out[i], crossed.has(i), `office ${i} frame ${frame}: lit exactly from the frame its chief is inside`);
    });
  }
  assert.equal(lit.size, n, 'all ten came on');
  const order = [...lit.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]);
  assert.equal(new Set(lit.values()).size, n, 'one at a time: no two on the same frame');
  assert.deepEqual(order, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].sort((a, b) => crossed.get(a) - crossed.get(b)));
});

test('the people of the lounge are never in an office: a person in the plaza lights nothing, and a vacant office stays dark with the same furnishing', () => {
  const mem = new Map(), rooms = [box(0, null, 0), box(1, 'A', 12)];
  const lounge = [{ x: 30, z: 3, chat: 'A' }, { x: 31, z: 4, chat: null }, { x: 6, z: -3, chat: null }];
  assert.deepEqual(run(mem, rooms, lounge), { 0: false, 1: false }, 'a lounge person of the chat that has office 1 is not in office 1');
});

test('only the first `count` people are read, and a slot that is no longer a room is forgotten', () => {
  const mem = new Map(), out = new Map(), people = [{ x: 30, z: 3, chat: null }, { x: 3, z: 3, chat: 'A' }];
  roomLights(mem, [box(0, null, 0)], people, out, 1);
  assert.equal(out.get(0), false, 'the second person is not read');
  roomLights(mem, [box(0, null, 0)], people, out, 2);
  assert.equal(out.get(0), true);
  assert.equal(mem.size, 1);
  roomLights(mem, [box(5, 'A', 0)], [], out);
  assert.deepEqual([...mem.keys()], [5], 'slot 0 is forgotten with its room');
  assert.deepEqual([...out.keys()], [5]);
});

test('the chat that has the office changes: the old chat\'s entry does not light the new one', () => {
  const mem = new Map();
  run(mem, [box(0, 'A', 0)], [{ x: 3, z: 3, chat: 'A' }]);                                  // A entered
  assert.deepEqual(run(mem, [box(0, 'B', 0)], []), { 0: false }, 'B has the office now, nobody is in it: dark, whatever A did');
  assert.deepEqual(run(mem, [box(0, 'A', 0)], []), { 0: false }, 'and A back in it is dark again until its own figure is inside');
});
