# Roadmap — v1.0.0, "rebuild on the API"

> **Status: decided 2026-09-19, nothing built yet.** The ComfyUI-era server (v0.1 → v0.4) is
> retired; its notes are in [notes/archive/](notes/archive/) and describe nothing that still
> exists on the machine. This document is the plan for replacing it.

The release is done when the full loop runs end to end on real table art with no local
inference anywhere:

> prompt → `generate-image` (Gemini) → Claude curates by reading the PNGs → `edit-image` to fix
> the pick → `cutout-image` for tokens → staging in the campaign repo → `upload-asset` →
> `set-actor-art` / `add-journal-image` via molten5e.

## Why the change

- ComfyUI needed many iterations per usable image; the owner was routinely feeding its output to
  Nano Banana to fix, which it did in one pass. The local pipeline was a slow random draft
  generator in front of the model that actually did the work.
- The trained house-style LoRA never delivered a consistent look despite a curated 46-plate
  corpus and a rank sweep. Nano Banana Pro takes style reference images natively.
- Battlemaps, the one workload where free local generation could matter, are bought as UVTT
  packs. Everything that remains is low-volume, high-taste work that costs cents per image.
- A 100 GB local install with nothing in git violated the family's "everything is in git" rule.

---

## M0 — Spike (go/no-go)

A throwaway script in the session scratchpad, not the server. Both tiers, real API, a few
dollars. Answers the only open questions:

- **Refusal rate** on fantasy violence: a combat scene with drawn weapons, a wounded monster,
  blood. The docs say nothing specific; this measures it.
- **Style hold**: three approved pieces as Pro style references, ten illustrations, one look?
- **Icon consistency**: twenty item icons on Flash from one style prefix, do they read as a set?
- **Party identity**: the four canonical portraits in the character slots, a campfire scene on
  each tier. Do all four survive?
- **Latency and actual cost** per call at each size, recorded.

Exit gate: numbers in a note under `notes/`, and a decision on whether icon style needs a Pro
style-ref pass or a Flash prefix is enough.

## M1 — Backend swap

- `src/gemini.ts` replaces `src/comfy.ts`: one seam, nothing else touches HTTP. Model ids and
  per-image prices live in one table.
- Presets rewritten to `{ ratio, size, tier, post }` per kind: `icon`, `token`, `portrait`,
  `illustration`. `handout` and `scene-background` are gone.
- `sharp` owns post-processing: 16:9 → 16:10 crop and downsample for illustrations, 512 square
  for icons and tokens, format.
- `generate-image` contract: `kind`, `prompt`, `slug`, optional `references` (paths; the server
  sorts them into character vs style slots by a `role` field), optional `tier`, `confirmPro`.
  Returns absolute paths named `<kind>-<slug>-<id>.png`.
- `edit-image` contract: `sourceImage`, `instruction`, `kind`, optional `tier`, `confirmPro`.
  Native instruction editing; the token kind re-runs cutout after.
- Delete: `workflows/`, `src/workflows.ts`, `src/comfy.ts`, `src/tools/upscale.ts`,
  `tests/integration/`, `vitest.integration.config.ts`. `.env.example` carries `GEMINI_API_KEY`
  and `ARTIFICER_OUTPUT_DIR`.
- Tests: offline unit suite on recorded API fixtures (request shaping, preset mapping, post-
  processing dimensions, filename convention, registry surface guard). No test hits the live API.
- Exit gate: build green, tests green, one icon and one illustration rendered through the tool.

## M2 — Cutout port

- `cutout-image` tool wrapping the `token_cutout.py` script moved here from
  `fvtt-mcp-molten5e/.claude/skills/token-cutout/`, with its `rembg` / chroma methods, the
  magenta preview, and the 512-square canvas rule intact. First rembg use downloads a ~176 MB
  model: approval-gated, stated up front.
- `kind: "token"` in `generate-image` and `edit-image` chains cutout automatically.
- The molten5e `token-cutout` skill is retired and its docs point here. One home.
- Exit gate: a generated token lands as an RGBA PNG at 512 with a verified preview.

## M3 — Pro cost gate and spend counter

- Any call resolving to `pro` without `confirmPro: true` refuses with the estimated cost and the
  two ways out. Tested for every kind and tier combination.
- Session spend counter, estimated from the price table; `artificer-status` reports key present,
  models reachable, spend so far.
- Exit gate: the refusal message reads well in the chat, and a confirmed Pro call goes through.

## M4 — `illustration-builder` skill rewrite

- Drop every ComfyUI, FLUX, seed, denoise, and LoRA rule. Keep the model-independent judgment:
  canon research gates, read the token art, negation backfires, garment nouns override clauses,
  translate canon into camera language, three-pass self-review, staging before Foundry.
- Add: the style shelf (which approved pieces are the standing style references), the Pro
  confirm rule and how to ask it, icon recipes, edit-first iteration.
- Re-earn any phrasing lessons on the new models; do not carry FLUX-specific findings over as
  if they still held.

## M5 — Docs and release

- README, CLAUDE.md, this roadmap, and the backlog reflect the shipped tool. `.mcp.json.example`
  unchanged in shape.
- Tag `v1.0.0`. Register at user scope; the owner restarts Claude Code.

---

## Decisions still open (owner)

- **Output directory** for raw renders before staging. Default proposed:
  `D:\Workbench\LOCAL\artificer-output`, gitignored by being outside the repo.
- **Icon format**: Foundry ships webp for compendium icons; the campaign repos hold png today.
- **Flash for portraits and illustrations** without a confirm: allowed as a cheap first draft, or
  is Pro mandatory there? Proposed: allowed via explicit `tier: "flash"`.

## History

- v0.1.0 (2026-08-26): ComfyUI + FLUX.1-dev / FLUX.2-klein, pinned workflow graphs, the loop
  proven end to end.
- v0.2.0: reference conditioning for party scenes. v0.3.0: FLUX.2-dev scene finisher.
- v0.4.0 (2026-08-28): house-style LoRA trained and shipped; four party portraits approved.
- 2026-09-19: direction changed to the Gemini API; ComfyUI and everything local deleted.
