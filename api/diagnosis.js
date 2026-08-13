import { randomUUID } from 'node:crypto';
import { createDeepSeekProvider } from '../src/ai/providers.js';
import { crossReviewDiagnosis } from '../src/ai/cross-review.js';
import { boundDiagnosisContext } from '../src/ai/context.js';
import { checkBurstLimit } from '../src/http/guard.js';
import { assembleTrustedDiagnosis } from '../src/ai/trusted-context.js';
import { signTrustToken } from '../src/security/trust-token.js';
import { resolveTrustSecret } from '../src/config/runtime.js';
import { emitOpsEvent as emitRuntimeOpsEvent } from '../src/observability/events.js';

const FINDING_STATUSES = new Set(['confirmed', 'probable', 'hypothesis']);
const PRIORITIES = new Set(['P0', 'P1', 'P2']);

export function validateAiFinding(finding) {
  if (!finding || typeof finding !== 'object') throw new TypeError('finding is required');
  if (!FINDING_STATUSES.has(finding.status)) throw new TypeError('invalid finding status');
  if (!PRIORITIES.has(finding.priority)) throw new TypeError('invalid finding priority');
  if (!Array.isArray(finding.evidence) || finding.evidence.length === 0) throw new TypeError('finding requires evidence');
  if (typeof finding.confidence !== 'number' || finding.confidence < 0 || finding.confidence > 1) throw new TypeError('invalid confidence');
  for (const key of ['title', 'impact', 'action', 'metric']) {
    if (typeof finding[key] !== 'string' || finding[key].trim() === '') throw new TypeError(`finding requires ${key}`);
  }
  return finding;
}

function normalizeAiResult(result) {
  if (result && typeof result === 'object' && result.mode === 'finding') {
    return {
      ...result,
      findings:Array.isArray(result.findings) ? result.findings.map((finding) => {
        if (!finding || typeof finding !== 'object') return finding;
        const { deterministic:_deterministic, crossModelStatus:_crossModelStatus, review:_review, ...safe } = finding;
        return safe;
      }) : result.findings
    };
  }
  if (!result || typeof result !== 'object' || result.mode !== 'question') return result;

  if (typeof result.question === 'string' && result.question.trim()) {
    return {
      ...result,
      question:{
        key:typeof result.key === 'string' && result.key.trim() ? result.key : 'follow_up',
        question:result.question.trim(),
        reason:typeof result.reason === 'string' ? result.reason : ''
      },
      findings:Array.isArray(result.findings) ? result.findings : []
    };
  }

  if (result.question && typeof result.question === 'object') {
    const text = typeof result.question.question === 'string'
      ? result.question.question
      : typeof result.question.text === 'string'
        ? result.question.text
        : '';
    if (text.trim()) {
      return {
        ...result,
        question:{
          ...result.question,
          key:typeof result.question.key === 'string' && result.question.key.trim()
            ? result.question.key
            : typeof result.key === 'string' && result.key.trim()
              ? result.key
              : 'follow_up',
          question:text.trim(),
          reason:typeof result.question.reason === 'string'
            ? result.question.reason
            : typeof result.reason === 'string'
              ? result.reason
              : ''
        },
        findings:Array.isArray(result.findings) ? result.findings : []
      };
    }
  }

  return result;
}

function validateAiResult(result) {
  if (!result || !['question', 'finding'].includes(result.mode)) throw new TypeError('invalid AI result mode');
  if (result.mode === 'question') {
    if (!result.question || typeof result.question.question !== 'string' || typeof result.question.key !== 'string') {
      throw new TypeError('question result is invalid');
    }
    return result;
  }
  if (!Array.isArray(result.findings)) throw new TypeError('finding result requires findings');
  result.findings.forEach(validateAiFinding);
  return result;
}

function logDiagnosisError(stage, error, requestId, startedAt) {
  console.error('[diagnosis]', requestId, stage, Date.now() - startedAt, error?.name || 'Error');
}

function jsonError(res, status, error, requestId) {
  return res.status(status).json({ error, requestId });
}

function injectedOrRuntime(deps, key, runtimeValue) {
  return Object.prototype.hasOwnProperty.call(deps, key) ? deps[key] : runtimeValue;
}

function usableInjectedTrustSecret(secret) {
  if (Buffer.isBuffer(secret)) return secret.length > 0;
  return typeof secret === 'string' && Boolean(secret.trim());
}

function headerValue(req, name) {
  const value = req.headers?.[name];
  if (Array.isArray(value)) return value[0] || '';
  return typeof value === 'string' ? value : '';
}

function clientIdentity(req) {
  const raw = headerValue(req, 'x-vercel-forwarded-for') || headerValue(req, 'x-forwarded-for');
  const ip = raw.split(',')[0]?.trim();
  return ip ? `diagnosis:${ip.slice(0, 80)}` : '';
}

