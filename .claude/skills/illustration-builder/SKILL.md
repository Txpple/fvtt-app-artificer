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
sure the prompt comes from **canon**, the style comes from **precedent**, Pro money is never
spent without the owner opting in, and nothing lands in the world uncurated. It adds no mechanics — the
artificer server owns model selection, dimensions, cutout, and file conventions; molten5e owns
delivery (`upload-asset`, `set-actor-art`, `add-journal-image`).

Tools used: `artificer-status`, `generate-image`, `edit-image`, `cutout-image` (artificer);
`manage-actors` `get`, `search-journals`, `manage-journals` (`list` / `get`), `manage-scenes` (`list`), `list-assets`, `download-asset`,
`upload-asset`, `set-actor-art`, `add-journal-image` (molten5e).

## Step 0 — Pin the subject and the destination

Two questions before anything renders: **what is this a picture of**, and **where does it live**?
The destination picks the `kind`, and the kind picks the model tier:

| destination | kind | tier |
| --- | --- | --- |
| item / spell / feature icon | `icon` | flash |
| actor token (top-down, cut to alpha automatically) | `token` | flash |
| actor sheet portrait | `portrait` | flash; mention Pro is available for a bit extra |
| journal image page / player handout / location splash | `illustration` | flash; mention Pro is available for a bit extra |

There is no map kind. Battlemaps are bought as UVTT packs; never try to generate one.

If the user named a subject that exists in the world (an NPC, a location with a journal, an
item), the next two steps are **mandatory** — never prompt from imagination for a named subject.

## Step 1 — Ground the prompt in canon

Pull the authoritative description before writing a word of prompt:

- **Actors**: `manage-actors` `get` — bio, race/species, gender, age, class, notable gear. The stat block is
  canon for props (a bandit statted with a crossbow gets a crossbow, whatever looks cooler).
- **Items**: the item's description and type. An icon of a "rusted iron key" is a rusted iron key,
  not a generic key.
- **Locations / events**: `search-journals` for the subject name; scene notes; quest journals.
- **Campaign repo** (when working in it): `notes/`, `plot/`, `sessions/` often carry richer
  description than the world does.
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
appearance. One PC's bio never mentions his hair; four generations shipped an invented brown
before his token settled it as white hair, a full white beard and a green-crystal staff. Tokens live at
`%LOCALAPPDATA%/FoundryVTT/Data/worlds/<world>/assets/tokens/<name>.png` — the path is in the
actor's `prototypeToken.texture.src`. Open it before writing a word of prompt.

## Step 2 — Study precedent, then attach it as references

All campaign art should feel like one book. On this backend that is done with **reference
images**, not with words alone and not with trained weights.

**The campaign's reference shelf lives in the campaign repo, at `art/SHELF.md`, not in this
skill.** Read it first, every time. It records the approved identity anchors (one file per PC
with the binding phrase to use in the prompt), the standing style shelf, which older files are
superseded and must never be attached, the house finish words, and the staging path. This skill
is generic; the shelf is what makes it one campaign's. If the repo has no `art/SHELF.md` yet,
build the shelf from the `art/` folder and the world's assets as below, then propose committing
one so the next session does not have to.

- `list-assets` on `worlds/<world>/assets/art`. Read the filenames: the `<kind>-<slug>-<id>`
  convention tells you what exists and for whom.
- `download-asset` (or read the campaign repo copies) of the 2–3 pieces closest in subject, and
  **look at them**: palette, rendering style, framing, lighting mood.
- For actor art this is a **hard gate**: when the actor has existing art (`hasImage`), get the
  actual file (`manage-actors` `export` → `img` / `prototypeToken.texture.src` → `download-asset`) and
  **Read it** before writing the prompt. Backstories rarely state appearance facts the art
  settles. One canon orc has bone-white skin his backstory never mentions; the first portrait
  shipped green. Keep continuity with the existing art unless the user asks for a redesign.

**Two kinds of reference, passed as `references: [{ path, role, label }]`.** The tool attaches
them in order and writes a preamble that binds each one by its 1-based index and label, so your
prompt can simply say the character's name and be understood:

- **Character references** hold identity. Both tiers take them (Flash up to 4 characters, Pro up
  to 5). Bind each one with an unmistakable prompt phrase so the model knows which figure is
  which.
- **Style references** hold the house look. The docs say Pro only, up to 3, but they work on
  Flash in practice (spike 2026-09-19; the whole 2026-09-19 batch was Flash and held the look).
  Attach the standing style shelf (from `art/SHELF.md`) on every portrait and illustration
  call unless the owner asks for something deliberately different.
- **Tokens take the world's own tokens as the style reference.** They are top-down full-body
  figures on transparency (`assets/tokens/<name>.png` in the world data). Attach one as
  `role: "style"` and the new token comes out at the same angle and in the same ink-lined look.
  The tool appends the framing and the chroma plate sentence itself, picks a plate colour the
  subject will not share (it samples the references AND reads the prompt for colour words, so a
  green dragon prompted against a grey token gets a magenta plate), cuts the result to alpha on
  a 512 square, and keeps the plate PNG beside it. Read the `*_preview.png` it reports before
  trusting the edge.

