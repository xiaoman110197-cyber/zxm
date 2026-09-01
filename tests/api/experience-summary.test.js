import test from 'node:test';
import assert from 'node:assert/strict';
import { handleExperienceSummaryRequest } from '../../api/experience-summary.js';

function mockRes(){
  return { statusCode:200, body:null, status(code){ this.statusCode=code; return this; }, json(value){ this.body=value; return this; }, setHeader(){} };
}

test('experience summary api returns aggregates without raw customer rows', async () => {
  const res = mockRes();
  await handleExperienceSummaryRequest({ method:'POST', body:{ file:{ name:'经营.csv', contentBase64:Buffer.from('x').toString('base64') } } }, res, {
    parseBusinessDocument:async () => ({ workbook:{ sheets:[{ name:'明细', headers:['日期','客户','状态','营业额'], rows:[{ 日期:'2026-09-02', 客户:'张三', 状态:'已成交', 营业额:500 }] }] } })
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.metrics.revenue, 500);
  assert.equal(JSON.stringify(res.body).includes('张三'), false);
});

test('experience summary api rejects non spreadsheet files', async () => {
  const res = mockRes();
  await handleExperienceSummaryRequest({ method:'POST', body:{ file:{ name:'a.pdf', contentBase64:Buffer.from('x').toString('base64') } } }, res);
  assert.equal(res.statusCode, 415);
});
