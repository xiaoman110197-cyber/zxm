import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const config = JSON.parse(await readFile(new URL('../../vercel.json', import.meta.url), 'utf8'));

test('long-running analysis and diagnosis functions have explicit duration limits', () => {
  assert.equal(config.functions?.['api/analyze-file.js']?.maxDuration, 180);
  assert.equal(config.functions?.['api/diagnosis.js']?.maxDuration, 45);
  assert.equal(config.functions?.['api/report.js']?.maxDuration, 45);
  assert.equal(config.functions?.['api/health.js']?.maxDuration, 10);
});

test('site responses include baseline browser security headers', () => {
  const headers = config.headers?.flatMap((rule) => rule.headers || []) || [];
  const byKey = new Map(headers.map((item) => [String(item.key).toLowerCase(), item.value]));
  assert.equal(byKey.get('x-content-type-options'), 'nosniff');
  assert.equal(byKey.get('x-frame-options'), 'DENY');
  assert.equal(byKey.get('referrer-policy'), 'no-referrer');
  assert.match(byKey.get('content-security-policy') || '', /default-src 'self'/);
});
