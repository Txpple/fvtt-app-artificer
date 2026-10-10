// The setup checks behind imagegen-status and `npm run doctor`: is the key set and accepted (a free
// models list, never a render), is the output directory usable (writable, outside any git repo),
// and can the configured Python run the cutout script (Pillow + numpy; rembg optional). Each check
// ends in one actionable line. Nothing here spends API credit or writes outside a throwaway probe
// that is removed at once.

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Gemini, isKeyRejection, MODELS, type Tier } from './gemini.js';

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface Check {
  check: string;
  status: CheckStatus;
  message: string;
}

const REQUIREMENTS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'requirements.txt'
);

/** The nearest directory at or above `dir` that exists (the drive root at worst). */
function nearestExisting(dir: string): string {
  let cur = path.resolve(dir);
  while (!fs.existsSync(cur)) {
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return cur;
}

/** The working tree root holding `dir` (a `.git` folder or worktree file), or undefined. */
export function findGitRoot(dir: string): string | undefined {
  let cur = nearestExisting(dir);
  for (;;) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    const up = path.dirname(cur);
    if (up === cur) return undefined;
    cur = up;
  }
}

function probeWritable(dir: string): string | undefined {
  try {
    const probe = fs.mkdtempSync(path.join(dir, '.imagegen-probe-'));
    fs.rmdirSync(probe);
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * The renders folder: writable (or creatable: the server makes it, parents included, on the
 * first render) and outside any git repo, since raw renders are curated before any is committed.
 */
export function checkOutputDir(dir: string): Check {
  const abs = path.resolve(dir);
  const exists = fs.existsSync(abs);
  if (exists && !fs.statSync(abs).isDirectory()) {
    return {
      check: 'output-dir',
      status: 'fail',
      message: `${abs} is a file, not a folder. Point IMAGEGEN_OUTPUT_DIR in .env at a folder.`,
    };
  }
  const probeAt = exists ? abs : nearestExisting(abs);
  const err = probeWritable(probeAt);
  if (err) {
    return {
      check: 'output-dir',
      status: 'fail',
      message: `${exists ? abs : `${abs} (to be created under ${probeAt})`} is not writable: ${err}. Set IMAGEGEN_OUTPUT_DIR in .env to a folder you can write.`,
    };
  }
  const repo = findGitRoot(abs);
  if (repo) {
    return {
      check: 'output-dir',
      status: 'warn',
      message: `${abs} is inside the git repo at ${repo}; every raw render would show up there as an untracked file. Set IMAGEGEN_OUTPUT_DIR in .env to a folder outside any repo.`,
    };
  }
  return {
    check: 'output-dir',
    status: 'ok',
    message: exists
      ? `${abs} is writable and outside any git repo.`
      : `${abs} does not exist yet; it is created on the first render (its parent is writable).`,
  };
}

/** What the probe script prints: the interpreter, and each package's version or null. */
interface PythonProbe {
  executable: string;
  version: string;
  pillow: string | null;
  numpy: string | null;
  rembg: boolean;
}

// Imports Pillow and numpy for real (a broken install fails here, not mid-cutout); rembg is only
// located, since importing it loads onnxruntime and takes seconds.
const PROBE = [
  'import importlib.util, json, sys',
  'r = {"executable": sys.executable, "version": sys.version.split()[0]}',
  'for mod, key in (("PIL", "pillow"), ("numpy", "numpy")):',
  '    try:',
  '        r[key] = getattr(__import__(mod), "__version__", "?")',
  '    except Exception:',
  '        r[key] = None',
  'r["rembg"] = importlib.util.find_spec("rembg") is not None',
  'print(json.dumps(r))',
].join('\n');

export interface RunOutcome {
  /** Set when the process could not be started at all (ENOENT and the like). */
  spawnError?: string;
  code: number | null;
  stdout: string;
  stderr: string;
}

function runProbe(python: string, timeoutMs: number): Promise<RunOutcome> {
  return new Promise(resolve => {
    let out = '';
    let err = '';
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(python, ['-c', PROBE], {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: timeoutMs,
        windowsHide: true,
      });
    } catch (e) {
      resolve({
        spawnError: e instanceof Error ? e.message : String(e),
        code: null,
        stdout: '',
        stderr: '',
      });
      return;
    }
    child.stdout?.on('data', d => {
      out += d;
    });
    child.stderr?.on('data', d => {
      err += d;
    });
    child.on('error', e =>
      resolve({ spawnError: e.message, code: null, stdout: out, stderr: err })
    );
    child.on('close', code => resolve({ code, stdout: out, stderr: err }));
  });
}

/** Turn one probe run into the check line. Pure; unit-tested on its own. */
export function judgePython(python: string, run: RunOutcome): Check {
  const install = (exe: string) => `"${exe}" -m pip install -r "${REQUIREMENTS}"`;
  const fail = (message: string): Check => ({ check: 'python', status: 'fail', message });
  if (run.spawnError) {
    return fail(
      `cannot run IMAGEGEN_PYTHON (${python}): ${run.spawnError}. Install Python 3, set IMAGEGEN_PYTHON in .env to the full path of its interpreter, then run ${install('<that path>')}.`
    );
  }
  // The Windows "App execution alias" stub: exits 9009 and points at the Store instead of running.
  if (run.code === 9009 || /Microsoft Store/i.test(run.stdout + run.stderr)) {
    return fail(
      `${python} is the Windows Store placeholder, not a Python install. Install Python 3 (python.org), set IMAGEGEN_PYTHON in .env to the full path of its python.exe, then run ${install('<that path>')}.`
    );
  }
  let probe: PythonProbe | undefined;
  try {
    probe = JSON.parse(run.stdout.trim().split('\n').at(-1) ?? '');
  } catch {
    probe = undefined;
  }
  if (run.code !== 0 || !probe) {
    return fail(
      `${python} did not run the check (exit ${run.code}): ${(run.stderr || run.stdout).trim().slice(0, 300)}. Set IMAGEGEN_PYTHON in .env to a working Python 3.`
    );
  }
  const missing = [!probe.pillow && 'Pillow', !probe.numpy && 'numpy'].filter(Boolean);
  const rembg = probe.rembg
    ? 'rembg present (AI matte fallback on)'
    : 'rembg absent (optional AI matte fallback for busy backgrounds; pip install "rembg[cpu]")';
  if (missing.length) {
    return fail(
      `Python ${probe.version} at ${probe.executable} lacks ${missing.join(' and ')}, so cutout-image and token/prop renders fail. Run ${install(probe.executable)}. ${rembg}.`
    );
  }
  return {
    check: 'python',
    status: 'ok',
    message: `Python ${probe.version} at ${probe.executable}: Pillow ${probe.pillow}, numpy ${probe.numpy}; ${rembg}.`,
  };
}

export type PythonCheckFn = () => Promise<Check>;

export function makePythonCheck(python: string, timeoutMs = 20_000): PythonCheckFn {
  return async () => judgePython(python, await runProbe(python, timeoutMs));
}

const KEY_URL = 'https://aistudio.google.com/apikey';
const KEY_HELP = `Create one at ${KEY_URL} in a Google Cloud project with billing on (the image models are paid-tier only)`;

export interface KeyResult {
  check: Check;
  /** Which tiers' models the key can see; empty when the list could not be read. */
  models: Partial<Record<Tier, boolean>>;
  error?: string;
}

/** Key present and accepted, and which tiers it reaches. One models list call; no generation. */
export async function checkKey(
  gemini: Pick<Gemini, 'hasKey' | 'availableModels'>
): Promise<KeyResult> {
  if (!gemini.hasKey) {
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
    const available = await gemini.availableModels();
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

export interface DoctorDeps {
  gemini: Pick<Gemini, 'hasKey' | 'availableModels'>;
  outputDir: string;
  checkPython?: PythonCheckFn;
}

export interface DoctorReport {
  /** True when no check failed (warnings still leave the server usable). */
  ready: boolean;
  checks: Check[];
  models: KeyResult['models'];
  error?: string;
}

/** Every setup check in order: key, output dir, Python. Shared by imagegen-status and the CLI. */
export async function runDoctor(deps: DoctorDeps): Promise<DoctorReport> {
  const key = await checkKey(deps.gemini);
  const checks: Check[] = [key.check, checkOutputDir(deps.outputDir)];
  if (deps.checkPython) checks.push(await deps.checkPython());
  return {
    ready: checks.every(c => c.status !== 'fail'),
    checks,
    models: key.models,
    ...(key.error ? { error: key.error } : {}),
  };
}
