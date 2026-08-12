import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const vercel = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));

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

test('serverless api directory remains available alongside static output', () => {
  assert.ok(!vercel.functions || Object.keys(vercel.functions).every(key => key.startsWith('api/')));
});
