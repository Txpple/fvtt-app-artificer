# Plan: conformed battlemaps from a pre-walled library ("map-builder")

Written 2026-10-05 on the laptop after a day of proofs of concept for the Echoes of Halruaa
campaign (the Hearth caves). Revised 2026-10-07 at home after the owner restated the goal and
set the drift tolerance.

## Goal (owner, 2026-10-07)

> I have a huge library of pre-walled, pre-lit maps in inventory, and props if needed. I tell you
> what I need, you pick out of them and conform them to what I need using Gemini and scripting,
> and I get the map according to what I'm looking for, with the pre-walls still working.

So the product is **a catalogue plus a conforming repaint that carries the walls through**, in
that order. Kitbashing from pieces is the fallback for when nothing in inventory is close enough,
not the main path. Scenes that come out of this are:

1. **Picked from the library** (Tom Cartos, Forgotten Adventures, Mad Cartographer…): real paid
   art, never drawn from scratch.
2. **Conformed**: content swapped where asked (a shrine becomes a forge), painted in one
   campaign style across sources.
3. **Walled and lit** from the pack's own data, fitted to the new painting. **A few percent of
   wall movement is acceptable** (owner, 2026-10-07): correct it, don't refuse it.
4. **Linked** when a series is asked for: exits at known grid slots, teleporter pairs for Foundry.

## What we learned (the evidence the plan rests on)

| Experiment (2026-10-05) | Result | Lesson |
| --- | --- | --- |
| Restyle 12 Tom Cartos caves into Hearth areas, with content changes in the prompt (forge, terraces, seals) | Beautiful. The owner liked these best. But 10 of 12 were refused by the drift check (3–5% movement). | Content changes move walls a little. Rich source art makes rich output. **This is the main path; the refusals were the bug, not the renders.** |
| Procedural sketches (our own floor/void geometry, flat props) repainted | Exits lined up perfectly, floor overlap with the sketch 95–98%. The owner rated them **clearly inferior**: clip-art props, blobby caves, perfect rectangles. | **A repaint is only as rich as its input.** Never draw our own geometry for final art. |
| Kitbash: Chapel Ruins (Clean) + props lifted from Storage Room + painted-in Door slab, Postern, daylit band, then a repaint | Good. Cartos-quality halls, a convincing Door, daylight, braziers. | **The fallback method.** Works, needs fit afterwards (the slab grew two squares). |
| The drift check on sketches and kitbashes | Refused every render, including ones with 96–98% floor overlap. | Edge-strength phase correlation misfires on flat or edited input. Composed maps need a floor-mask score instead. |
| Prop lifting: standard map minus its Clean twin | Works. 30+ props per Cartos map, with alpha. Filling the contours stops pale props getting holes. | Every Cartos map with a Clean variant is also a prop library. |
| Tom Cartos packs | Every scene ships walls, doors and lights. Laptop packs were NeDB `.db`; **the home packs are LevelDB** (v11+ modules). | **Walls come from the source, not from tracing.** Reading them needs the foundryvtt-cli unpack route the dnd5e server already uses. |
| Parallel `edit-image` calls | Four at once all returned Gemini HTTP 500. One timed out. | Renders one at a time; retry a timeout once. |

Other details worth keeping:

- **The model adds and grows things.** Extra braziers and crates; the Door slab grew two squares.
  So walls are fitted **after** painting, not only carried from before. Keep painted-in pieces
  prop-sized; a big flat area invites invention.
- **One render in two invents terrain** (rock over the void, a whole extra cave). Take two
  renders, score both, and pick.
- **Void must stay pure black** for wall fitting. Put "the surrounding void stays pure black" in
  every instruction, and score the void's darkness.
- **A regular pattern in the input comes back as a baked grid.** Never feed grid-aligned regular
  patterns.
- **Tom Cartos "Combined" sheets reveal designed adjacencies.** Exact 3080×2380 splits. The
  cheapest way to get maps that already connect.
- **Colour changes at a seam don't matter** between scenes joined by teleporters. Exit
  **position and width** on the 140 px grid are what matter.
- **Cost:** about $0.15 a render, about $0.30 a map with two renders.
- **House-style conflict:** the illustration-builder battlemap recipe says "confident visible
  brushwork"; the Halruaa `art/SHELF.md` bans it (turns Van Gogh). Use "smooth, refined,
  controlled brushwork"; the campaign shelf wins.
