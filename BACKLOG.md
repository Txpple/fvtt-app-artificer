# Backlog

Candidates after v1.0.0, in rough priority order. The planned work lives in
[ROADMAP.md](ROADMAP.md). Two items that used to live here, AI token edits and the cutout port,
are now core roadmap milestones (M1 `edit-image`, M2 `cutout-image`).

## 0 · Linked battlemaps from map libraries (next up)

Kitbash library maps and props into a series of linked scenes, repaint them into one style,
fit walls and lights, and hand the LLM `.uvtt` / scene JSON plus teleporter pairs to place
through fvtt-mcp. Plan, lessons and proof-of-concept code in
[notes/map-builder/PLAN.md](notes/map-builder/PLAN.md) (2026-10-05).

## 1 · Icon sets as a first-class workflow

A homebrew item, spell, or feature set with matching icons is a bigger visual upgrade to a
Foundry world than another scene painting, and it is the thing Nano Banana 2 one-shots best.
Once M1 lands: a skill recipe for "icon set for this compendium folder" that reads the items,
prompts each from its description with one shared style prefix, batches through Flash, and
uploads the results with `upload-asset-tree`. Consider the Batch API (half price) for sets that
can wait.

## 2 · Multi-turn edit sessions

Google recommends `previous_interaction_id` for iterating on an image. `edit-image` in M1 is
single-shot (source image in, result out). If the spike shows conversational edits hold identity
better than re-feeding the file, add an optional session handle so "same, but at dusk" chains
without re-uploading.

## 3 · Flash Lite for throwaway drafts

Gemini 3.1 Flash Lite Image is about half the price of Flash at 1K but is not optimized for
reference images or multi-turn editing. Only worth a `draft` tier if icon volume gets large.

## 4 · Parked

- **Text-heavy props** (wanted posters, letters, signs): Pro renders text well, so this needs no
  new model, only a skill recipe and maybe a `handout-text` preset if 3:4 or 2:3 suits better
  than 16:9.
- **Per-character consistency beyond references**: Pro's five character slots cover the party
  plus one NPC. If a recurring villain needs to hold across dozens of images, revisit.
- **No upscaler, on purpose** (asked 2026-09-21, left). `upscale-image` went with ComfyUI.
  Every kind renders larger than it delivers, so only old or bought art could need one. If it
  ever does: sharp Lanczos for a 2x with no install, or `realesrgan-ncnn-vulkan` (one 40 MB
  zip, runs on the GPU via Vulkan, no CUDA) spawned like the cutout script. Never `edit-image`;
  it regenerates the pixels.

## Done

- **Battlemap restyles** (2026-10-02). `edit-image` `kind: "battlemap"`: a bought map repainted
  with its layout locked, mapped back onto the source's pixel grid (a whole-number upscale for a
  small source), drift-checked tile by tile and refused after two drifted renders. Shipped as
  WebP (owner's call the same day): 38.6 MB to 3.7 MB on the garden. Proven on 14 maps from
  Forgotten Adventures, Tom Cartos, and Mad Cartographer, about $6.25 of renders in all.

- **Key colour from the prompt, not only from samples** (found and fixed 2026-09-19). The first
  Bramblemaw token, a green dragon prompted against a grey reference token, went out on a green
  plate and cut clean by luck. `pickChromaKey` now scores the prompt's colour words alongside the
  sampled images: one mention argues against a key, two are decisive, worst case per key wins.
