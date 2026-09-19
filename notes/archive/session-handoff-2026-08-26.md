# Session handoff — 2026-08-26 (build day)

> **SUPERSEDED** by [session-handoff-2026-08-27.md](session-handoff-2026-08-27.md).

For the next context window. Everything below is committed; this note is the orientation page.

## What exists now

- **fvtt-mcp-artificer v0.3.1**, public at github.com/Txpple/fvtt-mcp-artificer, registered at
  user scope (`artificer` in `~/.claude.json`). Three tools: `generate-image` (modes draft /
  scene / final / refine, `referenceImages` on draft+scene), `upscale-image`, `artificer-status`.
  Six pinned workflows under `workflows/` (contract in its README). 22 unit tests + gated live
  suite; typecheck/biome/knip clean.
- **ComfyUI 0.34.0 headless** on `127.0.0.1:8188` (`scripts/launch-comfyui.ps1`; install at
  `D:\Workbench\LOCAL\LocalAI`). Models (~87 GB): klein-4B + qwen TE (drafts), FLUX.1-dev fp8
  (final/refine), FLUX.2-dev fp8 + mistral TE (scene), flux2 VAE, 4x-UltraSharp, turbo LoRA
  (on disk but **retired from scene.json** — owner wants full 24-step quality, ~80 s/scene).
  If ComfyUI is down, `artificer-status` says so; relaunch via the script.
- **The illustration-builder skill** (this repo, `.claude/skills/`) — the judgment layer. Its
  cookbook is the accumulated learning of the whole build day; READ IT BEFORE GENERATING
  ANYTHING. Hard gates: canon research (actor exports + their CURRENT art files; session
  diary + transcript + battlemap screenshot for event scenes), staging-first delivery,
  three-pass self-review before showing scene/final art.

## Canon state (world: the-broken-heart-of-greenrest, prod=molten + local sandbox mirror)

- **Five party portraits are canon** on both instances (portrait only; tokens untouched), files
  in `fvtt-campaign-greenrest\art\`. These are the `referenceImages` for scenes.
- **Staged awaiting owner verdict** in `...\art\staging\`: the Longshadow battle
  (`handout-longshadow-battle-777002.png`, owner liked it; suggested home = image page on the
  Session 5 diary entry) and three test scenes (cadoc/displacer/hobgoblin — superseded in
  spirit by the composition findings; the Cadoc money render `cadoc-money_00001_.png` in the
  ComfyUI output dir shows the new standard but has weak tusks — needs its three-pass pass).

## Owner preferences (also in skill/memory)

- Inline chat previews ONLY (Read the PNGs; SendUserFile for finals). No browser pane, no bare
  file paths. Desktop copies on request.
- Per-download approval with file/source/size. Staging before Foundry, always. Tokens are
  sacred — `set-actor-art` with `applyToToken: false`.
- Three-pass self-review before showing scene art; iterate seeds silently, show the best.
- Translate canon to visual vocabulary — never prompt proper nouns ("First Light" → "longsword
  in warm dawn light").

## Open work, in priority order

1. ~~Redo displacer + hobgoblin scenes~~ DONE 2026-08-26 (2nd window): vignette money renders
   staged — `handout-displacer-alpha-593465674.png` (Thomas kills the alpha, First Light +
   lantern) and `handout-hobgoblin-captain-1796044867.png` (Jetten finishes the captain).
   Old wide-cast versions in staging are superseded; awaiting owner verdict + destinations.
2. ~~Cadoc money render~~ DONE same window: `handout-cadoc-graveheart-1061274353.png` staged —
   portrait-true tusks, real maul contact, anatomical crystal heart. Baseline `cadoc-money`
   superseded. (Longshadow deployment item dropped per owner 2026-08-26.)
3. **BACKLOG.md**: `edit-token` (nano-banana replacement — likely FLUX.2 ref conditioning or
   the flux2 image-edit path; spike needed), absorb `token-cutout` from molten5e, character
   LoRAs (the real fix for identity-at-distance), NVFP4 fast gear, Qwen-Image text props.

## Sharp edges

- MCP schema changes need a Claude Code restart (house rule; the owner restarts).
- ComfyUI survives session restarts (detached child) — check port 8188 before relaunching.
- `.claude.json` backup from registration day: `~/.claude.json.bak-artificer`.
- The campaign repo `art/` additions are NOT yet committed to that repo's git.
