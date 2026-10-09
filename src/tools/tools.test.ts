import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CutoutFn, CutoutOptions } from '../cutout.js';
import { Gemini } from '../gemini.js';
import { buildToolRegistry } from '../registry.js';
import { SpendMeter } from '../spend.js';
import { PROP_FRAMING, TOKEN_FRAMING } from '../presets.js';
import {
  BATTLEMAP_EDIT_KEEP,
  EDIT_PREAMBLE,
  OVERLAND_EDIT_KEEP,
  PROP_EDIT_KEEP,
  TOKEN_EDIT_KEEP,
} from './edit.js';
import { referencePreamble, resolveTier } from './shared.js';

let tmp: string;
let refPng: string;
let greenRef: string;
let propSrc: string;
let mapSrc: string;
let sent: Array<{ url: string; body: any }>;
let cuts: CutoutOptions[];

function fakeGemini(width = 1024, height = 1024): Gemini {
  sent = [];
  const fakeFetch = (async (url: any, init: any) => {
    const body = JSON.parse(init.body);
    sent.push({ url: String(url), body });
    // Answer on the plate colour the prompt asked for, as the real model does.
    const asked = /chroma-key \w+ \((#[0-9A-F]{6})\)/.exec(body.contents[0].parts.at(-1).text)?.[1];
    const data = (
      await sharp({ create: { width, height, channels: 3, background: asked ?? '#00ff00' } })
        .jpeg()
        .toBuffer()
    ).toString('base64');
    return new Response(
      JSON.stringify({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data } }] },
          },
        ],
      }),
      { status: 200 }
    );
  }) as typeof fetch;
  return new Gemini({ apiKey: 'k', timeoutMs: 1000, fetch: fakeFetch });
}

const fakeCutout: CutoutFn = async opts => {
  cuts.push(opts);
  // A visible subject in the middle of a transparent square, so fitting a prop has something to place.
  fs.writeFileSync(
    opts.output,
    await sharp({ create: { width: 512, height: 512, channels: 4, background: '#0000' } })
      .composite([
        {
          input: await sharp({
            create: { width: 200, height: 100, channels: 4, background: '#8a5a2bff' },
          })
            .png()
            .toBuffer(),
          left: 156,
          top: 206,
        },
      ])
      .png()
      .toBuffer()
  );
  return {
    file: opts.output,
    preview: `${opts.output}-preview`,
    method: 'chroma',
    coveragePct: 42,
    residualKeyPct: 0.1,
    width: 512,
    height: 512,
  };
};

/** A Gemini that answers with these plates in turn: 'clean' (flat plate) or 'clipped'. */
function sequenceGemini(plates: Array<'clean' | 'clipped'>): Gemini {
  sent = [];
  const fakeFetch = (async (url: any, init: any) => {
    const body = JSON.parse(init.body);
    sent.push({ url: String(url), body });
    const kind = plates[Math.min(sent.length - 1, plates.length - 1)];
    const bg =
      /chroma-key \w+ \((#[0-9A-F]{6})\)/.exec(body.contents[0].parts.at(-1).text)?.[1] ??
      '#FF00FF';
    const blade =
      kind === 'clipped' ? '<rect x="480" y="300" width="60" height="760" fill="#c0c0c0"/>' : '';
    const data = (
      await sharp(
        Buffer.from(
          `<svg width="1024" height="1024"><rect width="1024" height="1024" fill="${bg}"/>${blade}</svg>`
        )
      )
        .jpeg()
        .toBuffer()
    ).toString('base64');
    return new Response(
      JSON.stringify({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data } }] },
          },
        ],
      }),
      { status: 200 }
    );
  }) as typeof fetch;
  return new Gemini({ apiKey: 'k', timeoutMs: 1000, fetch: fakeFetch });
}

/** The API's real 1K sizes per aspect: not exactly the nominal ratios (3:4 is 896x1200). */
const API_1K: Record<string, [number, number]> = {
  '1:1': [1024, 1024],
  '3:4': [896, 1200],
  '4:3': [1200, 896],
  '2:3': [848, 1264],
  '3:2': [1264, 848],
  '9:16': [768, 1376],
  '16:9': [1376, 768],
};

/**
 * A Gemini that answers a map edit the way the API does (measured 2026-10-02): the source image
 * scaled to cover the output and centre-trimmed. 'slid' renders shift the whole layout 40 px,
 * the way a drifted restyle moves walls.
 */
