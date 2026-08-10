import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../../.github/workflows/test.yml', import.meta.url), 'utf8');
const pushBlock = workflow.split(/\npull_request:/)[0];
const pullRequestBlock = workflow.includes('\npull_request:') ? `pull_request:${workflow.split(/\npull_request:/)[1]}` : '';

test('CI verifies both feature branches and merged main pushes', () => {
  assert.match(pushBlock, /push:[\s\S]*branches:[\s\S]*- ['"]?feature\/\*\*['"]?/);
  assert.match(pushBlock, /- ['"]?main['"]?/);
  assert.match(pullRequestBlock, /pull_request:[\s\S]*branches:[\s\S]*- ['"]?main['"]?/);
});

test('CI runs tests and the production build', () => {
  assert.match(workflow, /npm test/);
  assert.match(workflow, /npm run build/);
});
