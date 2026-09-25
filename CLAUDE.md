# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# fvtt-app-artificer

Image-generation app for D&D table art, backed by the **Gemini image API** (the Nano Banana
models). Claude Code drives it through its MCP server (registered as `artificer`), which exposes
a small set of **Foundry-specific** tools so Claude can author prompts, generate art, edit existing art, cut tokens to alpha, curate the results by actually looking at
them, and hand the winners to the Foundry pipeline (`upload-asset` → `set-actor-art` /
`add-journal-image` in `fvtt-mcp-dnd5e`).

Status: **v1.0.0 shipped 2026-09-19 on the Gemini API.** The first version of this server wrapped
a local ComfyUI install with FLUX models and a trained house-style LoRA. That direction is dead:
the local pipeline took many iterations per usable image, the LoRA never delivered a consistent
look, and the owner was already feeding its output to Nano Banana to fix. ComfyUI, the models, the
training toolkit, and the corpus are deleted from the machine. Nothing local remains. See
[ROADMAP.md](ROADMAP.md) for the rebuild milestones; the ComfyUI-era notes are in
[notes/archive/](notes/archive/) for history only and describe nothing that still exists.

## Scope (binding)

- **Foundry-specific by decree, NOT a generic Gemini image bridge.** Tools speak Foundry
  vocabulary and get tweaked freely for Foundry work. Do not generalize.
- **API only.** No local models, no local inference, no GPU dependency. Do not reintroduce a
  local backend or a backend abstraction. One client, one provider.
- **Separate from `fvtt-mcp-dnd5e`.** That server is scoped to Foundry content authoring and
  must not couple to image generation. This server never talks to the Foundry bridge; the
  handoff between them is files on disk + the dnd5e MCP's upload tools.
- Same house philosophy as the rest of the family: **tools do, skills decide.** Correctness
  (model selection per kind, ratio and size, post-processing, cutout, file conventions, the Pro
  cost gate) lives in tested tools here; judgment (prompt craft, curation taste, which reference
  images to attach, which actor/journal gets the art) lives in the `illustration-builder` skill.
- **Everything is in git.** The tool is this repo; the approved art is in the campaign repos.
  The only machine-side state is the API key in `.env`.

## Architecture

```
Claude ──MCP──> fvtt-app-artificer ──HTTPS──> Gemini image API
                      │                        (Nano Banana 2 / Nano Banana Pro)
                      ├── sharp: crop, resize, format
                      └── cutout: rembg matte / chroma key → alpha
```

- Tools return absolute file paths; Claude reads the PNGs directly to curate.
- Small server: `generate-image`, `edit-image`, `cutout-image`, `artificer-status`. Resist tool
  sprawl.

## Models and tiers

| tier | model | role | rough cost |
|---|---|---|---|
| `flash` (default for every kind) | Nano Banana 2 (Gemini 3.1 Flash Image) | everything unless the owner opts up | ~7¢ at 1K, ~10¢ at 2K, ~15¢ at 4K |
| `pro` (opt-in) | Nano Banana Pro (Gemini 3 Pro Image) | offered for portraits and illustrations "for a bit extra"; crowded scenes, text-heavy handouts | ~13¢ at 1K/2K, ~24¢ at 4K |

