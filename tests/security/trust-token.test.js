import test from 'node:test';
import assert from 'node:assert/strict';
import { signTrustToken, verifyTrustToken } from '../../src/security/trust-token.js';

const secret = 'test-only-trust-secret-with-enough-entropy';
const now = Date.UTC(2026, 7, 12, 9, 0, 0);

test('signs and verifies a typed trust token within its lifetime', () => {
  const token = signTrustToken('analysis', { summary:{ rowCount:2 } }, { secret, now, ttlMs:60_000 });
  const data = verifyTrustToken(token, 'analysis', { secret, now:now + 30_000 });

  assert.deepEqual(data, { summary:{ rowCount:2 } });
});

test('rejects tampering, wrong key, wrong type and expiry', () => {
  const token = signTrustToken('analysis', { correctionId:`correction_${'a'.repeat(64)}_1` }, { secret, now, ttlMs:1_000 });
  const parts = token.split('.');
  const tampered = `${parts[0]}.${parts[1].slice(0, -1)}A.${parts[2]}`;

  assert.throws(() => verifyTrustToken(tampered, 'analysis', { secret, now }), /invalid/i);
  assert.throws(() => verifyTrustToken(token, 'analysis', { secret:'different-secret', now }), /invalid/i);
  assert.throws(() => verifyTrustToken(token, 'diagnosis', { secret, now }), /invalid/i);
  assert.throws(() => verifyTrustToken(token, 'analysis', { secret, now:now + 1_001 }), /expired/i);
});

test('rejects a non-canonical Base64url signature even when it decodes to the same bytes', () => {
  let token = signTrustToken('analysis', { summary:{ rowCount:2 } }, { secret, now });
  let parts = token.split('.');
  let replacement = parts[2].endsWith('A') ? 'B' : 'A';
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `${parts[2].slice(0, -1)}${replacement}`;
    if (Buffer.from(candidate, 'base64url').equals(Buffer.from(parts[2], 'base64url'))) {
      assert.throws(() => verifyTrustToken(`${parts[0]}.${parts[1]}.${candidate}`, 'analysis', { secret, now }), /invalid/i);
      return;
    }
    token = signTrustToken('analysis', { summary:{ rowCount:attempt + 3 } }, { secret, now });
    parts = token.split('.');
    replacement = parts[2].endsWith('A') ? 'B' : 'A';
  }
  assert.fail('expected to construct an equivalent non-canonical Base64url signature');
});

test('rejects missing signing configuration and oversized payloads', () => {
  assert.throws(() => signTrustToken('analysis', {}, { env:{}, now }), /signing/i);
  assert.throws(
    () => signTrustToken('analysis', { text:'x'.repeat(50 * 1024) }, { secret, now }),
    /large/i
  );
});