function mapGemini(renders: Array<'faithful' | 'slid' | 'nudged'>): Gemini {
  sent = [];
  const fakeFetch = (async (url: any, init: any) => {
    const body = JSON.parse(init.body);
    sent.push({ url: String(url), body });
    const how = renders[Math.min(sent.length - 1, renders.length - 1)];
    const [w, h] = API_1K[body.generationConfig.imageConfig.aspectRatio];
    const input = Buffer.from(body.contents[0].parts[0].inline_data.data, 'base64');
    let out = await sharp(input)
      .resize(w, h, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer();
    if (how === 'slid') {
      const wide = await sharp(out).extend({ left: 40, extendWith: 'mirror' }).png().toBuffer();
      out = await sharp(wide).extract({ left: 0, top: 0, width: w, height: h }).png().toBuffer();
    }
    if (how === 'nudged') {
      // Only the left fifth of the map slides down 40 px: a repainted coastline, not a new map.
      const strip = Math.round(w / 5);
      const moved = await sharp(out)
        .extract({ left: 0, top: 0, width: strip, height: h - 40 })
        .png()
        .toBuffer();
      out = await sharp(out)
        .composite([{ input: moved, left: 0, top: 40 }])
        .png()
        .toBuffer();
    }
    const data = (await sharp(out).jpeg({ quality: 95 }).toBuffer()).toString('base64');
    return new Response(
      JSON.stringify({
        candidates: [
          {
            finishReason: 'STOP',
            content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data } }] },
          },
        ],
      }),
      { status: 200 }
    );
  }) as typeof fetch;
  return new Gemini({ apiKey: 'k', timeoutMs: 1000, fetch: fakeFetch });
}

function build(gemini = fakeGemini()) {
  const spend = new SpendMeter();
  cuts = [];
  return { spend, ...buildToolRegistry({ gemini, spend, outputDir: tmp, cutout: fakeCutout }) };
}

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'imagegen-test-'));
  refPng = path.join(tmp, 'ref.png');
  fs.writeFileSync(
    refPng,
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
      .png()
      .toBuffer()
  );
  // A 2x1 prop with its subject off-centre in the tile: 400x200 at (100, 50).
  propSrc = path.join(tmp, 'anvil_2x1.png');
  fs.writeFileSync(
    propSrc,
    await sharp({ create: { width: 600, height: 300, channels: 4, background: '#0000' } })
      .composite([
        {
          input: await sharp({
            create: { width: 400, height: 200, channels: 4, background: '#444444ff' },
          })
            .png()
            .toBuffer(),
          left: 100,
          top: 50,
        },
      ])
      .png()
      .toBuffer()
  );
  // A 400x300 textured map: deterministic noise, softened, so the drift check has edges to lock on.
  mapSrc = path.join(tmp, 'tavern.jpg');
  {
    let seed = 7;
    const px = Buffer.alloc(400 * 300 * 3);
    for (let i = 0; i < px.length; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      px[i] = seed >> 23;
    }
    fs.writeFileSync(
      mapSrc,
      await sharp(px, { raw: { width: 400, height: 300, channels: 3 } })
        .blur(1.5)
        .jpeg({ quality: 95 })
        .toBuffer()
    );
  }
  greenRef = path.join(tmp, 'green.png');
  fs.writeFileSync(
    greenRef,
    await sharp({ create: { width: 8, height: 8, channels: 3, background: '#30a030' } })
      .png()
      .toBuffer()
  );
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('the Pro cost gate', () => {
  it('refuses pro kinds without confirmPro and states the cost and both ways out', () => {
    expect(() => resolveTier('illustration', 'pro', undefined)).toThrow(
      /tier: "pro".*\$0\.24.*confirmPro: true.*omit tier for flash/s
    );
    expect(() => resolveTier('portrait', 'pro', false)).toThrow(/\$0\.13/);
  });

  it('defaults every kind to flash and accepts a confirmed pro call', () => {
    expect(resolveTier('icon', undefined, undefined)).toBe('flash');
    expect(resolveTier('illustration', undefined, undefined)).toBe('flash');
    expect(resolveTier('portrait', undefined, undefined)).toBe('flash');
    expect(resolveTier('illustration', 'pro', true)).toBe('pro');
    expect(() => resolveTier('icon', 'pro', undefined)).toThrow(/confirmPro/);
  });
});

