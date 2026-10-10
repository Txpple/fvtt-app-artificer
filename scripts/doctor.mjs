#!/usr/bin/env node
// `npm run doctor`: the imagegen-status checks from a terminal, before Claude Code is involved.
// It loads .env exactly as the server does (dist/config.js) and runs the same checks
// (dist/doctor.js): the key (a free models list, never a render, so no credit is spent), the
// output folder, and the cutout Python. One line per check with its fix; exit 1 when not ready.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (!fs.existsSync(path.join(dist, 'doctor.js'))) {
  console.error('✗ build  dist/ is missing. Run `npm run build`, then `npm run doctor`.');
  process.exit(1);
}

const load = file => import(pathToFileURL(path.join(dist, file)).href);
const { config } = await load('config.js');
const { Gemini } = await load('gemini.js');
const { makePythonCheck, runDoctor } = await load('doctor.js');
if (typeof runDoctor !== 'function') {
  console.error(
    '✗ build  dist/ is from an older build. Run `npm run build`, then `npm run doctor`.'
  );
  process.exit(1);
}

const report = await runDoctor({
  gemini: new Gemini({ apiKey: config.geminiApiKey, timeoutMs: config.timeoutMs }),
  outputDir: config.outputDir,
  checkPython: makePythonCheck(config.pythonBin),
});

const MARK = { ok: '✓', warn: '!', fail: '✗' };
const width = Math.max(...report.checks.map(c => c.check.length));
console.log(`${config.server.name} ${config.server.version}`);
for (const c of report.checks) {
  console.log(`${MARK[c.status]} ${c.check.padEnd(width)}  ${c.message}`);
}
const warned = report.checks.some(c => c.status === 'warn');
console.log(
  !report.ready
    ? 'Not ready: fix the ✗ lines above and run `npm run doctor` again.'
    : warned
      ? 'Ready, with the ! lines above worth a look. A running server picks up .env changes on a Claude Code restart.'
      : 'Ready. A running server picks up .env changes on a Claude Code restart.'
);
process.exit(report.ready ? 0 : 1);
