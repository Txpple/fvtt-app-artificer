# Plan: linked battlemaps from map libraries ("map-builder")

Written 2026-10-05 on the laptop, after a day of proofs of concept for the Echoes of Halruaa
campaign (the Hearth caves). Pick this up at home, where the prop packs and the Foundry data are.

## Goal

Ask for "a series of linked maps for X" and get scenes that are:

1. **Built from map libraries** (Tom Cartos, Forgotten Adventures, Mad Cartographer…): real
   paid art, kitbashed, never drawn from scratch.
2. **One art style**: artificer's battlemap repaint stabilises the look across sources.
3. **Linked**: every exit sits at a known grid slot, paired with an exit on the next map,
   and Foundry gets teleporter regions for each pair.
4. **Walled and lit**: UVTT-grade walls, doors and lights, which the LLM places in Foundry.

## What we learned today (the evidence the plan rests on)

| Experiment | Result | Lesson |
| --- | --- | --- |
| Restyle 12 Tom Cartos caves into Hearth areas, with content changes in the prompt (forge, terraces, seals) | Beautiful. The owner liked these best. But 10 of 12 were refused by the drift check (3–5% movement). | Content changes move walls a little. Rich source art makes rich output. |
| Procedural sketches (our own floor/void geometry, flat props) repainted | Exits lined up perfectly, and floor overlap with the sketch was 95–98%. But the owner rated them **clearly inferior** to the remade Cartos maps: clip-art props, blobby caves, perfect rectangles. | **A repaint is only as rich as its input.** Never draw our own geometry for final art. |
| Kitbash: Chapel Ruins (Clean variant) + props lifted from Storage Room + painted-in Door slab, Postern and daylit band, then a repaint | Good. Cartos-quality halls, a convincing Door, daylight, braziers. | **The method to build on.** |
| The drift check on sketches and kitbashes | Refused every render, including ones with 96–98% floor overlap. | Edge-strength phase correlation misfires on flat or edited input. Composed maps need a floor-mask acceptance test. |
| Prop lifting: standard map minus its Clean twin | Works. 30+ props per Cartos map, with alpha. Filling the contours stops pale props getting holes. | Every Cartos map with a Clean variant is also a prop library. |
| Tom Cartos module `.db` | Every scene ships walls, doors and lights (`packs/*.db`, NDJSON, grid 140 px, 3080×2380). | **Walls can be carried from the source, not guessed.** |
| Parallel `edit-image` calls | Four at once all returned Gemini HTTP 500. One call timed out. | Run renders one at a time, and retry a timeout once. |

Other details worth keeping:

- **The model adds and grows things.** It added extra braziers and crates, and the Door slab
  grew two squares into the hall. So walls must be fitted **after** painting, not only carried
  from before. Keep painted-in pieces prop-sized; a big flat area invites invention.
- **One render in two invents terrain** (rock over the void, a whole extra cave). Always take
  two renders, score both, and pick.
- **Void must stay pure black** for wall tracing; some renders painted textured rock there.
  Put "the surrounding void stays pure black" in every instruction, and score the void's darkness.
- **A regular pattern in the input comes back as a baked grid.** The sketch's flagstone joints
  repainted as a printed grid. Never feed grid-aligned regular patterns.
- **Tom Cartos "Combined" sheets reveal designed adjacencies.** Their tiles are an exact
  3080×2380 split (difference between tiles and sheet averages about 4/255). They are the
  cheapest way to get maps that already connect.
- **Colour changes at a seam don't matter** when maps are separate scenes joined by
  teleporters. What matters is that exit **position and width** match on the 140 px grid.
- **Cost:** about $0.15 a render, so about $0.30 a map, since two renders is the norm.
- **House-style conflict:** the illustration-builder battlemap recipe says "confident visible
  brushwork", but this campaign's `art/SHELF.md` bans that phrase (it turns Van Gogh). Use
  "smooth, refined, controlled brushwork" and let the campaign's shelf win.
- **Content prompts work in place:** "the curved stone structure is a forge hearth" restyled a
  Cartos shrine into a forge. That kind of prompt is how a library map becomes *your* place.

## Architecture (respecting artificer's scope)

Artificer never talks to Foundry (CLAUDE.md, binding). The split stays:

