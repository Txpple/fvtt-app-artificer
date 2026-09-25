// edit-image — instruction-style editing of an existing asset: swap a weapon, recolor a cloak,
// add a scar. The source image is attached first; extra references may follow.

import { z } from 'zod';
import { toInputSchema } from '../utils/schema.js';
import { type Kind, PRESETS } from '../presets.js';
import {
  confirmProSchema,
  kindSchema,
  loadImage,
  type Reference,
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
        'violet energy". For a flaw-fix pass, name every flaw precisely in one instruction ' +
        '("the left peryton has four legs; give it two", "remove the second fireball") and ' +
        'end with "keep everything else identical". Everything else is kept by the tool\'s ' +
        'own wording.'
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

/**
 * Token edits go out light, the way the owner prompts the native app: the instruction, one keep
 * line, the plate. No strict preamble, no re-stated framing (the source already carries the
 * pitch). Chosen over the full wording in the elf A/B (2026-09-24): it redesigned more boldly
 * and held face, hair, and angle just as well. World tokens carry a baked cast shadow the model
 * otherwise repaints as part of the figure; one sentence removes it (bronze dragon, same day).
 */
export const TOKEN_EDIT_KEEP =
  'Keep the face, hair, and the top-down token angle. Remove any cast shadow.';

/** Assemble the edit prompt for a kind. The token plate sentence is appended later by render(). */
export function editPrompt(kind: Kind, instruction: string, refs: Reference[]): string {
  // Shift reference numbering past the source image.
  const preamble = referencePreamble(refs).replace(
    /Image (\d+)/g,
    (_, n) => `Image ${Number(n) + 1}`
  );
  if (kind === 'token') {
    const source = refs.length ? 'Image 1 is the token to edit. ' : '';
    return `${source}${preamble}${instruction.trim().replace(/[.\s]+$/, '')}. ${TOKEN_EDIT_KEEP}`;
  }
  const suffix = PRESETS[kind].suffix;
  return `${EDIT_PREAMBLE}${preamble}Instruction: ${instruction.trim()}${suffix ? ` ${suffix}` : ''}`;
}

export class EditImageTool {
  constructor(private readonly deps: ToolDeps) {}

  getToolDefinitions() {
    return [
      {
        name: 'edit-image',
        description:
          'Edit an existing image with one instruction while keeping identity, pose, angle, and ' +
          'style. Flash for every kind (pro was no better at fixes and re-cropped once). ' +
          'Tokens are prompted light (your instruction as you would type it in the Gemini app, ' +
          'plus a keep-face/hair/angle line and "remove any cast shadow"), put back on a chroma ' +
          'plate keyed to the token\'s own colours, and cut to alpha on the 512 square in the ' +
          'same call. "give this an updated painterly style" restyles a world token in place. ' +
          'Returns the new file path, dimensions, and estimated spend.',
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
    const prompt = editPrompt(p.kind, p.instruction, refs);
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
