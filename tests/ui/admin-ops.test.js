import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';

test('admin page exposes accessible login and operations evidence regions', async () => {
  const html = await readFile(new URL('../../public/admin/ops.html', import.meta.url), 'utf8');
  for (const id of [
    'admin-login', 'coverage-status', 'summary-cards', 'error-table', 'stage-table',
    'request-table', 'request-filter', 'logout'
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /type="password"/);
  assert.match(html, /aria-live="polite"/);
});

test('admin client uses same-origin APIs without browser secret persistence', async () => {
  const js = await readFile(new URL('../../public/admin/ops.js', import.meta.url), 'utf8');
  assert.match(js, /\/api\/admin-login/);
  assert.match(js, /\/api\/admin-ops/);
  assert.match(js, /textContent/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|innerHTML|VERCEL_TOKEN|ADMIN_PASSWORD|ADMIN_SESSION_SECRET/);
});

test('admin layout contains a narrow-screen table overflow boundary', async () => {
  const css = await readFile(new URL('../../public/admin/ops.css', import.meta.url), 'utf8');
  assert.match(css, /\.table-scroll\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(css, /@media\s*\(max-width:\s*600px\)/);
  assert.match(css, /max-width:\s*100%/);
});

test('production build copies administrator assets into dist', async () => {
  for (const name of ['ops.html', 'ops.js', 'ops.css']) {
    await access(new URL(`../../dist/admin/${name}`, import.meta.url));
  }
});
