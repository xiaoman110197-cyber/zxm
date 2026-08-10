import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../../.github/workflows/test.yml', import.meta.url), 'utf8');

test('CI runs for main, feature branches, fix branches and pull requests to main', () => {
  assert.match(workflow, /push:[\s\S]*?-\s+main/);
  assert.match(workflow, /push:[\s\S]*?-\s+['"]feature\/\*\*['"]/);
  assert.match(workflow, /push:[\s\S]*?-\s+['"]fix\/\*\*['"]/);
  assert.match(workflow, /pull_request:[\s\S]*?-\s+main/);
});
