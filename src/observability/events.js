export const OPS_EVENT_PREFIX = 'OPS_EVENT ';
export const OPS_EVENT_NAMES = new Set([
  'request_started',
  'stage_completed',
  'request_completed',
  'request_failed'
]);
export const OPS_ROUTES = new Set(['analyze-file', 'diagnosis', 'report']);

const OPS_STAGES = new Set([
  'validation',
  'parsing',
  'cloud-ocr',
  'local-ocr',
  'structuring',
  'checking-rules',
  'primary-model',
  'review-model',
  'report-generation'
]);
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_FAILURE_CODE = /^[A-Z0-9_]{1,64}$/;

function copyDuration(result, input, key) {
  const value = Number(input?.[key]);
  if (Number.isFinite(value) && value >= 0) result[key] = Math.round(value);
}

export function normalizeOpsEvent(input, { now = Date.now(), env = process.env } = {}) {
  if (!OPS_EVENT_NAMES.has(input?.event)) throw new TypeError('invalid ops event');
  if (!OPS_ROUTES.has(input?.route)) throw new TypeError('invalid ops route');
  if (!SAFE_ID.test(String(input?.requestId || ''))) throw new TypeError('invalid requestId');
  if (input.stage !== undefined && !OPS_STAGES.has(input.stage)) throw new TypeError('invalid stage');
  if (input.failureCode !== undefined && !SAFE_FAILURE_CODE.test(input.failureCode)) {
    throw new TypeError('invalid failureCode');
  }

  const timestamp = new Date(input.timestamp ?? now);
  if (Number.isNaN(timestamp.valueOf())) throw new TypeError('invalid timestamp');
  const result = {
    level:input.level === 'error' ? 'error' : 'info',
    event:input.event,
    route:input.route,
    requestId:String(input.requestId),
    timestamp:timestamp.toISOString()
  };

  copyDuration(result, input, 'durationMs');
  copyDuration(result, input, 'stageDurationMs');
  if (input.stage !== undefined) result.stage = input.stage;
  if (input.failureCode !== undefined) result.failureCode = input.failureCode;

  const deploymentId = String(env?.VERCEL_DEPLOYMENT_ID || '');
  const gitSha = String(env?.VERCEL_GIT_COMMIT_SHA || '');
  if (SAFE_ID.test(deploymentId)) result.deploymentId = deploymentId;
  if (/^[a-f0-9]{7,40}$/i.test(gitSha)) result.gitSha = gitSha.slice(0, 12);
  if (['production', 'preview', 'development'].includes(env?.VERCEL_ENV)) {
    result.environment = env.VERCEL_ENV;
  }
  return result;
}

export function emitOpsEvent(event, { logger = console.info, now, env } = {}) {
  const normalized = normalizeOpsEvent(event, { now, env });
  logger(`${OPS_EVENT_PREFIX}${JSON.stringify(normalized)}`);
  return normalized;
}

export function failureCodeFor(error, fallback = 'UNEXPECTED_ERROR') {
  const normalized = String(error?.code || fallback)
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .slice(0, 64);
  return SAFE_FAILURE_CODE.test(normalized) ? normalized : 'UNEXPECTED_ERROR';
}
