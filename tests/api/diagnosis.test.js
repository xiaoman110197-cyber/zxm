import test from 'node:test';
import assert from 'node:assert/strict';
import { handleDiagnosisRequest, validateAiFinding } from '../../api/diagnosis.js';

function mockRes() {
  return { statusCode: 200, body: null, status(code){ this.statusCode = code; return this; }, json(value){ this.body = value; return this; } };
}

test('diagnosis api rejects missing diagnosis input', async () => {
  const req = { method: 'POST', body: {} };
  const res = mockRes();
  await handleDiagnosisRequest(req, res, { apiKey: 'test', ai: async () => ({}) });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /diagnosis/i);
});

test('diagnosis api reports missing server api key', async () => {
  const req = { method: 'POST', body: { diagnosis: { id: 'd1', answers: {}, evidence: [], findings: [], documents: [] } } };
  const res = mockRes();
  await handleDiagnosisRequest(req, res, { apiKey: '', ai: async () => ({}) });
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /OPENAI_API_KEY/);
});

test('AI findings must satisfy evidence schema', () => {
  assert.throws(() => validateAiFinding({ status: 'confirmed', priority: 'P0' }), /evidence/i);
  assert.doesNotThrow(() => validateAiFinding({
    status: 'probable', priority: 'P1', evidence: ['owner_answer:营业额下降'], confidence: 0.76,
    action: '核对近30天营业额趋势', metric: '营业额', impact: '影响现金流', title: '营业额下降'
  }));
});

test('diagnosis api returns structured AI result only after validation', async () => {
  const req = { method: 'POST', body: { diagnosis: { id: 'd1', answers: { problem: '利润下降' }, evidence: [], findings: [], documents: [] } } };
  const res = mockRes();
  await handleDiagnosisRequest(req, res, {
    apiKey: 'test',
    ai: async () => ({ mode: 'finding', findings: [{ status: 'probable', priority: 'P1', evidence: ['owner_answer:利润下降'], confidence: 0.7, action: '核对成本与毛利', metric: '毛利率', impact: '利润受压', title: '利润下降需验证' }] })
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.mode, 'finding');
  assert.equal(res.body.findings[0].priority, 'P1');
});
