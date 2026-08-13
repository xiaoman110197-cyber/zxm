import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { handleAnalyzeFileRequest } from '../../api/analyze-file.js';
import { verifyTrustToken } from '../../src/security/trust-token.js';

const trustSecret = 'analysis-test-secret-with-enough-entropy';

function mockRes() {
  return { statusCode:200, body:null, headers:{}, status(code){ this.statusCode = code; return this; }, setHeader(name,value){ this.headers[String(name).toLowerCase()] = value; }, json(value){ this.body = value; return this; } };
}

function mismatchWorkbookBase64() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { 订单号:'A001', 营业额:100 },
    { 订单号:'A002', 营业额:100 }
  ]), '订单明细');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ 指标:'营业额', 数值:250 }]), '汇总');
  return XLSX.write(wb, { type:'buffer', bookType:'xlsx' }).toString('base64');
}

test('file analysis exposes deterministic corrections separately from raw audit errors', async () => {
  const res = mockRes();
  await handleAnalyzeFileRequest({ method:'POST', body:{ file:{ name:'经营报表.xlsx', contentBase64:mismatchWorkbookBase64() } } }, res, { disableBurstGuard:true, trustSecret });

  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.corrections));
  const correction = res.body.corrections.find((item) => item.kind === 'calculation_error' && item.label === '营业额合计');
  assert.equal(correction.originalValue, 250);
  assert.equal(correction.correctedValue, 200);
  assert.match(correction.id, /^correction_[a-f0-9]{64}_1$/);
  const signed = verifyTrustToken(res.body.analysisToken, 'analysis', { secret:trustSecret });
  assert.equal(signed.corrections[0].id, correction.id);
  assert.match(signed.sourceDigest, /^[a-f0-9]{64}$/);
  assert.equal(signed.corrections[0].correctedValue, 200);
  assert.equal('text' in signed.document, false);
  assert.equal(signed.document.structured, true);
  assert.equal(Array.isArray(signed.document.preview), true);
  assert.doesNotMatch(JSON.stringify(signed), new RegExp(mismatchWorkbookBase64().slice(0, 40)));
});

test('production file analysis reports missing trust signing as 503 before parsing', async () => {
  for (const trustSecret of [undefined, '   ']) {
    let parsed = false;
    const res = mockRes();
    await handleAnalyzeFileRequest({ method:'POST', body:{ file:{
      name:'data.csv', contentBase64:Buffer.from('a,b\n1,2').toString('base64')
    } } }, res, {
      env:{}, requireTrustToken:true, disableBurstGuard:true, trustSecret,
      parseBusinessDocument:async () => { parsed = true; throw new Error('must not parse'); }
    });
    assert.equal(parsed, false);
    assert.equal(res.statusCode, 503);
    assert.match(res.body.error, /签名|配置/);
  }
});
