# fvtt-mcp-imagegen

An [MCP](https://modelcontextprotocol.io) server that lets Claude make art for your Foundry VTT
table using Google's Gemini image models (Nano Banana). Four tools, one API key, no GPU.

[Claude Code](https://claude.com/claude-code) drives it. The server is registered as `artificer`,
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
- **Portraits.** Actor sheet art at 3:4. Hand it a previous portrait or two as style
  references and the new one matches your table's look.
- **Illustrations.** Player handouts and scene splashes at 2560×1600. Hand it your party's
  portraits as character references and they keep their faces in group scenes.
- **Edits.** Change one thing about an existing image and keep the rest: swap a weapon, recolor
  a cloak, add a scar, fix an extra limb.
- **Cutouts.** Knock the background off any token image you already have.

## The tools

| tool | what it does |
| --- | --- |
| `generate-image` | Render one asset from a prompt. `kind` is `icon`, `token`, `prop`, `portrait`, or `illustration`; it picks the model, aspect, size, framing, and post-processing for you. Optional `references` (character, style, or pose) and, for tokens, `creatureSize` (`medium` or `large`); for props, `footprint` (`"2x1"`). |
| `edit-image` | Apply one instruction to an existing image and keep everything else. Token edits are prompted the way you would type in the Gemini app and re-cut automatically. Takes `creatureSize` too. `kind: "battlemap"` restyles a bought map with its layout locked (edit only; `generate-image` refuses it, since a map painted from words has no walls). |
| `cutout-image` | Cut a token's background to alpha and deliver it on a square canvas. |
| `artificer-status` | Key present, models reachable, estimated spend this session. |

Every call returns the file path, the pixel size, and an estimated cost.

## Models and cost

Everything runs on **Nano Banana 2** (Gemini 3.1 Flash Image) by default: roughly 7 cents for
an icon or token, 10 cents for a portrait, 15 cents for an illustration.

**Nano Banana Pro** (Gemini 3 Pro Image) is available for about double. It is stronger on
crowded multi-figure scenes and images with legible text. Claude will not use it unless you
say so: a Pro call refuses without an explicit confirm and tells you the price first.

Prices are Google's published per-image rates and may change. The server keeps a running
estimate; your actual bill is in the Google Cloud console.

## Requirements

- Node.js 22 or newer.
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) with billing
  enabled. Prepaid credit with auto-reload off is a sensible ceiling.
- Python 3 with Pillow and numpy for the token cutout. `rembg` is optional and adds an AI
  matte fallback for busy backgrounds (first use downloads a ~176 MB model).

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
ARTIFICER_OUTPUT_DIR=C:\path\where\renders\should\land
```

Register the server with Claude Code (user scope, so it is available in every project), then
restart Claude Code:

```bash
claude mcp add -s user artificer -- node /absolute/path/to/fvtt-mcp-imagegen/dist/index.js
```

Or copy [`.mcp.json.example`](.mcp.json.example) and set absolute paths.

## Using it

Ask Claude for what you want in table terms:

- "Make icons for these six items."
- "This goblin needs a token; use my existing orc token as the style reference."
- "Illustrate the party arriving at the ruined mill at dusk; here are their portraits."
- "Change this token's cloak to forest green."
- "This old token looks rough; give it an updated painterly pass."
- "Cut the background off this token."

Claude reads every render before showing it to you and fixes obvious flaws (an extra limb, a
duplicated spell effect) with one edit. Files are named `<kind>-<slug>-<id>.png` so they drop
straight into a Foundry asset folder.

## With a Foundry MCP server: art grounded in your world

The artificer only makes pictures. Pair it with a Foundry MCP server such as
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
```

<!-- openroll5e:family -->
## Part of Open Roll 5e

fvtt-mcp-imagegen is one of the three MCP servers in Open Roll 5e, a suite of Foundry VTT modules and Claude
Code tooling built for one D&D 5e table and shared. The other servers:

- [fvtt-mcp-dnd5e](https://github.com/Txpple/fvtt-mcp-dnd5e): builds D&D 5e content in a live Foundry world from Claude Code: a stat block becomes a complete NPC, a map image a walled and lit scene, an adventure its journals, tables and handouts.
- [fvtt-mcp-sessionscribe](https://github.com/Txpple/fvtt-mcp-sessionscribe): turns a session's Discord recording and Foundry chat log into its record: a speaker-labelled transcript, a player recap, a combat report and GM notes.

The modules, each of which installs and works on its own and none of which needs another:

- [Open Roll 5e: Autoexplore](https://github.com/Txpple/fvtt-mod-autoexplore): lets a scene start fully explored, so the whole map shows through the fog of war while tokens still need line of sight.
- [Open Roll 5e: Battle Flow](https://github.com/Txpple/fvtt-mod-battleflow): combat automation for dnd5e 2024 rules: a hit rolls and applies its own damage, saves resolve themselves, reactions hold, and concentration is tracked. Every rule that touches a fight in the 2024 core books, Heroes of Faerûn, Arcana Unleashed and Ravenloft: The Horrors Within.
- [Open Roll 5e: Combat Plus](https://github.com/Txpple/fvtt-mod-combatplus): automates the chores of running a fight: combat music, an initiative gate, an out-of-turn movement block, defeated marking at 0 HP and turn alerts.
- [Open Roll 5e: Errata](https://github.com/Txpple/fvtt-mod-errata5e): corrects, in memory, bugs in the premium D&D 2024 books, the dnd5e system and Foundry itself, each fix held until the vendor ships its own.
- [Open Roll 5e: FX Studio](https://github.com/Txpple/fvtt-mod-fxstudio): visual and sound effects for dnd5e, played from what actually happened at the table, with about a thousand stock FX and a window for authoring your own.
- [Open Roll 5e: Loot Shelf](https://github.com/Txpple/fvtt-mod-lootshelf): loot chests and merchant shelves that players can take from, buy from and sell to without owning them, with a receipt for every trade.
- [Open Roll 5e: Open Server](https://github.com/Txpple/fvtt-mod-openserver): for hosted worlds: clears the startup pause so players can play before the GM arrives, and gives any user a landing scene of their own.
- [Open Roll 5e: Party Stash](https://github.com/Txpple/fvtt-mod-partystash): makes a dnd5e Group actor's inventory a working party stash: drags move instead of copying, coin moves through a dialog, and every transfer posts a receipt.
- [Open Roll 5e: Soundscape](https://github.com/Txpple/fvtt-mod-soundscape): background sound for scenes: random one-shots with silence between them, seamless crossfaded loops, day and night gating, and quiet during combat.

How they fit together is mapped in [fvtt-suite-openroll5e](https://github.com/Txpple/fvtt-suite-openroll5e).
<!-- /openroll5e:family -->

## License

MIT. See [LICENSE](LICENSE).