**House finish words come from the shelf too.** With style references attached, words reinforce
the images; they are not a substitute for them. One lesson holds everywhere: "gleaming" invites a
glossy studio sheen; describe armor as `worn … with a soft dull sheen` instead.

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
- **The garment NOUN overrides any clause describing it** (proven 2026-08-28, an elf archer's sleeves). A
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
2. **Flash by default, Pro on request (owner rule 2026-09-19).** Every kind runs on Flash
   with no confirm. When the owner asks for a portrait or an illustration, say once, in one
   line, that Pro is available for a bit extra (about double: 13 cents at 2K, 24 cents at 4K)
   and carry on with Flash unless they take it. Pro earns its cost on crowded multi-figure
   scenes and text-heavy handouts; it is not a better fixer. `tier: "pro"` needs
   `confirmPro: true`, which you pass only after the owner said yes.
3. `generate-image` with the canon prompt and the references. Two or three candidates for
   portraits and illustrations, one for icons and tokens (they one-shot well; re-roll on a miss).
   Every result reports `estimatedUsd` and `sessionEstimatedUsd`; `artificer-status` totals by
   tier. The API has no balance call, so these are estimates from the price table.
4. **Read every PNG, twice.** First against canon, not against "is it pretty": wrong gender,
   wrong species, wrong props, wrong mood are **rejections** even on beautiful renders. Then
   **the flaw pass (owner rule 2026-09-19)**: scan the image deliberately for the defects these
   models make and a viewer spots instantly. Count them out loud in your head:
   - **Limbs and digits**: legs per creature (a peryton has two; a wolf four), arms per figure,
     fingers on visible hands, feet that touch the ground.
   - **Duplicated effects and props**: one spell, one effect. A stray second fireball, a floating
     extra weapon, a second bow, a sword with two hilts.
   - **Faces and identity**: every referenced character present once, no reference face on an
     NPC, no twin of a party member in the background.
   - **Signatures and text**: scribbles in a corner, lettering on banners, watermark-like marks.
   - **Objects that make no sense**: a shield strap to nothing, a staff passing through a body,
     a reflection that does not match.
   If any of these is **obvious**, it goes through `edit-image` in one instruction that names
   every flaw precisely and ends with "keep everything else identical", then gets Read again.
   Two edit passes at most; if the third read still shows it, re-generate instead. **Name the
   flaw anatomically, not by count.** "Every peryton must have exactly two legs" failed twice,
   once on Pro; "delete the rear pair of legs trailing behind its front talons, leaving two bird
   legs and a feathered tail" worked first time on Flash. Pro is not a better fixer, and it
   re-cropped the image (2026-09-19); stay on Flash for edits and say precisely what to remove. Subtle
   softness is not a flaw; an extra leg is. **The pass is mandatory every time; the edit is
   not.** A render with no obvious flaw is finished. Do not touch it to make it "better";
   every edit re-rolls the pixels and can introduce a new flaw.
5. **Edit before re-rolling.** A candidate that is right on canon but wrong on one detail goes
   through `edit-image` with a single instruction ("swap the sword for a hand axe", "make the
   cloak forest green"). Edits default to Flash for every kind and hold identity, pose, angle,
   and style (an orc token took new plate armour and a crackling maul in one pass). Re-generate
   only when the composition or the identity is wrong. Editing an existing WORLD token is the
   normal way to change a PC's gear: source the token file, describe the change, and the result
   is already cut. **Write token edits the way the owner types in the Gemini app**: one plain
   sentence ("give this elf a sword and armor instead"), no "keep everything identical", no
   angle or background words. The tool adds a keep-face/hair/angle line and a plate keyed to
   the token's colours; a light prompt beat the strict wording in the elf A/B (2026-09-24).
6. **Self-review is mandatory before showing portrait or illustration art** (owner rules
   2026-08-26 and 2026-09-19): generate → Read (canon, then the flaw pass) → edit or re-generate
   → Read again. Never show a render whose flaw pass you skipped; the owner found a second
   fireball and a four-legged peryton in a scene that had been shown as finished. Show the owner
   only the best surviving render, with a one-line note of what was fixed or rejected on the
   way. Icons and tokens skip the canon critique but not the flaw pass (limb count, symmetry,
   a clean silhouette).
7. Show the user the final (send the file) before or as it lands in the world.

## Step 5 — Stage locally; Foundry only after approval

**Nothing goes to Foundry uncurated by the owner.** Finals land in the campaign repo's staging
area first:

- Copy the finished PNG to `<campaign repo>\art\staging\<kind>-<slug>-<id>.png`. The absolute
  path is in the campaign's `art/SHELF.md`.
- Show the user the file and **stop there by default**. Uploading to the live world
  (`upload-asset`) and wiring (`set-actor-art`, `add-journal-image`) happen only when the owner
  approves — then the file also graduates from `art\staging\` to `art\`.
- Pass `creatureSize` from the actor's traits on every token call (large/huge/gargantuan
  deliver 1024; the rest 512). Tokens arrive already cut to alpha, shadowless (owner rule 2026-09-24: no
  shadows on tokens; the prompt tells the model to drop a baked one). Read the magenta preview
  the cutout wrote before trusting the edge. For a token from anywhere else, `cutout-image`
  does the same cut. Restyling a world token ("give this an updated painterly style") is an
  ordinary token edit: point `sourceImage` at the file wherever it lives.
  Installing a token in the world (upload, `set-actor-art`, resetting the inherited prototype
  scale/ring/rotation) follows the molten5e `token-cutout` skill, which now holds only that half.
- If canon details were invented in Step 1, offer to write them back into the actor bio/journal so
  the art and the text agree forever after.
