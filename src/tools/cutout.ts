// cutout-image — knock a token's background out to alpha on a Foundry-ready 512 square. For
// renders from this server the token kind already did this; the tool exists for images from
// anywhere else (a bought pack, a hand-drawn plate, an old JPEG token).

import * as path from 'node:path';
import { z } from 'zod';
import { CHROMA_KEYS } from '../chroma.js';
import { toInputSchema } from '../utils/schema.js';
import type { ToolDeps } from './shared.js';

const cutoutSchema = z.object({
  sourceImage: z.string().min(1).describe('Absolute path of the image to cut (PNG/JPEG/WebP).'),
  output: z
    .string()
    .optional()
    .describe('Absolute output path (.png). Default: next to the source as <name>-cut.png.'),
  method: z
    .enum(['auto', 'chroma', 'rembg'])
    .optional()
    .describe(
      'auto (default): chroma if the plate is a flat key colour, with a rembg fallback when the ' +
        'cut fails verification. chroma: flat green/blue/magenta/solid plates, instant. rembg: AI ' +
        'matte for busy backgrounds, hair, and soft edges (first use downloads a ~176 MB model).'
    ),
  color: z
    .string()
    .optional()
    .describe(
      'Chroma key colour: "green", "magenta", "blue", or #RRGGBB. Omit to sample the corners.'
    ),
  keepShadow: z.boolean().optional().describe('chroma only: keep a cast shadow on the plate.'),
  erode: z
    .number()
    .int()
    .min(0)
    .max(8)
    .optional()
    .describe('Shrink the matte N px to eat a fringe.'),
  size: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Square canvas edge; default 512 (Foundry scale 1.0). 0 keeps the source canvas.'),
  padPct: z.number().min(0).max(30).optional().describe('Transparent margin, % of the edge (4).'),
  trim: z
    .boolean()
    .optional()
    .describe('Tighten to the subject before fitting (default true); false letterboxes as-is.'),
});

export class CutoutImageTool {
  constructor(private readonly deps: ToolDeps) {}

  getToolDefinitions() {
    return [
      {
        name: 'cutout-image',
        description:
          'Knock the background off a token image to real alpha and deliver it centred on a ' +
          '512 square so Foundry scale 1.0 is right. Writes a magenta-composited *_preview.png ' +
          'beside it: READ THAT before trusting the edge. Returns coverage and residual-key ' +
          'numbers; a cut outside sane coverage falls back to the rembg AI matte automatically.',
        inputSchema: toInputSchema(cutoutSchema),
      },
    ];
  }

  async handleCutoutImage(args: unknown) {
    const p = cutoutSchema.parse(args);
    const output =
      p.output ??
      path.join(
        path.dirname(p.sourceImage),
        `${path.basename(p.sourceImage).replace(/\.[^.]+$/, '')}-cut.png`
      );
    if (path.resolve(output) === path.resolve(p.sourceImage)) {
      throw new Error('output must differ from the source image');
    }
    if (p.color && !(p.color in CHROMA_KEYS) && !/^#?[0-9a-fA-F]{6}$/.test(p.color)) {
      throw new Error('color must be green, magenta, blue, or #RRGGBB');
    }
    return this.deps.cutout({
      input: p.sourceImage,
      output,
      method: p.method ?? 'auto',
      ...(p.color ? { color: p.color } : {}),
      ...(p.keepShadow ? { keepShadow: true } : {}),
      ...(p.erode !== undefined ? { erode: p.erode } : {}),
      ...(p.size !== undefined ? { size: p.size } : {}),
      ...(p.padPct !== undefined ? { padPct: p.padPct } : {}),
      ...(p.trim !== undefined ? { trim: p.trim } : {}),
    });
  }
}
