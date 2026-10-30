// Which offices are lit: the light of an office follows its people, not the data. No WebGL and no DOM, so that node can test it (test/ofis-presence.test.mjs); ofis.js (`lightsFor`) asks
// it once per frame, after the walkers have moved, and at every rebuild of the building, and throws the switches (decor.setLit) with the answer.
//
// An office is a box on the floor { x0, x1, z0, z1 }: its inside, whose wall the door opens through, so a person has entered it when the walk has taken them through the door and
// into that box, and has left it when they are out of the door again. The rule, for one office:
//   - while somebody is inside it, it is lit (anybody: the chat's own people, or the people of a chat that has gone and is still walking out);
//   - an office that a chat has taken stays dark until the first person of THAT chat is inside it (a furnished vacant look with the chat's sign): the chat that has the office has
//     "entered" once one of its figures has been inside, and from then on the office stays lit for as long as that chat has it, whoever stands up, leaves or is out of the box for a
//     moment (a finished sub-agent, a person that walks to another seat by the door, a rebuild);
//   - a vacant office (nobody's chat) is lit only while somebody is inside: the people of the chat that has just closed keep it lit until the last one is out of the box;
//   - when the chat that has an office changes (it closed and another took the office, the first one's person still walking out of it), what the old chat's people did is forgotten: the
//     new chat has not entered until one of ITS figures is inside, and the office goes dark when the last person of the old one has left it.
// The rule needs nothing but where people are and whose they are, so it reads the same after a rebuild (nothing is reset to the data), the people of the lounge (they are not in any
// office's box) never count, and a figure still waiting at the entrance (not drawn yet) is not passed in.
//
//   roomLights(mem, rooms, people, out, count)   the lights of every office, as `out` (a Map slot -> on, made if not given)
//     mem     the memory between two calls, a Map that the caller keeps (slot -> { owner, entered }); a slot that is not in `rooms` any more is forgotten
//     rooms   [{ slot, owner, x0, x1, z0, z1 }]: owner is the id of the chat that has the office, null when it is vacant
//     people  [{ x, z, chat }]: the figures that are in the scene, chat the id of the chat whose figure it is (the first `count` of them are read)

export const inBox = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

export function roomLights(mem, rooms, people, out = new Map(), count = people.length) {
  out.clear();
  for (const r of rooms) {
    let st = mem.get(r.slot);
    if (!st || st.owner !== r.owner) { st = { owner: r.owner, entered: false }; mem.set(r.slot, st); }
    let inside = false;
    for (let i = 0; i < count; i++) {
      const p = people[i];
      if (!inBox(r, p.x, p.z)) continue;
      inside = true;
      if (r.owner !== null && p.chat === r.owner) { st.entered = true; break; }
    }
    out.set(r.slot, inside || (r.owner !== null && st.entered));
  }
  for (const slot of mem.keys()) if (!out.has(slot)) mem.delete(slot);                 // (a Map can lose an entry while it is walked)
  return out;
}
