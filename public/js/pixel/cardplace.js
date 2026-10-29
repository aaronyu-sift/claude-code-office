// Where the card goes: next to what it belongs to (an agent in the scene or a row of the shelf), inside the area it may use, never over its anchor.
// Pure geometry, so the rules are tested with numbers. Boxes are { x, y, w, h } in one coordinate system; `bounds` is { x0, y0, x1, y1 }.
//   placeCard({ anchor, card, bounds, gap, margin, prefer }) -> { x, y, side, tail }
// `side` is where the card sits relative to the anchor ('right', 'left', 'below', 'above', or 'dock' when no side has room and the card is pushed
// into the corner of the bounds that is farthest from the anchor); `tail` is { side, at }: the edge of the card that faces the anchor and the
// offset along that edge where the little pointer goes (null for 'dock').

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, hi < lo ? lo : v));
const ORDER = { right: ['right', 'left', 'below', 'above'], left: ['left', 'right', 'below', 'above'], below: ['below', 'above', 'right', 'left'], above: ['above', 'below', 'right', 'left'] };

export function placeCard({ anchor, card, bounds, gap = 14, margin = 8, prefer = 'right', tailPad = 22 }) {
  const lo = { x: bounds.x0 + margin, y: bounds.y0 + margin }, hi = { x: bounds.x1 - margin - card.w, y: bounds.y1 - margin - card.h };
  const cx = anchor.x + anchor.w / 2, cy = anchor.y + anchor.h / 2;
  const at = side => {
    if (side === 'right') return { x: anchor.x + anchor.w + gap, y: clamp(cy - card.h / 2, lo.y, hi.y) };
    if (side === 'left') return { x: anchor.x - gap - card.w, y: clamp(cy - card.h / 2, lo.y, hi.y) };
    if (side === 'below') return { x: clamp(cx - card.w / 2, lo.x, hi.x), y: anchor.y + anchor.h + gap };
    return { x: clamp(cx - card.w / 2, lo.x, hi.x), y: anchor.y - gap - card.h };
  };
  const fits = (side, p) => (side === 'right' || side === 'left' ? p.x >= lo.x && p.x <= hi.x : p.y >= lo.y && p.y <= hi.y);
  for (const side of ORDER[prefer] || ORDER.right) {
    const p = at(side);
    if (!fits(side, p)) continue;
    const horizontal = side === 'right' || side === 'left';
    const tail = { side: horizontal ? (side === 'right' ? 'left' : 'right') : (side === 'below' ? 'top' : 'bottom'), at: horizontal ? clamp(cy - p.y, tailPad, card.h - tailPad) : clamp(cx - p.x, tailPad, card.w - tailPad) };
    return { x: Math.round(p.x), y: Math.round(p.y), side, tail };
  }
  // no side has room (a small window, a big card): the corner of the bounds that is farthest from the anchor
  const x = cx > (bounds.x0 + bounds.x1) / 2 ? lo.x : hi.x, y = cy > (bounds.y0 + bounds.y1) / 2 ? lo.y : hi.y;
  return { x: Math.round(clamp(x, lo.x, hi.x)), y: Math.round(clamp(y, lo.y, hi.y)), side: 'dock', tail: null };
}
