import { createHmac } from 'node:crypto';

const TRUST_PURPOSE = 'zhenduan-trust-token-v1';

function trimmed(env, key) {
  return String(env?.[key] || '').trim();
}

function short(value, max = 120) {
  return String(value || '').trim().slice(0, max);
}

export function resolveTrustSecret(env = process.env) {
  const explicit = trimmed(env, 'EVIDENCE_SIGNING_SECRET');
  if (explicit) return { mode:'explicit', secret:Buffer.from(explicit, 'utf8') };

  const deepseek = trimmed(env, 'DEEPSEEK_API_KEY');
  if (deepseek) {
    return {
      mode:'derived',
      secret:createHmac('sha256', Buffer.from(deepseek, 'utf8')).update(TRUST_PURPOSE).digest()
    };
  }
  return { mode:'missing', secret:null };
}

export function runtimeConfig(env = process.env) {
  const qianfanSecret = trimmed(env, 'QIANFAN_API_KEY');
  const qianfanAppIdConfigured = Boolean(trimmed(env, 'QIANFAN_APP_ID'));
  const deepseekConfigured = Boolean(trimmed(env, 'DEEPSEEK_API_KEY'));
  const signing = resolveTrustSecret(env);
  const keyFormat = !qianfanSecret ? 'missing' : qianfanSecret.startsWith('bce-v3/') ? 'bce-v3' : 'unexpected';
  const errors = [];
  if (!qianfanSecret) errors.push('QIANFAN_KEY_MISSING');
  else if (keyFormat !== 'bce-v3') errors.push('QIANFAN_KEY_FORMAT_UNEXPECTED');
  if (!deepseekConfigured) errors.push('DEEPSEEK_KEY_MISSING');
  if (!signing.secret) errors.push('TRUST_SIGNING_UNAVAILABLE');

  return {
    ok:errors.length === 0,
    errors,
    environment:{
      vercel:short(env?.VERCEL_ENV || 'unknown', 40),
      node:short(env?.NODE_ENV || 'unknown', 40),
      gitBranch:short(env?.VERCEL_GIT_COMMIT_REF, 120),
      gitSha:short(env?.VERCEL_GIT_COMMIT_SHA, 12),
      project:short(env?.VERCEL_PROJECT_ID || env?.VERCEL_PROJECT_PRODUCTION_URL, 120),
      repository:short(env?.VERCEL_GIT_REPO_SLUG, 120)
    },
    qianfan:{
      configured:Boolean(qianfanSecret),
      keyFormat,
      appIdConfigured:qianfanAppIdConfigured,
      model:short(env?.QIANFAN_OCR_MODEL || 'deepseek-ocr', 120)
    },
    deepseek:{
      configured:deepseekConfigured,
      model:short(env?.DEEPSEEK_MODEL || 'deepseek-v4-flash', 120)
    },
    trust:{ available:Boolean(signing.secret), mode:signing.mode }
  };
}
