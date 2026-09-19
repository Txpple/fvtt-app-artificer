# M3 loop-proof notes — 2026-08-26

The release-gate loop ran end to end **through the registered MCP tools** (first session after
user-scope registration): prompt → `generate-image` draft batch → curation by reading the PNGs →
`generate-image` refine / `upscale-image` → molten5e `upload-asset` → journal in the live world.

## The three pieces (in "The Broken Heart of Greenrest", journal *Artificer Loop Proof*)

| piece | path under `Data/worlds/.../assets/art/` | route |
| --- | --- | --- |
| Handout — moor watchtower (2560×1600) | `handout-moor-watchtower-1118612440.png` | 6-draft batch → pick #5 → refine 0.7 |
| Portrait — halfling innkeeper (2048×2560) | `portrait-halfling-innkeeper-702448768.png` | 4-draft batch → **rejected** → re-prompt → pick #4 → refine 0.7 |
| Token — moor bandit (2048×2048) | `token-moor-bandit-1652653432.png` | 4-draft batch → pick #2 → upscale tail |

## Timings through the tools (warm)

Draft batches: 5.5–10 s for 4–6 images. Refines: 17–19 s finished at output resolution.
Upscale tail: 3.9 s. klein↔dev model swapping added no visible overhead on the 5090.

## Curation learnings (skill-layer fodder)

- **klein under-weights gender/species modifiers**: "elderly halfling innkeeper … her" produced
  four mustached gnome-eared men. Explicit "old halfling woman, grey hair in a neat bun" fixed it
  in one re-draft. The reject → re-prompt → re-batch cycle cost ~15 s total — curation working as
  designed, not a pipeline failure.
- **Prop drift**: "crossbow" repeatedly rendered as a musket/blunderbuss in 3 of 4 token drafts.
  Expect to curate for props, or describe them more concretely ("wooden crossbow with drawn
  string").
- **Signatures persist in dev renders**: the refine pass re-adds faint corner signatures /
  watermark-ish glyphs even when drafts were clean and the prompt says "no signature". Minor at
  table scale; a future crop/inpaint pass or LoRA choice may retire it.
- Journal delivery: `create-journal` with image pages (one text intro + three image pages) is the
  right proof-of-delivery shape; `add-journal-image` remains the incremental path.