describe('referencePreamble', () => {
  it('numbers references 1-based, labels them, and separates character from style roles', () => {
    const s = referencePreamble([
      { path: 'a', role: 'character', label: 'Morgash' },
      { path: 'b', role: 'style' },
    ]);
    expect(s).toMatch(/^Image 1 \(Morgash\) is a CHARACTER reference/);
    expect(s).toMatch(/Image 2 is a STYLE reference only/);
    expect(referencePreamble([])).toBe('');
  });

  it('binds a pose reference to pose and silhouette and forbids copying its drawing', () => {
    const s = referencePreamble([{ path: 'a', role: 'pose', label: 'old bear' }]);
    expect(s).toMatch(/^Image 1 \(old bear\) is a POSE reference only: match its exact pose/);
    expect(s).toContain('silhouette');
    expect(s).toContain('Do not copy its drawing');
  });
});

describe('generate-image', () => {
  it('writes a finished PNG named <kind>-<slug>-<id>.png, appends the preset suffix, and meters spend', async () => {
    const { dispatch, spend } = build();
    const r: any = await dispatch('generate-image', {
      kind: 'icon',
      prompt: 'a rusted iron key',
      slug: 'Rusted Key!',
    });
    expect(path.basename(r.file)).toMatch(/^icon-rusted-key-[0-9a-f]{8}\.png$/);
    expect(fs.existsSync(r.file)).toBe(true);
    expect(r).toMatchObject({
      kind: 'icon',
      tier: 'flash',
      width: 512,
      height: 512,
      estimatedUsd: 0.0336,
    });
    expect(spend.totalUsd).toBe(0.034);
    const text = sent[0].body.contents[0].parts.at(-1).text;
    expect(text).toMatch(/^a rusted iron key Inventory icon/);
    expect(sent[0].url).toContain('gemini-nano-banana-2.1');
    expect(cuts).toHaveLength(0);
  });

  it('tokens: picks magenta for a neutral reference, appends framing + plate, then cuts to 512', async () => {
    const { dispatch } = build();
    const r: any = await dispatch('generate-image', {
      kind: 'token',
      prompt: 'a goblin scout',
      slug: 'goblin',
      references: [{ path: refPng, role: 'style', label: 'Morgash token' }],
    });
    const parts = sent[0].body.contents[0].parts;
    expect(parts).toHaveLength(2);
    expect(parts[0].inline_data.mime_type).toBe('image/png');
    expect(parts[1].text).toMatch(/^Image 1 \(Morgash token\) is a STYLE reference/);
    expect(parts[1].text).toContain('fifteen degrees off vertical');
    expect(parts[1].text).toContain('chroma-key magenta (#FF00FF)');
    expect(r.chromaKey).toBe('magenta');
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toMatchObject({ color: 'magenta', size: 512, method: 'auto' });
    expect(cuts[0].dropShadow).toBeUndefined();
    expect(path.basename(cuts[0].input)).toMatch(/^token-goblin-[0-9a-f]{8}-plate\.png$/);
    expect(path.basename(r.file)).toMatch(/^token-goblin-[0-9a-f]{8}\.png$/);
    expect(r).toMatchObject({
      width: 512,
      height: 512,
      cutout: { method: 'chroma', coveragePct: 42 },
    });
    expect(fs.existsSync(r.plate)).toBe(true);
  });

  it('tokens: creatureSize large cuts to a 1024 square; medium and unset stay 512', async () => {
    const { dispatch } = build();
    await dispatch('generate-image', {
      kind: 'token',
      prompt: 'a dragon',
      slug: 'd',
      creatureSize: 'large',
    });
    await dispatch('generate-image', {
      kind: 'token',
      prompt: 'a cat',
      slug: 'c',
      creatureSize: 'medium',
    });
    await dispatch('edit-image', {
      sourceImage: refPng,
      instruction: 'painterly',
      kind: 'token',
      slug: 'g',
      creatureSize: 'large',
    });
    expect(cuts.map(c => c.size)).toEqual([1024, 512, 1024]);
    await expect(
      dispatch('generate-image', { kind: 'token', prompt: 'x', slug: 'x', creatureSize: 'huge' })
    ).rejects.toThrow();
  });

  it('tokens: a pose reference drops the preset framing but keeps the plate and the cut', async () => {
    const { dispatch } = build();
    await dispatch('generate-image', {
      kind: 'token',
      prompt: 'a big black bear',
      slug: 'bear',
      references: [{ path: refPng, role: 'pose', label: 'old bear' }],
    });
    const text = sent[0].body.contents[0].parts.at(-1).text;
    expect(text).toMatch(/^Image 1 \(old bear\) is a POSE reference only/);
    expect(text).not.toContain(TOKEN_FRAMING);
    expect(text).toContain('chroma-key');
    expect(cuts).toHaveLength(1);
    // Without a pose reference the framing is still appended.
    await dispatch('generate-image', { kind: 'token', prompt: 'a bear', slug: 'bear' });
    expect(sent[1].body.contents[0].parts.at(-1).text).toContain(TOKEN_FRAMING);
  });

  it('tokens: a render that clips at the edge is redone once, and both calls are billed', async () => {
    const { dispatch, spend } = build(sequenceGemini(['clipped', 'clean']));
    const r: any = await dispatch('generate-image', {
      kind: 'token',
      prompt: 'a knight',
      slug: 'k',
    });
    expect(sent).toHaveLength(2);
    expect(r.edgeRetried).toBe(true);
    expect(r.estimatedUsd).toBeCloseTo(0.0672);
    expect(spend.totalUsd).toBeCloseTo(0.0672);
    expect(cuts).toHaveLength(1);
    expect(fs.readdirSync(tmp).some(f => /^token-k-[0-9a-f]{8}-clipped1\.png$/.test(f))).toBe(true);
  });

  it('tokens: two clipped renders are refused, never cut or delivered', async () => {
    const { dispatch } = build(sequenceGemini(['clipped', 'clipped']));
    await expect(
      dispatch('generate-image', { kind: 'token', prompt: 'a knight', slug: 'k2' })
    ).rejects.toThrow(/Both renders clip the subject.*never delivered/);
    expect(sent).toHaveLength(2);
    expect(cuts).toHaveLength(0);
  });

  it('tokens: a clean first render is delivered with no retry', async () => {
    const { dispatch } = build(sequenceGemini(['clean']));
    const r: any = await dispatch('generate-image', {
      kind: 'token',
      prompt: 'a knight',
      slug: 'k3',
    });
    expect(sent).toHaveLength(1);
    expect(r.edgeRetried).toBeUndefined();
  });

  it('tokens: the framing and the edit keep line both forbid clipping at the edge', () => {
    expect(TOKEN_FRAMING).toMatch(/weapon.*inside the frame.*nothing touches or crosses the edge/);
    expect(TOKEN_EDIT_KEEP).toMatch(/weapons included, inside the frame/);
  });

  it('tokens: switches the plate to magenta when the reference subject is green', async () => {
    const { dispatch } = build();
    const r: any = await dispatch('generate-image', {
      kind: 'token',
      prompt: 'a goblin',
      slug: 'goblin',
      references: [{ path: greenRef, role: 'character' }],
    });
    expect(r.chromaKey).toBe('magenta');
    expect(sent[0].body.contents[0].parts.at(-1).text).toContain('chroma-key magenta (#FF00FF)');
    expect(cuts[0].color).toBe('magenta');
  });

  it('tokens: reads the prompt for the key, so a green dragon on a grey reference gets magenta', async () => {
    const { dispatch } = build();
    const r: any = await dispatch('generate-image', {
      kind: 'token',
      prompt: 'a young green dragon, olive scales, wings half-spread',
      slug: 'bramblemaw',
      references: [{ path: refPng, role: 'style', label: 'Morgash token' }],
    });
    expect(r.chromaKey).toBe('magenta');
    expect(sent[0].body.contents[0].parts.at(-1).text).toContain('chroma-key magenta (#FF00FF)');
    expect(cuts[0].color).toBe('magenta');
  });

  it('crops a confirmed pro illustration to 2560×1600 at the pro price', async () => {
    const { dispatch } = build(fakeGemini(4096, 2304));
    const r: any = await dispatch('generate-image', {
      kind: 'illustration',
      prompt: 'an inn',
      slug: 'inn',
      tier: 'pro',
      confirmPro: true,
    });
    expect(r).toMatchObject({ tier: 'pro', width: 2560, height: 1600, estimatedUsd: 0.24 });
    expect(sent[0].body.generationConfig.imageConfig).toEqual({
      aspectRatio: '16:9',
      imageSize: '4K',
    });
    expect(sent[0].url).toContain('gemini-3-pro-image');
  });

  it('refuses an unconfirmed pro call before any network call', async () => {
    const { dispatch } = build();
    await expect(
      dispatch('generate-image', { kind: 'portrait', prompt: 'x', slug: 'x', tier: 'pro' })
    ).rejects.toThrow(/confirmPro/);
    expect(sent).toHaveLength(0);
  });

  it('fails on a missing reference file before any network call', async () => {
    const { dispatch } = build();
    await expect(
      dispatch('generate-image', {
        kind: 'icon',
        prompt: 'x',
        slug: 'x',
        references: [{ path: path.join(tmp, 'nope.png'), role: 'style' }],
      })
    ).rejects.toThrow(/not found/);
    expect(sent).toHaveLength(0);
  });
});

