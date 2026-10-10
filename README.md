# fvtt-mcp-imagegen

An [MCP](https://modelcontextprotocol.io) server that lets Claude make art for your Foundry VTT
table using Google's Gemini image models (Nano Banana). Four tools, one API key, no GPU.

[Claude Code](https://claude.com/claude-code) drives it. The server is registered as `imagegen`,
and its `illustration-builder` skill grounds every piece in what your world already says and
shows. Claude writes the prompt, the server renders it, Claude looks at the result and fixes what
is wrong, and the finished file lands on disk ready to upload into Foundry.

## What you can make

- **Item, spell, and feature icons.** Twenty icons from one style line come back as one
  matching set. About 7 cents each.
- **Tokens.** Top-down, full-body, cut to transparency, centred on a square so Foundry's scale
  1.0 is right: 512 px, or 1024 px for Large and bigger creatures. Humanoids face up at the
  camera; beasts are seen along the back. No shadow, and nothing ever clips off the edge: a
  render with a sword or wing cut by the frame is redone, and refused if it clips twice. Hand it
  one of your existing tokens as a style reference and new ones match the angle and look. About
  7 cents each.
- **Token refreshes.** Point it at an old, low-res token and it repaints it at higher quality
  while keeping the pose, silhouette, design, and colours your players know. It can also turn
  one creature into another in the same pose (a rat's token into a squirrel).
- **Token redresses.** Start from a token you already have as the prototype and change who it
  is: "make this a Sharran cleric, black armour, a morningstar instead of the club". The pose,
  camera angle, and cut stay; the costume, gear, and figure change to match the actor it is now
  for. One stock token becomes the specific NPC in your world without a word of prompt about
  framing.
- **Token restyles.** The same trick as battlemaps, for a whole bestiary. Tokens gathered from
  different packs (Immortal Nights, Forgotten Adventures, a few you drew yourself) do not match
  on one map. Hand it one token as the style reference and run the rest through, and they come
  back in one consistent look, each still recognisably the creature it was.
- **Props.** Map dressing placed as tiles: furniture, barrels, trees, anvils. Seen straight
  down, object only, cut to transparency at the tile size (300 px per grid cell, from a
  `footprint` like `"2x1"`). Refreshing an existing prop returns it at the file's exact pixel
  size in the same spot on its canvas, so it replaces the old one one for one.
- **Battlemap restyles.** Repaint a map you bought (Tom Cartos, Mad Cartographer, anything) in
  one consistent painted style, with every wall, door, and object exactly where it was, so the
  walls and lights already traced over it in Foundry still fit. The result lands on the
  source's own pixel grid. An old low-res map comes back at a whole-number upscale (a
  1125×1500 map at 3375×4500). Every render is checked against the original, and one whose
  layout moved is redone once, then refused. Maps ship as WebP, about 4 MB where a PNG would
  be 40 to 70. About 15 cents a map.
- **Overland maps.** A regional or world map from a sourcebook or a sketch, repainted in the
  house style with the geography locked and every label, marker, road, compass rose, and scale
  bar painted out. Names go back on afterwards by script, spelled right and movable, instead of
  being left to the model. A busy map takes two or three passes to come clean; each is about 15
  cents.
- **Portraits.** Actor sheet art at 3:4. Hand it a previous portrait or two as style
  references and the new one matches your table's look.
- **Illustrations.** Player handouts and scene splashes at 2560×1600. Hand it your party's
  portraits as character references and they keep their faces in group scenes.
- **Illustrated session records.** With
  [`fvtt-mcp-sessionscribe`](https://github.com/Txpple/fvtt-mcp-sessionscribe) alongside, the
  recap and GM notes it writes after a session come back illustrated: Claude picks the moments
  from the record, checks where each one happened against the transcript, attaches the
  portraits and tokens of everyone in the scene so the same faces recur from one week to the
  next, and drops the finished plates into the journal and the recap. The worked example is the
  concluded [Greenrest campaign](https://github.com/Txpple/fvtt-campaign-greenrest): every
  recap carries eight or nine plates, and the same shelf of references went on to illustrate
  the campaign's book.
- **Edits.** Change one thing about an existing image and keep the rest: swap a weapon, recolor
  a cloak, add a scar, fix an extra limb.
- **Cutouts.** Knock the background off any token image you already have.

## The tools

| tool | what it does |
| --- | --- |
| `generate-image` | Render one asset from a prompt. `kind` is `icon`, `token`, `prop`, `portrait`, or `illustration`; it picks the model, aspect, size, framing, and post-processing for you. Optional `references` (character, style, or pose) and, for tokens, `creatureSize` (`medium` or `large`); for props, `footprint` (`"2x1"`). |
| `edit-image` | Apply one instruction to an existing image and keep everything else. Token edits are prompted the way you would type in the Gemini app and re-cut automatically. Takes `creatureSize` too. `kind: "battlemap"` restyles a bought map with its layout locked (edit only; `generate-image` refuses it, since a map painted from words has no walls). `kind: "overland"` does the same for a regional map and paints the lettering out. |
| `cutout-image` | Cut a token's background to alpha and deliver it on a square canvas. |
| `imagegen-status` | Setup doctor: key present and accepted, models reachable, output folder writable and outside git, cutout Python ready; estimated spend this session. |

Every call returns the file path, the pixel size, and an estimated cost.

## Models and cost

Everything runs on **Nano Banana 2.1** (`gemini-nano-banana-2.1`) by default: roughly 3 cents for
an icon or token, 5 cents for a portrait, 11 cents for an illustration.

**Nano Banana Pro** (Gemini 3 Pro Image) is available for about double at 4K and four times at 1K. It is stronger on
crowded multi-figure scenes and images with legible text. Claude will not use it unless you
say so: a Pro call refuses without an explicit confirm and tells you the price first.

Prices are Google's published per-image rates and may change. The server keeps a running
estimate; your actual bill is in the Google Cloud console.

## Requirements

- Node.js 22 or newer.
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) with billing
  enabled: the image models have no free tier. Prepaid credit with auto-reload off is a sensible
  ceiling.
- Python 3 with Pillow and numpy for the token cutout:
  `<python> -m pip install -r requirements.txt`. `rembg` is optional and adds an AI matte
  fallback for busy backgrounds (`pip install "rembg[cpu]"`; first use downloads a ~176 MB
  model). On Windows, bare `python` may be the Microsoft Store placeholder; set
  `IMAGEGEN_PYTHON` in `.env` to the full path of a real `python.exe`.

## Install

```bash
git clone https://github.com/Txpple/fvtt-mcp-imagegen.git
cd fvtt-mcp-imagegen
npm install
npm run build
cp .env.example .env
```

Put your key in `.env`:

```
GEMINI_API_KEY=your-key
IMAGEGEN_OUTPUT_DIR=C:\path\where\renders\should\land
```

The output folder is created on the first render and must sit outside any git repo. Set
`IMAGEGEN_PYTHON` too if bare `python` is not the interpreter you installed the requirements into.

Check the setup from the terminal before registering anything:

```bash
npm run doctor
```

It loads `.env` the way the server does and runs the same checks as `imagegen-status` below,
one line each (`✓` fine, `!` works but worth a look, `✗` broken) with the fix, and exits non-zero
until nothing is broken. The key check is a free model listing; it never renders, so it spends
no credit. Rerun it after each fix.

Register the server with Claude Code (user scope, so it is available in every project), then
restart Claude Code:

```bash
claude mcp add -s user imagegen -- "C:/Program Files/nodejs/node.exe" /absolute/path/to/fvtt-mcp-imagegen/dist/index.js
```

Give `node` as a full path (`which node` on macOS or Linux): Claude Code launched from the
desktop app may not see it on PATH. A desktop-app install may not put the `claude` CLI on PATH
either; then add the same entry by hand under `mcpServers` in `~/.claude.json` (user scope) and
restart:

```json
"mcpServers": {
  "imagegen": {
    "command": "C:/Program Files/nodejs/node.exe",
    "args": ["/absolute/path/to/fvtt-mcp-imagegen/dist/index.js"]
  }
}
```

[`.mcp.json.example`](.mcp.json.example) has the same entry for a project-scoped `.mcp.json`.

Then ask Claude to run `imagegen-status`. It is the setup doctor: one line each for the key
(present, and accepted by Google, checked with a free model listing), the output folder
(writable, outside any git repo), and the cutout Python (Pillow, numpy, rembg), each with the
fix when something is wrong (the same checks `npm run doctor` runs, plus this session's
estimated spend). The server also warns at startup when the key is missing.

## Using it

Ask Claude for what you want in table terms:

- "Make icons for these six items."
- "This goblin needs a token; use my existing orc token as the style reference."
- "Illustrate the party arriving at the ruined mill at dusk; here are their portraits."
- "Change this token's cloak to forest green."
- "This old token looks rough; give it an updated painterly pass."
- "Make this bandit token a Sharran cleric: black armour, morningstar, keep the pose."
- "These twelve tokens come from three different packs; restyle them all to match this one."
- "Illustrate last night's recap; the party's portraits are in this folder."
- "Cut the background off this token."

Claude reads every render before showing it to you and fixes obvious flaws (an extra limb, a
duplicated spell effect) with one edit. Files are named `<kind>-<slug>-<id>.png` so they drop
straight into a Foundry asset folder.

## With a Foundry MCP server: art grounded in your world

This server only makes pictures. Pair it with a Foundry MCP server such as
[`fvtt-mcp-dnd5e`](https://github.com/Txpple/fvtt-mcp-dnd5e) and Claude can read your
world before it prompts and put the result back when it is done. Then you can ask for things
like:

- **"Make a new token for the dragon in the Wyrmwood."** Claude pulls the actor's stat block
  and bio, opens the token your world already uses for a similar creature so the angle and line
  style match, renders, cuts to alpha, and can assign it to the actor.
- **"Illustrate the party walking into the dragon's lair for the first time."** Claude
  screenshots the battlemap, finds where the dragon's token is placed, reads the plot notes for
  the room, attaches the party's portraits so the faces hold, and paints the view from the
  doors down the hall to the dais.
- **"Illustrate three cool moments from the last few sessions."** Claude reads the session
  recaps and GM notes, picks the scenes, checks which actors were present and what they were
  carrying that night, and renders each one.
- **"Give this actor a portrait."** Claude reads the bio, looks at the existing token so the
  hair and skin match canon, renders at 3:4, and can set it as the sheet portrait.
- **"Icons for every item in this compendium folder."** One shared style line, one call per
  item, uploaded as a set.

The handoff is files on disk: this server writes them, the Foundry server uploads them
(`upload-asset`, `set-actor-art`, `add-journal-image`). Nothing here talks to Foundry directly,
so either half works on its own.

## With a campaign repo: the same faces every week

Consistency across a campaign comes from a small file, not from luck. A campaign repo keeps an
art shelf (`art/SHELF.md`): one approved portrait per player character with the short phrase
that binds it in a prompt ("a bone-white orc in battered steel plate"), two or three finished
pieces that carry the house look, the finish words that keep portraits matte and the palette
muted, and a note of which older files are superseded and must never be attached again. The
`illustration-builder` skill reads the shelf before every piece, attaches the anchors as
character references and the shelf as style references, and proposes a shelf if the repo has
none yet.

That is how Session Scribe's records stay illustrated by the same people session after session,
how a token redress lands as the actor your world already knows, and how a book assembled at
the end of a campaign reads as one artist's work. Greenrest's shelf, its approved art, and the
chronicle built from them are public in
[`fvtt-campaign-greenrest`](https://github.com/Txpple/fvtt-campaign-greenrest).

## How it works

```
Claude ──MCP──> fvtt-mcp-imagegen ──HTTPS──> Gemini image API
                      │
                      ├── sharp: convert, crop, resize
                      └── token_cutout.py: chroma key or rembg → alpha
```

- The API returns a JPEG; the server converts to PNG and applies the kind's post-processing
  (512 square for icons, 16:9 to 16:10 crop for illustrations, cutout for tokens).
- Tokens are rendered on a flat chroma plate, then keyed out. Magenta is the default because
  soft edges keep a trace of the plate and a magenta trace reads as a dark outline on warm
  subjects (skin, hair, fur, leather) where green reads as an olive fringe; green or blue takes
  over for purple, pink, or violet subjects. A magenta-composited preview is written beside
  every cut so the edge can be checked.
- Before a token is cut, the server checks the plate's outer edge for subject pixels. A clipped
  render is redone once and refused if it clips again.
- A battlemap is sent padded to the nearest aspect the API renders (a mirrored margin), and
  the render is mapped back onto the source's pixel grid. The API scales its input to cover the
  output and trims the excess, so a "3:4" render is 1792×2400, not 1800×2400. Then both images
  are reduced to edge strength and compared tile by tile (phase correlation): a restyle changes
  colour and texture, edges stay put. More than 3% of tiles moved by over 0.4% of the long
  side means the layout drifted. A checkerboard of source and result is written beside every
  map for the eye.
- A render the image safety filter blocks is retried once; the filter is not consistent on the
  same input.
- No local models, no fine-tuning, no ComfyUI. Style comes from reference images you attach.

## Development

```bash
npm test          # offline unit suite; nothing hits the live API
npm run typecheck
npm run check     # biome
npm run knip
npm run doctor    # the setup checks against your .env (needs a build)
```

`npm ci` runs two install scripts, both allowed in `package.json` under `allowScripts`:
esbuild's (it checks its platform binary; vitest's bundler) and classic-level's (it picks the
prebuilt LevelDB binding; the Foundry CLI behind `scripts/unpack_leveldb.mjs`). Neither is used
by the server at runtime.

<!-- openroll5e:family -->
## Part of Open Roll 5e

fvtt-mcp-imagegen is one of the three MCP servers in Open Roll 5e, a suite of Foundry VTT modules and Claude
Code tooling built for one D&D 5e table and shared. The other servers:

- [fvtt-mcp-dnd5e](https://github.com/Txpple/fvtt-mcp-dnd5e): builds D&D 5e content in a live Foundry world from Claude Code: a stat block becomes a complete NPC, a map image a walled and lit scene, an adventure its journals, tables and handouts.
- [fvtt-mcp-sessionscribe](https://github.com/Txpple/fvtt-mcp-sessionscribe): turns a session's Discord recording and Foundry chat log into its record. Its end-to-end `session-scribe` skill drives the server from the Craig link to a speaker-labelled transcript, a fully illustrated player recap, combat statistics, GM notes and a party snapshot.

The modules, each of which installs and works on its own and none of which needs another:

- [Open Roll 5e: Autoexplore](https://github.com/Txpple/fvtt-mod-autoexplore): lets a scene start fully explored, so the whole map shows through the fog of war while tokens still need line of sight.
- [Open Roll 5e: Battle Flow](https://github.com/Txpple/fvtt-mod-battleflow): combat automation for dnd5e 2024 rules: a hit rolls and applies its own damage, saves resolve themselves, reactions hold, and concentration is tracked. Every rule that touches a fight in the 2024 core books, Heroes of Faerûn, Arcana Unleashed and Ravenloft: The Horrors Within.
- [Open Roll 5e: Combat Plus](https://github.com/Txpple/fvtt-mod-combatplus): automates the chores of running a fight: combat music, an initiative gate, an out-of-turn movement block, defeated marking at 0 HP and turn alerts.
- [Open Roll 5e: Errata](https://github.com/Txpple/fvtt-mod-errata5e): corrects, in memory, bugs in the premium D&D 2024 books, the dnd5e system and Foundry itself, each fix held until the vendor ships its own.
- [Open Roll 5e: FX Studio](https://github.com/Txpple/fvtt-mod-fxstudio): visual and sound effects for dnd5e, played from what actually happened at the table, with about a thousand stock FX and a window for authoring your own.
- [Open Roll 5e: Loot Shelf](https://github.com/Txpple/fvtt-mod-lootshelf): loot chests and merchant shelves that players can take from, buy from and sell to without owning them, with a receipt for every trade.
- [Open Roll 5e: Open Server](https://github.com/Txpple/fvtt-mod-openserver): for hosted worlds: clears the startup pause so players can play before the GM arrives, and gives any user a landing scene of their own.
- [Open Roll 5e: Party Stash](https://github.com/Txpple/fvtt-mod-partystash): makes a dnd5e Group actor's inventory a working party stash: drags move instead of copying, coin moves through a dialog, and every transfer posts a receipt.
- [Open Roll 5e: Area Sounds](https://github.com/Txpple/fvtt-mod-areasounds): background sound for scenes: random one-shots with silence between them, seamless crossfaded loops, day and night gating, and quiet during combat.

Issues are welcome on every repo in the family; pull requests are not accepted, since each is one
author's design for one table, shared because it might suit yours. How they fit together is mapped in [fvtt-suite-openroll5e](https://github.com/Txpple/fvtt-suite-openroll5e).
<!-- /openroll5e:family -->

## License

MIT. See [LICENSE](LICENSE).
