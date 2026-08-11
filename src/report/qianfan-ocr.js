const ENDPOINT = 'https://qianfan.baidubce.com/v2/chat/completions';
const SUPPORTED_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg']);
const SAFE_PROVIDER_ERROR_CODES = new Set([
  'no_parameter_permission',
  'invalid_model',
  'invalid_appid',
  'invalid_iam_token',
  'coding_plan_api_key_required',
  'coding_plan_api_key_not_allowed',
  'coding_plan_not_subscribed',
  'coding_plan_subscription_expired',
  'coding_plan_model_not_supported',
  'coding_plan_hour_quota_exceeded',
  'coding_plan_week_quota_exceeded',
  'coding_plan_month_quota_exceeded',
  'coding_plan_rate_limit_exceeded',
  'coding_plan_cluster_rate_limited'
]);
const SAFE_TOP_LEVEL_NUMERIC_CODES = new Map([
  ['216003', 'AUTH_216003']
]);

function safeFailure(code, { model, logWarn }) {
  if (typeof logWarn === 'function') logWarn('[qianfan-ocr]', code, `model=${model}`);
  return {
    available:false,
    provider:null,
    model:null,
    text:'',
    failureCode:code,
    warning:`云端报表识别暂时失败（错误编号 ${code}）`
  };
}

function safeProviderErrorCode(status, payload) {
  const nestedRaw = String(payload?.error?.code || '').trim().toLowerCase();
  if (SAFE_PROVIDER_ERROR_CODES.has(nestedRaw)) {
    return `OCR_HTTP_${status || 'UNKNOWN'}_${nestedRaw.toUpperCase()}`;
  }

  const topLevelRaw = String(payload?.code || '').trim();
  const numericAlias = SAFE_TOP_LEVEL_NUMERIC_CODES.get(topLevelRaw);
  if (numericAlias) return `OCR_HTTP_${status || 'UNKNOWN'}_${numericAlias}`;

  const topLevelNamed = topLevelRaw.toLowerCase();
  if (SAFE_PROVIDER_ERROR_CODES.has(topLevelNamed)) {
    return `OCR_HTTP_${status || 'UNKNOWN'}_${topLevelNamed.toUpperCase()}`;
  }

  return `OCR_HTTP_${status || 'UNKNOWN'}`;
}

async function classifyHttpFailure(response) {
  const fallback = `OCR_HTTP_${response.status || 'UNKNOWN'}`;
  try {
    const payload = await response.json();
    return safeProviderErrorCode(response.status, payload);
  } catch {
    return fallback;
  }
}

function classifyTransportFailure(error) {
  const causeCode = String(error?.cause?.code || error?.code || '').toUpperCase();
  if (causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN') return 'OCR_DNS_ERROR';
  if (causeCode === 'UND_ERR_CONNECT_TIMEOUT' || causeCode === 'ETIMEDOUT') return 'OCR_CONNECT_TIMEOUT';
  if (causeCode === 'ECONNRESET' || causeCode === 'UND_ERR_SOCKET') return 'OCR_CONNECTION_RESET';
  if (causeCode === 'ECONNREFUSED') return 'OCR_CONNECTION_REFUSED';
  if (
    causeCode.startsWith('ERR_TLS_') ||
    causeCode.startsWith('CERT_') ||
    causeCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    causeCode === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    causeCode === 'SELF_SIGNED_CERT_IN_CHAIN'
  ) return 'OCR_TLS_ERROR';
  return 'OCR_NETWORK_ERROR';
}

export async function recognizeReportImage(input, {
  apiKey = process.env.QIANFAN_API_KEY || '',
  model = process.env.QIANFAN_OCR_MODEL || 'deepseek-ocr',
  fetchImpl = fetch,
  timeoutMs = 20000,
  logWarn = console.warn
} = {}) {
  const key = String(apiKey || '').trim();
  if (!key) return safeFailure('OCR_KEY_MISSING', { model, logWarn });
  if (!SUPPORTED_IMAGE_MIME_TYPES.has(input?.mimeType)) {
    return safeFailure('OCR_UNSUPPORTED_IMAGE', { model, logWarn });
  }
  if (!Buffer.isBuffer(input?.buffer)) {
    return safeFailure('OCR_INVALID_INPUT', { model, logWarn });
  }

  const imageUrl = `data:${input.mimeType};base64,${input.buffer.toString('base64')}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let stage = 'network';

  try {
    const response = await fetchImpl(ENDPOINT, {
      method:'POST',
      headers:{ Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
      signal:controller.signal,
      body:JSON.stringify({
        model,
        messages:[{
          role:'user',
          content:[
            {
              type:'text',
              text:'<image>\n<|grounding|>Convert the document to markdown. Preserve visible table rows, columns, labels, units and values. Do not correct business data.'
            },
            { type:'image_url', image_url:{ url:imageUrl } }
          ]
        }],
        stream:false
      })
    });

    if (!response.ok) {
      const failureCode = await classifyHttpFailure(response);
      return safeFailure(failureCode, { model, logWarn });
    }

    stage = 'response-json';
    let payload;
    try {
      payload = await response.json();
    } catch {
      return safeFailure('OCR_RESPONSE_JSON', { model, logWarn });
    }

    const output = payload?.choices?.[0]?.message?.content;
    if (typeof output !== 'string' || !output.trim()) {
      return safeFailure('OCR_EMPTY_OUTPUT', { model, logWarn });
    }

    return {
      available:true,
      provider:'qianfan',
      model,
      text:output.trim(),
      failureCode:null,
      warning:null
    };
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      return safeFailure('OCR_TIMEOUT', { model, logWarn });
    }
    if (stage === 'response-json') return safeFailure('OCR_RESPONSE_JSON', { model, logWarn });
    return safeFailure(classifyTransportFailure(error), { model, logWarn });
  } finally {
    clearTimeout(timer);
  }
}
