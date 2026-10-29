// The floating interface of the three.js Office scene (?scene=3d): the card that opens beside a clicked agent, the shelf card of the asleep and closed chats and the zoom buttons
// under it are the ones of the pixel scene (office-ui.js, pixel/card.js, pixel/shelf-view.js), here tied to the camera of ofis.js. ofis.js builds this once per view and calls into
// it from its pointer, data and frame code; what the scene alone knows comes in as `charOf`, `camera` and `size`.
//   agentBox(id) -> { cx, cy, w, h } the agent on the screen, in CSS px from the top left of the view (`api.agentScreen` of the add-on API, ofis.js), or null
//   covered()    -> { top, right } what floats over the view (the bar, the shelf card), in CSS px: "fit" frames the offices in the rest
//   syncZoom(zoom, min, max) disables the zoom button that cannot go any further
//   blocked()    -> [{ x, y, w, h }] what floats over the scene (the agent card, the shelf card, the zoom buttons) in CSS px of the scene's box: no label is drawn under it
//   figureRects(ids) -> Map id -> rect of the agents on the screen (at least MIN_TARGET wide and high, the click target): the labels give way to them
import * as THREE from 'three';
import { merge, load as loadSettings, fromQuery } from './pixel/settings.js';
import { createOfficeUi, MIN_TARGET } from './office-ui.js';

