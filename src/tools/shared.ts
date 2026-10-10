// Shared by generate-image and edit-image: the Pro cost gate, reference loading, prompt
// assembly, and the render → post-process → write → (token) cutout pipeline. Tools own
// correctness; this is it.

import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import { encodeMap, mapBack, mapFormat, type PadPlan } from '../battlemap.js';
import { type ChromaKey, chromaSuffix, pickChromaKey } from '../chroma.js';
import type { CutoutFn, CutoutResult } from '../cutout.js';
import type { PythonCheckFn } from '../doctor.js';
import { type Aspect, Gemini, type InlineImage, PRICE, TIERS, type Tier } from '../gemini.js';
import { type DriftReport, measureDrift, overlandDrifted } from '../drift.js';
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
  /** imagegen-status's Python probe (Pillow, numpy, rembg). Omitted = that check is skipped. */
  checkPython?: PythonCheckFn;
}

export const kindSchema = z
  .enum(KINDS)
  .describe(
    'Purpose preset. icon: 1:1 flash → 512 square. prop: a map prop (furniture, barrel, tree) ' +
      'seen straight down, object only, cut to alpha at its tile size (300 px per grid cell; ' +
      'an edit keeps the source size). token: 1:1 flash, top-down full body on a ' +
      'chroma plate, cut to alpha on a 512 square (1024 for creatureSize: "large"), no shadow ' +
      '(framing, plate, and cut are done for you). ' +
      'portrait: 3:4 at 2K. illustration: 16:9 at 4K → 2560×1600 (16:10 crop). ' +
      'battlemap (edit-image only): restyle a bought map with its layout locked, delivered on ' +
      "the source's pixel grid (a whole-number upscale for a small source), drift-checked. " +
      'overland (edit-image only): repaint a regional or world map on the same grid, bare of ' +
      'every name and symbol, with a looser drift check. ' +
      'Every kind defaults to flash; tier: "pro" is opt-in and needs confirmPro.'
  );

