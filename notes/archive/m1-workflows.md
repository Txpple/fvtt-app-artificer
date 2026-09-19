# M1 workflow-pinning notes — 2026-08-26

All four pinned graphs proven by verbatim API submission; output dimensions byte-checked.
Contract in [workflows/README.md](../workflows/README.md).

## Timings (warm, RTX 5090, fp8 dev / klein 4-step)

| run | time |
| --- | --- |
| draft.json — klein batch 6 @ 1536×960 | 11.1 s (~1.9 s/image) |
| draft variant — klein batch 2 @ 1024×1280 or 1024×1024 | 4–6 s |
| final.json — dev 20-step @ 1536×960 + ×4 upscale + downsample to 2560×1600 | 19.2 s |
| final-refine.json — same tail over an uploaded draft | 19.2 s |
| upscale.json — upscale tail alone | 4.1 s |

## The draft→final composition test (decision: two final modes)

Seeds don't transfer klein→dev, so we tested re-render strategies over a picked draft:

- **Fresh txt2img** (`final.json`): best raw quality, zero composition control. Keep for
  "the prompt is the spec" renders.
- **img2img denoise 0.55**: clones the draft's composition almost exactly but *inherits klein's
  rendering style* — dev can't restyle at that strength. Rejected as default.
- **img2img denoise 0.7** (`final-refine.json`, pinned): keeps the draft's scene skeleton
  (masses, lighting, key elements) while re-rendering in dev's painterly style. **Element
  retention is stochastic** — a second 0.7 run kept the cove/moon/boats but dropped the figure —
  so refine guarantees the scene's bones, not every prop. `denoise` stays substitutable for the
  skill layer to tune per case.

## Prompt-craft traps found (for the future illustration-builder skill)

- **"adventure book art" summons book furniture**: klein painted gibberish title typography on
  2 of 6 drafts and a white plate-border on another. Dev adds small corner signatures on painterly
  prompts. Phrase style without naming the artifact ("fantasy illustration" alone was clean), or
  accept a crop/retouch pass.
- Klein's painterly texture at 4 steps is genuinely competitive — expect drafts to sometimes win
  curation outright and go straight to `upscale.json`.
- Token prompts at 1024×1024 with "centered, plain dark background" produce clean cutout-ready
  framing (klein gave full-body even when asked waist-up; acceptable — the token-cutout skill
  mattes whatever framing wins).

## Mechanics learned

- `LoadImage` only reads ComfyUI's input store — upload via `POST /upload/image` (multipart
  `image=@file`) and substitute the returned `name`. Submitting a graph with a missing input file
  fails **at validation time** with a clean `node_errors` payload — good early failure for the
  server to surface.
- `Flux2Scheduler` takes width/height (resolution-shifted sigmas) — draft substitution must write
  dims into **both** node 5 and node 8.
- History polling via `GET /history/<prompt_id>`; `status.status_str === 'success'` plus
  `outputs.*.images[].filename` is all the server needs.
