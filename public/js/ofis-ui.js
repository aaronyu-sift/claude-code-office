// The floating interface of the three.js Office scene (?scene=3d): the card that opens beside a clicked agent, the shelf card of the asleep and closed chats and the zoom buttons
// under it are the ones of the pixel scene (office-ui.js, pixel/card.js, pixel/shelf-view.js), here tied to the camera of ofis.js. ofis.js builds this once per view and calls into
// it from its pointer, data and frame code; what the scene alone knows comes in as `charOf`, `camera` and `size`.
//   agentBox(id) -> { cx, cy, w, h } the agent on the screen, in CSS px from the top left of the view (`api.agentScreen` of the add-on API, ofis.js), or null
//   covered()    -> { top, right } what floats over the view (the bar, the shelf card), in CSS px: "fit" frames the offices in the rest
//   syncZoom(zoom, min, max) disables the zoom button that cannot go any further
//   blocked()    -> [{ x, y, w, h }] what floats over the scene (the agent card, the shelf card, the zoom buttons) in CSS px of the scene's box: no label is drawn under it
//   figureRects(ids) -> Map id -> rect of the agents on the screen (at least MIN_TARGET wide and high, the click target): the labels give way to them
import * as THREE from 'three';
import { hash } from './util.js';
import { merge, load as loadSettings, fromQuery } from './pixel/settings.js';
import { createOfficeUi, MIN_TARGET } from './office-ui.js';

// ------------------------------------------------------------ the figure of a shelf row
// The pixel scene draws the sleeping or leaning pixel worker from its atlas; here a row gets a small flat-shaded person in the style of the scene's own people (a round head
// with hair, a rounded torso in the project's colour): asleep, the head rests to one side with closed eyes and a "z"; closed, the person leans back with the hands behind the head.
const SKINS = ['#f3cfb0', '#e7b590', '#cf9670', '#b07650', '#86573a', '#f7dcc6'];
const HAIRS = ['#2b211c', '#4c3528', '#7d5130', '#c08f4f', '#1c1d24', '#8a8f9c', '#a8432f', '#e0c890'];
const FIG_W = 30, FIG_H = 38;

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
function mix(hex, t) {                                   // lighter for t > 0, darker for t < 0
  const to = t > 0 ? 255 : 0;
  return '#' + rgb(hex).map(v => Math.round(v + (to - v) * Math.abs(t)).toString(16).padStart(2, '0')).join('');
}
const hexOf = color => (/^#[0-9a-f]{6}$/i.test(color || '') ? color : '#7d8597');

function drawPerson(canvas, e) {
  const dpr = Math.min(3, window.devicePixelRatio || 1), asleep = e.kind === 'dormant', h = hash(e.id);
  const skin = SKINS[h % SKINS.length], hair = HAIRS[(h >>> 4) % HAIRS.length], shirt = hexOf(e.color);
  canvas.width = Math.round(FIG_W * dpr); canvas.height = Math.round(FIG_H * dpr);
  canvas.style.width = FIG_W + 'px'; canvas.style.height = FIG_H + 'px';
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, FIG_W, FIG_H);
  g.fillStyle = 'rgba(0, 0, 0, .28)';                   // the shadow on the floor
  g.beginPath(); g.ellipse(15, 36, 11, 2.2, 0, 0, Math.PI * 2); g.fill();
  const body = g.createLinearGradient(0, 22, 0, 36);    // torso
  body.addColorStop(0, mix(shirt, 0.18)); body.addColorStop(1, mix(shirt, -0.22));
  g.fillStyle = body;
  g.beginPath(); g.roundRect(7, 22, 16, 14, [6, 6, 3, 3]); g.fill();
  if (!asleep) {                                        // the hands behind the head
    g.fillStyle = mix(shirt, -0.08);
    for (const s of [-1, 1]) { g.beginPath(); g.ellipse(15 + s * 10.5, 17, 2.4, 5.2, s * 0.5, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = skin;
    for (const s of [-1, 1]) { g.beginPath(); g.arc(15 + s * 9, 11.6, 2.1, 0, Math.PI * 2); g.fill(); }
  }
  g.save();                                             // the head, tilted onto the shoulder when asleep
  g.translate(15, 23); g.rotate(asleep ? 0.34 : 0); g.translate(-15, -23);
  g.fillStyle = skin;
  g.beginPath(); g.arc(15, 13, 8.6, 0, Math.PI * 2); g.fill();
  g.fillStyle = hair;
  g.beginPath(); g.arc(15, 13, 9.1, Math.PI * 1.04, Math.PI * 1.96); g.closePath(); g.fill();
  g.strokeStyle = '#23252d'; g.fillStyle = '#23252d'; g.lineWidth = 1.2; g.lineCap = 'round';
  if (asleep) for (const x of [11.6, 18.4]) { g.beginPath(); g.arc(x, 13.4, 1.6, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); }
  else {
    for (const x of [11.6, 18.4]) { g.beginPath(); g.arc(x, 13, 1, 0, Math.PI * 2); g.fill(); }
    g.beginPath(); g.arc(15, 15.6, 2.4, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
  }
  g.restore();
  if (asleep) {
    g.fillStyle = '#9fb4ff'; g.font = '700 9px ui-monospace, Menlo, monospace'; g.textBaseline = 'alphabetic';
    g.fillText('z', 22, 8); g.font = '700 7px ui-monospace, Menlo, monospace'; g.fillText('z', 26.5, 4.6);
  }
}
const shelfFigure = { key: e => `${e.kind}|${e.id}|${e.color}`, draw: drawPerson };

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
