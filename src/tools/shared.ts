// Shared by generate-image and edit-image: the Pro cost gate, reference loading, prompt
// assembly, and the render → post-process → write → (token) cutout pipeline. Tools own
// correctness; this is it.

import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { type ChromaKey, chromaSuffix, pickChromaKey } from '../chroma.js';
import type { CutoutFn, CutoutResult } from '../cutout.js';
import { type Aspect, Gemini, type InlineImage, PRICE, TIERS, type Tier } from '../gemini.js';
import { EDGE_BAND, EDGE_LIMIT, edgeContact } from '../edge.js';
import { type Box, type Dimensions, dimensions, fitRect, postProcess } from '../post.js';
import {
  CREATURE_SIZES,
  type CreatureSize,
  filename,
  KINDS,
  type Kind,
  PRESETS,
  TOKEN_EDGE,
} from '../presets.js';
import { SpendMeter } from '../spend.js';

export interface ToolDeps {
  gemini: Gemini;
  spend: SpendMeter;
  outputDir: string;
  cutout: CutoutFn;
}

export const kindSchema = z
  .enum(KINDS)
  .describe(
    'Purpose preset. icon: 1:1 flash → 512 square. prop: a map prop (furniture, barrel, tree) ' +
      'seen straight down, object only, cut to alpha at its tile size (300 px per grid cell; ' +
      'an edit keeps the source size). token: 1:1 flash, top-down full body on a ' +
      'chroma plate, cut to alpha on a 512 square (1024 for creatureSize: "large"), no shadow ' +
      '(framing, plate, and cut are done for you). ' +
      'portrait: 3:4 at 2K. illustration: 16:9 at 4K → 2560×1600 (16:10 crop). Every kind ' +
      'defaults to flash; tier: "pro" is opt-in and needs confirmPro.'
  );

export const tierSchema = z
  .enum(TIERS)
  .optional()
  .describe(
    'Default flash (Nano Banana 2, ~7-15¢), never needs a confirm. "pro" (Nano Banana Pro, ' +
      '~13-24¢, style-reference slots, stronger multi-figure scenes) needs confirmPro.'
  );

export const confirmProSchema = z
  .boolean()
  .optional()
  .describe(
    'Required true with tier: "pro". Offer pro to the owner as an option for portraits and ' +
      'illustrations ("pro is available for a bit extra"); never assume it.'
  );

export const creatureSizeSchema = z
  .enum(CREATURE_SIZES)
  .optional()
  .describe(
    'Tokens only. medium (default): one grid cell, Tiny through Medium, a 512 square. large: ' +
      'Large, Huge, or Gargantuan, a 1024 square, the native render edge.'
  );

export const referenceSchema = z.object({
  path: z.string().min(1).describe('Absolute path of a PNG/JPEG on disk.'),
  role: z
    .enum(['character', 'style', 'pose'])
    .describe(
      'character: hold this face/figure (up to 4 on flash, 5 on pro). style: match palette, ' +
        'brushwork, light, camera angle; never copy the subject (works on both tiers in practice). ' +
        'pose: match only its pose, head direction, camera angle, and silhouette, never its ' +
        'drawing; for replacing a weak token, attach the old one as the ONLY image with this role.'
    ),
  label: z
    .string()
    .optional()
    .describe('Short name used to bind the reference in the prompt, e.g. "Morgash".'),
});
export type Reference = z.infer<typeof referenceSchema>;

