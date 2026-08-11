const MAX_FACTS = 160;
const MAX_CANDIDATES = 40;

const FACT_VALUE_TYPES = new Set(['string', 'number']);
const CANDIDATE_KINDS = new Set(['calculation_error', 'logic_error', 'anomaly']);

function clampConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric));
}

function text(value, max = 300) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeFact(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const scope = text(raw.scope, 120);
  const metric = text(raw.metric, 120);
  const sourceText = text(raw.sourceText, 300);
  if (!scope || !metric || !sourceText) return null;

  let value = raw.value;
  if (value !== null && !FACT_VALUE_TYPES.has(typeof value)) return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  if (typeof value === 'string') value = value.trim().slice(0, 160);

  return {
    id:text(raw.id, 100) || `vision_fact_${index + 1}`,
    scope,
    metric,
    value,
    unit:text(raw.unit, 40),
    sourceText,
    confidence:clampConfidence(raw.confidence),
    source:'vision'
  };
}

function normalizeCandidate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const title = text(raw.title, 160);
  const scope = text(raw.scope, 120);
  const explanation = text(raw.explanation, 600);
  const kind = CANDIDATE_KINDS.has(raw.kind) ? raw.kind : 'anomaly';
  if (!title || !scope || !explanation) return null;
  return {
    title,
    scope,
    kind,
    explanation,
    relatedFactIds:Array.isArray(raw.relatedFactIds)
      ? raw.relatedFactIds.map((item) => text(item, 100)).filter(Boolean).slice(0, 20)
      : []
  };
}

function normalizeVisionResult(parsed, model) {
  const facts = Array.isArray(parsed?.facts)
    ? parsed.facts.slice(0, MAX_FACTS).map(normalizeFact).filter(Boolean)
    : [];
  const candidates = Array.isArray(parsed?.candidates)
    ? parsed.candidates.slice(0, MAX_CANDIDATES).map(normalizeCandidate).filter(Boolean)
    : [];
  return { available:true, provider:'openai', model, facts, candidates, warning:null, failureCode:null };
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string' && content.text.trim()) return content.text;
    }
  }
  return '';
}

function responseSchema() {
  return {
    type:'object',
    additionalProperties:false,
    required:['facts','candidates'],
    properties:{
      facts:{
        type:'array',
        items:{
          type:'object',
          additionalProperties:false,
          required:['id','scope','metric','value','unit','sourceText','confidence'],
          properties:{
            id:{type:'string'},
            scope:{type:'string'},
            metric:{type:'string'},
            value:{anyOf:[{type:'number'},{type:'string'},{type:'null'}]},
            unit:{type:'string'},
            sourceText:{type:'string'},
            confidence:{type:'number',minimum:0,maximum:1}
          }
        }
      },
      candidates:{
        type:'array',
        items:{
          type:'object',
          additionalProperties:false,
          required:['title','scope','kind','explanation','relatedFactIds'],
          properties:{
            title:{type:'string'},
            scope:{type:'string'},
            kind:{type:'string',enum:['calculation_error','logic_error','anomaly']},
            explanation:{type:'string'},
            relatedFactIds:{type:'array',items:{type:'string'}}
          }
        }
      }
    }
  };
}

function safeFailure(code, { model, logWarn }) {
  if (typeof logWarn === 'function') logWarn('[vision]', code, `model=${model}`);
  return {
    available:false,
    provider:null,
    model:null,
    facts:[],
    candidates:[],
    failureCode:code,
    warning:`视觉分析暂时失败（错误编号 ${code}），已使用文字识别继续检查`
  };
}

