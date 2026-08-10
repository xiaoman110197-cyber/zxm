import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBurstLimit, resetBurstLimitsForTests } from '../../src/http/guard.js';

test('allows ordinary multi-turn usage within the burst window', () => {
  resetBurstLimitsForTests();
  for (let i = 0; i < 40; i += 1) {
    const result = checkBurstLimit('diagnosis:1.2.3.4', { limit:40, windowMs:600000, now:1000 + i });
    assert.equal(result.allowed, true);
  }
});

test('blocks the next request and reports a retry delay', () => {
  resetBurstLimitsForTests();
  for (let i = 0; i < 3; i += 1) checkBurstLimit('diagnosis:1.2.3.4', { limit:3, windowMs:1000, now:100 + i });
  const blocked = checkBurstLimit('diagnosis:1.2.3.4', { limit:3, windowMs:1000, now:200 });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1);
});

test('allows requests again after the window expires and does not share empty identities', () => {
  resetBurstLimitsForTests();
  checkBurstLimit('diagnosis:a', { limit:1, windowMs:1000, now:100 });
  assert.equal(checkBurstLimit('diagnosis:a', { limit:1, windowMs:1000, now:1200 }).allowed, true);
  assert.equal(checkBurstLimit('', { limit:1, windowMs:1000, now:100 }).allowed, true);
  assert.equal(checkBurstLimit('', { limit:1, windowMs:1000, now:101 }).allowed, true);
});
