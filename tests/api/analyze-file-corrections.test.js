import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { handleAnalyzeFileRequest } from '../../api/analyze-file.js';

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
  await handleAnalyzeFileRequest({ method:'POST', body:{ file:{ name:'经营报表.xlsx', contentBase64:mismatchWorkbookBase64() } } }, res, { disableBurstGuard:true });

  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.corrections));
  const correction = res.body.corrections.find((item) => item.kind === 'calculation_error' && item.label === '营业额合计');
  assert.equal(correction.originalValue, 250);
  assert.equal(correction.correctedValue, 200);
});
