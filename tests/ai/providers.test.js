import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeepSeekProvider, createOpenAIProvider } from '../../src/ai/providers.js';

test('deepseek provider uses official chat completions endpoint and v4 flash by default', async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init, body: JSON.parse(init.body) };
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"mode":"question","question":{"key":"traffic_source","question":"主要客流从哪里来？","reason":"定位获客缺口"},"findings":[]}' } }] }) };
  };
  const provider = createDeepSeekProvider({ apiKey: 'test-key', fetchImpl });
  const result = await provider.diagnose({ id: 'd1', answers: {}, evidence: [] });
  assert.equal(request.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(request.body.model, 'deepseek-v4-flash');
  assert.equal(request.init.headers.Authorization, 'Bearer test-key');
  assert.equal(request.body.response_format.type, 'json_object');
  assert.equal(request.body.max_tokens, 2500);
  assert.ok(request.init.signal);
  assert.equal(result.mode, 'question');
});

test('diagnosis prompt treats merchant-accepted deterministic corrections as the value to use', async () => {
  let systemPrompt = '';
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    systemPrompt = body.messages[0].content;
    return { ok:true, json:async () => ({ choices:[{ message:{ content:'{"mode":"question","question":{"key":"next","question":"下一步？","reason":"继续核实"},"findings":[]}' } }] }) };
  };
  const provider = createDeepSeekProvider({ apiKey:'k', fetchImpl });
  await provider.diagnose({ id:'d1', evidence:['correction_decision:{"label":"毛利率","originalValue":68,"correctedValue":60,"decision":"accepted"}'] });
  assert.match(systemPrompt, /accepted|采用正确值|订正/);
  assert.match(systemPrompt, /kept_original|保留原数据/);
  assert.match(systemPrompt, /优先|采用/);
});

test('deepseek provider can use v4 pro for review', async () => {
  let model;
  const fetchImpl = async (_url, init) => {
    model = JSON.parse(init.body).model;
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"reviews":[]}' } }] }) };
  };
  const provider = createDeepSeekProvider({ apiKey: 'k', model: 'deepseek-v4-pro', fetchImpl });
  await provider.review({ findings: [] });
  assert.equal(model, 'deepseek-v4-pro');
});

test('openai provider targets responses api and parses output_text', async () => {
  let request;
  const fetchImpl = async (requestUrl, init) => {
    request = { url:requestUrl, init, body:JSON.parse(init.body) };
    return { ok: true, json: async () => ({ output_text: '{"mode":"finding","question":null,"findings":[]}' }) };
  };
  const provider = createOpenAIProvider({ apiKey: 'openai-key', fetchImpl, model: 'gpt-5-mini' });
  const result = await provider.diagnose({ id: 'd1' });
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.body.max_output_tokens, 2500);
  assert.ok(request.init.signal);
  assert.equal(result.mode, 'finding');
});

test('provider aborts an upstream request after its configured timeout', async () => {
  const fetchImpl = async (_url, init) => new Promise((_resolve, reject) => {
    const guard = setTimeout(() => reject(new Error('fetch stub did not receive timely abort')), 80);
    init.signal?.addEventListener('abort', () => {
      clearTimeout(guard);
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once:true });
  });
  const provider = createDeepSeekProvider({ apiKey:'k', fetchImpl, timeoutMs:10 });
  await assert.rejects(() => provider.diagnose({ id:'d1' }), /timeout|timed out|超时/i);
});

test('provider fails clearly when api key is missing', () => {
  assert.throws(() => createDeepSeekProvider({ apiKey: '' }), /DEEPSEEK_API_KEY/);
  assert.throws(() => createOpenAIProvider({ apiKey: '' }), /OPENAI_API_KEY/);
});

test('provider rejects malformed json instead of inventing a result', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'not-json' } }] }) });
  const provider = createDeepSeekProvider({ apiKey: 'k', fetchImpl });
  await assert.rejects(() => provider.diagnose({ id: 'd1' }), /invalid JSON/);
});