Facts that shape the design (verified against Google's docs 2026-09-19):

- Both take up to 14 reference images. Flash holds identity for up to 4 characters; Pro for 5.
- The docs say only Pro takes style references (up to 3); in practice they work on Flash too.
  Either way that is the replacement for the LoRA: the house look comes from attaching approved
  pieces, not from trained weights.
- Resolutions are fixed steps (0.5K on Flash, 1K, 2K, 4K). Aspect ratios are a fixed list with
  **no 16:10**. The 2560×1600 table format is produced by generating 16:9 and cropping.
- Every output carries an invisible SynthID watermark. Irrelevant for a private table.
- The API returns JPEG; the server converts to PNG. Style references work on Flash in practice
  despite the docs listing them as Pro-only (spike, 2026-09-19).
- The content policy says nothing specific about fantasy violence. The spike rendered blood,
  corpses, and a severed head on both tiers with zero refusals; treat the filter as a non-issue for
  table art until proven otherwise.

## Tool design: purpose presets, not raw dimensions

`generate-image` takes `kind`, not width/height. Each kind carries its API ratio and size, its
default tier, and its post-processing:

| kind | tier default | API call | post-process | destination |
|---|---|---|---|---|
| `icon` | flash | 1:1 at 1K | resize to 512 square | item / spell / feature icons |
| `token` | flash | 1:1 at 1K, top-down full-body at the pitch of the world's tokens (an existing token attached as the style reference), on a chroma plate whose colour is chosen per subject | edge-clip check (subject touching the plate edge ⇒ one re-render, then refuse), cutout to alpha, no shadow, 512 square (1024 with `creatureSize: "large"`, meaning Large or bigger) | actor token |
| `prop` | flash | nearest API aspect to the footprint (generate) or the source (edit), object-only wording, chroma plate | edge-clip check, cutout, fitted to the exact tile size: 300 px per cell for a new prop, the source's own pixel size and subject box for an edit | map dressing tile (furniture, barrels, trees) |
| `portrait` | flash | 3:4 at 2K | none beyond naming | actor sheet portrait |
| `illustration` | flash | 16:9 at 4K, style refs attached | crop to 16:10, downsample to 2560×1600 | journal image / player handout |

**Nothing ever clips off a token or a prop (owner rule 2026-09-24).** A sword, wing, or foot
cut by the frame edge makes the token unusable. The framing and the token edit line both demand a margin on
every side, and `render()` counts subject pixels in the plate's outer 3 px (`src/edge.ts`): over
20 means clipped, the render is redone once (both calls billed), and a second clip is refused
with both plates kept for inspection. Never deliver or show a clipped token or prop.

There is no `scene-background` kind. Battlemaps are bought as UVTT packs from vendors and
imported; this server never makes map layers or backgrounds. Props are the exception the owner
asked for (2026-09-24): single objects placed on a map as tiles. They are never tokens: the token
wording ("keep the face, hair") grew a man on an armchair, a dryad on an oak, and a dwarf on a
crate, so props have their own object-only wording. A prop edit pads the source with a margin
before sending (a tile-filling crate otherwise came back clipped twice) and puts the new art in
the box the original occupied, so it drops into the same tile slot at the same scale.

**The Pro cost gate (owner rule 2026-09-19, revised the same day):** every kind defaults to
flash. `tier: "pro"` refuses unless `confirmPro: true` is passed, and the refusal states the
estimated cost. The skill mentions once that Pro is available for a bit extra when the owner
asks for a portrait or illustration, and passes the confirm only after they say yes. The server keeps a running estimated-spend counter per session; `artificer-status`
reports it. Tools enforce, skills ask.

## Setup order (done 2026-09-19; kept as the record)

1. Spike (throwaway script, not the server): both tiers on one icon, one token, a party scene
   with the four portraits as character references, and a combat scene with weapons and a
   wounded monster. Measure refusal rate, style-reference hold across ten images, icon
   consistency across twenty. Go/no-go for everything below.
2. Backend swap: Gemini client replaces the ComfyUI client; presets become ratio + size;
   `sharp` does crop and resize; `workflows/`, `src/comfy.ts`, `upscale-image`, and the live
   ComfyUI test suite are deleted. Tests run on recorded fixtures, never the live API.
3. Cutout port: the `token-cutout` script and its judgment move here from fvtt-mcp-dnd5e as
   `cutout-image`; `kind: "token"` chains it; the fvtt-mcp-dnd5e copy is retired.
4. Pro gate and spend counter.
5. `illustration-builder` skill rewrite for the edit-first, reference-driven workflow.
6. Docs and release: tag `v1.0.0`. New tools ⇒ Claude Code restart (the owner restarts, the
   session can't).

## Conventions inherited from the family

- Commit direct to `main`.
- Kernel-grade quality bar: tools are tested and own correctness; no judgment in tools.
- Output filenames: `<kind>-<slug>-<id>.png`, kebab-case, kind-prefixed, matching the campaign
  repos' `art/` shelf, so generate → curate → upload needs no glue.
- The API key lives in `.env` (gitignored), never in a skill, a prompt, or a commit.
- Register the server at **user scope**.
