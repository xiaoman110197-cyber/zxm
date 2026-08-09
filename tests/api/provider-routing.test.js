import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDiagnosisRequest } from '../../api/diagnosis.js';

function mockRes() {
  return { statusCode: 200, body: null, status(code){ this.statusCode = code; return this; }, json(value){ this.body = value; return this; } };
}

const diagnosis = { id:'d1', answers:{ problem:'利润下降' }, evidence:[], findings:[], documents:[] };

test('uses configured primary provider for diagnosis', async () => {
  let primaryCalled = false;
  const req = { method:'POST', body:{ diagnosis } };
  const res = mockRes();
  await handleDiagnosisRequest(req, res, {
    primaryProvider: { diagnose: async () => { primaryCalled = true; return { mode:'question', question:{ key:'cost', question:'最近成本变化多少？', reason:'判断利润问题' }, findings:[] }; } }
  });
  assert.equal(primaryCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mode, 'question');
});

test('runs reviewer provider for high-risk findings and returns cross-model status', async () => {
  let reviewCalled = false;
  const req = { method:'POST', body:{ diagnosis } };
  const res = mockRes();
  await handleDiagnosisRequest(req, res, {
    primaryProvider: { diagnose: async () => ({ mode:'finding', question:null, findings:[{
      title:'利润数据存在严重异常', status:'confirmed', priority:'P0', evidence:['报表毛利率异常'], confidence:0.9,
      impact:'利润风险', action:'立即核对成本', metric:'毛利率'
    }] }) },
    reviewerProvider: { review: async () => { reviewCalled = true; return { reviews:[{ title:'利润数据存在严重异常', verdict:'agree', reason:'证据支持', missingEvidence:[] }] }; } }
  });
  assert.equal(reviewCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.findings[0].crossModelStatus, 'consistent');
});

test('falls back to single-model result when reviewer provider is unavailable', async () => {
  const req = { method:'POST', body:{ diagnosis } };
  const res = mockRes();
  await handleDiagnosisRequest(req, res, {
    primaryProvider: { diagnose: async () => ({ mode:'finding', question:null, findings:[{
      title:'菜单图片可能影响点击', status:'hypothesis', priority:'P2', evidence:['老板反馈'], confidence:0.4,
      impact:'可能影响转化', action:'A/B测试', metric:'点击率'
    }] }) }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.findings[0].crossModelStatus, 'single_model');
});
