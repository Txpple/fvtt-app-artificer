# House-style LoRA — build log (started 2026-08-26)

Goal: one house art style across campaigns, trained on the owner's own 2024 D&D books.
Personal use only; the trained LoRA and the training corpus stay off the public repo.

## Decision: FLUX.1-dev, not FLUX.2-dev

FLUX.2-dev is 32B — its transformer alone is ~30 GB at fp8 and the Mistral-3 text encoder is
another ~24 GB. They cannot coexist on one 32 GB card: peak transient is 32.94 GB against the
5090's 31.84 GB usable, so Windows pages through system RAM and the step rate collapses to
**277 s/it** (a 400-step run takes 30+ hours; our ~3000-step style run would take ~10 days).
See github.com/genno-whittlery/flux2-dual-gpu-lora, which exists specifically to work around this.

FLUX.1-dev (12B) trains comfortably on the 5090 and is what ai-toolkit actually ships configs for
(`train_lora_flux_24gb.yaml`; there is **no** FLUX.2 example config).

Trade-off accepted: the LoRA applies to `final` + `refine` modes, not `scene` mode. That is fine —
`final` currently has *no* style mechanism at all (it renders from the prompt alone), and a style
LoRA also turns low-denoise `refine` into the style-unification pass the owner asked for. `scene`
mode keeps using reference anchoring (Morgash + Gren as refs 2–3), which is already proven.

If scene-mode style is wanted later: rent an 80 GB card for an afternoon, train there, run the
resulting LoRA locally (inference already streams the 35.5 GB fp8 checkpoint fine).

## Corpus (133 images) — `~/Desktop/lora-corpus-dnd2024/prepared/`

PHB 65 · MM 36 · DMG 18 · Heroes of Faerûn 14. Ravenloft deliberately skipped (horror art
direction). PHB-led on purpose: small-corpus LoRAs leak *content* along with style, and we want
the leak to be humanoids-in-gear, not monster scales.

**Only `assets/journal-art/` is usable.** The `portraits/` and `subjects/` directories in every
book module are token cutouts floating on white — no background, no composition, useless for style.

Three prep steps, all necessary (see the artifacts they remove):

1. **Alpha margins** — 69 of 139 plates ship with transparent feathered edges. Cropped to the
   opaque bounding box, then composited on white.
2. **Gold frames** — 35 plates (subclass/domain singles, some MM group plates) have a decorative
   gold border. Detected by locating the gold rule via a colour mask and row/column hit counts,
   then cropped to its interior. Left in, these teach the model to paint plate borders around
   everything — the training-data twin of the cookbook's "never say book art / cover / poster" rule.
3. **White-heavy vignettes** — 6 plates were figures floating on page white with no croppable
   margin. Moved to `excluded/`.

Captions are `.txt` alongside each image. **All 133 were written by looking at the image** — a
first filename-derived pass was scrapped because it under-described.

