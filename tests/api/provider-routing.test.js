import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDiagnosisRequest } from '../../api/diagnosis.js';

function mockRes() {
  return { statusCode:200, body:null, status(code){ this.statusCode = code; return this; }, json(value){ this.body = value; return this; } };
}

const diagnosis = { id:'d1', answers:{ problem:'利润下降' }, evidence:[], findings:[], documents:[] };

test('uses configured primary provider for diagnosis', async () => {
  let primaryCalled = false;
  const res = mockRes();
  await handleDiagnosisRequest({ method:'POST', body:{ diagnosis } }, res, {
    primaryProvider:{ name:'deepseek', diagnose:async () => { primaryCalled = true; return { mode:'question', question:{ key:'cost', question:'最近成本变化多少？', reason:'判断利润问题' }, findings:[] }; } },
    reviewerProvider:null
  });
  assert.equal(primaryCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mode, 'question');
});

test('primary diagnosis failure returns a safe 502 without switching providers', async () => {
  const res = mockRes();
  await handleDiagnosisRequest({ method:'POST', body:{ diagnosis } }, res, {
    primaryProvider:{ name:'deepseek', diagnose:async () => { throw new Error('provider unavailable'); } },
    reviewerProvider:null
  });
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'AI diagnosis failed');
  assert.equal(res.body.detail, undefined);
});

test('runs a second DeepSeek review pass for high-risk findings', async () => {
  let reviewCalled = false;
  const provider = {
    name:'deepseek',
    diagnose:async () => ({ mode:'finding', question:null, findings:[{
      title:'利润数据存在严重异常', status:'confirmed', priority:'P0', evidence:['报表毛利率异常'], confidence:0.9,
      impact:'利润风险', action:'立即核对成本', metric:'毛利率'
    }] }),
    review:async ({ findings }) => { reviewCalled = true; return { reviews:[{ id:findings[0].id, title:'利润数据存在严重异常', verdict:'agree', reason:'证据支持', missingEvidence:[] }] }; }
  };
  const res = mockRes();
  await handleDiagnosisRequest({ method:'POST', body:{ diagnosis } }, res, {
    primaryProvider:provider,
    reviewerProvider:provider
  });
  assert.equal(reviewCalled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.findings[0].crossModelStatus, 'consistent');
});

test('reviewer failure does not discard a valid primary diagnosis', async () => {
  const res = mockRes();
  await handleDiagnosisRequest({ method:'POST', body:{ diagnosis } }, res, {
    primaryProvider:{ name:'deepseek', diagnose:async () => ({ mode:'finding', question:null, findings:[{
      title:'利润数据存在严重异常', status:'confirmed', priority:'P0', evidence:['报表毛利率异常'], confidence:0.9,
      impact:'利润风险', action:'立即核对成本', metric:'毛利率'
    }] }) },
    reviewerProvider:{ name:'deepseek', review:async () => { throw new Error('review unavailable'); } }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.findings[0].title, '利润数据存在严重异常');
  assert.equal(res.body.findings[0].crossModelStatus, 'review_unavailable');
});

test('marks every unreviewed AI result unavailable when reviewer is unavailable', async () => {
  const res = mockRes();
  await handleDiagnosisRequest({ method:'POST', body:{ diagnosis } }, res, {
    primaryProvider:{ name:'deepseek', diagnose:async () => ({ mode:'finding', question:null, findings:[{
      title:'菜单图片可能影响点击', status:'hypothesis', priority:'P2', evidence:['老板反馈'], confidence:0.4,
      impact:'可能影响转化', action:'A/B测试', metric:'点击率'
    }] }) },
    reviewerProvider:null
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.findings[0].crossModelStatus, 'review_unavailable');
});