export const tierSchema = z
  .enum(TIERS)
  .optional()
  .describe(
    'Default flash (Nano Banana 2.1, ~3-11¢), never needs a confirm. "pro" (Nano Banana Pro, ' +
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
 * A battlemap's style reference lends its finish only: "match its camera angle" would tilt a
 * straight-down map, and its subject is another map whose layout must not leak in.
 */
export function referencePreamble(refs: Reference[], kind?: Kind): string {
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
    } else if (kind === 'battlemap' || kind === 'overland') {
      lines.push(
        `Image ${n}${who} is a STYLE reference only: match its palette, brushwork, and painted ` +
          'finish. Copy nothing else from it: no layout, no objects, no rooms, no shapes.'
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
  /** Battlemaps only: the unpadded source and how it was padded for the API. */
  map?: { source: Buffer; plan: PadPlan };
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
  /** Battlemaps: the source's pixel size and the whole-number scale the map was delivered at. */
  source?: { width: number; height: number };
  scale?: number;
  /** Battlemaps: how far the layout moved against the source (per-mille of the long side). */
  drift?: DriftReport;
  /** Battlemaps: the first render drifted and was redone. */
  driftRetried?: boolean;
  /** Battlemaps: source and result in alternating squares, for the eye to check alignment. */
  check?: string;
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
  if (input.kind === 'battlemap' || input.kind === 'overland') return renderMap(deps, input, id);
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

/** Display copy of a drift report: shares as per-mille of the long side, rounded. */
function driftSummary(d: DriftReport): DriftReport {
  const pm = (v: number) => Math.round(v * 10000) / 10;
  return {
    ...d,
    median: pm(d.median),
    p95: pm(d.p95),
    max: pm(d.max),
    structure: Math.round(d.structure * 1000) / 1000,
  };
}

/**
 * A battlemap: render the padded source, map the result back onto the source's pixel grid, and
 * check the layout did not move (owner rule 2026-10-02: Foundry walls and lights are traced over
 * it). A drifted render is redone once (both billed); a second drift is refused, both kept.
 */
async function renderMap(deps: ToolDeps, input: RenderInput, id: string): Promise<RenderOutput> {
  const kind = input.kind;
  const preset = PRESETS[kind];
  const map = input.map;
  if (!map) throw new Error(`${kind} render needs its source and pad plan`);
  const once = async () => {
    const result = await deps.gemini.generate({
      tier: input.tier,
      prompt: input.prompt,
      images: input.images,
      aspect: input.aspect ?? preset.aspect,
      size: preset.size,
    });
    const usd = deps.spend.record(input.tool, input.tier, preset.size);
    const back = await mapBack(result.image.data, map.plan);
    const measured = await measureDrift(map.source, back.png);
    // An overland map has nothing traced over it: only a grossly moved geography fails.
    const drift =
      kind === 'overland' ? { ...measured, failed: overlandDrifted(measured) } : measured;
    return { result, ...back, drift, usd };
  };
  const stem = path.join(deps.outputDir, `${kind}-${slugOf(input.slug)}-${id}`);
  let r = await once();
  // Every render of one map has the same size, so one format serves the drifted copies too.
  const format = mapFormat(r.width, r.height);
  const keep = async (n: number) => {
    const kept = `${stem}-drifted${n}.${format}`;
    fs.writeFileSync(kept, await encodeMap(r.png, format));
    return kept;
  };
  let estimatedUsd = r.usd;
  let driftRetried: boolean | undefined;
  if (r.drift.failed) {
    const kept1 = await keep(1);
    const first = driftSummary(r.drift);
    r = await once();
    estimatedUsd += r.usd;
    driftRetried = true;
    if (r.drift.failed) {
      const kept2 = await keep(2);
      const d = driftSummary(r.drift);
      throw new Error(
        `Both renders moved the map's layout (${first.drifted} of ${first.tiles} and ` +
          `${d.drifted} of ${d.tiles} measured tiles drifted, worst ${d.max}‰ of the long ` +
          (kind === 'overland'
            ? 'side); the geography moved too far to be the same map. '
            : 'side); a drifted battlemap is never delivered, since walls and lights are traced ' +
              'over it. ') +
          `Kept for inspection: ${kept1}, ${kept2}. Spent ` +
          `about $${estimatedUsd.toFixed(2)}. Ask for a lighter change and try again.`
      );
    }
  }
  const file = path.join(deps.outputDir, filename(kind, input.slug, id, format));
  fs.writeFileSync(file, await encodeMap(r.png, format));
  const check = `${stem}-check.jpg`;
  fs.writeFileSync(check, await checkerboard(map.source, r.png));
  return {
    file,
    kind,
    tier: input.tier,
    model: r.result.model,
    width: r.width,
    height: r.height,
    estimatedUsd,
    sessionEstimatedUsd: deps.spend.totalUsd,
    source: { ...map.plan.source },
    scale: r.scale,
    drift: driftSummary(r.drift),
    ...(driftRetried ? { driftRetried } : {}),
    check,
  };
}

/** Squares across the short side of the alignment check image. */
const CHECK_SQUARES = 8;

/**
 * Source and result in alternating squares at up to 2048 px: a moved wall or path breaks at every
 * square boundary it crosses, which the eye catches at once. JPEG: it is for looking at, and a
 * PNG of it ran to 8 MB.
 */
async function checkerboard(source: Buffer, result: Buffer): Promise<Buffer> {
  const m = await sharp(result).metadata();
  const k = Math.min(1, 2048 / Math.max(m.width ?? 1, m.height ?? 1));
  const w = Math.max(1, Math.round((m.width ?? 1) * k));
  const h = Math.max(1, Math.round((m.height ?? 1) * k));
  const [a, b] = await Promise.all(
    [source, result].map(img =>
      sharp(img).removeAlpha().resize(w, h, { fit: 'fill' }).raw().toBuffer()
    )
  );
  const cell = Math.max(1, Math.round(Math.min(w, h) / CHECK_SQUARES));
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const from = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? a : b;
      out[i] = from[i];
      out[i + 1] = from[i + 1];
      out[i + 2] = from[i + 2];
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 3 } })
    .jpeg({ quality: 85 })
    .toBuffer();
}

function slugOf(slug: string): string {
  return filename('token', slug, 'x')
    .replace(/^token-/, '')
    .replace(/-x\.png$/, '');
}

export function newId(): string {
  return randomBytes(4).toString('hex');
}
