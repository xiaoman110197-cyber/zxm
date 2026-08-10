import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDiagnosisRequest } from '../../api/diagnosis.js';

function mockRes() {
  return { statusCode: 200, body: null, status(code){ this.statusCode = code; return this; }, json(value){ this.body = value; return this; } };
}

const diagnosis = { id:'d1', answers:{ problem:'利润下降' }, evidence:[], findings:[], documents:[] };

function validQuestion() {
  return { mode:'question', question:{ key:'cost', question:'最近成本变化多少？', reason:'判断利润问题' }, findings:[] };
}

function validFinding() {
  return { mode:'finding', question:null, findings:[{
    title:'利润数据存在严重异常', status:'confirmed', priority:'P0', evidence:['报表毛利率异常'], confidence:0.9,
    impact:'利润风险', action:'立即核对成本', metric:'毛利率'
  }] };
}

test('uses configured primary provider for diagnosis', async () => {
  let primaryCalled = false;
  const req = { method:'POST', body:{ diagnosis } };
  const res = mockRes();
  await handleDiagnosisRequest(req, res, {
    primaryProvider: { name:'primary', diagnose: async () => { primaryCalled = true; return validQuestion(); } }
  });
  assert.equal(primaryCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mode, 'question');
});

test('falls back to the second provider with the same full context when primary diagnosis fails', async () => {
  let fallbackInput;
  const req = { method:'POST', body:{ diagnosis } };
  const res = mockRes();
  await handleDiagnosisRequest(req, res, {
    primaryProvider: { name:'deepseek', diagnose: async () => { throw new Error('primary down'); } },
    fallbackProvider: { name:'openai', diagnose: async (input) => { fallbackInput = input; return validQuestion(); } }
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(fallbackInput, diagnosis);
  assert.equal(res.body.mode, 'question');
  assert.equal(res.body.providerFallback, true);
});

test('falls back when primary returns an invalid diagnosis contract', async () => {
  let fallbackCalled = false;
  const res = mockRes();
  await handleDiagnosisRequest({ method:'POST', body:{ diagnosis } }, res, {
    primaryProvider: { name:'deepseek', diagnose: async () => ({ mode:'question', question:null, findings:[] }) },
    fallbackProvider: { name:'openai', diagnose: async () => { fallbackCalled = true; return validQuestion(); } }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(fallbackCalled, true);
});

test('returns service unavailable without fabricating a diagnosis when both providers fail', async () => {
  const res = mockRes();
  await handleDiagnosisRequest({ method:'POST', body:{ diagnosis } }, res, {
    primaryProvider: { name:'deepseek', diagnose: async () => { throw new Error('deepseek down'); } },
    fallbackProvider: { name:'openai', diagnose: async () => { throw new Error('openai down'); } }
  });
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /暂时不可用|unavailable/i);
  assert.equal(res.body.findings, undefined);
});

test('runs reviewer provider for high-risk findings and returns cross-model status', async () => {
  let reviewCalled = false;
  const req = { method:'POST', body:{ diagnosis } };
  const res = mockRes();
  await handleDiagnosisRequest(req, res, {
    primaryProvider: { name:'primary', diagnose: async () => validFinding() },
    reviewerProvider: { name:'reviewer', review: async () => { reviewCalled = true; return { reviews:[{ title:'利润数据存在严重异常', verdict:'agree', reason:'证据支持', missingEvidence:[] }] }; } }
  });
  assert.equal(reviewCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.findings[0].crossModelStatus, 'consistent');
});

test('reviewer failure does not destroy a valid primary diagnosis', async () => {
  const res = mockRes();
  await handleDiagnosisRequest({ method:'POST', body:{ diagnosis } }, res, {
    primaryProvider: { name:'primary', diagnose: async () => validFinding() },
    reviewerProvider: { name:'reviewer', review: async () => { throw new Error('review timeout'); } }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.findings[0].title, '利润数据存在严重异常');
  assert.equal(res.body.findings[0].crossModelStatus, 'review_unavailable');
});

test('falls back to single-model result when reviewer provider is unavailable', async () => {
  const req = { method:'POST', body:{ diagnosis } };
  const res = mockRes();
  await handleDiagnosisRequest(req, res, {
    primaryProvider: { name:'primary', diagnose: async () => ({ mode:'finding', question:null, findings:[{
      title:'菜单图片可能影响点击', status:'hypothesis', priority:'P2', evidence:['老板反馈'], confidence:0.4,
      impact:'可能影响转化', action:'A/B测试', metric:'点击率'
    }] }) }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.findings[0].crossModelStatus, 'single_model');
});
