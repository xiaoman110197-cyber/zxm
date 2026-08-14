import test from 'node:test';
import assert from 'node:assert/strict';
import { issueAdminSession, passwordMatches, verifyAdminSession } from '../../src/admin/session.js';

const secret = 'a'.repeat(32);

test('admin session verifies, expires and rejects tampering', () => {
  const token = issueAdminSession({ secret, now:1_000, ttlMs:30 * 60_000, nonce:'n1' });
  assert.equal(verifyAdminSession(token, { secret, now:1_001 }).v, 1);
  assert.throws(() => verifyAdminSession(`${token}x`, { secret, now:1_001 }), /invalid/i);
  assert.throws(() => verifyAdminSession(token, { secret, now:1_801_001 }), /expired/i);
});

test('password comparison accepts exact value and rejects different lengths safely', () => {
  assert.equal(passwordMatches('correct horse battery staple', 'correct horse battery staple', secret), true);
  assert.equal(passwordMatches('wrong', 'correct horse battery staple', secret), false);
  assert.equal(passwordMatches('', 'correct horse battery staple', secret), false);
});

test('session secrets must contain at least 32 bytes', () => {
  assert.throws(() => issueAdminSession({ secret:'short', now:1_000 }), /32/);
  assert.throws(() => verifyAdminSession('bad', { secret:'short', now:1_000 }), /32/);
});
