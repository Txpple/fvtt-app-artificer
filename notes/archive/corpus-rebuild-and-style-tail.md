# Corpus rebuild + the universal style tail (2026-08-27)

## The corpus rebuild (owner-led)

The 133-plate corpus was four art directions wearing one trigger word — Elmore-adjacent oil,
pastel storybook, airbrushed digital, comic whimsy — and the LoRA learned the blur. The owner
hand-picked 65 from the 858-plate pool; joint review cut it to **46** (comic/whimsical plates,
book covers, a rules diagram, an undersized plate, pastel outliers, and two per-plate calls).

- **Canonical location: `D:\Workbench\LOCAL\LocalAI\lora-corpus-dnd24art\prepared\`** (46 PNG +
  46 caption .txt). The Desktop working folders and `Z:\Shared\TableArt` are gone — this is the
  only copy. The old Desktop corpus path in configs A–C is dead.
- **12 artist signatures found** (11 by corner-sheet review + `phb-ranger` caught by the owner).
  All sat in the bottom ~3%, so every plate carries a blanket **8% bottom crop**. Detection was
  tried and rejected: a validated detector caught 12/12 knowns only at a threshold that flags
  half the corpus on foliage texture — recall yes, precision no. The crop is the guard.
- Captions written **from the images** (median 54 words, no style words — content only, so the
  undescribed style lands on the `dnd24art` trigger). The tighter corpus is what makes that
  caption strategy work: the undescribed remainder is finally consistent.
- Known residual skews: **dark** (mean lum 0.31; only ~4 daylight plates — expect the LoRA to
  fight daylight prompts), **magical-glow key light** (~15 plates — expect added glow), zero
  square-aspect plates. Fix by backfilling bright/richly-painted plates if it bites.
- Honest scope: this corpus buys "serious dramatic 2024-sourcebook," not actual Elmore.
  `dragonlance-inn` is the only true warm-oil plate. Real Elmore needs older-book scans.

## Overnight rank sweep D + E + F (`training/run-overnight.sh`, ~7 h)

**Runs A–C are void.** The owner's verdict on the 133-plate corpus is that it was plain bad, so
those checkpoints are not baselines and not comparison points. Nothing from them transfers —
including "rank is the lever," which was measured on that corpus. This sweep therefore assumes
**no rank prior at all** and brackets the space.

| Run | Rank | LR | Steps | Alpha |
| --- | --- | --- | --- | --- |
| D | 8 | 1e-4 | 4000 | 8 |
| E | 16 | 1e-4 | 4000 | 16 |
| F | 32 | 1e-4 | 4000 | 32 |

Everything except rank is held fixed. `alpha == rank` in all three, so the effective LoRA scale
is 1.0 regardless of rank and the LR means the same thing across runs — without that, a rank
comparison silently becomes a rank-and-LR comparison.

- **~2.0 s/it measured** ⇒ ~2h15m per run, ~7 h total. (The "2.9 s/it" in an earlier note was an
  instantaneous tqdm reading, not the average — there is no speed regression.)
- **Checkpoints every 500 steps** ⇒ 8 selection points per run, 24 candidate LoRAs overall. This
  matters more than usual here: 46 images × 4000 steps is **~87 epochs**, against ~30 on the old
  corpus. The final checkpoint may well be overfit and an earlier one may win, so the sweep is
  really rank × steps, and the step axis is free.
- Sample prompts state gender outright (the run-C lesson). Samples are 20-step and **must not be
  used for judgment** — they exist only to catch a collapsed run early.
- **Stop ComfyUI first** (~24 GB VRAM).
- **Delete or rename stale `output/dnd24art-*` dirs before launching.** ai-toolkit resumes from a
  leftover checkpoint rather than starting fresh; the aborted 20:08 run left a step-500
  checkpoint + `optimizer.pt` that would have silently made run D a resume. The runner now skips
  any config whose output dir already exists rather than doing that quietly.

## The universal style tail (v0.4.0 — shipped, restart pending)

Problem: the LoRA is FLUX.1-only; `draft`/`scene` are FLUX.2 — the weights cannot load there.
Fix: **every mode can end with a FLUX.1-dev low-denoise refine pass carrying the LoRA.**

- `workflows/final-lora.json` — final + `LoraLoaderModelOnly` (proven verbatim, 18 s).
- `workflows/final-refine-lora.json` — refine + LoRA + **input normalize to gen dims** (node 13,
  so finished 2560×1600 scene output re-samples at composition res, not 4 MP). Proven verbatim.
- `generate-image` gains `lora` + `loraStrength` (final/refine only, guarded), refine `denoise`
  floor lowered 0.3 → 0.1. Styling scene output = mode `refine` + `lora` + denoise 0.25–0.4
  over the finished render. **Schema change ⇒ owner must restart Claude Code.**

### Spike evidence (run-C LoRA over the approved displacer-alpha scene render)

Four tail passes (control / d0.25 s1.0 / d0.35 s1.0 / d0.35 s0.7), ~20 s each: composition
pixel-faithful, Thomas's face recognizably him at every setting, LoRA pass reads warmer/more
painted than control. Mechanism validated; judgment on style strength waits for the D/E LoRAs.
Not yet tested: nonhuman faces through the tail (Morgash's tusks — cookbook says dev img2img
humanizes; test at 0.25 before trusting it on him).

## Status change (owner, later this same day)

**No approved images exist anywhere.** The five staged portraits survive only as
backup/reference (identity refs for scene conditioning); every staged handout was deleted from
the campaign repo. Campaign art restarts from zero once the D/E LoRA + style tail are validated.

## WDAC blocks bitsandbytes (2026-08-27 evening)

Runs D/E both crashed at import: `OSError: [WinError 4551] An Application Control policy has
blocked this file` on the bitsandbytes native DLL. New since runs A–C, which used the same
`adamw8bit` setting successfully — this is a **machine policy change, not a code regression**
(same family as the uv-CPython `_ctypes` block already in memory). Fix: `optimizer: adamw` in
both configs (commit `a80bd54`).

What it actually costs — measured, not guessed:

- **Quality: nothing.** fp32 AdamW is the exact version; `adamw8bit` is the quantized
  approximation of it.
- **VRAM: ~260 MB (rank 8) / ~500 MB (rank 16).** Run C's rank-16 LoRA is 172 MB bf16 ⇒ ~86 M
  trainable params; two fp32 optimizer states = ~690 MB vs ~172 MB at 8-bit (C's `optimizer.pt`
  was 175 MB, which confirms the arithmetic). **The `a80bd54` commit message says "a few MB" —
  that is wrong by ~100×.** Irrelevant in practice: run D sits at 24.2 / 32.6 GB.
- **Speed: run D is ~2.9 s/it vs run C's ~2.1 s/it**, so D+E is ~6 h, not 4.8 h. Cause not
  isolated — could be fp32 optimizer memory traffic, could be different aspect buckets in the
  rebuilt corpus (8% bottom crop, no square plates). Do not attribute it without a test.
- **Model quantization is unaffected** — `quantize: true` still works, so ai-toolkit routes that
  through torchao/quanto rather than bitsandbytes.

## How to judge D/E/F tomorrow

**The comparison set is D, E, F and base FLUX.1 — nothing else.** A/B/C are out by owner
verdict, so the question is not "did the rebuild help" (that is settled by decree) but simply
**which rank, at which checkpoint, makes the best art on this corpus.**

- **D vs E vs F is a clean experiment.** Same corpus, optimizer, LR, steps, seed; rank is the
  only free variable, and `alpha == rank` keeps the LR comparable. Conclusions about rank drawn
  *within* this sweep are valid.
- **Always render a no-LoRA control** in the same batch. The run-A lesson was that half the
  "LoRA defects" (walrus tusks, watermarks) came from base FLUX and were only visible as such
  once a control existed.
- **Judge at final quality through the real pipeline** — `final` + the style tail, at the sizes
  the table actually uses. 20-step preview judging is banned (run-A lesson) and that includes
  the training samples.
- **Sweep the checkpoint axis, not just the final weights.** With ~87 epochs, expect the best
  result to be somewhere around 1500–2500 steps rather than 4000. Start at 2000 for each rank
  before assuming the final checkpoint is the candidate.
- Watch specifically for the corpus's known skews landing in output: **dark** (mean lum 0.31,
  only ~4 daylight plates — the "ruined open-air temple" sample prompt is the daylight probe)
  and **magical-glow key light** (~15 plates). If daylight scenes come out murky, that is the
  corpus, and the fix is backfilling bright plates rather than changing rank.
- Note for the record: run C's config is misnamed `-r64` but trained at rank 16. Irrelevant now
  that C is void, but do not let the filename seed a false "rank 64" memory.

## Open items

1. Owner deletes the Desktop working folders (confirmed safe; training copy is canonical).
2. ~~Tonight: run the sweep~~ — launched 2026-08-27 ~20:55, D→E→F, ETA ~04:00.
3. Tomorrow: pick rank/checkpoint/strength through the real pipeline (final + tail at several
   strengths, beside the reference portraits, with a no-LoRA control) — see the judging section.
4. Wire the winner's filename into the presets/skill; owner restarts Claude Code for the schema.
5. **A/B/C checkpoints are void** (bad corpus) and can be deleted whenever the owner wants the
   disk back — they are no longer keepsakes-until-beaten. Left in place for now; deleting is the
   owner's call.
6. The aborted-run dirs `output\dnd24art-{D,E}-*.aborted-20*` are junk from tonight's false
   starts; safe to delete.
