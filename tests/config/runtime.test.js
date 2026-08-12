import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTrustSecret, runtimeConfig } from '../../src/config/runtime.js';

test('runtime config classifies missing Qianfan configuration without exposing secrets', () => {
  const config = runtimeConfig({ NODE_ENV:'production', VERCEL_ENV:'preview' });

  assert.equal(config.qianfan.configured, false);
  assert.equal(config.qianfan.keyFormat, 'missing');
  assert.equal(config.qianfan.model, 'deepseek-ocr');
  assert.equal(config.environment.vercel, 'preview');
  assert.ok(config.errors.includes('QIANFAN_KEY_MISSING'));
  assert.doesNotMatch(JSON.stringify(config), /api.?key/i);
});

test('runtime config distinguishes unexpected and expected bce-v3 Qianfan keys', () => {
  const unexpectedSecret = 'legacy-secret-value';
  const expectedSecret = 'bce-v3/current-secret-value';
  const unexpected = runtimeConfig({ QIANFAN_API_KEY:unexpectedSecret, DEEPSEEK_API_KEY:'deepseek-secret' });
  const expected = runtimeConfig({
    QIANFAN_API_KEY:`  ${expectedSecret}  `,
    QIANFAN_APP_ID:'appid-sensitive-value',
    QIANFAN_OCR_MODEL:'deepseek-ocr',
    DEEPSEEK_API_KEY:'deepseek-secret',
    VERCEL_GIT_COMMIT_SHA:'54cf85fe69cc26c4d522ddba9ae3e945574ae1ca'
  });

  assert.equal(unexpected.qianfan.keyFormat, 'unexpected');
  assert.ok(unexpected.errors.includes('QIANFAN_KEY_FORMAT_UNEXPECTED'));
  assert.equal(expected.qianfan.keyFormat, 'bce-v3');
  assert.equal(expected.qianfan.appIdConfigured, true);
  assert.equal(expected.environment.gitSha, '54cf85fe69cc');
  assert.doesNotMatch(JSON.stringify(unexpected), new RegExp(unexpectedSecret));
  assert.doesNotMatch(JSON.stringify(expected), /current-secret-value|deepseek-secret|appid-sensitive-value/);
});

test('trust secret prefers an explicit secret and otherwise derives a purpose-bound secret', () => {
  const explicit = resolveTrustSecret({ EVIDENCE_SIGNING_SECRET:'explicit-secret', DEEPSEEK_API_KEY:'deepseek-secret' });
  const derivedA = resolveTrustSecret({ DEEPSEEK_API_KEY:'deepseek-secret' });
  const derivedB = resolveTrustSecret({ DEEPSEEK_API_KEY:'deepseek-secret' });
  const missing = resolveTrustSecret({});

  assert.equal(explicit.mode, 'explicit');
  assert.equal(derivedA.mode, 'derived');
  assert.equal(missing.mode, 'missing');
  assert.equal(missing.secret, null);
  assert.notDeepEqual(explicit.secret, derivedA.secret);
  assert.deepEqual(derivedA.secret, derivedB.secret);
});