describe('edit-image', () => {
  it('attaches the source first, defaults to flash, shifts reference numbering, and re-cuts tokens', async () => {
    const { dispatch } = build();
    const r: any = await dispatch('edit-image', {
      sourceImage: refPng,
      instruction: 'swap the sword for a maul',
      kind: 'token',
      slug: 'morgash',
      references: [{ path: refPng, role: 'style' }],
    });
    const parts = sent[0].body.contents[0].parts;
    expect(parts).toHaveLength(3);
    const text = parts[2].text;
    expect(text).toMatch(/^Image 1 is the token to edit\. Image 2 is a STYLE reference/);
    expect(text).toContain(`swap the sword for a maul. ${TOKEN_EDIT_KEEP}`);
    expect(text).toContain('chroma-key magenta');
    expect(r.tier).toBe('flash');
    expect(path.basename(r.file)).toMatch(/^token-morgash-[0-9a-f]{8}\.png$/);
    expect(cuts).toHaveLength(1);
  });

  it('prompts token edits light: instruction, keep line, plate; no strict preamble or framing', async () => {
    const { dispatch } = build();
    await dispatch('edit-image', {
      sourceImage: refPng,
      instruction: 'give this elf a sword and armor instead.',
      kind: 'token',
      slug: 'elf',
    });
    const text = sent[0].body.contents[0].parts[1].text;
    expect(text).toMatch(
      new RegExp(
        `^give this elf a sword and armor instead\\. ${TOKEN_EDIT_KEEP} The ENTIRE image background`
      )
    );
    expect(text).not.toContain(EDIT_PREAMBLE);
    expect(text).not.toContain(TOKEN_FRAMING);
  });

  it('keeps the strict preamble for non-token edits', async () => {
    const { dispatch } = build();
    await dispatch('edit-image', {
      sourceImage: refPng,
      instruction: 'remove the second fireball',
      kind: 'illustration',
      slug: 'x',
    });
    const text = sent[0].body.contents[0].parts[1].text;
    expect(text.startsWith(EDIT_PREAMBLE)).toBe(true);
    expect(text).toContain('Instruction: remove the second fireball');
  });

  it('samples the SOURCE token for the key: a green source gets a magenta plate', async () => {
    const { dispatch } = build();
    const r: any = await dispatch('edit-image', {
      sourceImage: greenRef,
      instruction: 'add a scar',
      kind: 'token',
      slug: 'goblin',
    });
    expect(r.chromaKey).toBe('magenta');
  });

  it('reads the edit instruction for the key: a cloak recoloured green leaves the green plate', async () => {
    const { dispatch } = build();
    const r: any = await dispatch('edit-image', {
      sourceImage: refPng,
      instruction: 'make the cloak forest green',
      kind: 'token',
      slug: 'morgash',
    });
    expect(r.chromaKey).toBe('magenta');
  });

  it('still gates an explicit pro edit', async () => {
    const { dispatch } = build();
    await expect(
      dispatch('edit-image', {
        sourceImage: refPng,
        instruction: 'x',
        kind: 'portrait',
        slug: 'x',
        tier: 'pro',
      })
    ).rejects.toThrow(/confirmPro/);
  });
});

