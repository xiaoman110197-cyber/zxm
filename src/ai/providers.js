const DIAGNOSIS_SYSTEM_PROMPT = [
  '你是经营诊断助手。必须基于老板回答、经营数据和可追溯证据工作。',
  '信息不足时返回 mode=question，只追问一个最有信息价值的问题。',
  '证据足够时返回 mode=finding，并输出 findings。',
  '不得把猜测写成事实；confirmed 必须有直接证据，probable 是高概率但仍需验证，hypothesis 是待验证假设。',
  '返回 JSON，不要输出 JSON 以外的文本。'
].join('\n');

const REVIEW_SYSTEM_PROMPT = [
  '你是第二模型复核员，不要重新自由发挥。',
  '只检查主模型的结论是否被证据支持、是否夸大因果、P0/P1/P2 是否合理、还缺什么证据。',
  '返回 JSON：{"reviews":[{"title":"...","verdict":"agree|disagree","reason":"...","missingEvidence":[]}]}。',
  '返回 JSON，不要输出 JSON 以外的文本。'
].join('\n');

function parseJson(text, providerName) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${providerName} returned invalid JSON`);
  }
}

async function ensureOk(response, providerName) {
  if (response.ok) return;
  let detail = '';
  try { detail = await response.text(); } catch {}
  throw new Error(`${providerName} request failed (${response.status ?? 'unknown'}): ${detail.slice(0, 300)}`);
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs, providerName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${providerName} request timeout`)), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal:controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${providerName} request timeout`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function createDeepSeekProvider({
  apiKey = process.env.DEEPSEEK_API_KEY || '',
  model = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash',
  fetchImpl = fetch,
  diagnosisTimeoutMs = 25000,
  reviewTimeoutMs = 10000,
  diagnosisMaxTokens = 1800,
  reviewMaxTokens = 1000
} = {}) {
  if (!apiKey) throw new Error('Server is missing DEEPSEEK_API_KEY');

  async function request(messages, { timeoutMs, maxTokens }) {
    const response = await fetchWithTimeout(fetchImpl, 'https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        response_format: { type: 'json_object' },
        max_tokens: maxTokens,
        stream: false
      })
    }, timeoutMs, 'DeepSeek');
    await ensureOk(response, 'DeepSeek');
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('DeepSeek response has no message content');
    return parseJson(content, 'DeepSeek');
  }

  return {
    name: 'deepseek',
    model,
    diagnose(diagnosis) {
      return request([
        { role: 'system', content: DIAGNOSIS_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(diagnosis) }
      ], { timeoutMs:diagnosisTimeoutMs, maxTokens:diagnosisMaxTokens });
    },
    review(primaryResult) {
      return request([
        { role: 'system', content: REVIEW_SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(primaryResult) }
      ], { timeoutMs:reviewTimeoutMs, maxTokens:reviewMaxTokens });
    }
  };
}

export function createOpenAIProvider({
  apiKey = process.env.OPENAI_API_KEY || '',
  model = process.env.OPENAI_MODEL || 'gpt-5-mini',
  fetchImpl = fetch,
  diagnosisTimeoutMs = 25000,
  reviewTimeoutMs = 10000,
  diagnosisMaxTokens = 1800,
  reviewMaxTokens = 1000
} = {}) {
  if (!apiKey) throw new Error('Server is missing OPENAI_API_KEY');

  async function request(instructions, input, { timeoutMs, maxOutputTokens }) {
    const response = await fetchWithTimeout(fetchImpl, 'https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        instructions,
        input: JSON.stringify(input),
        text: { format: { type: 'json_object' } },
        max_output_tokens: maxOutputTokens,
        store: false
      })
    }, timeoutMs, 'OpenAI');
    await ensureOk(response, 'OpenAI');
    const payload = await response.json();
    if (typeof payload?.output_text !== 'string' || !payload.output_text.trim()) throw new Error('OpenAI response has no output_text');
    return parseJson(payload.output_text, 'OpenAI');
  }

  return {
    name: 'openai',
    model,
    diagnose(diagnosis) {
      return request(DIAGNOSIS_SYSTEM_PROMPT, diagnosis, { timeoutMs:diagnosisTimeoutMs, maxOutputTokens:diagnosisMaxTokens });
    },
    review(primaryResult) {
      return request(REVIEW_SYSTEM_PROMPT, primaryResult, { timeoutMs:reviewTimeoutMs, maxOutputTokens:reviewMaxTokens });
    }
  };
}