The rule that matters: captions describe **content only** (species, figure count, gear, setting,
action) and deliberately say nothing about lighting, mood, palette, or brushwork. Anything named in
a caption is attributed to those words instead of to the trigger, so the style has to stay
*undescribed* in order to land on `dnd24art`. Subject-intrinsic colour ("green robes", "a red
dragon", "bone-white skin") is content and stays; image-level colour ("bathed in golden light") is
style and is banned.

Why the filename pass was not good enough: 114 of 133 captions were three-to-nine words naming only
a class or concept, so every undescribed detail leaked into the trigger. `phb-oath-of-vengeance`
was captioned "a paladin, oath of vengeance" for a plate that actually shows *a green dragonborn in
dark red-gemmed plate with a spectral blue dragon rising behind* — all of which was being taught to
`dnd24art`. Looking at the images also caught filenames that simply lie: `mm-ghouls` shows one
ghoul, `dmg-npc-healer` shows a spellcaster over a stone slab and no patient, `hof-white-worm` is a
winged dragon, and `phb-barbarian` / `mm-ogres` / `phb-eldritch-knight` are cropped too tightly to
determine species.

Final state: min 4 words, median 20, mean 19; zero sparse captions, zero style-word leaks.

## Environment

- Trainer: `D:\Workbench\LOCAL\LocalAI\ai-toolkit` (ostris/ai-toolkit), venv at `ai-toolkit\venv`.
- Base weights: `black-forest-labs/FLUX.1-dev`, diffusers format, ~32 GB, in the HF cache.
  License-gated: the owner accepted the FLUX.1-dev Non-Commercial License and ran `hf auth login`
  themselves (weights are non-commercial; **outputs** are explicitly fine for personal and
  commercial use).
- Rebuild with `setup-venv.sh`.

### Install gotchas (both cost a full failed run)

- **Never use uv-managed CPython here** — Windows Application Control blocks its `_ctypes` DLL.
  Use `py -3.13 -m venv`. Same policy breaks `uv tool install` console-script trampolines.
- `scipy==1.12.0` (pinned in `requirements.txt`) has no cp313 wheel and tries to compile. Install
  `requirements_base.txt` plus `scipy>=1.14` instead.
- `torchaudio` is imported by `toolkit/config_modules.py` but is not in the requirements; install it
  from the same cu128 index as torch.

## Runtime notes

- **Stop ComfyUI before training** — it holds ~23.8 GB of VRAM. `artificer-status` shows the queue;
  relaunch with `scripts/launch-comfyui.ps1`.
- Desktop cost with the single 4K monitor on the 5090 is only ~1 GB, leaving ~30.4 GB.

## Benchmark results (2026-08-26, RTX 5090, rank 32, batch 1, 1024/768/512 buckets)

| | bf16 (`quantize: false`) | fp8 (`quantize: true`) |
| --- | --- | --- |
| Peak VRAM | 32,024 MiB / 32,607 (98%) | **23,108 MiB (71%)** |
| Step time | 10.5–12.2 s/it | **1.65–2.21 s/it** |
| 4,000 steps | ~12 h | **~2.4 h** |

**fp8 wins outright.** bf16 did not OOM, but only because Windows paged the overflow to system
RAM — the same thrash that rules out FLUX.2, just milder; that paging *is* the 5× slowdown.

Decisive extra argument: **inference is already fp8** (`final`/`refine` load
`flux1-dev-fp8.safetensors`). Training bf16 and deploying fp8 would be a train/inference precision
mismatch. fp8 training matches deployment, so it is the more correct choice here, not a compromise.

"Longer and better" therefore gets spent on **more steps and variant comparison** rather than on
precision — a well-tuned fp8 LoRA beats one blind mistuned bf16 run.

## Overnight plan (~8 h, sequential, `run-overnight.sh`)

| Run | Steps | LR | Rank |
| --- | --- | --- | --- |
| A | 4000 | 1e-4 | 32 |
| B | 5000 | 5e-5 | 32 |
| C | 4000 | 1e-4 | 64 |

Checkpoints every 500 steps are kept, so step-count comparison is free — no variant needed for it;
the runs vary only what checkpoints cannot give us (LR and rank). Each run also samples 5 images
every 500 steps using real campaign subjects (Morgash's tusks, Gren's silver-white spellfire, the
autumn temple, a firelit hobgoblin cave, Thomas's sunburst shield), so curation in the morning is
visual — same as every other judgement call in this pipeline.

**Stop ComfyUI before launching** and leave it down for the duration.

Run C was swapped mid-night from rank 64 to **rank 16** on the evidence below (leak is the failure
mode, so less capacity is the informative experiment, not more). Its config *filename* still says
`r64` — deliberate: the runner is a live bash process that reads itself as it executes, so only the
file contents were changed. Output folder reads `dnd24art-C-lr1e4-r16`.

## Run A findings (lr 1e-4, rank 32, 4000 steps — 2h21m, 8 ckpts @ 327 MB, 45 samples)

The style transferred: crisp confident linework, saturated colour, worn metal with real surface
damage — recognisably the 2024 sourcebook look rather than generic FLUX.

Three defects, all pointing the same way (**the LoRA applies too strongly**):

1. **Parchment leak.** Prompts that do NOT name a background collapse to a flat page-coloured field,
   sometimes with a border edge, and a signature artifact at ~1000 steps. Cause: compositing the 69
   transparent-margin plates onto **white** during prep. Cropping tighter, or onto neutral grey,
   would have been better — fix this at the data level before any retrain.
   **Not fatal:** prompts that DO name a setting render full environments (the ruined-temple and
   misty-forest samples both did). The house portrait spec always names a background, so this is
   mostly self-mitigating.
2. **Overrides prompt content** — ignored "bone-white skin" (came out tan) and produced upward
   walrus tusks (the cookbook's known "tusk is a trap word" failure).
3. **Cartooning on faces** (owner's read), and one sample looked "like a bad meshy AI model".

**Do not judge faces from the sample grid.** Samples are 20-step, guidance 4, 1024px previews with
no upscale — a preview setting that punishes faces specifically while flattering landscapes. Also,
"elderly wizard casting magic" is an enormous base-model attractor, so FLUX's own prior may be what
shows through there rather than the LoRA.

**Morning evaluation must be done through the real pipeline**, not the previews: render the
candidate through `final` mode at full steps + the upscale tail, at several LoRA strengths, and put
it beside the already-approved staged portraits. Three dials to search, not one: **which run ×
which checkpoint depth × what LoRA strength** (strength is continuous at inference — an
over-cartooning LoRA at 1.0 is often correct at 0.6–0.7, so a "too strong" checkpoint is not
disqualified).

It is fine for this to lose. Reference anchoring (Morgash + Gren as refs 2–3) already works.

## Run B findings (lr 5e-5, rank 32, 5000 steps — 2h57m) — NULL RESULT

Halving the learning rate **fixed essentially nothing**. At 5000 steps the Morgash prompt still
produced tan skin (not the prompted bone-white), a parchment field with a page border, walrus
tusks, and a watermark in the lower-left. The paladin prompt was still smooth airbrushed
digital art with a flat gold disc instead of a sunburst on blue.

**Conclusion: the defects are in the CORPUS, not the hyperparameters.** Two runs three-quarters of
an order of magnitude apart in learning rate produced the same artifacts, which is what you would
expect if the model is faithfully reproducing what it was shown.

The three artifacts and their almost certain data causes:

| Artifact | Cause in the corpus |
| --- | --- |
| Parchment field + page border | plates on page-white; surviving frames the deframer missed (e.g. `phb-abjurer`, where art breaking out of the frame defeated the gold-rule detection) |
| **Fake signatures and watermarks** (e.g. "@wrlinse2a.com") | published plates carrying artist marks — **never filtered for at all** |
| Canon overridden (bone-white ignored) | style layer applying too strongly over prompt content |

### Action: the corpus needs rebuilding, not retuning

Owner is hand-picking ~100 from the full pool, copied to `Z:\Shared\TableArt` (858 journal-art
plates in `01-journal-art`, plus cutouts/tokens/icons; `_claude-picked-133` holds the current set
with captions for reference). Rejection criteria, all three learned the hard way:

1. no visible frame or border
2. **no artist signature or watermark**
3. no white/parchment page background

Then re-prep (crop to art interior, do **not** composite margins onto white) and re-caption.
One retrain is only ~2.4 h now that everything is installed.

## Run C findings (lr 1e-4, **rank 16**, 4000 steps — 2h20m, 8 ckpts @ 164 MB) — BEST OF THE THREE

Swapping C from rank 64 to rank 16 paid off, and in the direction predicted: **less capacity means
less memorisation of artifacts.**

Versus A and B at comparable depth:
- skin noticeably **paler** (closer to the prompted bone-white, though still not there)
- tusks **smaller and integrated**, not walrus ivory
- **no visible watermark** on the samples checked
- paladin finally rendered a real architectural background and a proper rayed sunburst shield
  instead of a flat gold disc on a blur

Still unfixed: the **parchment field + page border** on portrait prompts. That artifact survives
every hyperparameter change, which fits — it is present in a large share of the plates, so even a
low-rank LoRA learns it. It is a data problem and only a data fix will remove it.

### Overnight ranking

| Run | Rank | LR | Verdict |
| --- | --- | --- | --- |
| **C** | 16 | 1e-4 | **best** — fewest artifacts, best prompt adherence |
| A | 32 | 1e-4 | watermarks, walrus tusks, tan skin, worst paladin |
| B | 32 | 5e-5 | null result — identical to A despite half the LR |

Two implications: **rank is the lever that matters here, not learning rate**, and going lower still
(rank 8) is worth testing on the rebuilt corpus. Total wall clock 7h38m for all three
(A 2h21m, B 2h57m, C 2h20m), all at ~2 s/it, no OOM or crash.

### Note on sample prompts — my error, not the model's

The five sample prompts omitted gender, violating the cookbook's own first rule ("say the identity
outright"). The paladin rendered female because the prompt never said male. Do not read that as a
LoRA defect; the *rendering* faults in that image are real, the gender is not.
