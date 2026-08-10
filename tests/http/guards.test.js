import test from 'node:test';
import assert from 'node:assert/strict';
import { strictBase64ToBuffer, serializedSize, createBurstLimiter } from '../../src/http/guards.js';

test('strict base64 decoder rejects malformed payloads instead of silently decoding garbage', () => {
  assert.throws(() => strictBase64ToBuffer('not*base64', { maxBytes:1024, label:'文件' }), /Base64|编码|损坏/);
  assert.throws(() => strictBase64ToBuffer('abc', { maxBytes:1024, label:'文件' }), /Base64|编码|损坏/);
});

test('strict base64 decoder enforces decoded byte limit before expensive parsing', () => {
  const oversized = Buffer.alloc(3 * 1024 * 1024 + 1, 0x61).toString('base64');
  assert.throws(() => strictBase64ToBuffer(oversized, { maxBytes:3 * 1024 * 1024, label:'文件' }), /过大|3 MB|限制/);
  const ok = Buffer.from('hello').toString('base64');
  assert.equal(strictBase64ToBuffer(ok, { maxBytes:1024, label:'文件' }).toString(), 'hello');
});

test('serializedSize measures UTF-8 JSON payload bytes', () => {
  assert.equal(serializedSize({ value:'中' }), Buffer.byteLength(JSON.stringify({ value:'中' }), 'utf8'));
});

test('burst limiter allows a small burst then rejects until the window expires', () => {
  let now = 1000;
  const limiter = createBurstLimiter({ limit:2, windowMs:1000, now:() => now });
  assert.equal(limiter.check('ip-1').allowed, true);
  assert.equal(limiter.check('ip-1').allowed, true);
  const blocked = limiter.check('ip-1');
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
  now = 2101;
  assert.equal(limiter.check('ip-1').allowed, true);
});
