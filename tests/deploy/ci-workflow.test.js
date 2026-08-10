import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../../.github/workflows/test.yml', import.meta.url), 'utf8');
const pullRequestMarker = /\n\s{2}pull_request:/;
const parts = workflow.split(pullRequestMarker);
const pushBlock = parts[0];
const pullRequestBlock = parts.length > 1 ? `pull_request:${parts[1]}` : '';

test('CI verifies both feature branches and merged main pushes', () => {
  assert.match(pushBlock, /push:[\s\S]*branches:[\s\S]*- ['"]?feature\/\*\*['"]?/);
  assert.match(pushBlock, /- ['"]?main['"]?/);
  assert.match(pullRequestBlock, /pull_request:[\s\S]*branches:[\s\S]*- ['"]?main['"]?/);
});

test('CI runs tests and the production build', () => {
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build/);
});
