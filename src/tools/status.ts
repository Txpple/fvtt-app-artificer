// artificer-status — cold-start diagnosability: is the key set, can it see both models, where do
// files land, and what has this session spent so far (estimated; the API has no balance call).

import { z } from 'zod';
import { MODELS } from '../gemini.js';
import { toInputSchema } from '../utils/schema.js';
import type { ToolDeps } from './shared.js';

const statusSchema = z.object({});

export class StatusTool {
  constructor(private readonly deps: ToolDeps) {}

  getToolDefinitions() {
    return [
      {
        name: 'artificer-status',
        description:
          'Health check: API key present, which image models the key can reach, the output ' +
          'directory, and estimated session spend by tier. Call this first on a cold start.',
        inputSchema: toInputSchema(statusSchema),
      },
    ];
  }

  async handleStatus(args: unknown) {
    statusSchema.parse(args);
    const keyPresent = this.deps.gemini.hasKey;
    let models: Record<string, boolean> = {};
    let error: string | undefined;
    if (keyPresent) {
      try {
        const available = await this.deps.gemini.availableModels();
        models = Object.fromEntries(
          Object.entries(MODELS).map(([tier, id]) => [tier, available.includes(id)])
        );
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      }
    }
    return {
      keyPresent,
      models,
      ...(error ? { error } : {}),
      outputDir: this.deps.outputDir,
      cutoutScript: 'scripts/token_cutout.py (chroma; rembg fallback when installed)',
      spend: this.deps.spend.summary(),
    };
  }
}
