// imagegen-status — the cold-start doctor: is the key set and accepted (a free models list, no
// generation credit), which models it reaches, is the output folder writable and outside any git
// repo, can the configured Python run the cutout, and what has this session spent so far
// (estimated; the API has no balance call). Every check ends in one actionable line.

import { z } from 'zod';
import { type Check, checkOutputDir } from '../doctor.js';
import { isKeyRejection, MODELS } from '../gemini.js';
import { toInputSchema } from '../utils/schema.js';
import type { ToolDeps } from './shared.js';

const statusSchema = z.object({});

const KEY_URL = 'https://aistudio.google.com/apikey';
const KEY_HELP = `Create one at ${KEY_URL} in a Google Cloud project with billing on (the image models are paid-tier only)`;

export class StatusTool {
  constructor(private readonly deps: ToolDeps) {}

  getToolDefinitions() {
    return [
      {
        name: 'imagegen-status',
        description:
          'Setup doctor and health check: API key present and accepted (no generation credit ' +
          'spent), which image models the key can reach, the output directory (writable, ' +
          'outside any git repo), the cutout Python (Pillow, numpy, rembg), and estimated ' +
          'session spend by tier. Call this first on a cold start.',
        inputSchema: toInputSchema(statusSchema),
      },
    ];
  }

  private async keyCheck(): Promise<{
    check: Check;
    models: Record<string, boolean>;
    error?: string;
  }> {
    if (!this.deps.gemini.hasKey) {
      return {
        check: {
          check: 'key',
          status: 'fail',
          message: `GEMINI_API_KEY is not set. ${KEY_HELP}, put it in this server's .env, and restart Claude Code.`,
        },
        models: {},
      };
    }
    try {
      const available = await this.deps.gemini.availableModels();
      const models = Object.fromEntries(
        Object.entries(MODELS).map(([tier, id]) => [tier, available.includes(id)])
      );
      const unseen = Object.entries(MODELS).filter(([tier]) => !models[tier]);
      if (unseen.length) {
        return {
          check: {
            check: 'key',
            status: unseen.length === Object.keys(MODELS).length ? 'fail' : 'warn',
            message: `Key accepted, but it cannot see ${unseen.map(([tier, id]) => `${tier} (${id})`).join(' or ')}; renders on that tier will fail. Check the key's project has billing on and the model is offered in its region.`,
          },
          models,
        };
      }
      return {
        check: { check: 'key', status: 'ok', message: 'Key accepted; both tiers reachable.' },
        models,
      };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      return {
        check: isKeyRejection(e)
          ? {
              check: 'key',
              status: 'fail',
              message: `Gemini rejected GEMINI_API_KEY (${error}). Copy the key again from ${KEY_URL} into .env (no quotes or spaces) and restart Claude Code.`,
            }
          : {
              check: 'key',
              status: 'warn',
              message: `Could not confirm the key: ${error}. Check the network and try again.`,
            },
        models: {},
        error,
      };
    }
  }

  async handleStatus(args: unknown) {
    statusSchema.parse(args);
    const key = await this.keyCheck();
    const checks: Check[] = [key.check, checkOutputDir(this.deps.outputDir)];
    if (this.deps.checkPython) checks.push(await this.deps.checkPython());
    return {
      ready: checks.every(c => c.status !== 'fail'),
      checks,
      keyPresent: this.deps.gemini.hasKey,
      models: key.models,
      ...(key.error ? { error: key.error } : {}),
      outputDir: this.deps.outputDir,
      cutoutScript: 'scripts/token_cutout.py (chroma; rembg fallback when installed)',
      spend: this.deps.spend.summary(),
    };
  }
}
