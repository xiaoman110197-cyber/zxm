import test from 'node:test';
import assert from 'node:assert/strict';
import { handleHealthRequest } from '../../api/health.js';

function mockRes() {
  return {
    statusCode:200, body:null, headers:{},
    status(code){ this.statusCode = code; return this; },
    setHeader(name, value){ this.headers[String(name).toLowerCase()] = value; },
    json(value){ this.body = value; return this; }
  };
}

test('health endpoint rejects unsupported methods and disables caching', async () => {
  const res = mockRes();
  await handleHealthRequest({ method:'POST' }, res, { env:{} });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('health endpoint exposes only secret-safe Preview configuration state', async () => {
  const qianfanSecret = 'bce-v3/health-test-secret';
  const deepseekSecret = 'deepseek-health-test-secret';
  const res = mockRes();
  await handleHealthRequest({ method:'GET' }, res, { env:{
    VERCEL_ENV:'preview', NODE_ENV:'production', VERCEL_GIT_COMMIT_REF:'feature/deepseek-ocr-pipeline',
    VERCEL_GIT_COMMIT_SHA:'54cf85fe69cc26c4d522ddba9ae3e945574ae1ca',
    VERCEL_PROJECT_PRODUCTION_URL:'zhenduan.example', VERCEL_GIT_REPO_SLUG:'zxm',
    QIANFAN_API_KEY:qianfanSecret, QIANFAN_OCR_MODEL:'deepseek-ocr',
    QIANFAN_APP_ID:'appid-health-test-secret',
    DEEPSEEK_API_KEY:deepseekSecret, DEEPSEEK_MODEL:'deepseek-v4-flash'
  } });

  const serialized = JSON.stringify(res.body);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.body.ok, true);
  assert.equal(res.body.qianfan.keyFormat, 'bce-v3');
  assert.equal(res.body.qianfan.appIdConfigured, true);
  assert.equal(res.body.environment.vercel, 'preview');
  assert.equal(res.body.environment.gitSha, '54cf85fe69cc');
  assert.equal(res.body.trust.mode, 'derived');
  assert.doesNotMatch(serialized, /health-test-secret|bce-v3\/|appid-health-test-secret/);
});

test('health endpoint distinguishes unexpected Qianfan key format without reflecting it', async () => {
  const secret = 'legacy-qianfan-secret';
  const res = mockRes();
  await handleHealthRequest({ method:'GET' }, res, { env:{ QIANFAN_API_KEY:secret, DEEPSEEK_API_KEY:'deepseek-secret' } });

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.qianfan.keyFormat, 'unexpected');
  assert.ok(res.body.errors.includes('QIANFAN_KEY_FORMAT_UNEXPECTED'));
  assert.doesNotMatch(JSON.stringify(res.body), new RegExp(secret));
});
