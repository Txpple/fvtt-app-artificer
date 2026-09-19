# Session handoff — 2026-08-27 (art day + LoRA build)

Supersedes `session-handoff-2026-08-26.md`. Everything below is committed; this is the
orientation page for the next context window.

## What exists now

- **fvtt-mcp-artificer v0.3.1** — unchanged this session. Three tools (`generate-image` with
  draft/scene/final/refine, `upscale-image`, `artificer-status`), six pinned workflows.
- **ComfyUI 0.34.0** headless on 127.0.0.1:8188. Relaunch:
  `powershell -NoProfile -ExecutionPolicy Bypass -File D:\Workbench\LOCAL\LocalAI\launch-comfyui.ps1`
  (the `-ExecutionPolicy Bypass` is required — worth baking into the script).
- **NEW: ai-toolkit** at `D:\Workbench\LOCAL\LocalAI\ai-toolkit` with a working venv, plus
  FLUX.1-dev base weights (~32 GB) in the HF cache. See `notes/lora-house-style.md` for the full
  build log, benchmarks and install traps. Rebuild with `training/setup-venv.sh`.
- **The illustration-builder skill** — gained two rules this session (house portrait finish;
  style anchoring via the Morgash+Gren reference pair). READ IT BEFORE GENERATING ANYTHING.

## Part 1 — Art, still awaiting owner verdict

All in `fvtt-campaign-greenrest\art\staging\`. **Nothing has been wired into either Foundry
instance.** The campaign repo's `art/` additions are still uncommitted to that repo's git.

**Portrait consistency pass** (all 5 redone in the house matte-oil spec, each conditioned on its
own old portrait for identity):
- `portrait-morgash-gravemaker-603249608` — **owner approved**. Also *corrects canon*: the legacy
  portrait had a tusk rooted in the cheek; the cookbook phrase plus "smooth unbroken cheeks"
  fixed it.
- `portrait-gren-greenmantle-1743027517` — **owner approved**. De-aged to middle-aged per owner;
  eyes fixed after a "buggy" note.
- `portrait-thomas-invictus-2130536468`, `portrait-jetten-elisedil-432067893` — re-rendered with
  the contrast fix + style anchoring. **Owner has not given a verdict on the final versions.**
- `portrait-salyth-683985156` — **ignore**, Salyth is not an active PC (see memory).

**Scene redos** (vignette/money style, three-pass review):
- `handout-displacer-alpha-593465674` — Thomas kills the alpha.
- `handout-hobgoblin-captain-1796044867` — Jetten finishes the captain.
- `handout-cadoc-graveheart-1061274353` — Morgash at the Graveheart.
- Superseded old wide-cast versions (`*-880101`, `*-880210`, `*-880310`) can be deleted from
  staging on the owner's word. `handout-longshadow-battle-777002` predates this session.

## Part 2 — The house-style LoRA

Read **`notes/lora-house-style.md`** — it has the full decision record, benchmarks, corpus prep,
and per-run findings. Summary:

- **FLUX.1-dev, not FLUX.2-dev.** FLUX.2 is 32B; on a single 5090 it thrashes at 277 s/it (~10
  days for our run). Consequence: **the LoRA can never apply to `scene` mode** (FLUX.2) — only
  `final` and `refine`.
- Three overnight runs, 7h38m, no failures. **Run C (rank 16) won.** Rank is the lever that
  matters; halving the learning rate (run B) changed nothing.
- Checkpoints in `ai-toolkit\output\dnd24art-*`. Run C's final + its 2000-step checkpoint are
  copied into ComfyUI `models\loras\`.

### Real-pipeline evaluation (this is the part that matters)

A bench harness at `scratchpad\suite.py` injects a `LoraLoaderModelOnly` into the real
`final.json` and submits directly to ComfyUI — **no MCP change, no restart needed**. 21 renders
(4 PCs + 3 empty scenes × base/0.5/0.8) are in `C:\Users\sippelmc\Desktop\lora-test-suite\`,
named `<subject>__<strength>.png`.

**Findings so far (only ~6 of 21 examined closely — the rest need the owner's eye):**

| Use | Verdict |
| --- | --- |
| **Scenes / environments** | **Clear win.** Base FLUX.1 drifts *photorealistic* on scene prompts (the crypt base looks like a photo of a real ossuary); the LoRA makes it painted. |
| Character portraits | Mild improvement — tighter construction, better props — but still glossy digital, not the approved matte-oil look. |
| Party scenes w/ references | N/A — that's FLUX.2 scene mode. |

**I was wrong about a lot of this overnight and the corrections matter:**
- The **parchment/page-background** artifact only appears when the prompt does not name a setting.
  The house spec always does, so it never affected real work.
- The **walrus tusks are NOT the LoRA** — the no-LoRA control produces them too. Base model +
  the known trap word.
- **Bone-white skin survives** at every strength in the real pipeline. The "tan skin" failure was
  an artifact of 20-step previews.
- Root cause of all three errors: **I judged 20-step sample previews with no control.** The
  cookbook's own rule — judge at final quality — applies to evaluation, not just curation.

### Known real defects (not artifacts of my testing)

- **Fake signatures / watermarks** (one read `@wrlinse2a.com`). Present in LoRA renders *and* in
  the base control, so partly FLUX — but training on published plates reinforced it. **I never
  filtered the corpus for artist marks.**
- Corpus has **20 plates with meaningful page-white/parchment** and at least one surviving gold
  frame (`phb-abjurer`, missed because art broke out past the frame). Listed in the notes.

## Part 3 — Open decisions

1. **Owner is hand-picking ~100 plates.** All book art (5,359 files) is copied to
   `Z:\Shared\TableArt`, sorted — `01-journal-art` (858) is the real pool; `_claude-picked-133`
   holds the current corpus + captions for reference. Rejection criteria: **no frames/borders, no
   signatures/watermarks, no white/parchment backgrounds.** Then re-prep (crop to art interior,
   do NOT composite margins onto white) + re-caption + retrain (~2.4 h).
2. **Verdict on Thomas + Jetten portraits**, then wire the approved set into both Foundry
   instances (`set-actor-art`, portraits only — tokens are sacred, `applyToToken: false`), retire
   the legacy files as scene references, and write Gren's corrected middle age into his bio.
3. **Does the LoRA ship?** If it stays scene-only, it needs wiring into the MCP server: a
   `LoraLoaderModelOnly` in a new pinned `final-lora.json` (do NOT edit the proven `final.json`)
   plus `lora`/`loraStrength` params on `generate-image` — an **MCP schema change, so the owner
   must restart Claude Code**.

## Sharp edges

- **Inline image previews often do not reach the owner** in the desktop app — deliver with
  `SendUserFile`. Still Read them yourself first: I sent two unviewed and described them
  positively when they were junk.
- **Never use uv-managed CPython on this box** — Windows Application Control blocks its `_ctypes`.
  Use `py -3.13`. (Also in memory.)
- **Stop ComfyUI before any training run** — it holds ~24 GB of VRAM.
- Sample/eval prompts must **state gender outright** — omitting it turned Thomas into a woman,
  violating the cookbook's own first rule.
- MCP schema changes need a Claude Code restart; the owner restarts, the session cannot.