```
library index ─┐
               ├─> [skill: map-builder] plans the area graph, picks sources + props   (judgment)
user's goal ───┘            │
                            ▼  manifest.json
               [artificer: compose]  composite.png + carried walls/lights/exits  (deterministic)
                            ▼
               [artificer: edit-image battlemap, acceptance = floor overlap]  painted.webp
                            ▼
               [artificer: fit]  walls refit to the painting, lights found → .uvtt + scene.json
                            ▼  files on disk
               [fvtt-mcp skill]  upload-asset → create-scene → create-walls / create-lights
                                 → create-region + createSceneTeleporter per exit pair
                                 → screenshot-scene to verify
```

The bridge already has every placement tool: `create-scene`, `create-walls`, `create-lights`,
`create-region`, `add-region-behavior`, `createSceneTeleporter` / `remapSceneTeleporters`,
`create-tiles`, `upload-asset(-tree)`, `screenshot-scene`, and the Tom Cartos importer's
`tc-scene-payloads-*`. **No new bridge tools are needed for v1.**

## Stages

### 0 · Library index (script, no API cost)

`scripts/map-library.py` scans module folders (Foundry `Data/modules/` at home; loose pack
folders like `Desktop/tomcartos-itw-caves-0N/` on the laptop) and writes one index (JSON) per pack:

- **Per scene:** background image, its Clean/Simple/variant siblings, grid size, walls, doors,
  lights (from the pack `.db`), and the floor mask (rasterised from the walls, falling back to
  a void threshold).
- **Edge exits:** the gaps in the walls along each map edge, as `{edge, from, to}` in squares.
  This is what makes "pick a map whose north exit fits" a lookup.
- **Adjacency from Combined sheets:** which tiles sit next to which, and on which edges.
- **Props:** prop-pack tiles (alpha already, footprint from the `NxN` in the name) plus props
  lifted from standard-minus-Clean (filled contours, area > 1500 px), each with its source box
  and footprint.
