import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const vercel = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));
const execFileAsync = promisify(execFile);

test('Vercel builds static mobile UI into dist', () => {
  assert.equal(pkg.scripts?.build, 'rm -rf dist && cp -R public dist && node scripts/verify-server-imports.js');
  assert.equal(vercel.buildCommand, 'npm run build');
  assert.equal(vercel.outputDirectory, 'dist');
});

test('CI uses a reproducible Node 20 install and verifies tests plus build', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/test.yml', import.meta.url), 'utf8');
  assert.match(workflow, /node-version:\s*['"]20['"]/);
  assert.match(workflow, /run:\s*npm ci/);
  assert.match(workflow, /run:\s*npm test/);
  assert.match(workflow, /run:\s*npm run build/);
});

test('npm ci lockfile includes the Linux canvas binary required by PDF parsing', async () => {
  const { stdout } = await execFileAsync(process.execPath, ['scripts/verify-linux-lock.js'], {
    cwd:new URL('../..', import.meta.url)
  });
  assert.match(stdout, /Verified Linux PDF canvas dependency/);
});

test('serverless api directory remains available alongside static output', () => {
  assert.ok(!vercel.functions || Object.keys(vercel.functions).every(key => key.startsWith('api/')));
});

test('administrator API functions have bounded durations', () => {
  assert.equal(vercel.functions?.['api/admin-login.js']?.maxDuration, 10);
  assert.equal(vercel.functions?.['api/admin-ops.js']?.maxDuration, 10);
});
