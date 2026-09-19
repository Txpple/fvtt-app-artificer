# Backlog

Candidates after v1.0.0, in rough priority order. The planned work lives in
[ROADMAP.md](ROADMAP.md). Two items that used to live here, AI token edits and the cutout port,
are now core roadmap milestones (M1 `edit-image`, M2 `cutout-image`).

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
