# Third-party material

Everything in this repository is MIT licensed (see [LICENSE](LICENSE)). The following third-party software is used or shipped.

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

## Upstream

- [azorkai/claude-code-office](https://github.com/azorkai/claude-code-office), MIT, Copyright (c) 2026 azorkai: this repository is a fork; the server, dashboard, timeline, cost tracker and the 3D scene are upstream code.

## Art

The pixel art has no third-party source: every sprite is generated from the voxel models in `tools/sprites/`. If third-party art is ever added, its licence is recorded here first.
