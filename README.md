# fvtt-mcp-artificer

> 🚧 **Rebuilding.** This server is being rewritten from a local ComfyUI backend to the Gemini
> image API (decided 2026-09-19). The tools described below are the target contract; see
> [ROADMAP.md](ROADMAP.md) for what has actually landed.

A **Foundry-specific** image-generation [Model Context Protocol](https://modelcontextprotocol.io)
server for D&D table art, driven by **Claude Code**. It calls the **Gemini image API** (Nano
Banana 2 and Nano Banana Pro) and exposes a small set of Foundry-shaped tools so Claude can author
prompts, generate art, edit existing art, cut tokens to alpha, **curate the results by actually
looking at them**, and hand the winners to the Foundry pipeline in its sister server,
[`fvtt-mcp-molten5e`](https://github.com/Txpple/fvtt-mcp-molten5e)
(`upload-asset` → `set-actor-art` / `add-journal-image`).

No local models, no GPU. Everything that matters is in git: this repo holds the tool, the
campaign repos hold the approved art, and the only machine-side state is an API key.

## Why this shape

This is **not a generic image-API bridge**, by decree. Tools speak Foundry vocabulary — icons,
tokens, portraits, illustrations — and get tweaked freely for Foundry work. And it stays
**separate from `fvtt-mcp-molten5e`**: that server is scoped to Foundry content authoring and must
not couple to image generation. This server never talks to the Foundry bridge; the handoff
between them is files on disk plus the molten5e upload tools.

Same house philosophy as the rest of the family: **tools do, skills decide.** Correctness (model
per kind, ratio and size, post-processing, cutout, file conventions, the Pro cost gate) lives in
tested tools here; judgment (prompt craft, curation taste, which references to attach, which actor
or journal gets the art) lives in the `illustration-builder` skill.

```
Claude ──MCP──> fvtt-mcp-artificer ──HTTPS──> Gemini image API
                      │
                      ├── sharp: crop, resize, format
                      └── cutout: rembg matte / chroma key → alpha
```

## Purpose presets, not raw dimensions

`generate-image` takes a `kind`, not width/height. Each kind fixes the model tier, the API ratio
and size, and the post-processing:

| kind | tier default | API call | finished output |
| --- | --- | --- | --- |
| `icon` | flash | 1:1 at 1K | 512×512 |
| `token` | flash | 1:1 at 1K | 512×512 RGBA, background cut to alpha |
| `portrait` | pro | 3:4 at 2K | as rendered |
| `illustration` | pro | 16:9 at 4K with style references | 2560×1600 (16:10 crop) |

Battlemaps are not a kind. They are bought as UVTT packs and imported.

## Tiers and the cost gate

| tier | model | for |
| --- | --- | --- |
| `flash` | Nano Banana 2 (Gemini 3.1 Flash Image) | icons, tokens, edits, cheap drafts |
| `pro` | Nano Banana Pro (Gemini 3 Pro Image) | portraits, illustrations, party scenes, text-heavy handouts; the only tier that takes style references |

Pro costs roughly twice Flash. Any call that resolves to Pro refuses unless `confirmPro: true` is
passed, and the refusal states the estimated cost. The skill asks the owner before confirming.
`artificer-status` reports estimated spend for the session.

## Tools

| tool | what it does |
| --- | --- |
| `generate-image` | `kind` + `prompt` + `slug`, optional `references` (character or style, by role), optional `tier`, `confirmPro`. Returns absolute PNG paths named `<kind>-<slug>-<id>.png`. |
| `edit-image` | `sourceImage` + `instruction` + `kind`. Instruction-style editing of an existing image: swap a weapon, change a cloak, add a scar. Tokens are re-cut to alpha after. |
| `cutout-image` | Knock the background off a token render to real alpha (rembg AI matte, or chroma key for flat plates), verified against a magenta preview, delivered on a 512 square so Foundry scale 1.0 is right. |
| `artificer-status` | Key present, models reachable, estimated session spend. |

## Requirements

- **Node.js 22+**.
- A **Gemini API key** with access to the image models.
- **Python 3** with `rembg` for the AI matte in `cutout-image` (chroma key works without it).
  First rembg use downloads a ~176 MB model.

## Build

```bash
npm install
npm run build
```

Tests: `npm test` (offline unit suite on recorded API fixtures; nothing hits the live API).
Quality gates: `npm run typecheck`, `npm run check` (biome), `npm run knip`.

## Wire into Claude Code

House convention registers the server at **user scope** (new MCP tools ⇒ restart Claude Code).
Either use the CLI:

```bash
claude mcp add -s user artificer -- node D:/path/to/fvtt-mcp-artificer/dist/index.js
```

or copy [`.mcp.json.example`](.mcp.json.example) into a `.mcp.json` Claude Code reads (or merge
into `~/.claude.json` `mcpServers`) with **absolute** paths. On Windows point `command` at the full
`node.exe` path if Node isn't on `PATH`.

## Configuration

Copy [`.env.example`](.env.example) to `.env` (gitignored):

- `GEMINI_API_KEY` — never committed, never placed in a skill or prompt.
- `ARTIFICER_OUTPUT_DIR` — where raw renders land before curation and staging.
- `ARTIFICER_TIMEOUT_MS` — per-call wait cap.

## License

MIT License — see [LICENSE](LICENSE) for details.
