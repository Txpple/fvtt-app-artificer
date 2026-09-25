// Cutout: knock a token's plate out to alpha by spawning the bundled Python script. The script owns
// the pixels (chroma key with despill and feathering, or the rembg AI matte); this wrapper owns
// the contract: arguments, parsing, verification, and the fallback from chroma to rembg.

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { CHROMA_KEYS, type ChromaKey, scoreKeys } from './chroma.js';

const SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'token_cutout.py'
);

export type CutoutMethod = 'auto' | 'chroma' | 'rembg';

export interface CutoutOptions {
  input: string;
  output: string;
  method?: CutoutMethod;
  /** Chroma key colour as #RRGGBB or a named key; omitted = the script samples the corners. */
  color?: string | ChromaKey;
  keepShadow?: boolean;
  /** Composite the world tokens' cast shadow under the cut (before the square fit). */
  dropShadow?: boolean;
  erode?: number;
  /** Square canvas edge; 0 keeps the source canvas. Default 512 (Foundry scale 1.0). */
  size?: number;
  padPct?: number;
  trim?: boolean;
}

export interface CutoutResult {
  file: string;
  preview: string;
  method: 'chroma' | 'rembg';
  /** % of the SOURCE frame the subject covers, per the script. */
  coveragePct: number;
  /** % of the delivered opaque pixels still carrying the key hue (fringe / interior residue). */
  residualKeyPct: number;
  width: number;
  height: number;
  /** Set when the first attempt failed verification and rembg was used instead. */
  fellBackToRembg?: boolean;
}

export type CutoutFn = (opts: CutoutOptions) => Promise<CutoutResult>;

export function buildArgs(opts: CutoutOptions): string[] {
  const args = [SCRIPT, opts.input, opts.output, '--method', opts.method ?? 'auto'];
  if (opts.color) {
    const hex = opts.color in CHROMA_KEYS ? CHROMA_KEYS[opts.color as ChromaKey] : opts.color;
    args.push('--color', hex.replace(/^#/, ''));
  }
  if (opts.keepShadow) args.push('--keep-shadow');
  if (opts.dropShadow) args.push('--drop-shadow');
  if (opts.erode && opts.erode > 0) args.push('--erode', String(opts.erode));
  if (opts.size !== undefined) args.push('--size', String(opts.size));
  if (opts.padPct !== undefined) args.push('--pad', String(opts.padPct));
  if (opts.trim === false) args.push('--no-trim');
  return args;
}

export function parseScriptOutput(stdout: string): {
  method: 'chroma' | 'rembg';
  coveragePct: number;
} {
  const method = /^method:\s*(chroma|rembg)/m.exec(stdout)?.[1] as 'chroma' | 'rembg' | undefined;
  const cov = /subject coverage:\s*([\d.]+)%/.exec(stdout)?.[1];
  if (!method || cov === undefined) {
    throw new Error(`cutout script output not understood:\n${stdout.slice(0, 500)}`);
  }
  return { method, coveragePct: Number(cov) };
}

function run(python: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', d => {
      out += d;
    });
    child.stderr.on('data', d => {
      err += d;
    });
    child.on('error', e => reject(new Error(`cannot run ${python}: ${e.message}`)));
    child.on('close', code => {
      if (code === 0) resolve(out);
      else reject(new Error(`token_cutout.py exited ${code}: ${(err || out).slice(0, 800)}`));
    });
  });
}

/** How much key hue survives in the delivered opaque pixels. */
export async function residualKey(file: string, key: ChromaKey | undefined): Promise<number> {
  if (!key) return 0;
  const scores = await scoreKeys(fs.readFileSync(file));
  return Math.round((scores.find(s => s.key === key)?.risk ?? 0) * 1000) / 10;
}

/** Coverage outside this band means the key was misread (all or nothing was cut). */
const COVERAGE_MIN = 3;
const COVERAGE_MAX = 97;
const RESIDUAL_MAX = 2;

export function makeCutout(python: string): CutoutFn {
  return async function cutout(opts: CutoutOptions): Promise<CutoutResult> {
    if (!fs.existsSync(opts.input)) throw new Error(`image not found: ${opts.input}`);
    if (!fs.existsSync(SCRIPT)) throw new Error(`cutout script missing: ${SCRIPT}`);
    const namedKey =
      opts.color && opts.color in CHROMA_KEYS ? (opts.color as ChromaKey) : undefined;

    const attempt = async (method: CutoutMethod) => {
      const stdout = await run(python, buildArgs({ ...opts, method }));
      const parsed = parseScriptOutput(stdout);
      const meta = await sharp(opts.output).metadata();
      const res: CutoutResult = {
        file: opts.output,
        preview: `${opts.output.replace(/\.png$/i, '')}_preview.png`,
        method: parsed.method,
        coveragePct: parsed.coveragePct,
        residualKeyPct: await residualKey(opts.output, namedKey),
        width: meta.width ?? 0,
        height: meta.height ?? 0,
      };
      return res;
    };

    // Our 'auto' is chroma first (the plate colour is known exactly), rembg only as the fallback.
    // The script's own --method auto prefers rembg whenever it is installed, so never pass it.
    const requested = opts.method ?? 'auto';
    const first = await attempt(requested === 'auto' ? 'chroma' : requested);
    const bad =
      first.coveragePct < COVERAGE_MIN ||
      first.coveragePct > COVERAGE_MAX ||
      first.residualKeyPct > RESIDUAL_MAX;
    if (bad && requested === 'auto') {
      // Chroma misread the plate or the subject shares the key hue. Let the AI matte try.
      try {
        const second = await attempt('rembg');
        return { ...second, fellBackToRembg: true };
      } catch {
        return first; // rembg unavailable: hand back the chroma cut with its numbers visible.
      }
    }
    return first;
  };
}
