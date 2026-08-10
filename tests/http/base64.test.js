import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeBase64Strict } from '../../src/http/base64.js';

test('decodes canonical browser Base64 payloads', () => {
  const source = Buffer.from('老板经营数据', 'utf8');
  assert.deepEqual(decodeBase64Strict(source.toString('base64')), source);
});

test('rejects malformed Base64 instead of silently accepting partial bytes', () => {
  for (const value of ['%%%not-base64%%%', 'AAAA=AAAA', 'A', 'AA===']) {
    assert.throws(() => decodeBase64Strict(value), /base64|编码|格式/i);
  }
});

test('rejects empty or non-string payloads', () => {
  assert.throws(() => decodeBase64Strict(''), /base64|为空/i);
  assert.throws(() => decodeBase64Strict(null), /base64|为空/i);
});