function applyBurstGuard(req, res, requestId, deps) {
  if (deps.disableBurstGuard) return null;
  const identity = clientIdentity(req);
  if (!identity) return null;
  const result = checkBurstLimit(identity, { limit:40, windowMs:10 * 60 * 1000 });
  if (result.allowed) return null;
  res.setHeader?.('Retry-After', String(result.retryAfterSeconds));
  return jsonError(res, 429, '请求较频繁，请稍后再试', requestId);
}

function singleModel(result, status = 'review_unavailable') {
  if (result.mode !== 'finding') return result;
  return {
    ...result,
    findings:result.findings.map((finding) => ({
      ...finding,
      crossModelStatus:status
    }))
  };
}

function buildRuntimeProviders() {
  const apiKey = process.env.DEEPSEEK_API_KEY || '';
  if (!String(apiKey).trim()) return { primaryProvider:null, reviewerProvider:null };
  const provider = createDeepSeekProvider({ apiKey, timeoutMs:12000 });
  return { primaryProvider:provider, reviewerProvider:provider };
}

export async function handleDiagnosisRequest(req, res, deps = {}) {
  const requestId = deps.requestId || randomUUID();
  const startedAt = Date.now();
  const emitOps = (event) => {
    try {
      (deps.emitOpsEvent || emitRuntimeOpsEvent)({ route:'diagnosis', requestId, ...event });
    } catch {
      // Observability must never change a business response.
    }
  };
  emitOps({ event:'request_started' });
  if (req.method && req.method !== 'POST') return jsonError(res, 405, 'Method not allowed', requestId);
  const diagnosis = req.body?.diagnosis;
  if (!diagnosis || typeof diagnosis !== 'object' || !diagnosis.id) return jsonError(res, 400, 'diagnosis is required', requestId);
  const trust = resolveTrustSecret(deps.env || process.env);
  const productionTrustRequired = deps.requireTrustToken === true || process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL_ENV);
  if (productionTrustRequired && !usableInjectedTrustSecret(deps.trustSecret) && !trust.secret) {
    return jsonError(res, 503, '服务端证据签名配置不可用', requestId);
  }
  const limited = applyBurstGuard(req, res, requestId, deps);
  if (limited) return limited;
  let providerDiagnosis;
  try {
    providerDiagnosis = boundDiagnosisContext(assembleTrustedDiagnosis(diagnosis, {
      secret:deps.trustSecret,
      env:deps.env,
      now:deps.trustNow
    }));
  } catch {
    return jsonError(res, 422, '诊断资料验证失败，请重新分析资料', requestId);
  }

  const runtime = buildRuntimeProviders();
  const primaryProvider = injectedOrRuntime(deps, 'primaryProvider', runtime.primaryProvider);
  const reviewerProvider = injectedOrRuntime(deps, 'reviewerProvider', runtime.reviewerProvider);
  if (!primaryProvider?.diagnose) {
    return jsonError(res, 503, 'Server is missing DEEPSEEK_API_KEY', requestId);
  }

  try {
    const primaryStartedAt = Date.now();
    const resultRaw = await primaryProvider.diagnose(providerDiagnosis);
    emitOps({ event:'stage_completed', stage:'primary-model', stageDurationMs:Date.now() - primaryStartedAt });
    let result = validateAiResult(normalizeAiResult(resultRaw));

    if (result.mode === 'finding') {
      if (reviewerProvider?.review) {
        try {
          result = await crossReviewDiagnosis(result, {
            reviewer:(payload) => reviewerProvider.review(payload),
            shouldReview:() => true
          });
        } catch (error) {
          logDiagnosisError(`reviewer-provider:${reviewerProvider?.name || 'deepseek'}`, error, requestId, startedAt);
          result = singleModel(result, 'review_unavailable');
        }
      } else {
        result = singleModel(result);
      }
      result = {
        ...result,
        findings:boundDiagnosisContext({ id:'result', answers:{}, evidence:[], documents:[], findings:result.findings }).findings
      };
      validateAiResult(result);
    }

    console.info('[diagnosis]', requestId, 'complete', primaryProvider?.name || 'deepseek', Date.now() - startedAt);
    let diagnosisToken = null;
    if (result.mode === 'finding') {
      try {
        diagnosisToken = signTrustToken('diagnosis', {
          findings:result.findings,
          sourceDigests:providerDiagnosis.sourceDigests || []
        }, {
          secret:deps.trustSecret,
          env:deps.env,
          now:deps.trustNow
        });
      } catch (error) {
        const production = deps.requireTrustToken === true || process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL_ENV);
        if (production) throw error;
      }
    }
    emitOps({ event:'request_completed', durationMs:Date.now() - startedAt });
    return res.status(200).json({ ...result, diagnosisToken, requestId });
  } catch (error) {
    logDiagnosisError(`primary-provider:${primaryProvider?.name || 'deepseek'}`, error, requestId, startedAt);
    emitOps({ event:'request_failed', level:'error', durationMs:Date.now() - startedAt, failureCode:'PRIMARY_PROVIDER_ERROR' });
    return jsonError(res, 502, 'AI diagnosis failed', requestId);
  }
}

export default async function handler(req, res) {
  return handleDiagnosisRequest(req, res);
}
