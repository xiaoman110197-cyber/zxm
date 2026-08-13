import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeepSeekProvider } from '../../src/ai/providers.js';

test('deepseek provider uses official chat completions endpoint and v4 flash by default', async () => {
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init, body:JSON.parse(init.body) };
    return { ok:true, json:async () => ({ choices:[{ message:{ content:'{"mode":"question","question":{"key":"traffic_source","question":"主要客流从哪里来？","reason":"定位获客缺口"},"findings":[]}' } }] }) };
  };
  const provider = createDeepSeekProvider({ apiKey:'  test-key  ', fetchImpl });
  const result = await provider.diagnose({ id:'d1', answers:{}, evidence:[] });
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
    systemPrompt = JSON.parse(init.body).messages[0].content;
    return { ok:true, json:async () => ({ choices:[{ message:{ content:'{"mode":"question","question":{"key":"next","question":"下一步？","reason":"继续核实"},"findings":[]}' } }] }) };
  };
  const provider = createDeepSeekProvider({ apiKey:'k', fetchImpl });
  await provider.diagnose({ id:'d1', evidence:['correction_decision:{"label":"毛利率","originalValue":68,"correctedValue":60,"decision":"accepted"}'] });
  assert.match(systemPrompt, /accepted|采用正确值|订正/);
  assert.match(systemPrompt, /kept_original|保留原数据/);
  assert.match(systemPrompt, /优先|采用/);
});

test('diagnosis prompt distinguishes trusted report facts, proven corrections, anomalies and unresolved confirmations', async () => {
  let systemPrompt = '';
  const fetchImpl = async (_url, init) => {
    systemPrompt = JSON.parse(init.body).messages[0].content;
    return { ok:true, json:async () => ({ choices:[{ message:{ content:'{"mode":"question","question":{"key":"next","question":"下一步？","reason":"继续核实"},"findings":[]}' } }] }) };
  };
  const provider = createDeepSeekProvider({ apiKey:'k', fetchImpl });
  await provider.diagnose({
    id:'d1',
    evidence:[
      'report_fact:{"scope":"华南大区","metric":"营收","value":9800,"unit":"万元","trusted":true}',
      'report_issue:{"kind":"calculation_error","title":"毛利率计算错误","scope":"华南大区","originalValue":85,"correctedValue":37.76,"source":"program"}',
      'report_review_confirmation:{"scope":"华南大区","metric":"成本","value":6100,"trusted":false}'
    ]
  });
  assert.match(systemPrompt, /report_fact/);
  assert.match(systemPrompt, /trusted=true|trusted.*true/);
  assert.match(systemPrompt, /report_issue/);
  assert.match(systemPrompt, /source=program|source.*program/);
  assert.match(systemPrompt, /correctedValue/);
  assert.match(systemPrompt, /report_review_confirmation/);
  assert.match(systemPrompt, /不得.*确定事实|不能.*确定事实/);
  assert.match(systemPrompt, /anomaly|异常/);
});

test('deepseek provider can use v4 pro for review', async () => {
  let model;
  const fetchImpl = async (_url, init) => {
    model = JSON.parse(init.body).model;
    return { ok:true, json:async () => ({ choices:[{ message:{ content:'{"reviews":[]}' } }] }) };
  };
  const provider = createDeepSeekProvider({ apiKey:'k', model:'deepseek-v4-pro', fetchImpl });
  await provider.review({ findings:[] });
  assert.equal(model, 'deepseek-v4-pro');
});

test('review prompt is an independent second pass and protects deterministic facts', async () => {
  let systemPrompt = '';
  const fetchImpl = async (_url, init) => {
    systemPrompt = JSON.parse(init.body).messages[0].content;
    return { ok:true, json:async () => ({ choices:[{ message:{ content:'{"reviews":[]}' } }] }) };
  };
  const provider = createDeepSeekProvider({ apiKey:'k', fetchImpl });
  await provider.review({ findings:[] });
  assert.match(systemPrompt, /第二次独立复核/);
  assert.match(systemPrompt, /deterministic|程序/);
  assert.match(systemPrompt, /finding_1|稳定 id|对应 id/);
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
  assert.throws(() => createDeepSeekProvider({ apiKey:'' }), /DEEPSEEK_API_KEY/);
  assert.throws(() => createDeepSeekProvider({ apiKey:'   ' }), /DEEPSEEK_API_KEY/);
});

test('provider rejects malformed json instead of inventing a result', async () => {
  const fetchImpl = async () => ({ ok:true, json:async () => ({ choices:[{ message:{ content:'not-json' } }] }) });
  const provider = createDeepSeekProvider({ apiKey:'k', fetchImpl });
  await assert.rejects(() => provider.diagnose({ id:'d1' }), /invalid JSON/);
});
