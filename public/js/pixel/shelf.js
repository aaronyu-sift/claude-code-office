// The shelf: the chats that have no room, newest first. Pure functions (no DOM and no clock of their own), so the rules are tested without a browser.
//   - a live main session that has been asleep for long (status 'dormant', idle for more than two hours) leaves its room and goes on the shelf;
//   - a session with no process (closed) goes on the shelf too, from the server's list of recently closed sessions;
//   - a chat that waits for you ('waiting', 'ask'), works or has just finished a turn is never on the shelf: it stays in its room.
//   - only the newest few are shown (capEntries): how many is a setting (settings.js), the visitor can ask for more.
// An entry: { id, kind: 'dormant' | 'closed', name, title, project, color, at (when it fell asleep or closed, ms), observed (closed: the server saw it) }.

export const DEFAULT_CAP = 10, MIN_CAP = 3, MAX_CAP = 200;          // the shelf shows this many chats (setting `shelf`: the default and its limits)

export const isShelved = a => !!a && a.kind === 'main' && a.status === 'dormant';

const byNewest = (p, q) => q.at - p.at || (p.id < q.id ? -1 : p.id > q.id ? 1 : 0);

export function shelfEntries({ agents, closed = [] }) {
  const out = [], live = new Set();
  for (const a of agents) {
    if (a.kind !== 'main') continue;
    live.add(a.id);
    if (isShelved(a)) out.push({ id: a.id, kind: 'dormant', name: a.name || a.title || a.project || '', title: a.title || '', project: a.project || '', color: a.color, at: a.updated || a.since || 0, observed: false });
  }
  for (const c of closed) {
    if (!c || !c.id || live.has(c.id)) continue;                                     // a closed chat that was opened again is a live one
    out.push({ id: c.id, kind: 'closed', name: c.name || c.title || c.project || '', title: c.title || '', project: c.project || '', color: c.color, at: c.closedAt || 0, observed: !!c.observed });
  }
  return out.sort(byNewest);
}

// The newest `max` entries of a list that is already newest first (the order is kept); `hidden` is how many were left out, `total` the length of the list.
// A `max` that is not a whole number of at least 1 is the default.
export function capEntries(entries, max) {
  const n = Number.isFinite(max) && max >= 1 ? Math.floor(max) : DEFAULT_CAP, all = Array.isArray(entries) ? entries : [];
  return { shown: all.slice(0, n), hidden: Math.max(0, all.length - n), total: all.length };
}

// The sleeping pose for a chat that is idle, the leaning one for a chat that is closed (poses of the worker sprites, ids.js).
export const poseOf = entry => (entry.kind === 'dormant' ? 'sleep' : 'relax');
