// generate-image — the workhorse. Speaks Foundry vocabulary (kind + prompt + slug), never raw
// dimensions or model ids. Style and framing text the preset owns is appended for the caller.

import { z } from 'zod';
import { toInputSchema } from '../utils/schema.js';
import { nearestAspect, PRESETS, PROP_CELL_PX, parseFootprint } from '../presets.js';
import {
  confirmProSchema,
  creatureSizeSchema,
  kindSchema,
  loadImage,
  referencePreamble,
  referenceSchema,
  render,
  resolveTier,
  tierSchema,
  type ToolDeps,
} from './shared.js';

const generateImageSchema = z.object({
  kind: kindSchema,
  prompt: z
    .string()
    .min(1)
    .describe(
      'What a camera would see, in illustrator terms. Do not add framing or background text for ' +
        'icons and tokens; the preset appends it.'
    ),
  slug: z.string().min(1).describe('Kebab-cased into the filename: <kind>-<slug>-<id>.png.'),
  references: z
    .array(referenceSchema)
    .max(14)
    .optional()
    .describe(
      'Reference images, attached in this order. Bind each in the prompt by its label or ' +
        '1-based index ("Image 2 is Morgash").'
    ),
  tier: tierSchema,
  confirmPro: confirmProSchema,
  creatureSize: creatureSizeSchema,
  footprint: z
    .string()
    .regex(/^\d{1,2}x\d{1,2}$/i)
    .optional()
    .describe(
      'Props only: grid cells wide x tall, e.g. "2x1" for a table (default "1x1"). The prop is ' +
        'rendered at the nearest API aspect and delivered at 300 px per cell (600x300 here). ' +
        'Library files carry it in their name: "TC_Anvil 02_2x1.png".'
    ),
});

export class GenerateImageTool {
  constructor(private readonly deps: ToolDeps) {}

  getToolDefinitions() {
    return [
      {
        name: 'generate-image',
        description:
          'Generate one Foundry art asset from a prompt via the Gemini image API. kind picks ' +
          'the model tier, aspect, size, framing text, and post-processing; the result is a ' +
          'finished PNG on disk. READ IT before showing anyone: count limbs per creature, ' +
          'check for duplicated spell effects or props, stray signatures, and reference faces ' +
          'on the wrong figure; obvious flaws are one edit-image call away. Every kind runs ' +
          'on flash by default; tier: "pro" refuses without confirmPro: true and states the cost. ' +
          'Returns the file path, dimensions, and estimated spend.',
        inputSchema: toInputSchema(generateImageSchema),
      },
    ];
  }

  async handleGenerateImage(args: unknown) {
    const p = generateImageSchema.parse(args);
    const tier = resolveTier(p.kind, p.tier, p.confirmPro);
    const refs = p.references ?? [];
    const images = refs.map(r => loadImage(r.path));
    // A pose reference carries the camera angle; the token framing's "face tilts up toward the
    // viewer" fought it and turned beasts to face the camera (bear, hound, troll, 2026-09-24).
    const posed = p.kind === 'token' && refs.some(r => r.role === 'pose');
    const suffix = posed ? '' : PRESETS[p.kind].suffix;
    const fp = p.kind === 'prop' ? parseFootprint(p.footprint ?? '1x1') : undefined;
    const prompt = `${referencePreamble(refs)}${p.prompt.trim()}${suffix ? ` ${suffix}` : ''}`;
    return render(this.deps, {
      tool: 'generate-image',
      kind: p.kind,
      tier,
      prompt,
      images,
      slug: p.slug,
      ...(p.creatureSize ? { creatureSize: p.creatureSize } : {}),
      ...(fp
        ? {
            aspect: nearestAspect(fp.w / fp.h),
            canvas: { width: fp.w * PROP_CELL_PX, height: fp.h * PROP_CELL_PX },
          }
        : {}),
    });
  }
}
