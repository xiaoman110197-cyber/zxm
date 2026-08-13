import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const opsFiles = [
  'src/observability/events.js', 'src/observability/aggregate.js', 'src/observability/vercel-logs.js',
  'src/admin/session.js', 'src/admin/http.js', 'api/admin-login.js', 'api/admin-ops.js',
  'public/admin/ops.html', 'public/admin/ops.js', 'public/admin/ops.css',
  'api/analyze-file.js', 'api/diagnosis.js', 'api/report.js'
];

test('operations sources never log raw business payloads or embed bearer secrets', async () => {
  const source = (await Promise.all(opsFiles.map((file) => readFile(new URL(`../../${file}`, import.meta.url), 'utf8')))).join('\n');
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error)\([^\n]*(?:req\.body|file\.name|ocrText|contentBase64)/);
  assert.doesNotMatch(source, /Bearer\s+[A-Za-z0-9_-]{16,}/);
});

test('example environment documents every administrator dependency', async () => {
  const envExample = await readFile(new URL('../../.env.example', import.meta.url), 'utf8');
  for (const name of ['ADMIN_PASSWORD','ADMIN_SESSION_SECRET','VERCEL_TOKEN','VERCEL_PROJECT_ID']) {
    assert.match(envExample, new RegExp(`^${name}=`, 'm'));
  }
});
