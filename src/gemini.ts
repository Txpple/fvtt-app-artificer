// The one HTTP seam. Nothing else in the server talks to the network. Speaks the Gemini
// `generateContent` REST shape directly (no SDK): text + inline images in, one inline image out.
// Model ids and per-image prices live here and nowhere else.

export const TIERS = ['flash', 'pro'] as const;
export type Tier = (typeof TIERS)[number];

export const SIZES = ['1K', '2K', '4K'] as const;
export type ImageSize = (typeof SIZES)[number];

export const ASPECTS = ['1:1', '3:4', '4:3', '16:9', '9:16', '3:2', '2:3'] as const;
export type Aspect = (typeof ASPECTS)[number];

/** Model ids exactly as the API lists them (verified 2026-09-19). */
export const MODELS: Record<Tier, string> = {
  flash: 'gemini-3.1-flash-image',
  pro: 'gemini-3-pro-image',
};

/** USD per generated image, from the published price table (2026-09-19). Estimates only. */
export const PRICE: Record<Tier, Record<ImageSize, number>> = {
  flash: { '1K': 0.067, '2K': 0.101, '4K': 0.151 },
  pro: { '1K': 0.134, '2K': 0.134, '4K': 0.24 },
};

export interface InlineImage {
  data: Buffer;
  mimeType: string;
}

export interface GenerateRequest {
  tier: Tier;
  prompt: string;
  /** Reference / source images, in the order the prompt refers to them. */
  images?: InlineImage[];
  aspect: Aspect;
  size: ImageSize;
}

export interface GenerateResult {
  image: InlineImage;
  model: string;
  finishReason: string;
}

export interface GeminiOptions {
  apiKey: string;
  timeoutMs: number;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  baseUrl?: string;
}

/** Shape the request body exactly as the API expects. Pure; unit-tested on its own. */
export function buildRequestBody(req: GenerateRequest): Record<string, unknown> {
  const parts: Array<Record<string, unknown>> = [];
  for (const img of req.images ?? []) {
    parts.push({ inline_data: { mime_type: img.mimeType, data: img.data.toString('base64') } });
  }
  parts.push({ text: req.prompt });
  return {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio: req.aspect, imageSize: req.size },
    },
  };
}

/** Pull the one image out of a response, or explain precisely why there is none. */
export function parseResponse(json: any, model: string): GenerateResult {
  const blocked = json?.promptFeedback?.blockReason;
  if (blocked) throw new Error(`Gemini blocked the prompt: ${blocked}`);
  const cand = json?.candidates?.[0];
  const part = cand?.content?.parts?.find((p: any) => p?.inlineData?.data);
  if (!part) {
    const text = (cand?.content?.parts ?? [])
      .map((p: any) => p?.text)
      .filter(Boolean)
      .join(' ')
      .slice(0, 300);
    throw new Error(
      `Gemini returned no image (finishReason=${cand?.finishReason ?? 'none'})${text ? `: ${text}` : ''}`
    );
  }
  return {
    image: {
      data: Buffer.from(part.inlineData.data, 'base64'),
      mimeType: String(part.inlineData.mimeType ?? 'image/jpeg'),
    },
    model,
    finishReason: String(cand?.finishReason ?? ''),
  };
}

export class Gemini {
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly opts: GeminiOptions) {
    this.fetchFn = opts.fetch ?? fetch;
    this.baseUrl = opts.baseUrl ?? 'https://generativelanguage.googleapis.com/v1beta';
  }

  get hasKey(): boolean {
    return this.opts.apiKey.length > 0;
  }

  /**
   * One render. An IMAGE_SAFETY finish is retried once: the filter is not deterministic on the
   * same input (a harpy token was blocked, then passed on the identical request, 2026-09-24).
   * Prompt-level blocks and every other failure surface immediately.
   */
  async generate(req: GenerateRequest): Promise<GenerateResult> {
    try {
      return await this.generateOnce(req);
    } catch (e) {
      if (!(e instanceof Error) || !/finishReason=IMAGE_SAFETY/.test(e.message)) throw e;
      try {
        return await this.generateOnce(req);
      } catch (e2) {
        if (e2 instanceof Error) e2.message = `${e2.message} (blocked twice; retried once)`;
        throw e2;
      }
    }
  }

  private async generateOnce(req: GenerateRequest): Promise<GenerateResult> {
    if (!this.hasKey) throw new Error('GEMINI_API_KEY is not set in .env');
    const model = MODELS[req.tier];
    const res = await this.fetchFn(`${this.baseUrl}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': this.opts.apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(buildRequestBody(req)),
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message ?? JSON.stringify(json).slice(0, 300);
      throw new Error(`Gemini HTTP ${res.status}: ${msg}`);
    }
    return parseResponse(json, model);
  }

  /** Which of our two models this key can see. Empty when unreachable. */
  async availableModels(): Promise<string[]> {
    if (!this.hasKey) return [];
    const res = await this.fetchFn(`${this.baseUrl}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': this.opts.apiKey },
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });
    if (!res.ok) throw new Error(`Gemini HTTP ${res.status} listing models`);
    const json: any = await res.json();
    const names: string[] = (json?.models ?? []).map((m: any) => String(m.name ?? ''));
    return Object.values(MODELS).filter(id => names.includes(`models/${id}`));
  }
}
