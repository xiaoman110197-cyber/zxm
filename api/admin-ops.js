import { ADMIN_COOKIE_NAME, applyAdminHeaders, readCookie } from '../src/admin/http.js';
import { verifyAdminSession } from '../src/admin/session.js';
import { aggregateOpsLogs } from '../src/observability/aggregate.js';
import { fetchRuntimeLogs } from '../src/observability/vercel-logs.js';

const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

function reply(res, status, body) {
  return res.status(status).json(body);
}

function sessionIsValid(req, env, deps) {
  try {
    (deps.verifySession || verifyAdminSession)(readCookie(req, ADMIN_COOKIE_NAME), {
      secret:env.ADMIN_SESSION_SECRET,
      now:deps.now
    });
    return true;
  } catch {
    return false;
  }
}

function safeUnavailableCode(error) {
  return ['VERCEL_AUTH_FAILED', 'VERCEL_RATE_LIMITED', 'VERCEL_TIMEOUT', 'VERCEL_UNAVAILABLE'].includes(error?.code)
    ? error.code
    : 'VERCEL_UNAVAILABLE';
}

export async function handleAdminOpsRequest(req, res, deps = {}) {
  applyAdminHeaders(res);
  if (req.method !== 'GET') return reply(res, 405, { error:'Method not allowed' });
  const env = deps.env || process.env;
  if (!sessionIsValid(req, env, deps)) return reply(res, 401, { error:'需要管理员登录' });

  const range = String(req.query?.range || '24h');
  const requestId = String(req.query?.requestId || '');
  if (!['24h', '7d'].includes(range) || (requestId && !SAFE_REQUEST_ID.test(requestId))) {
    return reply(res, 400, { error:'查询条件无效' });
  }
  if (!String(env.VERCEL_TOKEN || '').trim() || !String(env.VERCEL_PROJECT_ID || '').trim()) {
    return reply(res, 503, { error:'监控配置不可用' });
  }

  const now = Number.isFinite(deps.now) ? deps.now : Date.now();
  const requestedSince = new Date(now - (range === '7d' ? 7 : 1) * 24 * 60 * 60 * 1000).toISOString();
  try {
    const upstream = await (deps.fetchRuntimeLogs || fetchRuntimeLogs)({
      token:env.VERCEL_TOKEN,
      projectId:env.VERCEL_PROJECT_ID,
      teamId:env.VERCEL_TEAM_ID,
      since:range,
      until:new Date(now)
    });
    const records = requestId
      ? upstream.records.filter((record) => record.message.includes(`"requestId":"${requestId}"`))
      : upstream.records;
    const aggregate = aggregateOpsLogs(records, { requestedSince, truncated:upstream.truncated });
    return reply(res, 200, { available:true, ...aggregate });
  } catch (error) {
    return reply(res, 200, { available:false, partial:true, code:safeUnavailableCode(error) });
  }
}

export default async function handler(req, res) {
  return handleAdminOpsRequest(req, res);
}
