# Session handoff — 2026-08-28

Supersedes the 08-27 handoffs. Everything below is committed and verified.

## Done this session

**The house-style LoRA shipped.** Rank sweep D(8)/E(16)/F(32) on the rebuilt 46-plate corpus,
judged at final quality through the real pipeline against a no-LoRA control on four seeds.
Winner: **run F, rank 32, step 2000, strength 1.0**, installed as
`dnd24art-house-v1.safetensors` in ComfyUI `models\loras\`.

- **Step-2000 beats step-4000 in every rank** — 46 images x 4000 steps is ~87 epochs and the
  final checkpoints wash out into pale haze.
- Scenes are the clear win (light, depth, and better prompt adherence than base). Portraits
  improve more modestly.
- The dark-corpus worry is dead: a desert daylight probe stayed high-key at every strength.
- Watermarks and walrus tusks were **base FLUX defects**, seed-clustered, present in the
  control. Not the LoRA, not the corpus.
- **The style tail is validated on nonhuman faces**: refine + house-v1 at denoise 0.25–0.35
  preserves orc tusks and bone-white skin; the no-LoRA control humanized the same face. The
  LoRA is what protects the anatomy — never run the tail lora-less on a nonhuman.

**The four party portraits are approved, wired, and canon.** Gren, Morgash, Thomas, Jetten —
in `fvtt-campaign-greenrest\art\` and set on BOTH Foundry instances (portraits only,
`applyToToken: false`; tokens untouched). Gren's appearance is written into his bio.
The legacy portraits are deleted (recoverable from git history).

**Six cookbook rules earned across ~40 renders** are in the skill. The two that cost the most
time: **read the token art** (bios omit appearance — four generations shipped an invented
hair color) and **negation backfires** ("no beard" grows a beard; describe bare skin instead).

## State of the machine

- ComfyUI up on 127.0.0.1:8188. ai-toolkit venv intact; corpus at
  `LocalAI\lora-corpus-dnd24art\prepared\` (46 PNG + 46 captions).
- `ai-toolkit\output\` holds only the three valid runs (D/E/F). The void A/B/C checkpoints and
  aborted dirs were deleted — 8.4 GB freed.
- Bench/judging scratch scripts live in the session scratchpad only; nothing needed from them.

## Next up

**Queue is clear as of 2026-08-29.** All three items below are closed; nothing is pending in
this repo. The build is done and the loop works — pick up new work from the owner.

1. ~~Scene illustrations~~ — **in progress in a separate agent session**, not this repo's
   queue. The mechanics live in the skill: `scene` mode + portraits in `referenceImages` for
   identity, then the style tail for the house look (identity ≠ style; the LoRA is never
   trained on the party). Canonical reference shelf with per-PC binding phrases is in the skill.
2. ~~Jetten's stat block vs. portrait discrepancy~~ — resolved and done (owner, 2026-08-29).
3. ~~Bake the LoRA into the tool presets~~ — **closed, won't do** (2026-08-29). It looks like
   it would prevent forgetting the LoRA, but it can't: the real rule is conditional on the
   subject being nonhuman, which only the caller knows, so a preset default changes the default
   without adding enforcement. Costs are concrete — a code change plus an owner-performed Claude
   Code restart, the LoRA name/strength duplicated across `presets.ts` and `SKILL.md` free to
   drift, and the loss of the no-LoRA control (omitting `lora` is what made the rank-sweep
   judging possible, and is what a future house-v2 judging would need). Don't re-raise.

## Sharp edges

- **ComfyUI is shared across concurrent agent sessions.** A busy queue or VRAM in use is not
  evidence of a stale job — another session may be rendering. Never restart or kill ComfyUI to
  "clear" it without asking the owner first; you would destroy someone else's work in progress.
- **Inline image previews often don't reach the owner** — deliver finals with `SendUserFile`.
  Still Read them yourself first.
- **Three-pass self-review before showing art is mandatory** and was violated repeatedly this
  session; the owner had to curate my rejects. Generate → Read → critique → re-seed, then show
  ONE survivor with a note on what was rejected.
- bitsandbytes is blocked by Application Control (WinError 4551) ⇒ `optimizer: adamw`.
- Stopping a training wrapper does NOT kill the trainer python, and a stale `output/<run>/` dir
  makes ai-toolkit resume instead of restart.
