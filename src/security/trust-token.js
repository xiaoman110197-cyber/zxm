import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolveTrustSecret } from '../config/runtime.js';

const TOKEN_VERSION = 'v1';
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PAYLOAD_BYTES = 48 * 1024;
const MAX_CLOCK_SKEW_MS = 60 * 1000;

function signingSecret({ secret, env } = {}) {
  if (Buffer.isBuffer(secret) && secret.length) return secret;
  if (typeof secret === 'string' && secret.trim()) return Buffer.from(secret.trim(), 'utf8');
  return resolveTrustSecret(env).secret;
}

function validType(type) {
  return typeof type === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(type);
}

function invalidToken() {
  return new Error('Trust token is invalid');
}

function signatureFor(payloadPart, secret) {
  return createHmac('sha256', secret).update(`${TOKEN_VERSION}.${payloadPart}`).digest();
}

export function signTrustToken(type, data, options = {}) {
  if (!validType(type)) throw new TypeError('Trust token type is invalid');
  const secret = signingSecret(options);
  if (!secret) throw new Error('Trust token signing is unavailable');
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const ttlMs = Number.isFinite(options.ttlMs) ? options.ttlMs : DEFAULT_TTL_MS;
  if (ttlMs <= 0 || ttlMs > DEFAULT_TTL_MS) throw new RangeError('Trust token lifetime is invalid');

  let payload;
  try {
    payload = Buffer.from(JSON.stringify({ v:1, type, iat:now, exp:now + ttlMs, data }), 'utf8');
  } catch {
    throw new TypeError('Trust token data is invalid');
  }
  if (payload.length > MAX_PAYLOAD_BYTES) throw new RangeError('Trust token payload is too large');

  const payloadPart = payload.toString('base64url');
  const signaturePart = signatureFor(payloadPart, secret).toString('base64url');
  return `${TOKEN_VERSION}.${payloadPart}.${signaturePart}`;
}

export function verifyTrustToken(token, expectedType, options = {}) {
  if (!validType(expectedType)) throw new TypeError('Trust token type is invalid');
  const secret = signingSecret(options);
  if (!secret) throw new Error('Trust token signing is unavailable');
  if (typeof token !== 'string' || token.length > MAX_PAYLOAD_BYTES * 2) throw invalidToken();
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_VERSION || !parts[1] || !parts[2]) throw invalidToken();

  let suppliedSignature;
  let payload;
  try {
    suppliedSignature = Buffer.from(parts[2], 'base64url');
    payload = Buffer.from(parts[1], 'base64url');
  } catch {
    throw invalidToken();
  }
  if (suppliedSignature.toString('base64url') !== parts[2] || payload.toString('base64url') !== parts[1]) {
    throw invalidToken();
  }
  if (!payload.length || payload.length > MAX_PAYLOAD_BYTES) throw invalidToken();
  const expectedSignature = signatureFor(parts[1], secret);
  if (suppliedSignature.length !== expectedSignature.length || !timingSafeEqual(suppliedSignature, expectedSignature)) {
    throw invalidToken();
  }

  let decoded;
  try {
    decoded = JSON.parse(payload.toString('utf8'));
  } catch {
    throw invalidToken();
  }
  if (!decoded || decoded.v !== 1 || decoded.type !== expectedType || !Number.isFinite(decoded.iat) || !Number.isFinite(decoded.exp)) {
    throw invalidToken();
  }
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  if (decoded.iat > now + MAX_CLOCK_SKEW_MS || decoded.exp <= decoded.iat || decoded.exp - decoded.iat > DEFAULT_TTL_MS) {
    throw invalidToken();
  }
  if (now > decoded.exp) throw new Error('Trust token has expired');
  return decoded.data;
}
