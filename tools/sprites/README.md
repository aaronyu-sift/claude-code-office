# Sprite tools

Models are written as code (voxels) and rendered to pixel art with the renderer of
[VoxPix](https://github.com/andyeswong/voxpix) (MIT). Nothing here is needed to run the app.

```bash
git clone https://github.com/andyeswong/voxpix .tools/voxpix && git -C .tools/voxpix checkout c8e9843   # pinned, git-ignored; VOXPIX_DIR overrides the path
node tools/sprites/build.mjs && node tools/sprites/diorama.mjs        # writes tools/sprites/models/*.json
bun tools/sprites/render.ts out.png 4 -45 30 tools/sprites/models/desk.json   # ppu yaw elevation
OBL=0.75,1 bun tools/sprites/render.ts out.png 4 0 30 tools/sprites/models/diorama.json   # oblique camera
bun tools/sprites/density.ts       # how large agents are for N agents, isometric versus oblique
```

- `lib.mjs`: voxel DSL, colour ramps with hue shift. `models.mjs`: palette and objects. `diorama.mjs`: a test room.
- `props.mjs`: floors, walls, workers and poses. `decor.mjs`: furniture, desk props, plants, trees and the garden. `catalog.mjs`: every sprite (id, category, footprint, facings, tags, light and steam anchors).
- `build-atlas.mjs --proj iso|front [--check] [--only <id-prefix>] [--sheet <png>]` renders the catalog with the camera of the projection (`public/js/pixel/projection.js`), packs one atlas per projection into `public/pixel/` and writes `manifest.json` and `public/js/pixel/footprints.js`. `--check` renders in memory and fails when the committed files differ (determinism). `--sheet` writes a contact sheet to look at the art.
- `content-minimums.mjs` / `content-table.mjs`: the content lists of the plan (section 5) against the manifest, `npm run sprites:table`.