describe('props', () => {
  it('generate: footprint sets the API aspect and the exact tile size; object-only framing', async () => {
    const { dispatch } = build();
    const r: any = await dispatch('generate-image', {
      kind: 'prop',
      prompt: 'a blacksmith anvil on a wooden stump',
      slug: 'anvil',
      footprint: '2x1',
    });
    const body = sent[0].body;
    expect(body.generationConfig.imageConfig.aspectRatio).toBe('16:9');
    const text = body.contents[0].parts.at(-1).text;
    expect(text).toContain(PROP_FRAMING);
    expect(text).not.toMatch(/face tilts up|hair/);
    expect(text).toContain('chroma-key');
    expect(cuts).toHaveLength(1);
    expect(cuts[0].size).toBe(0); // the tool fits the prop itself, not the square-fitting script
    expect(path.basename(r.file)).toMatch(/^prop-anvil-[0-9a-f]{8}\.png$/);
    expect(r).toMatchObject({ kind: 'prop', width: 600, height: 300 });
    const m = await sharp(r.file).metadata();
    expect([m.width, m.height]).toEqual([600, 300]);
  });

  it('generate: a prop with no footprint is one cell, 300 square', async () => {
    const { dispatch } = build();
    const r: any = await dispatch('generate-image', {
      kind: 'prop',
      prompt: 'a barrel',
      slug: 'barrel',
    });
    expect(sent[0].body.generationConfig.imageConfig.aspectRatio).toBe('1:1');
    expect(r).toMatchObject({ width: 300, height: 300 });
  });

  it('generate: refuses a malformed footprint before calling the API', async () => {
    const { dispatch } = build();
    await expect(
      dispatch('generate-image', { kind: 'prop', prompt: 'x', slug: 'x', footprint: 'big' })
    ).rejects.toThrow();
    expect(sent).toHaveLength(0);
  });

  it('edit: keeps the source size and shape, with the object-only keep line', async () => {
    const { dispatch } = build();
    const r: any = await dispatch('edit-image', {
      sourceImage: propSrc,
      instruction: 'repaint this prop at much higher quality',
      kind: 'prop',
      slug: 'anvil',
    });
    const text = sent[0].body.contents[0].parts.at(-1).text;
    expect(sent[0].body.generationConfig.imageConfig.aspectRatio).toBe('16:9');
    expect(text).toContain(`repaint this prop at much higher quality. ${PROP_EDIT_KEEP}`);
    expect(text).not.toContain(TOKEN_EDIT_KEEP);
    expect(text).not.toMatch(/face, hair/);
    expect(r).toMatchObject({ kind: 'prop', width: 600, height: 300 });
    // The model saw the source with a transparent margin (12% of the long side, 72 px).
    const sentSource = Buffer.from(sent[0].body.contents[0].parts[0].inline_data.data, 'base64');
    const sm = await sharp(sentSource).metadata();
    expect([sm.width, sm.height]).toEqual([744, 444]);
    // The new art went back where the original sat, at the original's scale.
    const { data, info } = await sharp(r.file).raw().toBuffer({ resolveWithObject: true });
    const alpha = (x: number, y: number) => data[(y * info.width + x) * 4 + 3];
    expect(alpha(300, 150)).toBe(255);
    expect(alpha(40, 150)).toBe(0);
    expect(alpha(560, 150)).toBe(0);
  });
});

