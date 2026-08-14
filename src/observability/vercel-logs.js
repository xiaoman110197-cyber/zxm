const API_ORIGIN = 'https://api.vercel.com';
const MAX_RANGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DEPLOYMENTS = 5;
const MAX_RECORDS = 1000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

function safeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizedUpstreamError(status) {
  if (status === 401 || status === 403) return safeError('VERCEL_AUTH_FAILED');
  if (status === 429) return safeError('VERCEL_RATE_LIMITED');
  return safeError('VERCEL_UNAVAILABLE');
}

function requestedSince(value, untilMs) {
  if (value instanceof Date) return value.valueOf();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = /^(\d+)(h|d)$/.exec(String(value || '24h'));
  if (!match) return untilMs - 24 * 60 * 60 * 1000;
  const unitMs = match[2] === 'd' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
  return untilMs - Number(match[1]) * unitMs;
}

async function checkedFetch(url, options, fetchImpl) {
  try {
    const result = await fetchImpl(url, options);
    if (!result?.ok) throw normalizedUpstreamError(result?.status);
    return result;
  } catch (error) {
    if (error?.code?.startsWith('VERCEL_')) throw error;
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw safeError('VERCEL_TIMEOUT');
    throw safeError('VERCEL_UNAVAILABLE');
  }
}

async function boundedText(response) {
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    return { text:text.slice(0, MAX_RESPONSE_BYTES), truncated:true };
  }
  return { text, truncated:false };
}

function recordsFromText(text) {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (typeof parsed?.message === 'string') return [parsed];
    return parsed?.logs || parsed?.events || [];
  } catch {
    return trimmed.split('\n').map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  }
}

export async function fetchRuntimeLogs({
  token,
  projectId,
  teamId = '',
  since = '24h',
  until = new Date(),
  limit = MAX_RECORDS,
  fetchImpl = fetch,
  signal
} = {}) {
  if (!String(token || '').trim() || !String(projectId || '').trim()) {
    throw new TypeError('Vercel log configuration is required');
  }
  const untilMs = until instanceof Date ? until.valueOf() : Number(until);
  const sinceMs = Math.max(requestedSince(since, untilMs), untilMs - MAX_RANGE_MS);
  const recordLimit = Math.min(MAX_RECORDS, Math.max(1, Number(limit) || MAX_RECORDS));
  const requestSignal = signal || AbortSignal.timeout(8000);
  const headers = { Authorization:`Bearer ${token}`, Accept:'application/json, application/x-ndjson' };

  const deploymentsUrl = new URL('/v6/deployments', API_ORIGIN);
  deploymentsUrl.searchParams.set('projectId', projectId);
  deploymentsUrl.searchParams.set('target', 'production');
  deploymentsUrl.searchParams.set('since', String(sinceMs));
  deploymentsUrl.searchParams.set('until', String(untilMs));
  deploymentsUrl.searchParams.set('limit', String(MAX_DEPLOYMENTS + 1));
  if (teamId) deploymentsUrl.searchParams.set('teamId', teamId);
  const deploymentsResponse = await checkedFetch(deploymentsUrl, { headers, signal:requestSignal }, fetchImpl);
  let deploymentPayload;
  try {
    deploymentPayload = await deploymentsResponse.json();
  } catch {
    throw safeError('VERCEL_UNAVAILABLE');
  }
  const availableDeployments = Array.isArray(deploymentPayload?.deployments) ? deploymentPayload.deployments : [];
  const deployments = availableDeployments.slice(0, MAX_DEPLOYMENTS);
  let truncated = availableDeployments.length > MAX_DEPLOYMENTS;
  const records = [];
  let usedBytes = 0;

  for (const deployment of deployments) {
    const deploymentId = String(deployment?.uid || deployment?.id || '');
    if (!deploymentId) continue;
    const logsUrl = new URL(`/v1/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}/runtime-logs`, API_ORIGIN);
    logsUrl.searchParams.set('since', String(sinceMs));
    logsUrl.searchParams.set('until', String(untilMs));
    logsUrl.searchParams.set('limit', String(recordLimit - records.length));
    if (teamId) logsUrl.searchParams.set('teamId', teamId);
    const logsResponse = await checkedFetch(logsUrl, { headers, signal:requestSignal }, fetchImpl);
    const bounded = await boundedText(logsResponse);
    usedBytes += Buffer.byteLength(bounded.text, 'utf8');
    if (bounded.truncated || usedBytes >= MAX_RESPONSE_BYTES) truncated = true;
    for (const record of recordsFromText(bounded.text)) {
      if (records.length >= recordLimit) { truncated = true; break; }
      if (record && typeof record.message === 'string') {
        records.push({
          message:record.message,
          timestamp:record.timestamp || (Number.isFinite(record.timestampInMs) ? new Date(record.timestampInMs).toISOString() : undefined),
          deploymentId:record.deploymentId || deploymentId,
          environment:record.environment
        });
      }
    }
    if (records.length >= recordLimit || usedBytes >= MAX_RESPONSE_BYTES) break;
  }

  return {
    records,
    truncated,
    upstreamCoverage:{ since:new Date(sinceMs).toISOString(), until:new Date(untilMs).toISOString() }
  };
}
