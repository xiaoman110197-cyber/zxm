const buckets = new Map();
const MAX_TRACKED_KEYS = 2000;

function trimOldestKeyIfNeeded() {
  while (buckets.size >= MAX_TRACKED_KEYS) {
    const first = buckets.keys().next();
    if (first.done) return;
    buckets.delete(first.value);
  }
}

export function checkBurstLimit(key, { limit = 40, windowMs = 10 * 60 * 1000, now = Date.now() } = {}) {
  if (!key) return { allowed:true, retryAfterSeconds:0 };
  const safeLimit = Math.max(1, Math.floor(limit));
  const safeWindow = Math.max(1000, Math.floor(windowMs));
  const cutoff = now - safeWindow;
  const existing = buckets.get(key) || [];
  const recent = existing.filter((timestamp) => timestamp > cutoff && timestamp <= now);

  if (recent.length >= safeLimit) {
    buckets.set(key, recent);
    const retryAfterSeconds = Math.max(1, Math.ceil((recent[0] + safeWindow - now) / 1000));
    return { allowed:false, retryAfterSeconds };
  }

  if (!buckets.has(key)) trimOldestKeyIfNeeded();
  recent.push(now);
  buckets.set(key, recent);
  return { allowed:true, retryAfterSeconds:0 };
}

export function resetBurstLimitsForTests() {
  buckets.clear();
}
