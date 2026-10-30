// Which offices are lit: the light of an office follows its people, not the data. No WebGL and no DOM, so that node can test it (test/ofis-presence.test.mjs); ofis.js (`lightsFor`) asks
// it once per frame, after the walkers have moved, and throws the switches (decor.setLit) with the answer (a rebuild of the building throws none: the next frame's pass reads the people).
//
// An office is a box on the floor { x0, x1, z0, z1 }: its inside, whose wall the door opens through, so a person has entered it when the walk has taken them through the door and
// into that box, and has left it when they are out of the door again. The rule, for one office:
//   - while somebody is inside it, it is lit (anybody: the chat's own people, or the people of a chat that has gone and is still walking out);
//   - an office that a chat has taken stays dark until the first person of THAT chat is inside it (a furnished vacant look with the chat's sign): the chat that has the office has
//     "entered" once one of its figures has been inside, and from then on the office stays lit for as long as that chat has it, whoever stands up, leaves or is out of the box for a
//     moment (a finished sub-agent, a person that walks to another seat by the door, a rebuild);
//   - a vacant office (nobody's chat) is lit only while somebody is inside it (and for the hold below): the people of the chat that has just closed keep it lit until the last one is out of the box;
//   - when the chat that has an office changes (it closed and another took the office, the first one's person still walking out of it), what the old chat's people did is forgotten: the
//     new chat has not entered until one of ITS figures is inside, and the office goes dark a hold after the last person of the old one has left it;
//   - a light that is lit is switched off only when the rule above has said "off" for LIGHT_HOLD_S of the scene's clock in a row (the hold). The rule says "on" again at once (a person
//     is inside, or the chat has entered) and that cancels the off: a gap shorter than the hold never reaches the switch. An office that is dark is not held (the hold only keeps a
//     light on, it never turns one on): a job that turns round before the door lights nothing, and a person inside lights the office in the very frame it comes through the door.
// The rule needs nothing but where people are, whose they are and what time the scene's clock shows, so it reads the same after a rebuild (nothing is reset to the data), the people of
// the lounge (they are not in any office's box) never count, and a figure still waiting at the entrance (not drawn yet) is not passed in.
//
//   roomLights(mem, rooms, people, out, count, now, hold)   the lights of every office, as `out` (a Map slot -> on, made if not given)
//     mem     the memory between two calls, a Map that the caller keeps (slot -> { owner, entered, lit, offAt }); a slot that is not in `rooms` any more is forgotten
//     rooms   [{ slot, owner, x0, x1, z0, z1 }]: owner is the id of the chat that has the office, null when it is vacant
//     people  [{ x, z, chat }]: the figures that are in the scene, chat the id of the chat whose figure it is (the first `count` of them are read)
//     now     the scene's clock in seconds (a number that only grows, the sum of the frames' steps: not the wall clock, which a slow frame rate or a hidden page bends); required,
//             because a hold that is never given the time would keep a light on for ever
//     hold    seconds (LIGHT_HOLD_S): 0 is the rule without a hold

// Why 1.0 s: when a chat closes and another takes the SAME office while the first one's chief is still walking out of it, the old chief leaves the floor box and the new chief crosses the
// door a moment apart (the review measured the light going off and on again 0.4 to 1.1 s apart in the office nearest the entrance), and the room blinked. A gap shorter than the hold
// never reaches the switch (gaps of 0.4 and 0.9 s were measured and switch nothing now). The hold is a pure delay, so it does not close every gap: a gap of 1.5 s still goes dark for
// 0.5 s (the gap less the hold) and comes on again, which the walk QA counts as the `handover` sweep; closing those would take a look at who is walking towards the door, which
// this rule, given only positions and the clock, does not do. 1.0 s keeps a person who turns back at a door, or a new person coming in behind the last one, in a lit room, and is short
// enough that an office is dark about a second after its last person has gone (the feedback kind of docs/motion.md: a blink of a light is a flaw, a light that stays a second after you
// is what a room does). It is the same with prefers-reduced-motion: the switch is a step there, which makes a blink harder, not easier to bear.
export const LIGHT_HOLD_S = 1.0;

export const inBox = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

export function roomLights(mem, rooms, people, out = new Map(), count = people.length, now, hold = LIGHT_HOLD_S) {
  if (typeof now !== 'number' || !Number.isFinite(now)) throw new TypeError('roomLights needs the scene clock in seconds (now)');
  out.clear();
  for (const r of rooms) {
    let st = mem.get(r.slot);
    if (!st) { st = { owner: r.owner, entered: false, lit: false, offAt: null }; mem.set(r.slot, st); }
    else if (st.owner !== r.owner) { st.owner = r.owner; st.entered = false; }            // another chat has the office: what the old one did is forgotten (the light and its hold are the room's own and stay)
    let inside = false;
    for (let i = 0; i < count; i++) {
      const p = people[i];
      if (!inBox(r, p.x, p.z)) continue;
      inside = true;
      if (r.owner !== null && p.chat === r.owner) { st.entered = true; break; }
    }
    if (inside || (r.owner !== null && st.entered)) { st.lit = true; st.offAt = null; }       // on, and any off that was waiting is cancelled
    else if (st.lit) {                                                                        // the rule says off: the light goes when it has said so for the whole hold
      if (st.offAt === null) st.offAt = now;
      if (now - st.offAt >= hold) { st.lit = false; st.offAt = null; }
    }
    out.set(r.slot, st.lit);
  }
  for (const slot of mem.keys()) if (!out.has(slot)) mem.delete(slot);                 // (a Map can lose an entry while it is walked)
  return out;
}
