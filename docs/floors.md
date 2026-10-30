# Floors and the depth rule

The ground, the floors and the walls of the 3D office used to blink while the user zoomed or panned. This page says why, what the builders must do so that it cannot come back, and how
`tools/qa/office3d-coplanar-qa.mjs` holds them to it. Reminders item S45, from the report "flooring and some designs would flicker, looking like shader issues".

## Why it blinked

There is no custom shader in the scene: every material is a `MeshLambertMaterial` or a `MeshBasicMaterial`. What blinked was a depth tie. Two faces in one plane (or a few millimetres
apart) get nearly the same depth at a pixel, the depth buffer cannot say which one is in front, and the winner changes with the sub-pixel position of the pixel centre. Every zoom step
and every cursor zoom (which also pans) moves the sample positions by a fraction of a pixel, so the winner changes: the stone ground flickers between light stone and the dark plinth
under it, a floor pattern gets dark speckles, a trim shows the colour of the wall it ends in. A picture taken once shows one winner, so nobody saw it in a screenshot.

What the investigators measured on the real scene before the work (software GL, so the counts are an upper bound for a GPU with a better depth buffer; the gaps that cure it are not):

| What | Before | Cause |
| --- | --- | --- |
| stone slab against the plinth under it | the plinth top was exactly the slab's height (y 0), the rim 2 mm under it: up to 1,685 slab pixels lost to the plinth in one view, up to 30 percent of the interior | `ofis.js` plinth and rim |
| room floor against the dark base box under it | the floor mesh was 4 mm over the box: 16,763 pixel swaps at zoom 6 | `ofis.js` buildShell base box |
| lounge deck, hall rugs, curb, road paint, path joints, signs, board screens, trims, window decals | each 0 to 5 mm over another layer | see the table below |

The same scan on the real scene, written as a check (`3d-coplanar-10`, 10 chats): 15,402 pairs of visible faces within 9.5 mm of one plane, in 49 groups, before; 0 after. The 3-chat
scene (`3d-coplanar-3`, 8 offices vacant) reads 0 too, and so do both with the allow-list empty.

## The rule

> Two visible layers are at least 10 mm apart, or they share no plane.

It is the comment above `class Batch` in `public/js/ofis.js`. In practice: a decal, a rug, a paint stripe, a screen over a bezel stands 12 mm over what it lies on; a trim or a curb
that meets the end of a wall overhangs it by 10 mm or more; a box whose top would be the height of another box's top is raised or lowered by 12 mm. Never `polygonOffset`: a material of
its own is a draw call of its own, and `3d-budget` and `3d-vacant` count them (164 and 69 calls with this work, as without it). The 12 mm are the margin that was tested (a 4 mm gap lost pixels in every test, a 12 mm
gap lost none); on a GPU with a 32-bit float depth buffer less would do, and nobody has to find out how much less.

A layer that is covered by something nearer is not a tie: the plinth under the slab, or the corner post where the end wall of a hall meets the wall of an office, can be coplanar and
nobody sees it. The scan casts rays at the camera to tell the two apart (below), so the builders do not have to move what cannot be seen. Today 71 pairs are covered in this way (the check prints the number) and none is seen.

## What changed

| Where | Before | After |
| --- | --- | --- |
| `ofis.js` plinth box and rim | tops at y 0 and -0.002 (the slab is at 0) | tops at -0.024 and -0.036: 24 mm and 36 mm under the slab, 12 mm under the paths that start inside the plinth at `WALK_Y` (-0.012). The first try, -0.012 and -0.024 as in the investigators' proposal, left two visible ties with those paths (the entrance stub and the walk of `ofis-env.js`: a 3 cm sliver at the slab's edge where the slab plane does not hide them). |
| `ofis.js` buildShell | a dark box under every office floor, top 4 mm under the floor mesh | removed. Its 2 cm ring lay inside the walls; the ambient-occlusion bake (`ofis-polish.js`) reads the batch's geometry only above 0.02 m, and its before and after pictures differ by less than 12 levels except at moved edges. 132 triangles fewer at 11 offices. |
| `ofis.js` hall | rug inlay 4 mm over the rug, door mat 2 mm under the inlay | floor 0.01, rug 0.022, inlay 0.034, mat 0.046 |
| `ofis.js` plaza | the curb's front face was the plaza box's front face | the curb overhangs by 15 mm on its three open sides |
| `ofis.js` hall end cap | top at the same height as the caps of the offices it meets | 10 mm lower |
| `ofis.js` door trims | ended where the low wall ends (one plane) | reach 30 mm past it |
| `ofis.js` vacant signs, hall board, reception monitor | the blank face 1.5 mm, the board's screen 4 mm and the monitor's screen 5 mm in front of the box behind them | 12 to 14 mm |
| `ofis-env.js` curb | ended in the sidewalk's end face, top 5 mm over the sidewalk | overhangs 10 mm, stands 15 mm over |
| `ofis-env.js` road paint, zebra, joints | 3 to 4 mm over the asphalt and the paving | 12 mm |
| `ofis-env.js` paths | the edge strip, the dirt strip and their joint discs 2 to 3 mm apart | edge strip at `PATH_Y`, dirt 12 mm over it, each disc the same height and colour as its strip; the stone at the bridge ends 30 mm over the dirt |
| `ofis-env.js` house | the door step's top was the house plinth's top, the flower box's top the window sill's, the walk ended in the step's face | step 12 mm higher, flower box 12 mm higher, the walk ends 5 cm inside the step |
| `ofis-lounge.js`, `lounge-plan.js` | deck base top 0.0135, planks top 0.016 (`DECK.h`), plaza top 0.012 | base top 0.024, planks top 0.036, lip 0.05 high; the rug, the candle, the books and the coffee machine (all with a height of their own) follow `DECK.h`; `ofis-decor.js` takes a rug's height from its item when it has one |
| `ofis-decor.js` | whiteboard decals 3 to 9 mm, picture mats 7 mm, laptop screens 5 mm over their faces | 11 to 14 mm |

