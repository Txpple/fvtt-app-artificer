---
name: illustration-builder
description: >-
  Generate campaign art with the artificer tools, grounded in what the world already says and shows.
  Use when the user wants art for the table: "make a portrait for <NPC>", "generate art for this
  scene/journal/handout", "this actor needs a token", "icons for these items", "illustrate this
  location", "give the inn a picture", "change this token's cloak". Reads the ACTUAL descriptions
  (actor bios, journals, scene notes, campaign repo) to build prompts, studies existing art in the
  Foundry data files for precedent and style, runs the generate → look → edit loop, and wires the
  winner into the world. The artificer tools own correctness (model per kind, dimensions, cutout,
  file naming, the Pro cost gate); this skill owns the judgment: what to prompt, which references
  to attach, what to reject, when to pay for Pro, where the art goes.
---

# Illustration builder

The judgment layer over `generate-image` / `edit-image` / `cutout-image`. Its whole job is to make
sure the prompt comes from **canon**, the style comes from **precedent**, the owner is asked
before Pro money is spent, and nothing lands in the world uncurated. It adds no mechanics — the
artificer server owns model selection, dimensions, cutout, and file conventions; molten5e owns
delivery (`upload-asset`, `set-actor-art`, `add-journal-image`).

Tools used: `artificer-status`, `generate-image`, `edit-image`, `cutout-image` (artificer);
`get-actor`, `search-journals`, `list-journals`, `list-scenes`, `list-assets`, `download-asset`,
`upload-asset`, `set-actor-art`, `add-journal-image` (molten5e).

## Step 0 — Pin the subject and the destination

Two questions before anything renders: **what is this a picture of**, and **where does it live**?
The destination picks the `kind`, and the kind picks the model tier:

| destination | kind | tier |
| --- | --- | --- |
| item / spell / feature icon | `icon` | flash |
| actor token (top-down, cut to alpha automatically) | `token` | flash |
| actor sheet portrait | `portrait` | pro (ask first) |
| journal image page / player handout / location splash | `illustration` | pro (ask first) |

There is no map kind. Battlemaps are bought as UVTT packs; never try to generate one.

If the user named a subject that exists in the world (an NPC, a location with a journal, an
item), the next two steps are **mandatory** — never prompt from imagination for a named subject.

## Step 1 — Ground the prompt in canon

Pull the authoritative description before writing a word of prompt:

- **Actors**: `get-actor` — bio, race/species, gender, age, class, notable gear. The stat block is
  canon for props (a bandit statted with a crossbow gets a crossbow, whatever looks cooler).
- **Items**: the item's description and type. An icon of a "rusted iron key" is a rusted iron key,
  not a generic key.
- **Locations / events**: `search-journals` for the subject name; scene notes; quest journals.
- **Campaign repo** (when working in it — e.g. `fvtt-campaign-greenrest`): `notes/`, `plot/`,
  `sessions/` often carry richer description than the world does.
