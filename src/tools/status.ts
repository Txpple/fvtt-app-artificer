// imagegen-status — the cold-start doctor: is the key set and accepted (a free models list, no
// generation credit), which models it reaches, is the output folder writable and outside any git
// repo, can the configured Python run the cutout, and what has this session spent so far
// (estimated; the API has no balance call). Every check ends in one actionable line. The checks
// live in src/doctor.ts, shared with `npm run doctor` (scripts/doctor.mjs).

import { z } from 'zod';
import { runDoctor } from '../doctor.js';
import { toInputSchema } from '../utils/schema.js';
import type { ToolDeps } from './shared.js';

const statusSchema = z.object({});

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

  async handleStatus(args: unknown) {
    statusSchema.parse(args);
    const report = await runDoctor(this.deps);
    return {
      ready: report.ready,
      checks: report.checks,
      keyPresent: this.deps.gemini.hasKey,
      models: report.models,
      ...(report.error ? { error: report.error } : {}),
      outputDir: this.deps.outputDir,
      cutoutScript: 'scripts/token_cutout.py (chroma; rembg fallback when installed)',
      spend: this.deps.spend.summary(),
    };
  }
}