- **Tags:** Claude reads contact sheets of thumbnails once and writes short tags ("built
  halls in a cave", "underground river with docks", "pillared temple"). Cache them in the
  index so it is never re-read.

Where it lives: a rebuildable cache beside the output dir (pack art is licensed: **never commit
it**). Only the script and its tests go in git.

### 1 · Plan (skill: judgment)

The skill turns the goal into an **area graph**: nodes are areas (with what each must hold:
"a 20-ft door to daylight", "a pool", "a seal cracked from below"), and edges are links with
direction ("Great Hall east to goat ledges west").

- Prefer a **Combined sheet** when a group of areas fits one. Its joins are designed.
- Otherwise pick per node by tags and exit compatibility from the index.
- Fix every exit to a **grid slot** (edge and squares). Link pairs share position and width,
  so teleporter regions are mirror images.
- Show the owner a **contact sheet of the chosen sources plus a node graph** before spending
  anything.

### 2 · Compose (artificer: deterministic)

New tool (or a `kind: "compose"`; that's a decision, see Open decisions) that takes a manifest
and returns `composite.png` + `composite.kit.json`. The manifest operations come straight from
`poc_kitbash_door.py`:

| Op | What it does | Walls |
| --- | --- | --- |
| `base` | a library map (pick its Clean variant to start bare) | its pack walls |
| `keepProps` | put the standard map's props back inside a box | — |
| `place` | a prop (lifted or tile) at grid x,y with rotation and scale, plus a soft drop shadow | — (props get no walls by default) |
| `paste` | a region of another map, with a feathered seam mask | that map's walls, transformed and clipped |
| `cutExit` | an exit corridor piece cut to a fixed edge slot | removes walls in the slot |
| `markPiece` | a small marker the model will paint ("stone door slab", "side door") | a door wall at its line |
| `fill` | procedural texture (daylit rock, outside ground) | none |

Rules learned today: no grid-regular patterns; keep painted-in pieces prop-sized; put the
outside strip and its edge exits on the grid.

### 3 · Restyle (artificer: existing `edit-image` `battlemap`)

- Same instruction across a series (that sentence is what makes sources one family), plus a
  short content map ("the stone block is an anvil", "the pale band is daylit mountainside"),
  plus "the surrounding void stays pure black".
- **New acceptance mode for composed input:** rasterise the composite's floor and compare with
  the painted floor (void threshold after a 6 px blur). Accept at **IoU ≥ 0.95** with no single
  blob of extra or missing floor bigger than about 1 square. Keep the phase-correlation drift
  check for plain restyles of bought maps, where it works.
- Two renders, sequential, scored by IoU and void darkness; Claude looks at both and picks.

### 4 · Fit (artificer: deterministic, OpenCV)

- **Walls:** start from the carried walls. Snap each vertex to the painted floor's contour
  within 0.3 squares. Where the painting really moved a wall (IoU holes), re-trace that stretch
  with `findContours` + `approxPolyDP` (epsilon ≈ 0.15 squares). Doors come from the manifest
  (`markPiece`) and the source `.db`. Exit slots stay open.
- **Lights:** start from the source `.db` and the manifest's lights. Then find glows in the
  painting (HSV clusters: warm orange = fire/brazier, cyan = fungus/water, white = daylight)
  and add one where none exists, coloured from the pixels. Radius by class: fire 20/40, lamp
  5/15, fungus 0/10, daylight 15/30.
- **Overlay preview**, the check image for the owner: walls white, doors orange, lights as
  circles, exits as blue bands. This is the "visual of the final product".

### 5 · Package (artificer)

Per map: `<slug>.webp`, `<slug>.uvtt` (the Universal VTT format: `resolution.pixels_per_grid`,
`line_of_sight`, `portals`, `lights`, image embedded), and `<slug>.scene.json` (Foundry-native
walls/lights/regions, which the bridge takes directly). Per series: `links.json` with every
exit pair.

### 6 · Place (fvtt-mcp skill, not artificer)

`upload-asset`, then `create-scene` (grid 140, the campaign's scene folder, autoexplore flag
from `conventions/map-packs.md`), then `create-walls` and `create-lights`, then
`createSceneTeleporter` for each pair in `links.json`, then `screenshot-scene` and read it.

## Milestones (each ends with something the owner can look at)

1. **Library index:** the three Tom Cartos cave packs indexed (walls, exits, Combined
   adjacency, lifted props, tags), plus a contact sheet. No API cost. Tests on a small fixture.
2. **Compose:** today's Door kitbash reproduced from a manifest, not hand code, with carried
   walls drawn on the composite.
3. **Acceptance:** the IoU mode in `battlemap` with tests. Re-run the Door: it should be
   **accepted** first try, not refused, and cost $0.15 more often.
4. **Fit + package:** walls and lights fitted to the painted Door; overlay preview; `.uvtt` and
   `scene.json` written. Check: import the `.uvtt` by hand into a test world and walk a token.
5. **Place + link:** the fvtt-mcp skill builds three linked scenes (Great Hall from Forgotten
   Temple, goat ledges from Bears Den, the Door kitbash) with teleporters, in a test world.
6. **The skill:** `map-builder` (its own skill, or a chapter of `illustration-builder`) from
   goal to placed scenes, with owner checkpoints: (a) sources + graph, (b) painted + overlay,
   (c) placed.

## Open decisions for the owner

- **New tool or a kind?** CLAUDE.md says resist tool sprawl and add work as a `kind`. Compose
  takes a manifest, not a prompt, so a `compose-battlemap` tool may be honest. Alternatively
  `edit-image kind: "battlemap"` could accept `sourceManifest` in place of `sourceImage`.
- **Python for compose/fit?** It is OpenCV-heavy. There's precedent: `token_cutout.py` is spawned
  the same way. Dependencies: `opencv-python-headless`, `numpy`, `pillow` (installed on the
  laptop 2026-10-05: OpenCV 5.0.0, numpy 2.5.3, Pillow 12.3.0).
- **Where the index cache lives**, and whether prop packs get indexed in full or on demand.
- **UVTT or Foundry-native as the primary sidecar.** Recommendation: write both; place from
  the Foundry JSON.

## Files

- `poc_kitbash_door.py`: today's hand-coded Door kitbash (Chapel Ruins Clean + lifted props +
  painted-in slab, Postern and daylight). It's the spec for the compose ops.
- `poc_sketch_layouts.py`: the procedural sketch generator. **Superseded** (quality); kept for
  its exit-slot and teleporter-region bookkeeping, which is right.
- The images are on the laptop's Desktop only (they're pack-derived, so not committed):
  `TheHearth/` (12 restyled Cartos caves), `TheHearth-Maps/`, `TheHearth-POC/`,
  `TheHearth-Kitbash/` (the Door: before painting, the source with both renders, and the pick).
