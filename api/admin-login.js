import { checkBurstLimit } from '../src/http/guard.js';
import { ADMIN_COOKIE_NAME, adminClientIdentity, applyAdminHeaders } from '../src/admin/http.js';
import { issueAdminSession, passwordMatches } from '../src/admin/session.js';

const SESSION_TTL_SECONDS = 30 * 60;

function reply(res, status, body) {
  return res.status(status).json(body);
}

function cookie(value, maxAge = SESSION_TTL_SECONDS) {
  return `${ADMIN_COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=${maxAge}`;
}

export async function handleAdminLoginRequest(req, res, deps = {}) {
  applyAdminHeaders(res);
  const env = deps.env || process.env;
  if (req.method === 'DELETE') {
    res.setHeader?.('Set-Cookie', cookie('', 0));
    return reply(res, 200, { ok:true });
  }
  if (req.method !== 'POST') return reply(res, 405, { error:'Method not allowed' });
  if (!String(env.ADMIN_PASSWORD || '').trim() || Buffer.byteLength(String(env.ADMIN_SESSION_SECRET || '')) < 32) {
    return reply(res, 503, { error:'管理员登录暂不可用' });
  }

  if (!deps.disableRateLimit) {
    const identity = adminClientIdentity(req);
    if (identity) {
      const rate = checkBurstLimit(`admin-login:${identity}`, { limit:5, windowMs:15 * 60 * 1000 });
      if (!rate.allowed) {
        res.setHeader?.('Retry-After', String(rate.retryAfterSeconds));
        return reply(res, 429, { error:'管理员登录失败' });
      }
    }
  }

  if (!passwordMatches(req.body?.password, env.ADMIN_PASSWORD, env.ADMIN_SESSION_SECRET)) {
    return reply(res, 401, { error:'管理员登录失败' });
  }
  const session = issueAdminSession({
    secret:env.ADMIN_SESSION_SECRET,
    now:deps.now,
    ttlMs:SESSION_TTL_SECONDS * 1000,
    nonce:deps.nonce
  });
  res.setHeader?.('Set-Cookie', cookie(session));
  return reply(res, 200, { ok:true });
}

export default async function handler(req, res) {
  return handleAdminLoginRequest(req, res);
}
