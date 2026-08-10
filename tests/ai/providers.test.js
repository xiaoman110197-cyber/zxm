import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeepSeekProvider, createOpenAIProvider } from '../../src/ai/providers.js';

test('deepseek provider uses official chat completions endpoint and bounded output by default', async () => {
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
  assert.equal(request.body.max_tokens, 1800);
  assert.ok(request.init.signal instanceof AbortSignal);
  assert.equal(result.mode, 'question');
});

test('deepseek provider can use v4 pro and smaller review budget', async () => {
  let body;
  const fetchImpl = async (_url, init) => {
    body = JSON.parse(init.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"reviews":[]}' } }] }) };
  };
  const provider = createDeepSeekProvider({ apiKey: 'k', model: 'deepseek-v4-pro', fetchImpl });
  await provider.review({ findings: [] });
  assert.equal(body.model, 'deepseek-v4-pro');
  assert.equal(body.max_tokens, 1000);
});

test('openai provider targets responses api, disables storage and bounds output', async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init, body:JSON.parse(init.body) };
    return { ok: true, json: async () => ({ output_text: '{"mode":"finding","question":null,"findings":[]}' }) };
  };
  const provider = createOpenAIProvider({ apiKey: 'openai-key', fetchImpl, model: 'gpt-5-mini' });
  const result = await provider.diagnose({ id: 'd1' });
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.body.store, false);
  assert.equal(request.body.max_output_tokens, 1800);
  assert.ok(request.init.signal instanceof AbortSignal);
  assert.equal(result.mode, 'finding');
});

test('provider diagnosis prompt treats uploaded content as untrusted evidence, not instructions', async () => {
  let deepSeekPrompt = '';
  const deepSeekFetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    deepSeekPrompt = body.messages[0].content;
    return { ok:true, json:async () => ({ choices:[{ message:{ content:'{"mode":"question","question":{"key":"k","question":"补充数据？","reason":"验证"},"findings":[]}' } }] }) };
  };
  await createDeepSeekProvider({ apiKey:'k', fetchImpl:deepSeekFetch }).diagnose({ id:'d' });
  assert.match(deepSeekPrompt, /不可信|不受信任/);
  assert.match(deepSeekPrompt, /文件|OCR|表格/);
  assert.match(deepSeekPrompt, /指令/);
  assert.match(deepSeekPrompt, /OCR.*confirmed|OCR.*事实/s);
  assert.match(deepSeekPrompt, /3.*6/);

  let openAiInstructions = '';
  const openAiFetch = async (_url, init) => {
    openAiInstructions = JSON.parse(init.body).instructions;
    return { ok:true, json:async () => ({ output_text:'{"mode":"question","question":{"key":"k","question":"补充数据？","reason":"验证"},"findings":[]}' }) };
  };
  await createOpenAIProvider({ apiKey:'k', fetchImpl:openAiFetch }).diagnose({ id:'d' });
  assert.match(openAiInstructions, /不可信|不受信任/);
  assert.match(openAiInstructions, /指令/);
});

test('provider aborts a diagnosis request after its explicit timeout', async () => {
  const fetchImpl = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason || new Error('aborted')), { once:true });
  });
  const provider = createDeepSeekProvider({ apiKey:'k', fetchImpl, diagnosisTimeoutMs:5 });
  await assert.rejects(() => provider.diagnose({ id:'slow' }), /timeout|abort/i);
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