// ------------------------------------------------------------ the figure of a shelf row
// The pixel scene draws the sleeping or leaning pixel worker from its atlas; here a row gets a round avatar in the colour of its project (the lead's decision for the 3D scene):
// "Zz" on it for an asleep chat, a check mark for a closed one. Drawn on the row's canvas, so the shelf card's code is the same for both scenes.
const FIG_W = 30, FIG_H = 38;

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
function mix(hex, t) {                                   // lighter for t > 0, darker for t < 0
  const to = t > 0 ? 255 : 0;
  return '#' + rgb(hex).map(v => Math.round(v + (to - v) * Math.abs(t)).toString(16).padStart(2, '0')).join('');
}
const hexOf = color => (/^#[0-9a-f]{6}$/i.test(color || '') ? color : '#7d8597');

function drawAvatar(canvas, e) {
  const dpr = Math.min(3, window.devicePixelRatio || 1), asleep = e.kind === 'dormant', col = hexOf(e.color);
  canvas.width = Math.round(FIG_W * dpr); canvas.height = Math.round(FIG_H * dpr);
  canvas.style.width = FIG_W + 'px'; canvas.style.height = FIG_H + 'px';
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, FIG_W, FIG_H);
  g.fillStyle = 'rgba(0, 0, 0, .26)';                   // the shadow on the floor
  g.beginPath(); g.ellipse(15, 35.5, 10, 2, 0, 0, Math.PI * 2); g.fill();
  const disc = g.createRadialGradient(11, 12, 2, 15, 18, 15);
  disc.addColorStop(0, mix(col, 0.28)); disc.addColorStop(1, mix(col, -0.28));
  g.fillStyle = disc;
  g.beginPath(); g.arc(15, 18, 13, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255, 255, 255, .38)'; g.lineWidth = 1;
  g.beginPath(); g.arc(15, 18, 12.5, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#ffffff'; g.strokeStyle = '#ffffff'; g.lineCap = 'round'; g.lineJoin = 'round';
  if (asleep) {                                          // Zz
    g.font = '800 12px ui-monospace, Menlo, monospace'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillText('Z', 12.5, 24); g.font = '800 8px ui-monospace, Menlo, monospace'; g.fillText('z', 20, 16);
  } else {                                               // check mark
    g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(9.5, 18.5); g.lineTo(13.6, 22.6); g.lineTo(21, 13.6); g.stroke();
  }
}
const shelfFigure = { key: e => `${e.kind}|${e.id}|${e.color}`, draw: drawAvatar };

// ------------------------------------------------------------ the interface
// options: root (the Office view), area (the scene's box in it: pointer and wheel belong to it), ctx, camera (THREE.OrthographicCamera), size() -> [width, height] of the view in
// CSS px, charOf(id) -> the scene's character of that agent ({ root, hip }) or undefined, setSelected(id | null) (the scene marks the chosen agent), onShelfFirst() (the shelf
// card shows up for the first time: frame the offices again), overrides (settings from the URL, default the address of the page)
export function createOfisUi({ root, area, ctx, camera, size, charOf, setSelected, onShelfFirst, overrides = fromQuery(location.search) }) {
  const storage = (() => { try { return window.localStorage; } catch { return null; } })();
  const P = new THREE.Vector3(), hip = new THREE.Vector3(), scale = new THREE.Vector3();

  // The hip of an agent in the world. A person of the model pack keeps its joints as plain objects that are not in the scene (no parent), so its hip is the character's root
  // plus the hip height that the scene keeps in `pivotW`.
  function hipOf(c, out) {
    if (c.hip.parent) return c.hip.getWorldPosition(out);
    c.root.getWorldPosition(out);
    out.y += (typeof c.pivotW === 'number' ? c.pivotW : c.hip.position.y) * c.root.getWorldScale(scale).y;
    return out;
  }
  // the box of an agent on the screen: the box api.pickFigure tests (the hips plus or minus 0.34 across, from half a metre below to 1.1 above), projected
  function agentBox(id) {
    const c = charOf(id);
    if (!c || !c.root.parent || c.root.visible === false) return null;
    const [vw, vh] = size();
    hipOf(c, hip);
    const s = c.root.getWorldScale(scale).y;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const dx of [-1, 1]) for (const dz of [-1, 1]) for (const y of [-0.5, 1.1]) {
      P.set(hip.x + dx * 0.34 * s, hip.y + y * s, hip.z + dz * 0.34 * s).project(camera);
      const sx = (P.x + 1) / 2 * vw, sy = (1 - P.y) / 2 * vh;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  }

  const ui = createOfficeUi({
    root, area, ctx, storage, figureBox: agentBox, setSelected, onShelfFirst, figure: shelfFigure,
    shelfMax: merge(loadSettings(storage), overrides).values.shelf,       // the setting `shelf` and ?shelf=N, as in the pixel scene
  });

  function syncZoom(zoom, min, max) {
    for (const b of root.querySelectorAll('.of-ctl button[data-z]')) {
      const off = (b.dataset.z === 'out' && zoom <= min + 1e-3) || (b.dataset.z === 'in' && zoom >= max - 1e-3);
      if (b.disabled !== off) { b.disabled = off; b.setAttribute('aria-disabled', String(off)); }
    }
  }

  // what floats over the scene, in CSS px of the area; read once per frame by the label layout
  function blocked() {
    const a = area.getBoundingClientRect(), out = [];
    const add = el => {
      if (!el || el.hidden) return;
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) out.push({ x: r.left - a.left, y: r.top - a.top, w: r.width, h: r.height });
    };
    if (ui.card.id && !ui.card.el.classList.contains('away')) add(ui.card.el);
    if (root.dataset.shelf === 'open') add(root.querySelector('.of-shelf'));
    add(root.querySelector('.of-ctl'));
    add(root.querySelector('.of-shelf-tab'));
    return out;
  }
  function figureRects(ids) {
    const out = new Map();
    for (const id of ids) {
      const f = agentBox(id);
      if (!f) continue;
      const w = Math.max(f.w, MIN_TARGET), h = Math.max(f.h, MIN_TARGET);
      out.set(id, { x: f.cx - w / 2, y: f.cy - h / 2, w, h });
    }
    return out;
  }

  // read-only state for verification (from the console: document.querySelector('#view-ofis').__ofisUi)
  root.__ofisUi = {
    get card() { return ui.card.read(); }, shelf: () => ui.shelf.read(), setShelfFolded: on => ui.shelf.setCollapsed(!!on),
    agentBox, blocked, covered: ui.covered, get shelfMax() { return ui.shelf.read().max; },
  };

  return { ...ui, agentBox, syncZoom, blocked, figureRects };
}