describe('battlemaps', () => {
  it('edit: pads to the API aspect, pins the layout, and lands on the source grid, upscaled', async () => {
    const { dispatch, spend } = build(mapGemini(['faithful']));
    const r: any = await dispatch('edit-image', {
      sourceImage: mapSrc,
      instruction: 'repaint this battlemap as a hand-painted oil painting.',
      kind: 'battlemap',
      slug: 'tavern',
    });
    const cfg = sent[0].body.generationConfig.imageConfig;
    expect(cfg).toEqual({ aspectRatio: '4:3', imageSize: '4K' });
    const text = sent[0].body.contents[0].parts.at(-1).text;
    expect(text).toBe(
      `repaint this battlemap as a hand-painted oil painting. ${BATTLEMAP_EDIT_KEEP}`
    );
    expect(text).not.toContain(EDIT_PREAMBLE);
    // The model saw the source with a mirrored margin, at exactly the API aspect.
    const seen = await sharp(
      Buffer.from(sent[0].body.contents[0].parts[0].inline_data.data, 'base64')
    ).metadata();
    expect(seen.width).toBeGreaterThan(400);
    expect(Math.abs((seen.width ?? 0) * 3 - (seen.height ?? 0) * 4)).toBeLessThanOrEqual(4);
    // 1200x896 has room for 2x the 400x300 source: delivered at exactly 800x600.
    expect(r).toMatchObject({
      kind: 'battlemap',
      tier: 'flash',
      source: { width: 400, height: 300 },
      scale: 2,
    });
    expect(await sharp(r.file).metadata()).toMatchObject({
      width: 800,
      height: 600,
      format: 'webp',
    });
    expect(path.basename(r.file)).toMatch(/^battlemap-tavern-[0-9a-f]{8}\.webp$/);
    expect(r.drift.failed).toBe(false);
    expect(r.driftRetried).toBeUndefined();
    expect(fs.existsSync(r.check)).toBe(true);
    expect(spend.calls).toBe(1);
    expect(r.estimatedUsd).toBe(0.113);
  });

  it('edit: a drifted render is redone once, both billed, and the clean one delivered', async () => {
    const { dispatch, spend } = build(mapGemini(['slid', 'faithful']));
    const r: any = await dispatch('edit-image', {
      sourceImage: mapSrc,
      instruction: 'repaint',
      kind: 'battlemap',
      slug: 'tavern2',
    });
    expect(sent).toHaveLength(2);
    expect(r.driftRetried).toBe(true);
    expect(r.drift.failed).toBe(false);
    expect(spend.calls).toBe(2);
    expect(r.estimatedUsd).toBeCloseTo(0.226);
    expect(
      fs.readdirSync(tmp).some(f => /^battlemap-tavern2-[0-9a-f]{8}-drifted1\.webp$/.test(f))
    ).toBe(true);
  });

  it('edit: two drifted renders are refused, kept for inspection, never delivered', async () => {
    const { dispatch } = build(mapGemini(['slid', 'slid']));
    await expect(
      dispatch('edit-image', {
        sourceImage: mapSrc,
        instruction: 'repaint',
        kind: 'battlemap',
        slug: 'tavern3',
      })
    ).rejects.toThrow(/Both renders moved the map's layout.*never delivered/);
    expect(sent).toHaveLength(2);
    const files = fs.readdirSync(tmp).filter(f => f.startsWith('battlemap-tavern3-'));
    expect(files.some(f => f.endsWith('-drifted2.webp'))).toBe(true);
    expect(files.some(f => /^battlemap-tavern3-[0-9a-f]{8}\.(webp|png)$/.test(f))).toBe(false);
  });

  it('edit: a style reference lends finish only, never camera angle or layout', async () => {
    const { dispatch } = build(mapGemini(['faithful']));
    await dispatch('edit-image', {
      sourceImage: mapSrc,
      instruction: 'repaint',
      kind: 'battlemap',
      slug: 'tavern4',
      references: [{ path: refPng, role: 'style' }],
    });
    const text = sent[0].body.contents[0].parts.at(-1).text;
    expect(text).toMatch(/^Image 1 is the map to edit\. Image 2 is a STYLE reference only/);
    expect(text).toMatch(/no layout, no objects/);
    expect(text).not.toMatch(/camera angle; do not copy/);
  });

  it('generate: refuses a battlemap before any network call (maps are bought, with walls)', async () => {
    const { dispatch } = build(mapGemini(['faithful']));
    await expect(
      dispatch('generate-image', { kind: 'battlemap', prompt: 'a tavern', slug: 'x' })
    ).rejects.toThrow(/edit-image.*sourceImage/);
    expect(sent).toHaveLength(0);
  });

  it('edit: a partly nudged render is battlemap drift (walls would miss)', async () => {
    const { dispatch } = build(mapGemini(['nudged', 'nudged']));
    await expect(
      dispatch('edit-image', {
        sourceImage: mapSrc,
        instruction: 'repaint',
        kind: 'battlemap',
        slug: 'tavern5',
      })
    ).rejects.toThrow(/never delivered/);
  });

  it('edit: the keep line locks the layout and the contents, and leaves palette to the instruction', () => {
    expect(BATTLEMAP_EDIT_KEEP).toMatch(/walls, doors and lights are traced/);
    expect(BATTLEMAP_EDIT_KEEP).toMatch(/never what is in it/);
    expect(BATTLEMAP_EDIT_KEEP).toMatch(/cutaway floor plan/);
    expect(BATTLEMAP_EDIT_KEEP).not.toMatch(/same colou?rs/);
  });
});

describe('cutout-image', () => {
  it('defaults the output beside the source as <name>-cut.png and forwards options', async () => {
    const { dispatch } = build();
    const r: any = await dispatch('cutout-image', {
      sourceImage: refPng,
      method: 'chroma',
      color: 'magenta',
      erode: 1,
      padPct: 8,
      trim: false,
      dropShadow: true,
    });
    expect(r.file).toBe(path.join(tmp, 'ref-cut.png'));
    expect(cuts[0]).toMatchObject({
      input: refPng,
      method: 'chroma',
      color: 'magenta',
      erode: 1,
      padPct: 8,
      trim: false,
      dropShadow: true,
    });
  });

  it('leaves the drop shadow off by default for outside art', async () => {
    const { dispatch } = build();
    await dispatch('cutout-image', { sourceImage: refPng });
    expect(cuts[0].dropShadow).toBeUndefined();
  });

  it('rejects an output equal to the source and a bad colour', async () => {
    const { dispatch } = build();
    await expect(dispatch('cutout-image', { sourceImage: refPng, output: refPng })).rejects.toThrow(
      /must differ/
    );
    await expect(dispatch('cutout-image', { sourceImage: refPng, color: 'teal' })).rejects.toThrow(
      /green, magenta, blue/
    );
  });
});

describe('imagegen-status', () => {
  it('reports key presence, model reachability, output dir, and spend', async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ models: [{ name: 'models/gemini-nano-banana-2.1' }] }), {
        status: 200,
      })) as typeof fetch;
    const gemini = new Gemini({ apiKey: 'k', timeoutMs: 1000, fetch: fakeFetch });
    const { dispatch } = build(gemini);
    const s: any = await dispatch('imagegen-status', {});
    expect(s).toMatchObject({
      keyPresent: true,
      models: { flash: true, pro: false },
      outputDir: tmp,
    });
    expect(s.spend).toEqual({ calls: 0, estimatedUsd: 0, byTier: { flash: 0, pro: 0 } });
  });

  it('says so when the key is missing without calling out', async () => {
    const { dispatch } = build(new Gemini({ apiKey: '', timeoutMs: 1 }));
    const s: any = await dispatch('imagegen-status', {});
    expect(s.keyPresent).toBe(false);
    expect(s.models).toEqual({});
  });
});

