// edit-image — instruction-style editing of an existing asset: swap a weapon, recolor a cloak,
// add a scar. The source image is attached first; extra references may follow.

import { z } from 'zod';
import { toInputSchema } from '../utils/schema.js';
import { PRESETS } from '../presets.js';
import {
  confirmProSchema,
  kindSchema,
  loadImage,
  referencePreamble,
  referenceSchema,
  render,
  resolveTier,
  tierSchema,
  type ToolDeps,
} from './shared.js';

const editImageSchema = z.object({
  sourceImage: z.string().min(1).describe('Absolute path of the image to edit (PNG/JPEG/WebP).'),
  instruction: z
    .string()
    .min(1)
    .describe(
      'The change, and only the change: "replace the greatsword with a war maul crackling with ' +
        'violet energy". Everything else is kept by the tool\'s own wording.'
    ),
  kind: kindSchema,
  slug: z.string().min(1).describe('Kebab-cased into the filename: <kind>-<slug>-<id>.png.'),
  references: z
    .array(referenceSchema)
    .max(13)
    .optional()
    .describe('Optional extra references (attached after the source; indexes start at 2).'),
  tier: tierSchema,
  confirmPro: confirmProSchema,
});

export const EDIT_PREAMBLE =
  'Image 1 is the SOURCE image to edit. Keep the same subject, identity, pose, camera angle, ' +
  'composition, and rendering style exactly. Change ONLY what the instruction says. ';

export class EditImageTool {
  constructor(private readonly deps: ToolDeps) {}

  getToolDefinitions() {
    return [
      {
        name: 'edit-image',
        description:
          'Edit an existing image with one instruction while keeping identity, pose, angle, and ' +
          'style. Defaults to the flash tier for every kind (edits hold as well as on pro). ' +
          'Tokens get the chroma plate re-applied so they can be cut again. Returns the new ' +
          'file path, dimensions, and estimated spend.',
        inputSchema: toInputSchema(editImageSchema),
      },
    ];
  }

  async handleEditImage(args: unknown) {
    const p = editImageSchema.parse(args);
    // Edits default to flash regardless of kind; the spike showed no gain from pro here.
    const tier = resolveTier(p.kind, p.tier ?? 'flash', p.confirmPro);
    const refs = (p.references ?? []).map(r => ({ ...r }));
    const images = [loadImage(p.sourceImage), ...refs.map(r => loadImage(r.path))];
    // Shift reference numbering past the source image.
    const preamble = referencePreamble(refs).replace(
      /Image (\d+)/g,
      (_, n) => `Image ${Number(n) + 1}`
    );
    const suffix = PRESETS[p.kind].suffix;
    const prompt = `${EDIT_PREAMBLE}${preamble}Instruction: ${p.instruction.trim()}${suffix ? ` ${suffix}` : ''}`;
    return render(this.deps, {
      tool: 'edit-image',
      kind: p.kind,
      tier,
      prompt,
      images,
      slug: p.slug,
    });
  }
}