- **Content prompts work in place:** "the curved stone structure is a forge hearth" restyled a
  Cartos shrine into a forge. That is how a library map becomes *your* place.
- **Gemini has no mask and no control image.** It cannot be told "don't move this wall"; it can
  only be measured afterwards. ComfyUI-style ControlNet/inpainting would give hard geometric
  adherence, but the local pipeline died on paint quality and is deleted. If kitbash + fit ever
  fails on adherence at scale, the escape hatch is a **hosted** inpaint endpoint for the masked
  job only, decided on measured evidence. Not planned.

## Inventory at home (2026-10-07)

- **Walled map modules** (LevelDB, `module.json` + `packs/<name>/`), as zips in
  the Downloads folder: Into the Wilds Dungeons 01, 03, 04; Green Hag Lair; Temple of
  Night; Woodland Temple; Axziga's Lair. None installed in Foundry. These are the test maps.
- **The ItW Caves packs** used on the laptop are not on this machine yet; the owner will bring
  them over (2026-10-07). They are the Hearth's source material and the first catalogue target
  once here.
- The owner's asset library holds Props, Tokens and jb2a today, no map modules. It is the
  natural home for the unzipped walled packs (proposed `<assets>\Maps\<module-id>\`)
  and for the catalogue cache beside them, rather than Downloads.
- **Image-only maps**: `Ostenwold Town Map_VTT.zip`, `05. Free Map Images Pack.zip` (Downloads);
  the maps already copied into the Greenrest world's `assets/tom-cartos/` (webp/jpg/png, no walls).
- **Props**: ~70 Tom Cartos asset packs, Forgotten Adventures and Alaythea tiles under
  `<assets>\Props\`.
- **Tooling**: system Python 3.13 with OpenCV 5.0, numpy 2.4, Pillow 12.2. Node 22.
- Pack art is licensed: **the catalogue cache lives outside git**, in Workshelf beside the
  packs; only scripts and tests are committed.

## Architecture (respecting artificer's scope)

Artificer never talks to Foundry (CLAUDE.md, binding). The split:

```
catalogue (script, no API cost) ─┐
                                 ├─> [skill] picks the source map (or pieces), writes the   (judgment)
owner's ask ─────────────────────┘   conforming instruction, shows the pick before spending
                                              │  source image + walls/lights sidecar
                                              ▼
            [artificer: edit-image battlemap, walls in → walls out]   painted.webp + walls mapped
                                              ▼
            [artificer: fit]  walls snapped to the paint, movers flagged, glows found,
                              overlay preview → .uvtt + scene.json                   (deterministic)
                                              ▼  files on disk
            [fvtt-mcp skill]  upload-asset → create scene → walls / lights → teleporters → screenshot
```

Compose (kitbash) slots in before the repaint as an optional step that produces a source image
plus a sidecar, so everything downstream is the same.

The bridge already has every placement tool (`create-scene`, `create-walls`, `create-lights`,
`create-region`, teleporter remap, `create-tiles`, `upload-asset(-tree)`, `screenshot-scene`).
**No new bridge tools are needed for v1.**

## Capabilities to build

### A · Catalogue (script, no API cost)

`scripts/map-library.py` scans module folders (and unzips zips into the cache first) and writes
one JSON index per pack:

- **Per scene:** background image, its Clean/Simple/variant siblings, grid size, walls, doors,
  lights (unpacked from the LevelDB pack via a foundryvtt-cli child process, as `read-pack`
  does), and the floor mask (rasterised from the walls, falling back to a void threshold).
- **Edge exits:** gaps in the walls along each map edge, `{edge, from, to}` in squares.
- **Adjacency from Combined sheets.**
- **Props:** prop-pack tiles (alpha already, footprint from `NxN` in the name) plus props lifted
  from standard-minus-Clean, each with source box and footprint. Prop packs indexed on demand.
- **Tags:** Claude reads a contact sheet once and writes short tags ("built halls in a cave",
  "pillared temple, four exits"). Cached in the index.

### B · Walls in, walls out (artificer: `edit-image` `battlemap`)

`edit-image kind: "battlemap"` accepts an optional `sidecar` (walls, doors, lights in Foundry
shape, as the pack ships them). The same padding, scaling and crop-back applied to the image
(`src/battlemap.ts`) is applied to every coordinate, and the sidecar comes back mapped onto the
output grid. Pure geometry, tested on fixtures. Nothing re-derives a wall.

### C · Fit (artificer: deterministic, OpenCV)

- **Walls:** for each carried vertex, snap to the painted floor's edge within 0.3 squares.
  Report every segment whose endpoints moved by more than that as a **mover**; do not refuse.
  Doors stay where authored. Exit slots stay open.
- **Lights:** carried lights kept. Then a glow pass (HSV clusters: warm orange = fire, cyan =
  fungus/water, white = daylight) adds a light where the painting has a glow and the sidecar
  has none. Radius by class: fire 20/40, lamp 5/15, fungus 0/10, daylight 15/30.
- **Scores:** floor-mask IoU between source and painting (void threshold after a 6 px blur),
  void darkness, mover count. These are a **report**, not a gate.
- **Gate:** only gross failure refuses: IoU under about 0.85, or the existing drift check's
  disaster cases (a swapped layout scored 50–90%). The calibrated phase-correlation check stays
  as that gross test for plain restyles; its 3% threshold stops being a refusal.
- **Overlay preview:** walls white, doors orange, movers red, lights as circles, exits as blue
  bands, drawn on the painting. The owner's one-glance check.

### D · Package (artificer)

Per map: `<slug>.webp`, `<slug>.uvtt` (pixels_per_grid, line_of_sight, portals, lights, image
embedded) and `<slug>.scene.json` (Foundry-native walls/lights/regions, which the bridge takes
directly). Per series: `links.json` with every exit pair. Write both; place from the Foundry JSON.

### E · Compose (artificer, fallback path)

Takes a manifest, returns `composite.png` + a sidecar. Ops from `poc_kitbash_door.py`:

| Op | What it does | Walls |
| --- | --- | --- |
| `base` | a library map (its Clean variant to start bare) | its pack walls |
| `keepProps` | the standard map's props back inside a box | — |
| `place` | a prop at grid x,y with rotation and scale, soft drop shadow | none by default |
| `paste` | a region of another map, feathered seam | that map's walls, transformed and clipped |
| `cutExit` | an exit corridor cut to a fixed edge slot | removes walls in the slot |
| `markPiece` | a small marker the model will paint ("stone door slab") | a door wall at its line |
| `fill` | procedural texture (daylit rock, outside ground) | none |

Rules: no grid-regular patterns; painted-in pieces prop-sized; outside strips and exits on grid.

### F · Skill

`map-builder` (own skill, or a chapter of `illustration-builder`): ask → catalogue lookup →
pick shown to the owner → instruction (one style sentence per series, a short content map, the
void sentence) → two renders, sequential → overlay shown → package → hand to the fvtt-mcp skill.
Checkpoints: (a) the pick, (b) painted + overlay, (c) placed.

## Milestones (each ends with something the owner can look at)

1. **Catalogue** of the seven home packs: walls, lights, exits, Combined adjacency, floor masks,
   a contact sheet. No API cost. Tests on a small fixture pack.
2. **Walls in, walls out** in `battlemap`, with a plain restyle of one Dungeons map: the pack's
   walls drawn on the restyled map. First spend.
3. **Fit**: snap, movers, glow pass, scores, overlay. Rerun the kind of content-swap prompt that
   got refused on the laptop; it should come back accepted with a handful of red segments.
4. **Package**: `.uvtt` and `scene.json`; import the `.uvtt` by hand into a test world and walk a
   token through a door.
5. **Place**: the fvtt-mcp skill builds two linked scenes from the catalogue with a teleporter
   pair, in a test world.
6. **Compose**: the Door kitbash reproduced from a manifest; through B, C, D unchanged.
7. **The skill.**

## Run 1 at home (2026-10-07): catalogue + fit on six Hearth maps

Built: `scripts/map_library.py` (A, the catalogue; `scripts/unpack_leveldb.mjs` reads LevelDB
packs through foundryvtt-cli in a child) and `scripts/map_fit.py` (B + C: walls scaled by the
delivery scale, located in the repaint by normalised cross-correlation of edge-strength patches,
snapped, movers flagged, glows found, overlay drawn). Tests: `scripts/test_map_tools.py`.
Catalogue of the three Caves packs: 14 families, 5 Combined sheets, every tile matched.

Findings that change the plan:

- **Pack wall coordinates include Foundry's padding.** Not image pixels. The image sits at
  `ceil(width·padding/grid)·grid` per side (840, 700 on a 22×17 Cartos map). The catalogue
  translates sidecars onto image pixels and records `origin`; placement adds the target scene's
  origin back. Without this every wall is six squares off.
- **The floor-mask edge is not the wall line.** Only 4% of pack vertices sit within 6 px of the
  void boundary: Cartos walls run along the inner rock line, and nearly half the vertices are
  interior (props, pillars). So fit snaps by local structure, not by mask edge: an edge-strength
  patch around each vertex is located in the repaint by cross-correlation; small wall loops (a
  prop) move rigidly; a rim vertex that disagrees with its neighbours takes their median.
  Self-test (source against itself): 0 px everywhere.
- **Content swaps drift 3–11% of tiles and the tool refuses every one** (5 of 6 maps). The
  drafts are kept on disk, and fit handles them: floor IoU 0.97–0.99, median snap 1 px, p90
  1–27 px (under 0.2 squares), 0–15% of walls flagged as movers, almost all on a cave rim the
  paint pushed out a little. These are deliverable with walls.
- **The renders are the best Hearth set yet**: Great Hall (Forgotten Temple), forge (Wall of
  Power), terraces (Fungal Pools), deep tunnels (Twisting Tunnels), the Door (Chapel Ruins;
  the slab, the postern and glowing chalk were painted from words alone), family chambers
  (Storage Room). $1.36 for 6 maps, two renders where the drift gate fired.
- **A painted-in door needs a wall.** The Door render closed the cave mouth with the slab, but
  the carried walls still leave the mouth open. Doors that exist only in the prompt need a
  `markPiece`-style wall from the manifest (stage E) or a hand-placed door after fit.
- **The glow pass over-finds on busy maps.** Bright orange mushrooms read as fire. Found
  lights are a review list, not a result, until the pass checks for a halo around the blob.
- **Super map by script works.** Caves 04's Combined 06 layout, tiles replaced by the Great
  Hall and deep tunnels repaints, a colour ramp over 1.5 squares each side of the seam, and
  the sheet's own 894 walls fitted (median 1 px). The seam is visible only as a slight tonal
  change in the rock. The Combined sheets are the cheap route to the owner's "super map" ask.

## Run 2 at home (2026-10-07, same day): the full Hearth from Clean variants

Ten maps, all re-themed from the packs' Clean variants with the dressing named in the prompt,
walls from the Clean scene and lights from the standard scene: Great Hall, forge, terraces,
deep tunnels, the Door, family chambers, goat ledges (the session-zero grimlock raid through a
seal cracked from below), the Seal (the Catacomb-door gallery, the brood-mother's lair),
burial galleries (the Ledger of Names' sealed galleries), deep pools. Three super maps by
`map_stitch.py --variant clean`: chambers + forge, hall + tunnels, and the four-tile lower
Hearth from Caves 01's sheet (6160×4760, 1485 walls fitted at a median of 1 px). $4.23 for
the pass, 15 renders where the drift gate fired twice.

- **Clean sources fit better.** Floor IoU 0.98–0.996 and movers under 3% on nine of ten,
  against 0.97–0.99 and up to 15% from standard sources. The rock rim barely moves when the
  model has no dressing to re-interpret.
- **The drift gate fires on dressing, not drift.** Nine of fourteen single renders were
  refused; the fit accepted all but three drafts, and those three (a reshaped cave, a lost
  passage, an extended cave) scored IoU 0.86–0.89 with a missing-floor blob over 10 squares.
  That pair of numbers is the gross-failure gate for the battlemap kind.
- **Dressing from words works.** Benches, a fire pit, bookshelves, a forge with anvil and
  grindstone, mushroom beds with kerbs and carts, a goat fold with goats, coracles and drying
  racks, grave rows with name-stones, a Catacomb door on a platform, a cracked seal wall with
  chalk marks: all placed by the model where the prompt said, at Cartos quality, on a bare
  Clean floor. Props from the library were not needed for any of it.
- **Two renders is still the norm.** One draft in two invents something (a brick ring, a
  lost passage, a stray white glow at a map edge).
- **Nits for the pass after this:** gibberish lettering on name-stones and cloths; a stray
  daylight glow on the goat ledges' east wall; the Great Hall's flagstone platform lost its
  two plinths; the Door slab needs its wall.
- **Owner rules from the review (2026-10-07):** no creatures painted into a map (goats, fish:
  tokens instead); painted doors must sit in their openings the way the Hearth Door did, not
  as a flat upright flag; a super map needs a seam-blend pass. The three are in the skill.

### Run 3 (2026-10-07): goat ledges without goats, chambers without a door, seams blended

`scripts/map_seam.py` (cut / paste) is the seam-blend pass, run on all three super maps: a
6-square band per seam through `edit-image` `battlemap`, feathered back over half a square,
then refit. Four seams, five renders ($0.15 each; one seam was redone). Results: the tonal
line and the grain change are gone on every seam; walls refit at a median of 1 px.

- **Name the void in a seam prompt.** The first seam render painted a blue river through the
  black between the tiles ("any water is one body of water" plus a black band equals a
  river). "The black areas are solid void and stay pure black" fixed it.
- **The seam band shape is fine for the API.** A 3080×840 or 840×4760 band pads to 16:9 or
  9:16 and comes back on its own grid at scale 1; a 6160×840 band comes back downsampled
  then upsized, with no visible loss at the seam.
- **A door that is not in the source wanders.** The Storage Room Clean has no door; "the
  wooden door stays a wooden door" made the model invent one somewhere new each time, twice
  as a flat upright face. Prompt doors only where the sidecar has a door wall, or add the door
  by manifest. The chambers were rendered with "no door anywhere" and fit at IoU 0.994.
- **The planked floor in the chambers is Tom Cartos's.** The Clean Storage Room has a wooden
  floor in its west cave; it is not a model slip.

### The seam-blend pass (as built)

The colour ramp is not enough: water meets water as two kinds of water, rock changes grain at
the line. Plan: cut a band about 4 squares wide along each seam out of the stitched map, send
it through `edit-image` `battlemap` with a keep line plus "the two halves are one continuous
painting: the water is one body of water, the rock one rock, the floor one floor", map it
back onto the band (the tool already lands a render on its source grid), feather it into the
sheet over half a square, and re-run fit on the whole sheet. One render per seam, so about
$0.15 a seam. The band must carry a margin on both sides so the model sees what it is
matching.

### Run 4 (2026-10-07): the final set and the atlas

Desktop `TheHearth-final`: five scenes (the Door, Great Hall over deep tunnels, family
chambers over forge, deep pools, the 44x34 lower Hearth), walls and lights per scene, an
atlas (`scripts/map_atlas.py`) with eight proposed connectors as teleporter pairs, the Door
opening to an OUTSIDE node, `links.json`, and a README. Session spend $6.49.

- **The Door slab's wall** is a door segment joining the two wall ends that flank the cave
  mouth (12.3 to 17.0 squares along y = 2.0), added by script to the fitted sidecar.
- **The goat ledges' glow was the pack's "Open" entrance light.** Re-rendered from the
  Closed variant; the glow is gone and the walls are the Closed scene's.
- **Exits from the floor mask are too generous for a graph.** The rock rim reaches the map
  edge and reads as floor. `walkable_exits()` draws the walls as barriers first, which
  helps, but the connectors in the atlas were still chosen by eye from the renders and the
  plot. A trustworthy automatic exit list needs the rock rim classified, not thresholded.

## Decisions

- **Drift tolerance:** a few percent is acceptable; fit corrects, only gross failure refuses
  (owner, 2026-10-07).
- **Main path is restyle-with-content-swaps from the catalogue; kitbash is the fallback**
  (owner, 2026-10-07).
- **No local inference, no ControlNet.** Hosted inpainting is an escape hatch earned by evidence.

## Still open

- **Python for fit and compose?** OpenCV-heavy; `token_cutout.py` is the precedent for a spawned
  script. Means a second language with its own tests. Leaning yes.
- **Sidecar on `edit-image` or a separate tool?** B is a parameter on the existing kind. Fit and
  package could be the same call's post-processing (like cutout chains onto `token`) or a
  `fit-battlemap` tool. Leaning post-processing: one call in, map + walls + overlay out.
- **Prop packs indexed in full or on demand.** Leaning on demand.
- **Walls for image-only maps** (Ostenwold VTT, the free pack). Out of scope until the walled
  library runs out; tracing from paint is unreliable for doors.

## Files

- `poc_kitbash_door.py`: the hand-coded Door kitbash. The spec for the compose ops.
- `poc_sketch_layouts.py`: the procedural sketch generator. **Superseded** (quality); kept for its
  exit-slot and teleporter-region bookkeeping, which is right.
- The 2026-10-05 images are on the laptop's Desktop only (pack-derived, not committed):
  `TheHearth/`, `TheHearth-Maps/`, `TheHearth-POC/`, `TheHearth-Kitbash/`.
