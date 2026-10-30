// The parts of the 3D office's model path that need neither three.js nor a browser, so `npm test` can check them: which files a look loads,
// what to do with one that did not load, the palette map (how a pack's colours are pulled toward the scene's own), the table of people
// (which part of an outfit takes the agent's colour) and how the old joint rotations of the procedural figure drive a pack
// character's bones. ofis-assets.js turns these into three.js objects.

export const MODEL_DIR = 'models/';
const F = MODEL_DIR + 'kenney-furniture/', N = MODEL_DIR + 'kenney-nature/', M = MODEL_DIR + 'kenney-mini/';

// the pieces of furniture and nature the scene uses (Kenney Furniture Kit and Nature Kit, CC0), by the key the scene code asks for
export const DECOR_FILES = [
  'lampRoundFloor', 'lampRoundTable', 'lampSquareFloor', 'lampSquareTable', 'loungeSofa', 'loungeSofaLong', 'loungeChair', 'loungeChairRelax', 'loungeDesignSofa', 'stoolBar',
  'benchCushion', 'tableCoffee', 'tableCoffeeGlass', 'tableRound', 'table', 'sideTable', 'sideTableDrawers', 'bookcaseOpenLow', 'coatRackStanding', 'kitchenCoffeeMachine',
  'kitchenFridgeSmall', 'kitchenCabinet', 'speaker', 'laptop', 'pottedPlant', 'plantSmall2', 'plantSmall3', 'books', 'pillow', 'rugRound', 'rugRectangle',
  'rugRounded', 'rugSquare',
];
export const DECOR_PLANTS = ['pottedPlant', 'plantSmall2', 'plantSmall3'];
export const PROPS = {
  desk: F + 'desk.glb', screen: F + 'computerScreen.glb', keyboard: F + 'computerKeyboard.glb',
  mouse: F + 'computerMouse.glb', shelf: F + 'bookcaseClosedWide.glb', plant: F + 'plantSmall1.glb',
  // the room styles (ofis-styles.js, ofis-decor.js): lamps, seats, tables, rugs, kitchen, a screen and more plants from the same Furniture Kit
  ...Object.fromEntries(DECOR_FILES.map(k => [k, F + k + '.glb'])),
  treeA: N + 'tree_default.glb', treeA2: N + 'tree_oak.glb', treeB: N + 'tree_pineRoundA.glb', treeB2: N + 'tree_pineRoundB.glb',
  bushA: N + 'tree_fat.glb', bushA2: N + 'plant_bushDetailed.glb',
  rock1: N + 'stone_largeA.glb', rock2: N + 'stone_largeB.glb', rock3: N + 'stone_largeC.glb', rock4: N + 'stone_largeD.glb',
};

// The people (Kenney Mini Characters, CC0). `tint` lists the cells of the pack's 8 x 4 colour atlas that make up the outfit's top
// (torso and sleeves); those take the agent's colour. Read off pictures of each outfit with one cell lit at a time: the cell is the
// garment, skin, hair and hands are other cells. The pack's first outfit (female-a) carries a staff and is not shipped.
export const OUTFITS = [
  { key: 'p0', file: 'character-female-b', tint: [[2, 2]] },
  { key: 'p1', file: 'character-female-c', tint: [[5, 2]] },
  { key: 'p2', file: 'character-female-d', tint: [[1, 3]] },
  { key: 'p3', file: 'character-female-e', tint: [[4, 3]] },
  { key: 'p4', file: 'character-female-f', tint: [[0, 3]] },
  { key: 'p5', file: 'character-male-a', tint: [[1, 2]] },
  { key: 'p6', file: 'character-male-b', tint: [[4, 2]] },
  { key: 'p7', file: 'character-male-c', tint: [[5, 2]] },
  { key: 'p8', file: 'character-male-d', tint: [[0, 3]] },
  { key: 'p9', file: 'character-male-e', tint: [[4, 3]] },
  { key: 'p10', file: 'character-male-f', tint: [[1, 2]] },
];
export const ATLAS = { cols: 8, rows: 4 };

// every file a pack look loads, by key
export const MANIFEST = { ...PROPS, ...Object.fromEntries(OUTFITS.map(o => [o.key, M + o.file + '.glb'])) };
export const isPerson = key => OUTFITS.some(o => o.key === key);
// Kenney's furniture and nature kits write sRGB numbers where glTF expects linear ones; the baker reads them back as sRGB
export const rawSRGB = url => /kenney-(furniture|nature)/.test(url);

// ?assets=procedural keeps every piece procedural (what a failed file falls back to, too); ?polish=off turns the procedural polish off
// (occlusion, noise floor, tone mapping, contact shadows); both together are the scene as it was before the packs.
export function parseLook(search) {
  const q = new URLSearchParams(search || '');
  return { assets: q.get('assets') === 'procedural' ? 'procedural' : 'packs', polish: q.get('polish') !== 'off' };
}
export const manifestFor = look => (look.assets === 'packs' ? MANIFEST : {});