describe('overland maps', () => {
  it('edit: lands on the source grid, painted bare, with the overland keep line', async () => {
    const { dispatch, spend } = build(mapGemini(['faithful']));
    const r: any = await dispatch('edit-image', {
      sourceImage: mapSrc,
      instruction: 'repaint this map as an antique hand-painted atlas.',
      kind: 'overland',
      slug: 'halruaa',
    });
    const text = sent[0].body.contents[0].parts.at(-1).text;
    expect(text).toBe(`repaint this map as an antique hand-painted atlas. ${OVERLAND_EDIT_KEEP}`);
    expect(text).not.toContain(BATTLEMAP_EDIT_KEEP);
    expect(sent[0].body.generationConfig.imageConfig).toEqual({
      aspectRatio: '4:3',
      imageSize: '4K',
    });
    expect(r).toMatchObject({ kind: 'overland', source: { width: 400, height: 300 }, scale: 2 });
    expect(path.basename(r.file)).toMatch(/^overland-halruaa-[0-9a-f]{8}\.webp$/);
    expect(fs.existsSync(r.check)).toBe(true);
    expect(spend.calls).toBe(1);
  });

  it('edit: a partly nudged geography is delivered (the check is advisory below gross drift)', async () => {
    const { dispatch, spend } = build(mapGemini(['nudged']));
    const r: any = await dispatch('edit-image', {
      sourceImage: mapSrc,
      instruction: 'repaint',
      kind: 'overland',
      slug: 'halruaa2',
    });
    expect(r.drift.drifted).toBeGreaterThan(0);
    expect(r.drift.failed).toBe(false);
    expect(r.driftRetried).toBeUndefined();
    expect(spend.calls).toBe(1);
  });

  it('edit: a wholly moved geography is redone, then refused, both kept', async () => {
    const { dispatch } = build(mapGemini(['slid', 'slid']));
    await expect(
      dispatch('edit-image', {
        sourceImage: mapSrc,
        instruction: 'repaint',
        kind: 'overland',
        slug: 'halruaa3',
      })
    ).rejects.toThrow(/geography moved too far/);
    expect(sent).toHaveLength(2);
    const files = fs.readdirSync(tmp).filter(f => f.startsWith('overland-halruaa3-'));
    expect(files.some(f => f.endsWith('-drifted2.webp'))).toBe(true);
  });

  it('generate: refuses an overland map before any network call (it starts from a real map)', async () => {
    const { dispatch } = build(mapGemini(['faithful']));
    await expect(
      dispatch('generate-image', { kind: 'overland', prompt: 'a kingdom', slug: 'x' })
    ).rejects.toThrow(/overland is a repaint.*edit-image.*sourceImage/);
    expect(sent).toHaveLength(0);
  });

  it('the keep line locks the geography and paints out every name and symbol', () => {
    expect(OVERLAND_EDIT_KEEP).toMatch(/geography is locked/);
    expect(OVERLAND_EDIT_KEEP).toMatch(/Paint over every piece of lettering/);
    expect(OVERLAND_EDIT_KEEP).toMatch(/compass rose, scale bar/);
    expect(OVERLAND_EDIT_KEEP).not.toMatch(/walls, doors/);
  });
});
