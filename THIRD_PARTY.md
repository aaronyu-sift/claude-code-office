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

## three.js (the 3D office, the default Office view)

- Project: [mrdoob/three.js](https://github.com/mrdoob/three.js), version 186.
- Licence: MIT, Copyright © 2010-2026 three.js authors. The licence text is in [public/vendor/three/LICENSE](public/vendor/three/LICENSE).
- Use: the bundled copy in `public/vendor/three/` is loaded by the 3D scene (the default) and not by the pixel office (`?scene=pixel`).
- Add-ons, unmodified copies of the same release (`public/vendor/three/addons/`): `geometries/RoundedBoxGeometry.js`, and for the 3D scene's models `loaders/GLTFLoader.js`, `utils/BufferGeometryUtils.js` (which the loader imports) and `utils/SkeletonUtils.js` (to copy a rigged character).

## 3D models (the 3D office, the default Office view)

The 3D scene draws furniture, trees, rocks and people from three packs by [Kenney](https://kenney.nl), all released into the public domain under [Creative Commons Zero (CC0 1.0)](https://creativecommons.org/publicdomain/zero/1.0/). Crediting Kenney is not required; it is done here anyway. Each pack's own `License.txt` sits next to its files. Only the 60 files the scene uses are shipped, in `public/models/`; nothing is loaded for the pixel office, and `?assets=procedural` loads none for the 3D scene either.

| Pack | Files | Used for |
|---|---|---|
| [Furniture Kit](https://kenney.nl/assets/furniture-kit) 2.0, Kenney, CC0, [`public/models/kenney-furniture/`](public/models/kenney-furniture/) | `desk`, `computerScreen`, `computerKeyboard`, `computerMouse`, `bookcaseClosedWide`, `plantSmall1` | the angled desks, the monitors, keyboards, mice, the bookshelf and the small plants (the office chair `chairDesk` is no longer shipped: nobody sits on one any more, the seats are lounge chairs, sofas, benches and stools) |
| the same Furniture Kit, 33 more files for the room styles | `lampRoundFloor`, `lampRoundTable`, `lampSquareFloor`, `lampSquareTable`, `loungeSofa`, `loungeSofaLong`, `loungeChair`, `loungeChairRelax`, `loungeDesignSofa`, `stoolBar`, `benchCushion`, `tableCoffee`, `tableCoffeeGlass`, `tableRound`, `table`, `sideTable`, `sideTableDrawers`, `bookcaseOpenLow`, `coatRackStanding`, `kitchenCoffeeMachine`, `kitchenFridgeSmall`, `kitchenCabinet`, `speaker`, `laptop`, `pottedPlant`, `plantSmall2`, `plantSmall3`, `books`, `pillow`, `rugRound`, `rugRectangle`, `rugRounded`, `rugSquare` | the lamps, sofas, chairs, tables, rugs, coffee corner and plants of the six room styles (study, lab, garden, library, studio, cafe) |
| [Nature Kit](https://kenney.nl/assets/nature-kit) 2.1, Kenney, CC0, [`public/models/kenney-nature/`](public/models/kenney-nature/) | `tree_default`, `tree_oak`, `tree_pineRoundA`, `tree_pineRoundB`, `tree_fat`, `plant_bushDetailed`, `stone_largeA` to `stone_largeD` | the trees, bushes and rocks of the island around the building |
| [Mini Characters](https://kenney.nl/assets/mini-characters) 1.0, Kenney, CC0, [`public/models/kenney-mini/`](public/models/kenney-mini/) | `character-female-b` to `-f`, `character-male-a` to `-f` (11 of the 12 outfits; `female-a` carries a staff and is left out), and their shared colour atlas `Textures/colormap.png` | the chiefs and subagents at their desks |

Changes made to the files and to how they look, all in this repository's code (the packs' materials, colours and shapes are not edited by hand):

- The scene recolours them at load time with a palette map (`public/js/ofis-rig.js`) and bakes furniture, trees and rocks into vertex colours (`public/js/ofis-assets.js`); a person's outfit takes the agent's colour on its top.
- The furniture and nature files are the pack's own, byte for byte. The eleven character files were made smaller with [`tools/models/strip-glb.mjs`](tools/models/strip-glb.mjs): the 32 animation clips (the scene poses the bones itself), the tangents and the second uv set were removed, from about 250 KB to about 80 KB each. Run on the pack's originals the tool gives the shipped bytes again.
- If a file cannot be loaded, the scene draws its own procedural shape for that piece and says so once in the console.
- The 33 extra Furniture Kit files were downloaded on 2026-10-29 from the pack's page on [kenney.nl](https://kenney.nl/assets/furniture-kit) (`kenney_furniture-kit.zip`, 5,130,729 bytes, sha256 `e67652d0932cee41683f74711c03d3e192a2af9979ef8e6b237711f5482d46b0`), read as data only (nothing in the archive was run), and copied byte for byte from its `Models/GLTF format/` folder; `tools/models/strip-glb.mjs` finds nothing to remove in them (it is a no-op on furniture). The sha256 of every shipped furniture file is in [`public/models/kenney-furniture/SHA256SUMS`](public/models/kenney-furniture/SHA256SUMS); the 6 older files match the same archive byte for byte.

## Upstream

- [azorkai/claude-code-office](https://github.com/azorkai/claude-code-office), MIT, Copyright (c) 2026 azorkai: this repository is a fork; the server, dashboard, timeline, cost tracker and the 3D scene are upstream code.

## Art

The pixel art has no third-party source: every sprite is generated from the voxel models in `tools/sprites/`. The only third-party art in the repository is the 3D models listed above; if more is ever added, its licence is recorded here first.