// ------------------------------------------------------------ what a loaded file must contain

export const BONES = { root: 'root', torso: 'torso', head: 'head', armL: 'arm-left', armR: 'arm-right', legL: 'leg-left', legR: 'leg-right' };
// facts: { meshes: static meshes with positions and normals, skinned: skinned meshes, bones: [names] } -> null when usable, else the reason
export function judge(key, facts) {
  if (!facts) return 'nothing came out of the file';
  if (isPerson(key)) {
    if (!facts.skinned) return 'no skinned mesh';
    const miss = Object.values(BONES).filter(b => !facts.bones.includes(b));
    return miss.length ? 'missing bones: ' + miss.join(', ') : null;
  }
  return facts.meshes > 0 ? null : 'no mesh';
}

// One console warning per piece, however often the scene would have used it
export function createWarner(log) {
  const seen = new Set();
  return (key, text) => { if (seen.has(key)) return false; seen.add(key); log(text); return true; };
}
export const warnText = (key, url, why) => `[office-3d] model "${key}" (${url}) not used: ${why}; the built-in shape takes its place`;

// The outfit for a person: by the agent's hash among the outfits that loaded, null when none did (the procedural figure then stands in)
export function chooseOutfit(h, loadedKeys) {
  const keys = OUTFITS.map(o => o.key).filter(k => loadedKeys.includes(k));
  return keys.length ? keys[h % keys.length] : null;
}

// ------------------------------------------------------------ palette map (colours are linear sRGB numbers 0..1)