The lounge's people and furniture stand 2 cm higher than before (about one pixel at zoom 90). Nothing else moved by more than 3.6 cm, and that only for the beige rim around the stone, which
is 3 cm wide.

## The check

```
node tools/qa/office3d-coplanar-qa.mjs [--only 10|3] [--list] [--dd <mm>] [--root <copy>] [--mutations [--mutation <words>]] [--verify-mutations]
```

`3d-coplanar-10` and `3d-coplanar-3` build the scene with 10 and with 3 chats (the second is the building as it is used), read every face the camera sees of every static mesh through the
page's read-only getter `o.scene` (public/js/ofis.js; figures, glass, rings and beams are not read), and run `tools/qa/coplanar-scan.mjs`:

- the same facing, an offset along the normal under 9.5 mm (10 mm is the rule; a gap built as 10 mm reads 9.99 to 10.01 in float32),
- an overlap in that plane over 0.01 m2,
- a colour (the largest channel differs by 10 of 255 or more) or a texture that differs,
- and the overlap is seen: rays along the camera's direction from about 200 points over the overlap, cast at every face of the scene; one free point keeps the pair.

`3d-coplanar-scan-10` and `-3` guard the reading itself (an empty scene would pass everything). The scan is pure (`test/coplanar-scan.test.mjs` runs it on made-up scenes: ties found, the
rule's edge at 9 and 10 mm, textures, walls, the cover test). It is geometry only: no GPU, no frame time, the same answer on every machine.

**The allow-list** (`ALLOW` in the QA) is empty. An entry is `{ why, test }` for a pair that cannot be moved and cannot be seen; it is never for a pair nobody has looked at.

**When it fails** the detail names the plane (`+y plane -0.012`), the gap, the overlap, the two colours and the place. To find the builder lines make an instrumented copy and list:

```
node tools/qa/coplanar-trace.mjs /tmp/cco-trace
node tools/qa/office3d-coplanar-qa.mjs --root /tmp/cco-trace --list
```

Every pair then reads `[ofis.js:627<ofis.js:2210<...  <  ofis-env.js:759<...]`: the call sites of the lower and the upper face. `test/coplanar-trace.test.mjs` keeps the copy working.
`--dd 12` lists the layers between 9.5 and 12 mm too, to see what stands close but not tied.

**Mutations** (`--mutations`, 11, every one must fail): the plinth at the slab's height again; the rim 2 mm under the slab; the dark base box under the floors; a second wall of another
colour on every office wall (a new pair on one plane); the deck planks 4 mm over the plaza; the road paint 4 mm over the asphalt; the curb 5 mm over its sidewalk; the door trim ending where
the wall ends; the vacant sign's face 1.5 mm in front of its plate; the laptop screens 6 mm in front of their lids; the hall's rugs 4 mm apart. `--verify-mutations` checks that each line
to break is in the source once (run it after a change to a builder that moves one).

## Aliasing and the zoom flicker

On top of the ties, the canvas is drawn at pixel ratio 1.5 and the browser scales it by 1.33 to the 2x screen with a bilinear filter. The investigators measured that sign text and thin lines
shimmer about twice as much at 1.5 as at 2 (sign boxes error 13 to 19 of 255 at 1.5, 2.5 times less at 2) and that mipmaps are doing their job (without them the floors are 2 to 4 times
worse). The pixel ratio is not changed in this wave (it costs 1.78 times the pixels and waits on the real-GPU numbers of the pacing work); if the flicker survives the ties' removal on the
real GPU and goes at ratio 2, it is this upscale and not depth.

## What is not proven

- Everything above is software GL (SwiftShader, no MSAA, a 24-bit depth buffer). Whether the real GPU swapped the same pairs at the same zooms is not known; the gaps of 10 mm and more are
  safe on any depth buffer, so the fix does not depend on it, but the size of the gain on Metal is open. A look at the real window, zooming from 6 to 14 over a room and the sidewalk, answers it.
- The check proves that no two visible layers are within 9.5 mm. It does not prove that a layer 10 to 12 mm apart is safe on every GPU (the tests used 12 mm; the hall floor, 10 mm over the
  slab, was left as it was and the ground read clean in the pictures).
- Layers that are not planes (a rounded rug model against a floor, a sphere on a table) are not ties and are not read.
