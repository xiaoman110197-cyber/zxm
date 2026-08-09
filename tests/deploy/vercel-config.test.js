import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const vercel = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));

test('Vercel builds static mobile UI into dist', () => {
  assert.equal(pkg.scripts?.build, 'rm -rf dist && cp -R public dist');
  assert.equal(vercel.buildCommand, 'npm run build');
  assert.equal(vercel.outputDirectory, 'dist');
});

test('serverless api directory remains available alongside static output', () => {
  assert.ok(!vercel.functions || Object.keys(vercel.functions).every(key => key.startsWith('api/')));
});
