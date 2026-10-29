# Third-party material

Everything in this repository is MIT licensed (see [LICENSE](LICENSE)), except the 3D models in `public/models/`, which are CC0 (below). The following third-party software and art is used or shipped.

## VoxPix (build time only)

- Project: [andyeswong/voxpix](https://github.com/andyeswong/voxpix), voxel renderer.
- Licence: MIT, Copyright (c) 2026 Andrés Wong (full text below).
- Pinned commit: `c8e984313d5baa71e8d7349fa2811d3dee8e0213` (short form `c8e9843`).
- Use: the pixel-art office view ([public/pixel/](public/pixel/)) is made of sprites that our own voxel models (`tools/sprites/*.mjs`, code) are rendered into with VoxPix's renderer (`src/core`). VoxPix runs only when the art is regenerated (`node tools/sprites/build-atlas.mjs`, needs [bun](https://bun.sh) and a checkout in `.tools/voxpix`, which is git-ignored). The generated atlases (`public/pixel/atlas-iso.png`, `atlas-front.png`) and `manifest.json` are committed, so running the app and `npm test` never need VoxPix, and nothing of VoxPix is shipped or loaded at run time.
- No VoxPix model, palette or art is used: the models, palettes and sprites are original to this repository.

```
MIT License

Copyright (c) 2026 Andrés Wong

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## three.js (the original 3D office, `?scene=3d`)

- Project: [mrdoob/three.js](https://github.com/mrdoob/three.js), version 186.
- Licence: MIT, Copyright © 2010-2026 three.js authors. The licence text is in [public/vendor/three/LICENSE](public/vendor/three/LICENSE).
- Use: the bundled copy in `public/vendor/three/` is loaded only when the 3D scene is opened with `?scene=3d`; the pixel office does not load it.
- Add-ons, unmodified copies of the same release (`public/vendor/three/addons/`): `geometries/RoundedBoxGeometry.js`, and for the 3D scene's models `loaders/GLTFLoader.js`, `utils/BufferGeometryUtils.js` (which the loader imports) and `utils/SkeletonUtils.js` (to copy a rigged character).

## 3D models (the 3D office, `?scene=3d`)

The 3D scene draws furniture, trees, rocks and people from three packs by [Kenney](https://kenney.nl), all released into the public domain under [Creative Commons Zero (CC0 1.0)](https://creativecommons.org/publicdomain/zero/1.0/). Crediting Kenney is not required; it is done here anyway. Each pack's own `License.txt` sits next to its files. Only the 28 files the scene uses are shipped, in `public/models/`; nothing is loaded for the pixel office, and `?assets=procedural` loads none for the 3D scene either.

| Pack | Files | Used for |
|---|---|---|
| [Furniture Kit](https://kenney.nl/assets/furniture-kit) 2.0, Kenney, CC0, [`public/models/kenney-furniture/`](public/models/kenney-furniture/) | `desk`, `chairDesk`, `computerScreen`, `computerKeyboard`, `computerMouse`, `bookcaseClosedWide`, `plantSmall1` | the desks, chairs, monitors, keyboards, mice, the bookshelf and the small plants in every room |
| [Nature Kit](https://kenney.nl/assets/nature-kit) 2.1, Kenney, CC0, [`public/models/kenney-nature/`](public/models/kenney-nature/) | `tree_default`, `tree_oak`, `tree_pineRoundA`, `tree_pineRoundB`, `tree_fat`, `plant_bushDetailed`, `stone_largeA` to `stone_largeD` | the trees, bushes and rocks of the island around the building |
| [Mini Characters](https://kenney.nl/assets/mini-characters) 1.0, Kenney, CC0, [`public/models/kenney-mini/`](public/models/kenney-mini/) | `character-female-b` to `-f`, `character-male-a` to `-f` (11 of the 12 outfits; `female-a` carries a staff and is left out), and their shared colour atlas `Textures/colormap.png` | the chiefs and subagents at their desks |

Changes made to the files and to how they look, all in this repository's code (the packs' materials, colours and shapes are not edited by hand):

- The scene recolours them at load time with a palette map (`public/js/ofis-rig.js`) and bakes furniture, trees and rocks into vertex colours (`public/js/ofis-assets.js`); a person's outfit takes the agent's colour on its top.
- The furniture and nature files are the pack's own, byte for byte. The eleven character files were made smaller with [`tools/models/strip-glb.mjs`](tools/models/strip-glb.mjs): the 32 animation clips (the scene poses the bones itself), the tangents and the second uv set were removed, from about 250 KB to about 80 KB each. Run on the pack's originals the tool gives the shipped bytes again.
- If a file cannot be loaded, the scene draws its own procedural shape for that piece and says so once in the console.

## Upstream

- [azorkai/claude-code-office](https://github.com/azorkai/claude-code-office), MIT, Copyright (c) 2026 azorkai: this repository is a fork; the server, dashboard, timeline, cost tracker and the 3D scene are upstream code.

## Art

The pixel art has no third-party source: every sprite is generated from the voxel models in `tools/sprites/`. The only third-party art in the repository is the 3D models listed above; if more is ever added, its licence is recorded here first.
