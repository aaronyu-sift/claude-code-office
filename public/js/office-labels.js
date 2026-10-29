// What the label of an agent says, one place for both Office scenes (the pixel scene, pixel/index.js, and the three.js scene, ofis.js): which text a main agent and a
// sub-agent show, how it is cut, and which state classes it carries. Pure functions, so the rules are tested with numbers (test/office-labels.test.mjs); where the label
// goes on the screen is the scene's own business (pixel/labels.js for the pixel scene, `placeLabels` of ofis.js for the three.js one).
//   labelParts(agent, { main, overflow, activity }) -> the texts of the label
//   labelHtml(parts, { now, p })                    -> its markup; `p` is the class prefix ('px' in both scenes today: the glass label of the pixel scene)
//
// A main agent's label is the project (swatch + name) with the chip of a chat that waits for you, the chat name, the line of what it does and the line of what it just said.
// A sub-agent's label is its swatch and a short description (its description, else its type). With `activity` a working agent that has no tool call to show gets the text
// it is thinking, and a sub-agent gets the same "what it does" line as a main agent: the pixel scene does not pass it yet (its sub-agent labels stay one line), the
// three.js scene does.
import { t } from './i18n.js';
import { esc, fmtShort } from './util.js';

export const DESC_MAX = 18;      // characters of a sub-agent's description
export const DOING_MAX = 46;     // characters of the line "Tool · what it works on"
export const SAY_MAX = 56;       // characters of the line of what an agent just said

export const clipTxt = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// the description of a sub-agent cut at a word (the whole description if it fits): its description, else its type, else the word for "subagent"
export function shortDesc(s, fallback = t('agent.sub'), max = DESC_MAX) {
  const d = String(s.desc || s.atype || fallback).trim().replace(/\s+/g, ' ');
  if (d.length <= max) return d;
  let out = '';
  for (const w of d.split(' ')) { const nx = out ? out + ' ' + w : w; if (nx.length > max) break; out = nx; }
  return (out || d.slice(0, max - 2) + '…').replace(/[\s:;,.\-–—]+$/, '');
}

// "what it does": the newest tool call while it runs (the server drops it 20 s after it ended); with `activity`, a working agent without one shows what it thinks
function doingText(a, activity) {
  if (a.status !== 'working') return '';
  if (a.doing) return `${a.doing.n} · ${clipTxt(a.doing.l, DOING_MAX)}`;
  if (activity && a.act && a.act.code === 'thinking') {
    const thought = a.thought ? clipTxt(String(a.thought).replace(/\s+/g, ' ').trim(), DOING_MAX) : '';
    return thought ? `${t('act.thinking')} · ${thought}` : t('act.thinking');
  }
  return '';
}

// opts: main (a session's own label, else a sub-agent's), overflow (sub-agents that do not fit the room: "+n"), activity (see the top)
export function labelParts(a, { main = true, overflow = 0, activity = false } = {}) {
  const wait = main && (a.status === 'waiting' || a.status === 'ask') ? a.status : null;
  const doing = main || activity ? doingText(a, activity) : '';
  const say = main && a.say ? { dir: a.say.dir, text: clipTxt(a.say.text, SAY_MAX) } : null;
  return {
    main, status: a.status, color: a.color,
    project: a.project, name: main ? a.name || a.title || a.project : '', desc: main ? '' : shortDesc(a),
    wait, since: a.since, overflow: main ? overflow : 0, doing, say,
  };
}

// the markup of a label, without its box (the scene's element carries the box, the state class and `px-main` / `px-sub`); `now` is the store's clock in ms
export function labelHtml(parts, { now = Date.now(), p = 'px' } = {}) {
  const sw = `<span class="sw" style="background:${esc(parts.color)}"></span>`;
  const doing = parts.doing ? `<span class="${p}-doing">${esc(parts.doing)}</span>` : '';
  if (!parts.main) return `${sw}${esc(parts.desc)}${doing}`;
  const chip = parts.wait
    ? `<span class="of-chip w">${esc(t(parts.wait === 'ask' ? 'of.chipAsk' : 'of.chipWait'))} · <span data-since="${parts.since}" data-fmt="short">${fmtShort(now - parts.since)}</span></span>`
    : '';
  const more = parts.overflow ? `<span class="of-chip">+${parts.overflow}</span>` : '';
  const say = parts.say ? `<span class="${p}-say ${parts.say.dir}">${parts.say.dir === 'in' ? '← ' : '→ '}${esc(parts.say.text)}</span>` : '';
  return `<div class="${p}-top">${sw}<span class="${p}-proj">${esc(parts.project)}</span>${chip}${more}</div>` +
    `<div class="${p}-name">${esc(parts.name)}</div>${doing}${say}`;
}
