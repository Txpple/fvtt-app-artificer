// edit-image — instruction-style editing of an existing asset: swap a weapon, recolor a cloak,
// add a scar. The source image is attached first; extra references may follow.

import { z } from 'zod';
import { toInputSchema } from '../utils/schema.js';
import sharp from 'sharp';
import { padPlan, padSource } from '../battlemap.js';
import { alphaBox } from '../post.js';
import { type Kind, nearestAspect, PRESETS } from '../presets.js';
import {
  confirmProSchema,
  creatureSizeSchema,
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
  creatureSize: creatureSizeSchema,
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
  'Keep the face, hair, and the top-down token angle. Remove any cast shadow. Keep the whole ' +
  'figure, weapons included, inside the frame with a margin on every side; nothing crosses the edge.';

/**
 * Prop edits: the token keep line's "face, hair" grew people on an armchair, a tree, and a crate
 * (2026-09-24), so props get an object-only line and never the token one.
 */
export const PROP_EDIT_KEEP =
  'Keep the exact shape, silhouette, design, colours and the straight-down top-down camera ' +
  'angle. This is an object: do not add any person, creature, face, or figure. Remove any cast ' +
  'shadow. Keep the whole object inside the frame with a margin on every side; nothing crosses ' +
  'the edge.';

/**
 * Battlemap edits (owner request 2026-10-02): walls, doors, and lights are traced over the map in
 * Foundry, so the layout is pinned here and nothing else is. Palette, light, and finish stay with
 * the instruction: a keep line that also pinned "same colours, same daylight, only the technique
 * changes" smothered the restyle on the garden test, and the owner preferred the bolder render.
 * That bolder render roofed the conservatory over in glass, hence the open-interiors sentence.
 */
export const BATTLEMAP_EDIT_KEEP =
  'This is a top-down battle map for a virtual tabletop, and walls, doors and lights are traced ' +
  'over it, so the layout is locked: every wall, door, window, path, shoreline, cliff edge, ' +
  'building outline, piece of furniture, tree, rock and object stays exactly where it is, at the ' +
  'same size and shape, under the same straight-down camera, framed to the same edges. Change ' +
  'only how the map is painted, never what is in it: every object, statue and surface stays the ' +
  'same thing in the same material (bare earth stays bare earth, stairs stay stairs, a plain ' +
  'background stays plain). Rooms are shown as a cutaway floor plan, walls cut at waist height, ' +
  'every floor and its furnishings visible from above. Light and shadow fall exactly as in the ' +
  'source.';

/**
 * Overland maps (owner request 2026-10-03): a regional or world map repainted in the house style
 * and painted bare. Names, markers, and roads are lettered on afterwards by script, exactly, so
 * the model never draws text (it misspelled three of thirty labels on the first Halruaa render).
 * The bare map is the tool's promise, so the removal lives here, not in the instruction.
 */
export const OVERLAND_EDIT_KEEP =
  'This is an overland map of a region seen from directly above, and its place names, roads ' +
  'and markers are lettered on afterwards by hand, so the geography is locked and the map is ' +
  'painted bare: every coastline, river, lake, mountain range, pass, forest, swamp, desert and ' +
  'island stays exactly where it is, at the same size and shape, framed to the same edges. ' +
  'Change only how the land and sea are painted. Paint over every piece of lettering, every ' +
  'label and place name, every town or city marker, road, dashed line, border, compass rose, ' +
  'scale bar and frame with the land or sea that lies beneath it, so the finished map is pure ' +
  'painted terrain and water, with no text and no symbols anywhere on it.';

/** Transparent margin added around a prop source before it is sent, as a share of its long side. */
export const PROP_EDIT_PAD = 0.12;

/** Assemble the edit prompt for a kind. The token plate sentence is appended later by render(). */
export function editPrompt(kind: Kind, instruction: string, refs: Reference[]): string {
  // Shift reference numbering past the source image.
  const preamble = referencePreamble(refs, kind).replace(
    /Image (\d+)/g,
    (_, n) => `Image ${Number(n) + 1}`
  );
  const map = kind === 'battlemap' || kind === 'overland';
  if (kind === 'token' || kind === 'prop' || map) {
    const source = refs.length ? `Image 1 is the ${map ? 'map' : kind} to edit. ` : '';
    const keep =
      kind === 'prop'
        ? PROP_EDIT_KEEP
        : kind === 'battlemap'
          ? BATTLEMAP_EDIT_KEEP
          : kind === 'overland'
            ? OVERLAND_EDIT_KEEP
            : TOKEN_EDIT_KEEP;
    return `${source}${preamble}${instruction.trim().replace(/[.\s]+$/, '')}. ${keep}`;
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
          "plate keyed to the token's own colours, and cut to alpha on the 512 square in the " +
          'same call. "give this an updated painterly style" restyles a world token in place. ' +
          'Props (kind "prop") get object-only wording (no figures added) and come back cut at ' +
          "the source file's exact pixel size, ready for the same tile slot. Battlemaps " +
          '(kind "battlemap") restyle a bought map with the layout locked: the result lands on ' +
          "the source's pixel grid (a whole-number upscale when the source is small), is checked " +
          'for drift against the source (a drifted render is redone once, then refused), and ' +
          'comes with a checkerboard image of source and result to eyeball. Overland maps ' +
          '(kind "overland") repaint a regional or world map the same way, painted bare of every ' +
          'name, marker, road, compass rose and scale bar (letter them on afterwards), with a ' +
          'looser drift check that refuses only a grossly moved geography. Returns the new ' +
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
    const prompt = editPrompt(p.kind, p.instruction, refs);
    // A prop comes back at its source's exact size, with the new art in the box the original
    // occupied, so it drops into the same tile slot at the same scale. The model is shown the
    // source with a transparent margin: a crate drawn edge to edge on its tile was otherwise
    // repainted edge to edge and refused twice by the clip guard (2026-09-24).
    let propFit = {};
    if (p.kind === 'battlemap' || p.kind === 'overland') {
      // The API renders fixed aspects only: send the map padded to the nearest one, and map the
      // render back onto the source's own grid afterwards (battlemap.ts).
      const m = await sharp(images[0].data).metadata();
      const plan = padPlan(m.width ?? 1, m.height ?? 1);
      const source = images[0].data;
      images[0] = { mimeType: 'image/jpeg', data: await padSource(source, plan) };
      propFit = { aspect: plan.aspect, map: { source, plan } };
    } else if (p.kind === 'prop') {
      const m = await sharp(images[0].data).metadata();
      const width = m.width ?? 300;
      const height = m.height ?? 300;
      const box = await alphaBox(images[0].data);
      const pad = Math.round(Math.max(width, height) * PROP_EDIT_PAD);
      images[0] = {
        mimeType: 'image/png',
        data: await sharp(images[0].data)
          .ensureAlpha()
          .extend({
            top: pad,
            bottom: pad,
            left: pad,
            right: pad,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .png()
          .toBuffer(),
      };
      propFit = { aspect: nearestAspect(width / height), canvas: { width, height }, box };
    }
    return render(this.deps, {
      tool: 'edit-image',
      kind: p.kind,
      tier,
      prompt,
      images,
      slug: p.slug,
      ...(p.creatureSize ? { creatureSize: p.creatureSize } : {}),
      ...propFit,
    });
  }
}
