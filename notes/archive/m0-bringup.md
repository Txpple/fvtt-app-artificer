# M0 bring-up notes — 2026-08-26

Environment proven per [ROADMAP.md](../ROADMAP.md) M0. All exit-gate checks passed.

## Install

- **ComfyUI v0.34.0** portable (`ComfyUI_windows_portable_nvidia.7z`, 2.0 GB, GitHub
  Comfy-Org/ComfyUI releases) → `D:\Workbench\LOCAL\LocalAI\ComfyUI_windows_portable`
- Embedded Python 3.13.14, **torch 2.13.0+cu130** — `sm_120` in the arch list, RTX 5090
  detected, CUDA available. The Blackwell risk from the roadmap did not materialize.
- Headless launch: [`scripts/launch-comfyui.ps1`](../scripts/launch-comfyui.ps1) (deployed copy
  lives at `D:\Workbench\LOCAL\LocalAI\launch-comfyui.ps1`) — API mode on `127.0.0.1:8188`,
  `--disable-auto-launch`, outputs to `D:\Workbench\LOCAL\LocalAI\output`.

## Models (all owner-approved 2026-08-26, byte-verified against HF manifests)

| file | dir | bytes | source |
| --- | --- | --- | --- |
| `flux1-dev-fp8.safetensors` | `checkpoints/` | 17,246,524,772 | Comfy-Org/flux1-dev |
| `flux-2-klein-4b.safetensors` | `diffusion_models/` | 7,751,105,712 | Comfy-Org/vae-text-encorder-for-flux-klein-4b |
| `qwen_3_4b.safetensors` | `text_encoders/` | 8,044,982,048 | 〃 |
| `flux2-vae.safetensors` | `vae/` | 336,211,292 | 〃 |
| `4x-UltraSharp.safetensors` | `upscale_models/` | 66,864,028 | Kim2091/UltraSharp |

## Smoke renders (1536×960, the locked pre-upscale resolution)

- **klein** (4-step, euler, `Flux2Scheduler`): batch of 2 in **~5 s wall including first model
  load** — effectively ~1–2 s/image warm. Draft-batch economics confirmed.
- **dev fp8** (20-step, euler/simple, `FluxGuidance` 3.5, cfg 1.0): 1 image in **~18 s wall
  including first 17 GB checkpoint load** — warm renders will be well inside the 10–20 s target.
- VRAM after the dev render: **15.2 GB free of 32.6 GB** with dev resident — comfortable headroom
  for the upscale chain and a warm klein.
- Both renders visually verified (curation-by-reading works): coherent painterly forest-bridge
  scenes, on-prompt, correct resolution.

## Graph facts learned (feed into M1)

- FLUX.2-klein chain: `UNETLoader` + `CLIPLoader(type=flux2)` + `VAELoader(flux2-vae)` →
  `CLIPTextEncode` → `EmptyFlux2LatentImage` + `RandomNoise` + `KSamplerSelect(euler)` +
  `Flux2Scheduler(steps,width,height)` + `BasicGuider` → `SamplerCustomAdvanced` → `VAEDecode`.
  No negative conditioning (guidance-distilled).
- FLUX.1-dev all-in-one chain: `CheckpointLoaderSimple` → `CLIPTextEncode` ×2 →
  `FluxGuidance(3.5)` → `KSampler(cfg 1.0)` with `EmptySD3LatentImage`.
- `EmptyFlux2LatentImage` wants 16-px-divisible dims — 1536×960 fits; keep this constraint in
  mind when locking portrait/token preset sizes.
- dev fp8 renders showed a faint signature-like artifact in bottom corners at this prompt — watch
  during M1; usually prompt/seed-dependent.