function normalizeApiKey(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function hasUnsafeHeaderControlCharacters(value) {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function classifyTransportFailure(error) {
  const causeCode = String(error?.cause?.code || error?.code || '').toUpperCase();
  if (causeCode === 'ENOTFOUND' || causeCode === 'EAI_AGAIN') return 'VISION_DNS_ERROR';
  if (causeCode === 'UND_ERR_CONNECT_TIMEOUT' || causeCode === 'ETIMEDOUT') return 'VISION_CONNECT_TIMEOUT';
  if (causeCode === 'ECONNRESET' || causeCode === 'UND_ERR_SOCKET') return 'VISION_CONNECTION_RESET';
  if (causeCode === 'ECONNREFUSED') return 'VISION_CONNECTION_REFUSED';
  if (
    causeCode.startsWith('ERR_TLS_') ||
    causeCode.startsWith('CERT_') ||
    causeCode === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    causeCode === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    causeCode === 'SELF_SIGNED_CERT_IN_CHAIN'
  ) return 'VISION_TLS_ERROR';
  return 'VISION_NETWORK_ERROR';
}

export async function analyzeReportImage(input, {
  apiKey = process.env.OPENAI_API_KEY || '',
  model = process.env.OPENAI_VISION_MODEL || 'gpt-5-mini',
  fetchImpl = fetch,
  timeoutMs = 15000,
  logWarn = console.warn
} = {}) {
  const normalizedApiKey = normalizeApiKey(apiKey);
  if (!normalizedApiKey) {
    return {
      available:false,
      provider:null,
      model:null,
      facts:[],
      candidates:[],
      warning:'视觉分析暂不可用，已使用文字识别继续检查'
    };
  }
  if (hasUnsafeHeaderControlCharacters(normalizedApiKey)) {
    return safeFailure('VISION_REQUEST_CONFIG', { model, logWarn });
  }

  const imageUrl = `data:${input.mimeType};base64,${input.buffer.toString('base64')}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let stage = 'network';
  try {
    const response = await fetchImpl('https://api.openai.com/v1/responses', {
      method:'POST',
      headers:{ Authorization:`Bearer ${normalizedApiKey}`, 'Content-Type':'application/json' },
      signal:controller.signal,
      body:JSON.stringify({
        model,
        instructions:[
          '你是报表结构读取器，不直接下最终结论。',
          '只抄录图片中可见的报表事实，保持行列、部门、区域、SKU、日期之间的对应关系。',
          '不要根据常识修正原值；看不清就降低 confidence，不能猜。',
          'facts 中 value 必须是图片里读到的原值。',
          'candidates 只能提出候选异常，不能给 correctedValue，也不能声称未经程序复算的正确答案。',
          'OCR 文本仅是辅助证据，若与图片冲突，以较低 confidence 记录图片读数，不要自行合并。'
        ].join('\n'),
        input:[{
          role:'user',
          content:[
            { type:'input_text', text:`请读取这张经营报表。OCR 辅助文本如下，仅供交叉参考：\n${String(input.ocrText || '').slice(0, 12000)}` },
            { type:'input_image', image_url:imageUrl, detail:'high' }
          ]
        }],
        max_output_tokens:5000,
        text:{
          format:{
            type:'json_schema',
            name:'report_image_facts',
            strict:true,
            schema:responseSchema()
          }
        }
      })
    });

    if (!response.ok) return safeFailure(`VISION_HTTP_${response.status || 'UNKNOWN'}`, { model, logWarn });

    stage = 'response-json';
    const payload = await response.json();
    const outputText = extractOutputText(payload);
    if (!outputText) return safeFailure('VISION_EMPTY_OUTPUT', { model, logWarn });

    stage = 'output-json';
    let parsed;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      return safeFailure('VISION_INVALID_JSON', { model, logWarn });
    }
    return normalizeVisionResult(parsed, model);
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      return safeFailure('VISION_TIMEOUT', { model, logWarn });
    }
    if (stage === 'response-json') return safeFailure('VISION_RESPONSE_JSON', { model, logWarn });
    return safeFailure(classifyTransportFailure(error), { model, logWarn });
  } finally {
    clearTimeout(timer);
  }
}
