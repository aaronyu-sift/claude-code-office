# Sprite tools (work in progress)

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
