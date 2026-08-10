import { randomUUID } from 'node:crypto';
import { createDeepSeekProvider, createOpenAIProvider } from '../src/ai/providers.js';
import { crossReviewDiagnosis } from '../src/ai/cross-review.js';
import { boundDiagnosisContext } from '../src/ai/context.js';

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
  if (!result || typeof result !== 'object' || result.mode !== 'question') return result;

  if (typeof result.question === 'string' && result.question.trim()) {
    return {
      ...result,
      question: {
        key: typeof result.key === 'string' && result.key.trim() ? result.key : 'follow_up',
        question: result.question.trim(),
        reason: typeof result.reason === 'string' ? result.reason : ''
      },
      findings: Array.isArray(result.findings) ? result.findings : []
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
        question: {
          ...result.question,
          key: typeof result.question.key === 'string' && result.question.key.trim()
            ? result.question.key
            : typeof result.key === 'string' && result.key.trim()
              ? result.key
              : 'follow_up',
          question: text.trim(),
          reason: typeof result.question.reason === 'string'
            ? result.question.reason
            : typeof result.reason === 'string'
              ? result.reason
              : ''
        },
        findings: Array.isArray(result.findings) ? result.findings : []
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

const RESPONSE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['mode', 'question', 'findings'],
  properties: {
    mode: { type: 'string', enum: ['question', 'finding'] },
    question: { anyOf: [
      { type: 'null' },
      { type: 'object', additionalProperties: false, required: ['key','question','reason'], properties: {
        key:{type:'string'}, question:{type:'string'}, reason:{type:'string'}
      } }
    ] },
    findings: { type:'array', items:{ type:'object', additionalProperties:false,
      required:['title','status','priority','evidence','confidence','impact','action','metric'],
      properties:{
        title:{type:'string'}, status:{type:'string',enum:['confirmed','probable','hypothesis']},
        priority:{type:'string',enum:['P0','P1','P2']}, evidence:{type:'array',minItems:1,items:{type:'string'}},
        confidence:{type:'number',minimum:0,maximum:1}, impact:{type:'string'}, action:{type:'string'}, metric:{type:'string'}
      }
    } }
  }
};

function logDiagnosisError(stage, error, requestId, startedAt) {
  console.error('[diagnosis]', requestId, stage, Date.now() - startedAt, error?.name || 'Error');
}

function jsonError(res, status, error, requestId) {
  return res.status(status).json({ error, requestId });
}

function injectedOrRuntime(deps, key, runtimeValue) {
  return Object.prototype.hasOwnProperty.call(deps, key) ? deps[key] : runtimeValue;
}

// Kept for compatibility with existing tests and callers; new runtime routing uses providers below.
export async function callOpenAiDiagnosis(diagnosis, { apiKey, fetchImpl = fetch, model = process.env.OPENAI_MODEL || 'gpt-5-mini' } = {}) {
  const response = await fetchImpl('https://api.openai.com/v1/responses', {
    method:'POST', headers:{ Authorization:`Bearer ${apiKey}`, 'Content-Type':'application/json' },
    body:JSON.stringify({
      model,
      instructions:'你是经营诊断助手。不得把猜测写成事实。信息不足时只追问一个问题；证据足够时输出结构化 findings。',
      input:JSON.stringify(diagnosis),
      max_output_tokens:2500,
      text:{ format:{ type:'json_schema', name:'zhenduan_diagnosis', strict:true, schema:RESPONSE_SCHEMA } }
    })
  });
  if (!response.ok) throw new Error(`OpenAI request failed (${response.status})`);
  const payload = await response.json();
  if (!payload.output_text) throw new Error('OpenAI response has no output_text');
  return JSON.parse(payload.output_text);
}

function singleModel(result, status = 'single_model') {
  if (result.mode !== 'finding') return result;
  return {
    ...result,
    findings: result.findings.map((finding) => ({
      ...finding,
      crossModelStatus: finding.deterministic ? 'program_fact' : status
    }))
  };
}

function sameProvider(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  return Boolean(left.name && right.name && left.name === right.name);
}

function buildRuntimeProviders() {
  const deepSeekKey = process.env.DEEPSEEK_API_KEY || '';
  const openAiKey = process.env.OPENAI_API_KEY || '';

  if (deepSeekKey) {
    return {
      primaryProvider: createDeepSeekProvider({ apiKey:deepSeekKey, timeoutMs:12000 }),
      fallbackProvider: openAiKey ? createOpenAIProvider({ apiKey:openAiKey, timeoutMs:12000 }) : null,
      reviewerProvider: openAiKey ? createOpenAIProvider({ apiKey:openAiKey, timeoutMs:8000 }) : null
    };
  }
  if (openAiKey) {
    return {
      primaryProvider: createOpenAIProvider({ apiKey:openAiKey, timeoutMs:12000 }),
      fallbackProvider: null,
      reviewerProvider: null
    };
  }
  return { primaryProvider:null, fallbackProvider:null, reviewerProvider:null };
}

async function diagnoseWithFallback(diagnosis, { primaryProvider, fallbackProvider, requestId, startedAt }) {
  try {
    return {
      provider:primaryProvider,
      result:validateAiResult(normalizeAiResult(await primaryProvider.diagnose(diagnosis)))
    };
  } catch (error) {
    logDiagnosisError(`primary-provider:${primaryProvider?.name || 'unknown'}`, error, requestId, startedAt);
    if (!fallbackProvider?.diagnose) throw error;
    return {
      provider:fallbackProvider,
      result:validateAiResult(normalizeAiResult(await fallbackProvider.diagnose(diagnosis)))
    };
  }
}

export async function handleDiagnosisRequest(req, res, deps = {}) {
  const requestId = deps.requestId || randomUUID();
  const startedAt = Date.now();
  if (req.method && req.method !== 'POST') return jsonError(res, 405, 'Method not allowed', requestId);
  const diagnosis = req.body?.diagnosis;
  if (!diagnosis || typeof diagnosis !== 'object' || !diagnosis.id) return jsonError(res, 400, 'diagnosis is required', requestId);
  const providerDiagnosis = boundDiagnosisContext(diagnosis);

  // Legacy injection path retained for existing tests and isolated mocking.
  if ('ai' in deps || 'apiKey' in deps) {
    const apiKey = deps.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    if (!apiKey) return jsonError(res, 503, 'Server is missing OPENAI_API_KEY', requestId);
    try {
      const ai = deps.ai || ((value) => callOpenAiDiagnosis(value, { apiKey }));
      const result = validateAiResult(normalizeAiResult(await ai(providerDiagnosis)));
      return res.status(200).json({ ...result, requestId });
    } catch (error) {
      logDiagnosisError('legacy-provider', error, requestId, startedAt);
      return jsonError(res, 502, 'AI diagnosis failed', requestId);
    }
  }

  const runtime = buildRuntimeProviders();
  const primaryProvider = injectedOrRuntime(deps, 'primaryProvider', runtime.primaryProvider);
  const fallbackProvider = injectedOrRuntime(deps, 'fallbackProvider', runtime.fallbackProvider);
  const reviewerProvider = injectedOrRuntime(deps, 'reviewerProvider', runtime.reviewerProvider);
  if (!primaryProvider?.diagnose) {
    return jsonError(res, 503, 'Server is missing AI provider key (DEEPSEEK_API_KEY or OPENAI_API_KEY)', requestId);
  }

  try {
    const diagnosed = await diagnoseWithFallback(providerDiagnosis, { primaryProvider, fallbackProvider, requestId, startedAt });
    let result = diagnosed.result;

    if (result.mode === 'finding') {
      if (reviewerProvider?.review && !sameProvider(reviewerProvider, diagnosed.provider)) {
        try {
          result = await crossReviewDiagnosis(result, { reviewer:(payload) => reviewerProvider.review(payload) });
        } catch (error) {
          logDiagnosisError(`reviewer-provider:${reviewerProvider?.name || 'unknown'}`, error, requestId, startedAt);
          result = singleModel(result, 'review_unavailable');
        }
      } else {
        result = singleModel(result);
      }
      validateAiResult(result);
    }

    console.info('[diagnosis]', requestId, 'complete', diagnosed.provider?.name || 'unknown', Date.now() - startedAt);
    return res.status(200).json({ ...result, requestId });
  } catch (error) {
    logDiagnosisError('all-diagnosis-providers-failed', error, requestId, startedAt);
    return jsonError(res, 502, 'AI diagnosis failed', requestId);
  }
}

export default async function handler(req, res) {
  return handleDiagnosisRequest(req, res);
}
