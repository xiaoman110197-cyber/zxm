import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function requireSecret(secret) {
  if (Buffer.byteLength(String(secret || ''), 'utf8') < 32) throw new TypeError('session secret requires at least 32 bytes');
  return String(secret);
}

function digest(value, secret) {
  return createHmac('sha256', requireSecret(secret)).update(String(value ?? '')).digest();
}

function sign(payload, secret) {
  return createHmac('sha256', requireSecret(secret)).update(payload).digest('base64url');
}

export function passwordMatches(candidate, configured, secret) {
  return timingSafeEqual(digest(candidate, secret), digest(configured, secret));
}

export function issueAdminSession({ secret, now = Date.now(), ttlMs = 30 * 60 * 1000, nonce } = {}) {
  requireSecret(secret);
  const payload = Buffer.from(JSON.stringify({
    v:1,
    exp:now + ttlMs,
    nonce:nonce || randomBytes(16).toString('base64url')
  })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyAdminSession(token, { secret, now = Date.now() } = {}) {
  requireSecret(secret);
  const [payload, signature, extra] = String(token || '').split('.');
  if (!payload || !signature || extra) throw new TypeError('invalid admin session');
  const expected = sign(payload, secret);
  const valid = Buffer.byteLength(signature) === Buffer.byteLength(expected)
    && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) throw new TypeError('invalid admin session');
  let decoded;
  try { decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw new TypeError('invalid admin session'); }
  if (decoded?.v !== 1 || !Number.isFinite(decoded?.exp)) throw new TypeError('invalid admin session');
  if (decoded.exp <= now) throw new TypeError('admin session expired');
  return decoded;
}
