export class RequestGuardError extends Error {
  constructor(statusCode, userMessage) {
    super(userMessage);
    this.name = 'RequestGuardError';
    this.statusCode = statusCode;
    this.userMessage = userMessage;
  }
}

export function serializedSize(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    throw new RequestGuardError(400, '请求内容无法序列化');
  }
}

export function strictBase64ToBuffer(value, { maxBytes = Infinity, label = '内容', tooLargeMessage = '' } = {}) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RequestGuardError(422, `${label}编码损坏或不是有效 Base64`);
  }

  if (Number.isFinite(maxBytes)) {
    const maxEncodedChars = Math.ceil(maxBytes / 3) * 4 + 4;
    if (value.length > maxEncodedChars) {
      throw new RequestGuardError(413, tooLargeMessage || `${label}过大：超过当前限制`);
    }
  }

  const canonicalBase64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (value.length % 4 !== 0 || !canonicalBase64.test(value)) {
    throw new RequestGuardError(422, `${label}编码损坏或不是有效 Base64`);
  }

  let buffer;
  try {
    buffer = Buffer.from(value, 'base64');
  } catch {
    throw new RequestGuardError(422, `${label}编码损坏或不是有效 Base64`);
  }

  if (buffer.toString('base64') !== value) {
    throw new RequestGuardError(422, `${label}编码损坏或不是有效 Base64`);
  }
  if (buffer.length > maxBytes) {
    throw new RequestGuardError(413, tooLargeMessage || `${label}过大：超过当前限制`);
  }
  return buffer;
}

export function clientIp(req) {
  const forwarded = req?.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  const real = req?.headers?.['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  return req?.socket?.remoteAddress || 'unknown';
}

export function createBurstLimiter({ limit, windowMs, now = Date.now, maxKeys = 1000 } = {}) {
  if (!Number.isInteger(limit) || limit <= 0) throw new TypeError('limit must be a positive integer');
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new TypeError('windowMs must be positive');
  const buckets = new Map();

  function pruneGlobal(current) {
    if (buckets.size < maxKeys) return;
    for (const [key, timestamps] of buckets) {
      const fresh = timestamps.filter((timestamp) => current - timestamp < windowMs);
      if (fresh.length) buckets.set(key, fresh);
      else buckets.delete(key);
      if (buckets.size < maxKeys) break;
    }
    if (buckets.size >= maxKeys) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey !== undefined) buckets.delete(oldestKey);
    }
  }

  return {
    check(key) {
      const current = now();
      const bucketKey = String(key || 'unknown');
      const fresh = (buckets.get(bucketKey) || []).filter((timestamp) => current - timestamp < windowMs);
      if (fresh.length >= limit) {
        const retryMs = Math.max(1, windowMs - (current - fresh[0]));
        buckets.set(bucketKey, fresh);
        return { allowed:false, retryAfterSeconds:Math.max(1, Math.ceil(retryMs / 1000)) };
      }
      fresh.push(current);
      if (!buckets.has(bucketKey)) pruneGlobal(current);
      buckets.set(bucketKey, fresh);
      return { allowed:true, retryAfterSeconds:0 };
    }
  };
}
