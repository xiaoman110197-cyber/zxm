import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAdminLoginRequest } from '../../api/admin-login.js';

function mockRes() {
  return {
    statusCode:200, body:null, headers:{},
    status(code){ this.statusCode = code; return this; },
    setHeader(name, value){ this.headers[String(name).toLowerCase()] = value; },
    json(value){ this.body = value; return this; }
  };
}

const env = { ADMIN_PASSWORD:'correct horse battery staple', ADMIN_SESSION_SECRET:'s'.repeat(32) };

test('login rejects unsupported methods and missing server configuration without caching', async () => {
  for (const [req, deps, status] of [[{ method:'GET' }, { env }, 405], [{ method:'POST', body:{ password:'x' } }, { env:{} }, 503]]) {
    const res = mockRes();
    await handleAdminLoginRequest(req, res, deps);
    assert.equal(res.statusCode, status);
    assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
  }
});

test('successful login sets a short secure server-only cookie and reflects no secret', async () => {
  const res = mockRes();
  await handleAdminLoginRequest({ method:'POST', headers:{}, body:{ password:env.ADMIN_PASSWORD } }, res, { env, now:1_000, nonce:'n1', disableRateLimit:true });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok:true });
  assert.match(res.headers['set-cookie'], /^zhenduan_admin=/);
  assert.match(res.headers['set-cookie'], /HttpOnly/);
  assert.match(res.headers['set-cookie'], /Secure/);
  assert.match(res.headers['set-cookie'], /SameSite=Strict/);
  assert.match(res.headers['set-cookie'], /Path=\/admin/);
  assert.match(res.headers['set-cookie'], /Max-Age=1800/);
  assert.doesNotMatch(JSON.stringify(res), /correct horse|ssssssss/);
});

test('failed login uses one generic response and rate limits repeated attempts', async () => {
  const identity = '198.51.100.77';
  for (let index = 0; index < 5; index += 1) {
    const res = mockRes();
    await handleAdminLoginRequest({ method:'POST', headers:{ 'x-forwarded-for':identity }, body:{ password:`wrong-${index}` } }, res, { env });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { error:'管理员登录失败' });
  }
  const blocked = mockRes();
  await handleAdminLoginRequest({ method:'POST', headers:{ 'x-forwarded-for':identity }, body:{ password:env.ADMIN_PASSWORD } }, blocked, { env });
  assert.equal(blocked.statusCode, 429);
  assert.match(blocked.headers['retry-after'], /^\d+$/);
  assert.deepEqual(blocked.body, { error:'管理员登录失败' });
});

test('logout clears the administrator cookie', async () => {
  const res = mockRes();
  await handleAdminLoginRequest({ method:'DELETE' }, res, { env });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['set-cookie'], /zhenduan_admin=;/);
  assert.match(res.headers['set-cookie'], /Max-Age=0/);
});
