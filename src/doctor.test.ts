import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkOutputDir, findGitRoot, judgePython, makePythonCheck } from './doctor.js';

let tmp: string;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'imagegen-doctor-'));
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('output dir check', () => {
  it('passes a writable folder outside any repo', () => {
    expect(checkOutputDir(tmp)).toMatchObject({ check: 'output-dir', status: 'ok' });
  });

  it('passes a folder that does not exist yet and says it will be created', () => {
    const c = checkOutputDir(path.join(tmp, 'not', 'yet'));
    expect(c.status).toBe('ok');
    expect(c.message).toMatch(/created on the first render/);
    expect(fs.existsSync(path.join(tmp, 'not'))).toBe(false);
  });

  it('warns when the folder is inside a git repo, even before it exists', () => {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
    expect(findGitRoot(path.join(repo, 'art', 'raw'))).toBe(repo);
    const c = checkOutputDir(path.join(repo, 'art', 'raw'));
    expect(c.status).toBe('warn');
    expect(c.message).toContain(repo);
    expect(c.message).toMatch(/outside any repo/);
  });

  it('treats a worktree .git file as a repo too', () => {
    const wt = path.join(tmp, 'wt');
    fs.mkdirSync(wt);
    fs.writeFileSync(path.join(wt, '.git'), 'gitdir: elsewhere');
    expect(checkOutputDir(wt).status).toBe('warn');
  });

  it('fails a path that is a file', () => {
    const f = path.join(tmp, 'a-file');
    fs.writeFileSync(f, 'x');
    expect(checkOutputDir(f).status).toBe('fail');
  });
});

describe('python check', () => {
  const probe = (o: object) =>
    `${JSON.stringify({ executable: '/py', version: '3.12.1', ...o })}\n`;

  it('passes with Pillow and numpy, and reports rembg either way', () => {
    const ok = judgePython('python', {
      code: 0,
      stdout: probe({ pillow: '11.0', numpy: '2.1', rembg: false }),
      stderr: '',
    });
    expect(ok.status).toBe('ok');
    expect(ok.message).toMatch(/Pillow 11\.0, numpy 2\.1; rembg absent/);
    const withRembg = judgePython('python', {
      code: 0,
      stdout: probe({ pillow: '11.0', numpy: '2.1', rembg: true }),
      stderr: '',
    });
    expect(withRembg.message).toMatch(/rembg present/);
  });

  it('fails a missing package with the pip line for that interpreter', () => {
    const c = judgePython('python', {
      code: 0,
      stdout: probe({ pillow: null, numpy: '2.1', rembg: false }),
      stderr: '',
    });
    expect(c.status).toBe('fail');
    expect(c.message).toMatch(/lacks Pillow/);
    expect(c.message).toMatch(/"\/py" -m pip install -r ".*requirements\.txt"/);
  });

  it('recognises the Windows Store stub', () => {
    for (const run of [
      { code: 9009, stdout: '', stderr: '' },
      {
        code: 1,
        stdout: '',
        stderr: 'Python was not found; run without arguments to install from the Microsoft Store',
      },
    ]) {
      const c = judgePython('python', run);
      expect(c.status).toBe('fail');
      expect(c.message).toMatch(/Windows Store placeholder/);
    }
  });

  it('fails an interpreter that cannot be started', async () => {
    const c = await makePythonCheck(path.join(tmp, 'no-such-python'))();
    expect(c.status).toBe('fail');
    expect(c.message).toMatch(/cannot run IMAGEGEN_PYTHON/);
  });

  it('fails garbage output', () => {
    expect(judgePython('python', { code: 0, stdout: 'hello', stderr: '' }).status).toBe('fail');
  });
});
