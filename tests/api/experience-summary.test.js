import test from 'node:test';
import assert from 'node:assert/strict';
import * as experienceApi from '../../api/experience-summary.js';

const { handleExperienceSummaryRequest } = experienceApi;

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
    requestId:'trace-request-001',
    parseBusinessDocument:async () => ({ workbook:ambiguousWorkbook() }),
    fieldMapperProvider:'DeepSeek',
    fieldMapperModel:'deepseek-v4-flash',
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
  assert.deepEqual(res.body.aiMappingTrace, {
    provider:'DeepSeek',
    model:'deepseek-v4-flash',
    callStatus:'success',
    requestId:'trace-request-001',
    mappingCount:2
  });
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

test('V7 business question API uses aggregate context, keeps evidence deterministic, and blocks unsupported profit claims', async () => {
  assert.equal(typeof experienceApi.handleExperienceQuestionRequest, 'function');
  const res = mockRes();
  let receivedInput = null;
  await experienceApi.handleExperienceQuestionRequest({ method:'POST', body:{
    question:'今天利润怎么样？为什么？',
    summary:{
      ok:true, usedSheet:'订单明细', period:'2026-09-02', fieldCoverage:67,
      missing:['成本/毛利率'],
      metrics:{ records:20, appointments:12, arrivals:8, completed:6, noShows:2, revenue:9800, overdue:3 },
      channels:[{ channel:'企微', records:9, revenue:4300 }],
      overdueOwners:[{ owner:'小王', overdue:2 }]
    },
    source:{ fileName:'经营.csv' },
    history:[{ role:'owner', text:'今天怎样？' }, { role:'assistant', text:'营业额已确认。' }]
  } }, res, {
    provider:{ answerExperienceQuestion:async (input) => {
      receivedInput = input;
      return {
        overview:'营业额表现尚可，因此利润约为9800元。',
        cost:'暂无更多成本信息。',
        efficiency:'有3项逾期。',
        profit:'利润约9800元。',
        actions:['先处理逾期'],
        limits:[]
      };
    } }
  });
  assert.equal(res.statusCode, 200);
  assert.equal(receivedInput.context.facts.revenue, 9800);
  assert.equal(receivedInput.context.availability.profit, false);
  assert.match(res.body.answer.profit, /无法判断利润|不能判断利润/);
  assert.doesNotMatch(res.body.answer.profit, /9800/);
  assert.ok(res.body.evidence.some((item) => item.includes('2026-09-02')));
  assert.ok(res.body.evidence.some((item) => item.includes('20')));
  assert.equal(JSON.stringify(receivedInput).includes('客户明细'), false);
});
