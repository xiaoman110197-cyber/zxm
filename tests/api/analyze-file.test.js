import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { handleAnalyzeFileRequest } from '../../api/analyze-file.js';

function mockRes() {
  return { statusCode: 200, body: null, status(code){ this.statusCode = code; return this; }, json(value){ this.body = value; return this; } };
}

function workbookBase64() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ 订单号:'A001', 营业额:100 }, { 订单号:'A001', 营业额:100 }]), '订单明细');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ 指标:'营业额', 数值:250 }]), '汇总');
  return XLSX.write(wb, { type:'buffer', bookType:'xlsx' }).toString('base64');
}

test('file api rejects missing file payload', async () => {
  const res = mockRes();
  await handleAnalyzeFileRequest({ method:'POST', body:{} }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /file/i);
});

test('file api rejects unsupported extension without inventing analysis', async () => {
  const res = mockRes();
  await handleAnalyzeFileRequest({ method:'POST', body:{ file:{ name:'data.exe', contentBase64:'AA==' } } }, res);
  assert.equal(res.statusCode, 415);
  assert.equal(res.body.audit, undefined);
});

test('file api analyzes all Excel sheets and returns deterministic audit', async () => {
  const res = mockRes();
  await handleAnalyzeFileRequest({ method:'POST', body:{ file:{ name:'经营报表.xlsx', contentBase64:workbookBase64() } } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.document.sheetNames, ['订单明细','汇总']);
  assert.ok(res.body.audit.errors.some(e => e.type === 'duplicate'));
  assert.ok(res.body.audit.errors.some(e => e.type === 'cross_sheet_mismatch'));
  assert.equal(res.body.summary.sheetCount, 2);
});

test('structured upload gives AI bounded row evidence and a concise audit summary', async () => {
  const res = mockRes();
  await handleAnalyzeFileRequest({ method:'POST', body:{ file:{ name:'经营报表.xlsx', contentBase64:workbookBase64() } } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.document.preview[0].name, '订单明细');
  assert.equal(res.body.document.preview[0].rows[0].营业额, 100);
  assert.equal(res.body.document.auditSummary.metrics.revenue, 200);
  assert.equal(res.body.document.auditSummary.errorCount, res.body.audit.errors.length);
  assert.ok(res.body.document.auditSummary.topIssues.length > 0);
  assert.ok(res.body.document.auditSummary.topIssues.length <= 10);
});

test('file api analyzes CSV through the same normalized endpoint', async () => {
  const res = mockRes();
  const contentBase64 = Buffer.from('订单号,营业额\nA001,100\nA002,200', 'utf8').toString('base64');
  await handleAnalyzeFileRequest({ method:'POST', body:{ file:{ name:'订单.csv', contentBase64 } } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.document.type, 'csv');
  assert.equal(res.body.summary.sheetCount, 1);
  assert.equal(res.body.document.preview[0].rows.length, 2);
});

test('file api rejects files above the 3 MB raw-file transport limit before parsing', async () => {
  const res = mockRes();
  const contentBase64 = Buffer.alloc(3 * 1024 * 1024 + 1, 0x61).toString('base64');
  await handleAnalyzeFileRequest({ method:'POST', body:{ file:{ name:'大文件.csv', contentBase64 } } }, res, {
    parseBusinessDocument: async () => { throw new Error('parser should not run'); }
  });
  assert.equal(res.statusCode, 413);
  assert.match(res.body.error, /3\s*MB|过大/);
});

test('file api returns understandable error for corrupt Excel', async () => {
  const res = mockRes();
  await handleAnalyzeFileRequest({ method:'POST', body:{ file:{ name:'坏文件.xlsx', contentBase64:Buffer.from('not an xlsx').toString('base64') } } }, res);
  assert.equal(res.statusCode, 422);
  assert.match(res.body.error, /无法解析|损坏/);
});
