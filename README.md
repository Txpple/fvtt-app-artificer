# fvtt-app-artificer

An app that lets Claude make art for your Foundry VTT table using Google's Gemini image models
(Nano Banana). Four tools, one API key, no GPU.

[Claude Code](https://claude.com/claude-code) drives it. The app runs as an
[MCP](https://modelcontextprotocol.io) server named `artificer`, and its `illustration-builder`
skill grounds every piece in what your world already says and shows.

Claude writes the prompt, the server renders it, Claude looks at the result and fixes what is
wrong, and the finished file lands on disk ready to upload into Foundry.

## What you can make

- **Item, spell, and feature icons.** Twenty icons from one style line come back as one
  matching set. About 7 cents each.
- **Tokens.** Top-down, full-body, cut to transparency, centred on a square so Foundry's scale
  1.0 is right. Hand it one of your existing tokens as a style reference and new ones match the
  angle and look. About 7 cents each.
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
| `generate-image` | Render one asset from a prompt. `kind` is `icon`, `token`, `portrait`, or `illustration`; it picks the model, aspect, size, framing, and post-processing for you. Optional `references` (character or style). |
| `edit-image` | Apply one instruction to an existing image and keep everything else. Tokens are re-cut automatically. |
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
git clone https://github.com/Txpple/fvtt-app-artificer.git
cd fvtt-app-artificer
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
claude mcp add -s user artificer -- node /absolute/path/to/fvtt-app-artificer/dist/index.js
```

Or copy [`.mcp.json.example`](.mcp.json.example) and set absolute paths.

## Using it

Ask Claude for what you want in table terms:

- "Make icons for these six items."
- "This goblin needs a token; use my existing orc token as the style reference."
- "Illustrate the party arriving at the ruined mill at dusk; here are their portraits."
- "Change this token's cloak to forest green."
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
Claude ──MCP──> fvtt-app-artificer ──HTTPS──> Gemini image API
                      │
                      ├── sharp: convert, crop, resize
                      └── token_cutout.py: chroma key or rembg → alpha
```

- The API returns a JPEG; the server converts to PNG and applies the kind's post-processing
  (512 square for icons, 16:9 to 16:10 crop for illustrations, cutout for tokens).
- Tokens are rendered on a flat chroma plate whose colour is chosen per subject (green,
  magenta, or blue, whichever the subject shares least), then keyed out. A magenta-composited
  preview is written beside every cut so the edge can be checked.
- No local models, no fine-tuning, no ComfyUI. Style comes from reference images you attach.

## Development

```bash
npm test          # offline unit suite; nothing hits the live API
npm run typecheck
npm run check     # biome
npm run knip
```

## License

MIT. See [LICENSE](LICENSE).
