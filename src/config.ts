// Env/config loader. Loads .env from the repo root regardless of the launch cwd (Claude Code may
// start the server from anywhere), then resolves everything once so the rest of the code never
// touches process.env.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// dist/config.js → repo root is one level up. (src/config.ts sees the same shape under vitest.)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const config = {
  server: { name: 'fvtt-mcp-artificer', version: readPackageVersion() },
  /** Gemini API key. Empty string when unset; tools report that instead of crashing at startup. */
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  /** Where finished renders land before curation and staging. Outside any git repo. */
  outputDir: process.env.ARTIFICER_OUTPUT_DIR ?? 'D:\\Workbench\\LOCAL\\artificer-output',
  /** Python interpreter for the cutout script (needs Pillow + numpy; rembg optional). */
  pythonBin: process.env.ARTIFICER_PYTHON ?? 'python',
  /** Max wait for a single API call. */
  timeoutMs: Number(process.env.ARTIFICER_TIMEOUT_MS ?? 120_000),
};