- **Scenes of played events are a hard gate (owner rule)**: illustrating something that happened
  at the table means reading the session diary page AND the session transcript/gm-notes
  (`sessions/<date>/`), and **looking at the battlemap it was fought on** (`screenshot-scene`, or
  read the scene background) — terrain, layout, and the fight's actual beats come from there,
  never from imagination. Who was present matters too (absent PCs don't appear).
- **Arm the scene for the RIGHT session**: a fight from session 1 predates the party's later
  magic items. Check that session's own loot ledger before putting a weapon in anyone's hand.

Extract the **paintable facts**: species, gender, age, build, clothing, signature props, mood,
lighting, time of day, weather. These become the prompt's spine.

**Where canon is silent, don't silently invent.** For a named NPC whose bio never mentions hair
color, either ask, or propose ("canon doesn't say — I'll go with grey hair in a bun unless you'd
rather") and note what was invented so it can be written back into the bio. Generic subjects
("some bandit") invent freely.

**READ THE TOKEN ART, not just the bio** (learned the hard way 2026-08-28): bios routinely omit
appearance. Gren's never mentions his hair; four generations shipped an invented brown before his
token settled it as white hair, a full white beard and a green-crystal staff. Tokens live at
`%LOCALAPPDATA%/FoundryVTT/Data/worlds/<world>/assets/tokens/<name>.png` — the path is in the
actor's `prototypeToken.texture.src`. Open it before writing a word of prompt.

## Step 2 — Study precedent, then attach it as references

All campaign art should feel like one book. On this backend that is done with **reference
images**, not with words alone and not with trained weights:

- `list-assets` on `worlds/<world>/assets/art`. Read the filenames: the `<kind>-<slug>-<id>`
  convention tells you what exists and for whom.
- `download-asset` (or read the campaign repo copies) of the 2–3 pieces closest in subject, and
  **look at them**: palette, rendering style, framing, lighting mood.
- For actor art this is a **hard gate**: when the actor has existing art (`hasImage`), get the
  actual file (`export-actor` → `img` / `prototypeToken.texture.src` → `download-asset`) and
  **Read it** before writing the prompt. Backstories rarely state appearance facts the art
  settles. A canon Morgash has bone-white skin his backstory never mentions; the first portrait
  shipped green. Keep continuity with the existing art unless the user asks for a redesign.

**Two kinds of reference, passed as `references: [{ path, role, label }]`.** The tool attaches
them in order and writes a preamble that binds each one by its 1-based index and label, so your
prompt can simply say "Morgash" and be understood:

- **Character references** hold identity. Both tiers take them (Flash up to 4 characters, Pro up
  to 5). Bind each one with an unmistakable prompt phrase so the model knows which figure is
  which.
- **Style references** hold the house look. The docs say Pro only, up to 3, but they work on
  Flash in practice (spike 2026-09-19). Attach the standing style shelf on every portrait and
  illustration call unless the owner asks for something deliberately different.
- **Tokens take the world's own tokens as the style reference.** They are top-down full-body
  figures on transparency (see `assets/tokens/morgash.png` in the world data). Attach one as
  `role: "style"` and the new token comes out at the same angle and in the same ink-lined look.
  The tool appends the framing and the chroma plate sentence itself, samples the references to
  pick a plate colour the subject will not share, cuts the result to alpha on a 512 square, and
  keeps the plate PNG beside it. Read the `*_preview.png` it reports before trusting the edge.

**THE CANONICAL PARTY REFERENCE SHELF (approved 2026-08-28)** — the identity anchors for every
scene the party appears in. In the campaign repo at `fvtt-campaign-greenrest\art\`:

| PC | file | binding phrase to use in the prompt |
| --- | --- | --- |
| Gren | `portrait-gren-greenmantle-611.png` | "a short white-bearded gnome in green and gold robes" |
| Morgash | `portrait-morgash-gravemaker-611.png` | "a bone-white orc in battered steel plate" |
| Thomas | `portrait-thomas-invictus-611.png` | "a blond human paladin with a golden sunburst on his breastplate" |
| Jetten | `portrait-jetten-elisedil-3010.png` | "a lean tan ash-haired elf archer in a red cloak, arms covered in grey-brown sleeves and leather bracers" |

The older `-10534853 / -13527905 / -1504122958 / -934277758` files in the same folder are
SUPERSEDED (owner: "none of the pre-existing portraits are canonical"). Do not pass them as
references. Salyth is not an active PC.

**The standing style shelf** is the same four portraits until the owner approves illustrations
under the new backend; then pick the three that best carry the look and record them here.

**House portrait finish (owner-locked 2026-08-26):** the reference look is the Morgash/Gren
pair — `soft diffuse dusk light, low contrast, muted palette, matte powdery skin with no gloss or
shine, gentle even lighting with no harsh highlights, matte oil painting, visible painterly
brushwork, soft storybook finish`, paired with `rich mid-tones and deep shadows` so it does not
wash out. Words like "gleaming" invite a glossy studio sheen (the owner: "1960s TV cameo vibe") —
describe armor as `worn … with a soft dull sheen` instead. With style references attached, the
words reinforce the images; they are not a substitute for them.

## Step 3 — Craft the prompt (the cookbook)

Rules that have held across every model tried. Anything specific to the old local models was
dropped on 2026-09-19; re-earn phrasing lessons on the new backend before writing them here.

- **Say the identity outright**: "old halfling woman innkeeper, grey hair in a neat bun" — never
  a bare pronoun or a species adjective doing the work.
- **Describe props concretely**: "crossbow" drifts into muskets; "wooden crossbow with a drawn
  string" holds. Stat-block gear gets described, not named.
- **Never say "book art", "cover", or "poster"** — that paints title typography and plate
  borders. Style lives in words like "fantasy illustration", "oil painting style". The exception
  is a deliberate text prop (a real wanted poster), which is a Pro illustration.
- **Tokens**: describe the creature and its pose only. Never write framing, angle, or
  background words; the tool owns those and vaguer plate wording made Flash paint a green DISC
  on white in the spike. "Ink-lined with painted color and shading" in the prompt reinforces the
  world-token style reference.
- **Icons**: the tool appends "single subject centered, filling the frame, no text, no border";
  you supply the STYLE, or the render comes back photoreal. The proven set prefix: `fantasy RPG
  inventory icon, painterly oil illustration, soft top-left light, rich mid-tones and deep
  shadows, plain dark vignetted background. Subject:` then the object with its material ("rusted
  iron key", "worn oak longbow"). Same prefix for every icon in a set so they read as a set;
  twenty in a row held on Flash.
- **Negation backfires — describe presence, never absence** (proven twice, 2026-08-28). "no large
  tusks" DRAWS large tusks; "no beard" GROWS a beard. Say what IS there instead: "his chin and jaw
  and upper lip are smooth bare hairless skin".
- **The garment NOUN overrides any clause describing it** (proven 2026-08-28, Jetten sleeves). A
  "jerkin" is sleeveless whatever you say about its sleeves. Pick a garment noun that already
  implies the silhouette you want, and layer: "a grey-brown wool shirt with long sleeves underneath
  a closed leather vest".
- **"Shoulder caps" / "pauldrons" render as STEEL even in an all-leather prompt.** Say "leather
  vambraces" and leave the shoulders out.
- **Gendered features must be stacked, not stated once**: a lean build + smooth young face
  rendered a canon male elf as a woman despite the word "male". Add redundancy — "a man, a male
  elf" plus a strong square jaw and heavy brow.
- **Change one axis per render.** Rewriting the face clause and the body clause together is what
  costs the likeness. With `edit-image` this is natural: one instruction, one change.
- **Species proportion is a losing fight in a waist-up crop**: facial structure works better
  than size words, and a scale cue in frame beats both.
- **Translate canon into the model's vocabulary — never prompt in-world proper nouns or
  mechanics** (owner rule 2026-08-26). The generator has never heard of First Light, the Maul of
  Momentum, or Spellfire; naming them does nothing or free-associates garbage (a "rose-gold
  blazing" sword rendered as a pink lightsaber). Canon decides WHAT is true; the prompt says only
  what a camera would see: "First Light" → "a longsword catching warm dawn-colored light";
  "spellfire" → "silver-white fire"; "displacement" → "a ghostly after-image a step to one side".
  Keep effects modest — over-described glow becomes neon.
- **Compose inside the entity ceiling.** Past roughly six distinct subjects any model collapses
  into a posed lineup facing the camera, duplicates faces, and floats weapons. The full-party
  group shot is the HARDEST genre and a rare set-piece. Default to **duel/vignette compositions**:
  1–2 party members + one enemy + one landmark, one directional action, hero large and central.
  Give every party member exactly ONE unmistakable action clause; describe enemies with
  contrasting features so a reference face does not land on them.

## Step 4 — Run the loop: generate, look, edit

0. **The chat IS the gallery (owner preference — browser-pane previews don't work for them).**
   Reading a PNG renders it inline, so curating by reading doubles as showing the owner every
   candidate. Finals additionally go out via `SendUserFile` so they get a card.
1. Cold start? `artificer-status` first: key present, models reachable, spend so far.
2. **Ask before Pro.** Portraits and illustrations default to Pro. The tool refuses without
   `confirmPro: true` and states the estimated cost. Put that to the owner in one line
   ("Pro portrait, about 13 cents, go?") and only then confirm. A cheap first look is fine:
   `tier: "flash"` needs no confirm, and a Flash draft can be edited or re-rendered on Pro after.
3. `generate-image` with the canon prompt and the references. Two or three candidates for
   portraits and illustrations, one for icons and tokens (they one-shot well; re-roll on a miss).
   Every result reports `estimatedUsd` and `sessionEstimatedUsd`; `artificer-status` totals by
   tier. The API has no balance call, so these are estimates from the price table.
4. **Read every PNG.** Judge against canon, not against "is it pretty": wrong gender, wrong
   species, wrong props, wrong mood are **rejections** even on beautiful renders.
5. **Edit before re-rolling.** A candidate that is right on canon but wrong on one detail goes
   through `edit-image` with a single instruction ("swap the sword for a hand axe", "make the
   cloak forest green"). Edits default to Flash for every kind and hold identity, pose, angle,
   and style (Morgash's token took Sharran plate and a crackling maul in one pass). Re-generate
   only when the composition or the identity is wrong. Editing an existing WORLD token is the
   normal way to change a PC's gear: source the token file, describe the change, and the result
   is already cut.
6. **Three-pass self-review is mandatory before showing portrait or illustration art** (owner
   rule 2026-08-26): generate → Read → critique against canon, anatomy, and composition (weapons
   and hands especially) → edit or re-generate → repeat, at least THREE passes. Show the owner
   only the best surviving render, with a one-line note of what was rejected on the way.
   Icons and tokens are exempt from the three-pass rule but not from being Read.
7. Show the user the final (send the file) before or as it lands in the world.

## Step 5 — Stage locally; Foundry only after approval

**Nothing goes to Foundry uncurated by the owner.** Finals land in the campaign repo's staging
area first:

- Copy the finished PNG to `<campaign repo>\art\staging\<kind>-<slug>-<id>.png`. For Greenrest:
  `D:\Workbench\FVTT\Repos\fvtt-campaign-greenrest\art\staging\`.
- Show the user the file and **stop there by default**. Uploading to the live world
  (`upload-asset`) and wiring (`set-actor-art`, `add-journal-image`) happen only when the owner
  approves — then the file also graduates from `art\staging\` to `art\`.
- Tokens arrive already cut to alpha on a 512 square; Read the magenta preview the cutout wrote
  before trusting the edge. For a token from anywhere else, `cutout-image` does the same cut.
  Installing a token in the world (upload, `set-actor-art`, resetting the inherited prototype
  scale/ring/rotation) follows the molten5e `token-cutout` skill, which now holds only that half.
- If canon details were invented in Step 1, offer to write them back into the actor bio/journal so
  the art and the text agree forever after.
