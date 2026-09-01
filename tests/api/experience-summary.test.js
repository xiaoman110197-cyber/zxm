import test from 'node:test';
import assert from 'node:assert/strict';
import { handleExperienceSummaryRequest } from '../../api/experience-summary.js';

function mockRes(){
  return { statusCode:200, body:null, status(code){ this.statusCode=code; return this; }, json(value){ this.body=value; return this; }, setHeader(){} };
}

function ambiguousWorkbook(){
  return { sheets:[{ name:'门店流水', headers:['发生日','客户称呼','进度口径','到账口径','来路口径','跟单人','下次处理点','手机'], rows:[
    { 发生日:'2026-09-02', 客户称呼:'张三', 进度口径:'已成交', 到账口径:'688元', 来路口径:'抖音', 跟单人:'小王', 下次处理点:'2026-09-01 18:00', 手机:'13800000000' }
  ]}] };
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

test('AI mapping request sends schema profile without raw customer values and does not auto-apply suggestions', async () => {
  const res = mockRes();
  let receivedProfile = null;
  await handleExperienceSummaryRequest({ method:'POST', body:{
    file:{ name:'乱表.csv', contentBase64:Buffer.from('x').toString('base64') },
    requestFieldMapping:true
  } }, res, {
    parseBusinessDocument:async () => ({ workbook:ambiguousWorkbook() }),
    fieldMapper:async (profile) => {
      receivedProfile = profile;
      return { mappings:[
        { sheet:'门店流水', header:'发生日', field:'date', confidence:.96, reason:'列名表示发生日期' },
        { sheet:'门店流水', header:'到账口径', field:'amount', confidence:.9, reason:'列名表示到账金额' }
      ] };
    }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.summary.ok, false);
  assert.equal(res.body.mappingSuggestions.length, 2);
  const sent = JSON.stringify(receivedProfile);
  assert.equal(sent.includes('张三'), false);
  assert.equal(sent.includes('13800000000'), false);
  assert.equal(sent.includes('688元'), false);
  assert.match(sent, /发生日/);
  assert.match(sent, /到账口径/);
});

test('confirmed AI mappings are validated and then used by deterministic calculations without another model call', async () => {
  const res = mockRes();
  let fieldMapperCalls = 0;
  const confirmedMappings = [
    { sheet:'门店流水', field:'date', header:'发生日' },
    { sheet:'门店流水', field:'customer', header:'客户称呼' },
    { sheet:'门店流水', field:'status', header:'进度口径' },
    { sheet:'门店流水', field:'amount', header:'到账口径' },
    { sheet:'门店流水', field:'channel', header:'来路口径' },
    { sheet:'门店流水', field:'owner', header:'跟单人' },
    { sheet:'门店流水', field:'due', header:'下次处理点' }
  ];
  await handleExperienceSummaryRequest({ method:'POST', body:{
    file:{ name:'乱表.csv', contentBase64:Buffer.from('x').toString('base64') },
    confirmedMappings
  } }, res, {
    parseBusinessDocument:async () => ({ workbook:ambiguousWorkbook() }),
    fieldMapper:async () => { fieldMapperCalls += 1; return { mappings:[] }; }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(fieldMapperCalls, 0);
  assert.equal(res.body.summary.ok, true);
  assert.equal(res.body.summary.metrics.revenue, 688);
  assert.equal(res.body.summary.metrics.completed, 1);
  assert.equal(JSON.stringify(res.body).includes('张三'), false);
});