/** Resolve the tier and enforce the Pro gate. Throws the owner-facing refusal. */
export function resolveTier(
  kind: Kind,
  tier: Tier | undefined,
  confirmPro: boolean | undefined
): Tier {
  const resolved = tier ?? PRESETS[kind].tier;
  if (resolved === 'pro' && !confirmPro) {
    const usd = PRICE.pro[PRESETS[kind].size];
    throw new Error(
      `tier: "pro" (Nano Banana Pro) costs about $${usd.toFixed(2)} per ${kind}. Confirm with ` +
        'the owner, then pass confirmPro: true; or omit tier for flash (no confirm needed).'
    );
  }
  return resolved;
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export function loadImage(p: string): InlineImage {
  const mimeType = MIME[path.extname(p).toLowerCase()];
  if (!mimeType) throw new Error(`unsupported image type: ${p}`);
  if (!fs.existsSync(p)) throw new Error(`image not found: ${p}`);
  return { data: fs.readFileSync(p), mimeType };
}

/**
 * Build the reference preamble. Images are attached in the order given; the preamble tells the
 * model which is which by 1-based index, so the caller's prompt can say "Morgash" and be bound.
 */
export function referencePreamble(refs: Reference[]): string {
  if (refs.length === 0) return '';
  const lines: string[] = [];
  refs.forEach((r, i) => {
    const n = i + 1;
    const who = r.label ? ` (${r.label})` : '';
    if (r.role === 'character') {
      lines.push(
        `Image ${n}${who} is a CHARACTER reference: keep this exact face, build, and outfit faithful.`
      );
    } else if (r.role === 'pose') {
      // Wording proven on the bear, hound, and troll (2026-09-24): angle and silhouette held,
      // the old drawing did not come back.
      lines.push(
        `Image ${n}${who} is a POSE reference only: match its exact pose, body position, head ` +
          'direction, camera angle, and silhouette. Do not copy its drawing, colours, rendering, ' +
          'or level of detail; it is an old low-quality image being replaced.'
      );
    } else {
      lines.push(
        `Image ${n}${who} is a STYLE reference only: match its palette, brushwork, lighting, and ` +
          'camera angle; do not copy its subject.'
      );
    }
  });
  return `${lines.join(' ')} `;
}

export interface RenderInput {
  tool: string;
  kind: Kind;
  tier: Tier;
  /** Prompt without the token plate sentence; render() appends it with the chosen key. */
  prompt: string;
  images: InlineImage[];
  slug: string;
  /** Tokens only; defaults to medium (512). */
  creatureSize?: CreatureSize;
  /** Replaces the preset's API aspect (props: from the footprint or the source's shape). */
  aspect?: Aspect;
  /** Props only: the exact finished canvas, e.g. 600x300 for a 2x1 prop. */
  canvas?: Dimensions;
  /** Props only: where the subject goes on that canvas (an edit: where the original sat). */
  box?: Box;
}

/** Kinds rendered on a chroma plate, edge-checked, and cut to alpha. */
const CUT_KINDS: ReadonlySet<Kind> = new Set(['token', 'prop']);

export interface RenderOutput {
  file: string;
  kind: Kind;
  tier: Tier;
  model: string;
  width: number;
  height: number;
  estimatedUsd: number;
  sessionEstimatedUsd: number;
  /** Tokens and props: the chroma key chosen for this subject and the cut's numbers. */
  chromaKey?: ChromaKey;
  plate?: string;
  cutout?: Omit<CutoutResult, 'file' | 'width' | 'height'>;
  /** Tokens and props: the first render clipped the subject at the edge and was redone. */
  edgeRetried?: boolean;
}

/** Render one image through the API, post-process it, write it, meter it; cut tokens and props. */
export async function render(deps: ToolDeps, input: RenderInput): Promise<RenderOutput> {
  const preset = PRESETS[input.kind];
  const cut = CUT_KINDS.has(input.kind);
  let prompt = input.prompt;
  let chromaKey: ChromaKey | undefined;
  if (cut) {
    // Sample every attached image (source token for edits, reference tokens for generates) and
    // read the prompt: a generated subject's colour is only in the words.
    chromaKey = await pickChromaKey(
      input.images.map(i => i.data),
      input.prompt
    );
    prompt = `${prompt} ${chromaSuffix(chromaKey)}`;
  }

  fs.mkdirSync(deps.outputDir, { recursive: true });
  const id = newId();
  const once = async () => {
    const result = await deps.gemini.generate({
      tier: input.tier,
      prompt,
      images: input.images,
      aspect: input.aspect ?? preset.aspect,
      size: preset.size,
    });
    const png = await postProcess(result.image.data, preset.post);
    return { result, png, usd: deps.spend.record(input.tool, input.tier, preset.size) };
  };

  let { result, png, usd: estimatedUsd } = await once();
  let edgeRetried: boolean | undefined;
  if (cut && chromaKey) {
    // Nothing may clip off a token or a prop (owner rule 2026-09-24). A subject touching the
    // plate edge is rendered once more; if that is clipped too, refuse rather than deliver it.
    const clippedPath = (n: number) =>
      path.join(deps.outputDir, `${input.kind}-${slugOf(input.slug)}-${id}-clipped${n}.png`);
    let contact = await edgeContact(png, chromaKey);
    if (contact > EDGE_LIMIT) {
      fs.writeFileSync(clippedPath(1), png);
      const again = await once();
      ({ result, png } = again);
      estimatedUsd += again.usd;
      edgeRetried = true;
      contact = await edgeContact(png, chromaKey);
      if (contact > EDGE_LIMIT) {
        fs.writeFileSync(clippedPath(2), png);
        throw new Error(
          `Both renders clip the subject at the image edge (${contact} subject pixels in the ` +
            `outer ${EDGE_BAND} px); a clipped ${input.kind} is never delivered. Kept for inspection: ` +
            `${clippedPath(1)}, ${clippedPath(2)}. Spent about $${estimatedUsd.toFixed(2)}. ` +
            'Describe a more compact pose (weapon held close, wings folded) and try again.'
        );
      }
    }
  }
  const base = {
    kind: input.kind,
    tier: input.tier,
    model: result.model,
    estimatedUsd,
    sessionEstimatedUsd: deps.spend.totalUsd,
    ...(edgeRetried ? { edgeRetried } : {}),
  };

  if (cut && chromaKey) {
    const plate = path.join(deps.outputDir, `${input.kind}-${slugOf(input.slug)}-${id}-plate.png`);
    fs.writeFileSync(plate, png);
    const file = path.join(deps.outputDir, filename(input.kind, input.slug, id));
    const isProp = input.kind === 'prop';
    const result = await deps.cutout({
      input: plate,
      output: file,
      method: 'auto',
      color: chromaKey,
      // A token is fitted to its square by the script; a prop keeps the plate canvas here and is
      // fitted to its exact tile size below.
      size: isProp ? 0 : TOKEN_EDGE[input.creatureSize ?? 'medium'],
    });
    const { file: _f, width, height, ...rest } = result;
    if (isProp) {
      const canvas = input.canvas ?? { width: 300, height: 300 };
      fs.writeFileSync(
        file,
        await fitRect(fs.readFileSync(file), canvas.width, canvas.height, 4, input.box)
      );
      return { ...base, file, ...canvas, chromaKey, plate, cutout: rest };
    }
    return { ...base, file, width, height, chromaKey, plate, cutout: rest };
  }

  const dims = await dimensions(png);
  const file = path.join(deps.outputDir, filename(input.kind, input.slug, id));
  fs.writeFileSync(file, png);
  return { ...base, file, width: dims.width, height: dims.height };
}

function slugOf(slug: string): string {
  return filename('token', slug, 'x')
    .replace(/^token-/, '')
    .replace(/-x\.png$/, '');
}

export function newId(): string {
  return randomBytes(4).toString('hex');
}