const toLinear = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export function hexToLinear(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.replace(/./g, '$&$&');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error('not a colour: ' + hex);
  return [0, 2, 4].map(i => toLinear(parseInt(h.slice(i, i + 2), 16) / 255));
}
export function rgbToHsl(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l <= 0.5 ? d / (mx + mn) : d / (2 - mx - mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
export function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
const clamp01 = v => Math.max(0, Math.min(1, v));
// spec: { byName: { materialName: '#hex' } replaces a material's colour; sat and light multiply, lift adds lightness, hue shifts (0..1) }
// -> (materialName, [r, g, b]) => [r, g, b]; the files stay untouched
export function makePalette(spec = {}) {
  const { byName = {}, sat = 1, light = 1, lift = 0, hue = 0 } = spec;
  const fixed = Object.fromEntries(Object.entries(byName).map(([k, v]) => [k, hexToLinear(v)]));
  const plain = sat === 1 && light === 1 && lift === 0 && hue === 0;
  const fn = (name, rgb) => {
    if (fixed[name]) return fixed[name].slice();
    if (plain) return rgb.slice();
    const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
    return hslToRgb(h + hue, clamp01(s * sat), clamp01(l * light + lift));
  };
  fn.id = JSON.stringify(spec);
  return fn;
}

// the scene's own colours for each pack model (material names are the pack's: see the GLB files)
export const PALETTES = {
  furniture: { byName: { wood: '#c8935c', metal: '#8b929f', metalMedium: '#4a505d', metalDark: '#2a2f3a' } },   // (the office chair's cushion was the only 'carpet' here: the seats are the style's now)
  potDesk: { byName: { wood: '#e9e4da', plant: '#58ab58' } },
  potFloor: { byName: { wood: '#c8704a', plant: '#5fb25b' } },
  tree: { byName: { leafsGreen: '#5daa55', leafsDark: '#3f8c58', woodBark: '#8a5d3b', woodBarkDark: '#7a5236', grass: '#5aa653', _defaultMat: '#7a5236' } },
  rock: { byName: { stone: '#a7a29b', _defaultMat: '#a7a29b' } },
  // the room styles' furniture: the default colours; every style gives the same names its own colours (ofis-styles.js paletteSpec)
  decor: { byName: {
    wood: '#c8935c', woodDark: '#9c6d42', metal: '#8b929f', metalLight: '#b9bfca', metalMedium: '#4a505d', metalDark: '#2a2f3a', carpet: '#505869', carpetDarker: '#3c4352',
    carpetBlue: '#505869', carpetWhite: '#efe9dc', lamp: '#f5dfae', glass: '#bfe0ec', plant: '#5f9a5a', _defaultMat: '#9c6d42',
  } },
  pottedFloor: { byName: { wood: '#c8704a', woodDark: '#8a5a3a', plant: '#5fb25b' } },
};
// which palette goes with which model, so a test can check the material names
export const PALETTE_OF = {
  desk: 'furniture', screen: 'furniture', keyboard: 'furniture', mouse: 'furniture', shelf: 'furniture', plant: ['potDesk', 'potFloor'],
  treeA: 'tree', treeA2: 'tree', treeB: 'tree', treeB2: 'tree', bushA: 'tree', bushA2: 'tree', rock1: 'rock', rock2: 'rock', rock3: 'rock', rock4: 'rock',
  ...Object.fromEntries(DECOR_FILES.map(k => [k, k === 'pottedPlant' ? 'pottedFloor' : k === 'plantSmall2' || k === 'plantSmall3' ? ['potDesk', 'potFloor'] : 'decor'])),
};

// The seasons of the 3D scene are palette swaps (the pixel scene bakes its seasons into the sprites; this scene recolours): the trees (the same material names as
// PALETTES.tree: `leafsGreen` is the round trees and the bushes, `leafsDark` the pines, which keep their needles) and the ground (the two greens of the grass and the wood's
// darker green, the grass lip at the island's edge, the hedges, the green of the hills). Summer is the scene's usual look. A season changes colours only: nothing is added, moved or removed.
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const SEASON_PALETTES = {
  tree: {
    spring: { byName: { leafsGreen: '#f3a7c5', leafsDark: '#4aa86c', woodBark: '#8a5d3b', woodBarkDark: '#7a5236', grass: '#7ccf6a', _defaultMat: '#7a5236' } },
    summer: PALETTES.tree,
    autumn: { byName: { leafsGreen: '#e8892f', leafsDark: '#3b7a52', woodBark: '#7d5436', woodBarkDark: '#6f4a31', grass: '#b9a24a', _defaultMat: '#6f4a31' } },
    winter: { byName: { leafsGreen: '#d3dfe8', leafsDark: '#5f9186', woodBark: '#6f5a4a', woodBarkDark: '#625044', grass: '#b8c9c4', _defaultMat: '#625044' } },
  },
  ground: {
    spring: { grassA: '#a2e07a', grassB: '#c2ee8e', grassWood: '#86cf6b', lip: '#7fc462', leaf: '#5cae52', leaf2: '#72c262', hillA: '#78ba5c', hillB: '#8cc86a' },
    summer: { grassA: '#8cc76c', grassB: '#a6d47d', grassWood: '#70ad59', lip: '#6aa851', leaf: '#4f9a4c', leaf2: '#63b058', hillA: '#72ae59', hillB: '#7fb862' },
    autumn: { grassA: '#b4b45a', grassB: '#cbbf68', grassWood: '#98954a', lip: '#9c9a48', leaf: '#b0883a', leaf2: '#c4803a', hillA: '#a9a255', hillB: '#bcae5c' },
    winter: { grassA: '#e6eef3', grassB: '#f6f9fb', grassWood: '#c8d6dd', lip: '#cdd9df', leaf: '#7d9a8a', leaf2: '#93aa9c', hillA: '#e3ebef', hillB: '#f0f5f7' },
  },
};

// ------------------------------------------------------------ how the old joints drive a pack character's bones

// The pack's rest pose is a T (arms out); the procedural figure's arms hang down and swing from the shoulder. `j` holds the old joint
// angles (radians): armL/armR { x, z }, upper x, head x and z, legL/legR x. Returns Euler angles [x, y, z] for the bones.
export const SLEEVE = 0.16;                  // the sleeve's own slope when the arm hangs
export function poseBones(j) {
  return {
    armL: [j.armL.x, 0, -Math.PI / 2 + j.armL.z + SLEEVE],
    armR: [j.armR.x, 0, Math.PI / 2 + j.armR.z - SLEEVE],
    torso: [j.upper.x, 0, 0],
    head: [j.head.x, 0, j.head.z],
    legL: [j.legL.x, 0, 0],
    legR: [j.legR.x, 0, 0],
  };
}

// ------------------------------------------------------------ how a figure sits, by the kind of seat

// The same rig sits in every kind of seat (ofis-arrange.js: a lounge chair at a table is a 'desk' seat, a sofa, a bench or a lounge chair away from the tables is 'lounge', a bar stool is
// 'stool'). The hip's height is the seat's own (the seat model's top plus the pad of the figure, `hip` of a seat); what differs by kind is how the body sits: `lean` turns the upper body
// (radians, positive forward: a person at a desk leans a little to the screen, on a sofa back into it, on a stool a little forward over the table) and `legs` is the angle of the
// thighs (-1.5 is horizontal, forward; on a high stool the legs hang).
export const SEAT_POSE = {
  desk: { lean: 0.02, legs: -1.5 },
  lounge: { lean: -0.24, legs: -1.42 },
  stool: { lean: 0.07, legs: -0.95 },
};
export const seatPose = kind => SEAT_POSE[kind] || SEAT_POSE.desk;
