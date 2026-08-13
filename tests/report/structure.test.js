import test from 'node:test';
import assert from 'node:assert/strict';
import { structureReportText } from '../../src/report/structure.js';
import { inspectReportFacts } from '../../src/report/rules.js';

test('drops model facts whose sourceText is not present in OCR text', async () => {
  const provider = { async structureReport() { return { facts:[{
    id:'x', scope:'华南', metric:'收入', value:999999, unit:'元',
    sourceText:'华南 收入 999999', confidence:0.99, correctedValue:100
  }], candidates:[], confirmations:[] }; } };
  const result = await structureReportText({ text:'华南 收入 9800', source:'qianfan_ocr', degraded:false }, { provider });
  assert.equal(result.facts.length, 0);
});

test('drops a fact when its value is not anchored inside sourceText', async () => {
  const provider = { async structureReport() { return { facts:[{
    id:'x', scope:'华南', metric:'收入', value:999999, unit:'',
    sourceText:'华南 收入 9800', confidence:0.99
  }], candidates:[], confirmations:[] }; } };
  const result = await structureReportText({ text:'华南 收入 9800', source:'qianfan_ocr', degraded:false }, { provider });
  assert.equal(result.facts.length, 0);
});

test('strips correctedValue and downgrades local OCR facts', async () => {
  const provider = { async structureReport() { return {
    facts:[{ id:'f1', scope:'华南', metric:'收入', value:9800, unit:'元', sourceText:'华南 收入 9800 元', confidence:0.98, correctedValue:123 }],
    candidates:[{ title:'疑似异常', scope:'华南', kind:'anomaly', explanation:'需核对', relatedFactIds:['f1'], correctedValue:1 }],
    confirmations:[]
  }; } };
  const result = await structureReportText({ text:'华南 收入 9800 元', source:'local_ocr', degraded:true }, { provider });
  assert.equal(result.facts[0].source, 'local_ocr_ai');
  assert.ok(result.facts[0].confidence <= 0.64);
  assert.equal('correctedValue' in result.facts[0], false);
  assert.equal('correctedValue' in result.candidates[0], false);
});

test('drops candidates that only reference discarded facts', async () => {
  const provider = { async structureReport() { return {
    facts:[{ id:'bad', scope:'华南', metric:'收入', value:999, unit:'', sourceText:'不存在 999', confidence:0.9 }],
    candidates:[{ title:'异常', scope:'华南', kind:'anomaly', explanation:'...', relatedFactIds:['bad'] }],
    confirmations:[]
  }; } };
  const result = await structureReportText({ text:'华南 收入 9800', source:'qianfan_ocr', degraded:false }, { provider });
  assert.equal(result.candidates.length, 0);
});

test('normalizes anchored cloud OCR facts without inventing trust', async () => {
  const provider = { async structureReport() { return {
    facts:[{ id:'f1', scope:'华南', metric:'毛利率', value:85, unit:'%', sourceText:'华南 毛利率 85%', confidence:0.93 }],
    candidates:[], confirmations:[]
  }; } };
  const result = await structureReportText({ text:'华南 毛利率 85%', source:'qianfan_ocr', degraded:false }, { provider });
  assert.equal(result.facts.length, 1);
  assert.equal(result.facts[0].source, 'qianfan_ocr_ai');
  assert.equal(result.facts[0].confidence, 0.93);
  assert.equal('trusted' in result.facts[0], false);
});

test('drops isolated numeric citations that do not bind scope and metric on the same sourceText', async () => {
  const provider = { async structureReport() { return {
    facts:[{ id:'f1', scope:'华南', metric:'收入', value:9800, unit:'万元', sourceText:'9800 万元', confidence:0.99 }],
    candidates:[], confirmations:[]
  }; } };
  const result = await structureReportText({ text:'华南 收入\n9800 万元', source:'qianfan_ocr' }, { provider });
  assert.deepEqual(result.facts, []);
});

test('drops a fact whose declared unit is absent from its source citation', async () => {
  const provider = { async structureReport() { return {
    facts:[{ id:'f1', scope:'华南', metric:'收入', value:9800, unit:'万元', sourceText:'华南 收入 9800', confidence:0.99 }],
    candidates:[], confirmations:[]
  }; } };
  const result = await structureReportText({ text:'华南 收入 9800', source:'qianfan_ocr' }, { provider });
  assert.deepEqual(result.facts, []);
});

test('drops a numeric fact whose unit is omitted even when all other source anchors match', async () => {
  const provider = { async structureReport() { return {
    facts:[{ id:'f1', scope:'华南', metric:'收入', value:9800, unit:'', sourceText:'华南 收入 9800', confidence:0.99 }],
    candidates:[], confirmations:[]
  }; } };
  const result = await structureReportText({ text:'华南 收入 9800', source:'qianfan_ocr' }, { provider });
  assert.deepEqual(result.facts, []);
});

test('accepts strictly anchored date facts as unit-equivalent and enables date rules', async () => {
  const provider = { async structureReport() { return {
    facts:[
      { id:'production', scope:'SKU-1', metric:'生产日期', value:'2026-08-12', unit:'', sourceText:'SKU-1 生产日期 2026-08-12', confidence:0.99 },
      { id:'expiry', scope:'SKU-1', metric:'失效日期', value:'2026-08-01', unit:'', sourceText:'SKU-1 失效日期 2026-08-01', confidence:0.99 }
    ], candidates:[], confirmations:[]
  }; } };
  const text = 'SKU-1 生产日期 2026-08-12\nSKU-1 失效日期 2026-08-01';
  const result = await structureReportText({ text, source:'qianfan_ocr' }, { provider });
  assert.equal(result.facts.length, 2);
  assert.deepEqual(result.facts.map((fact) => fact.unit), ['','']);
  const issues = inspectReportFacts(result.facts, { now:new Date('2026-08-12T00:00:00Z') });
  assert.equal(issues.some((issue) => issue.title === '失效日期早于生产日期'), true);
});

test('does not treat an arbitrary unitless string as a date-equivalent fact', async () => {
  const provider = { async structureReport() { return {
    facts:[{ id:'bad-date', scope:'SKU-1', metric:'生产日期', value:'下周', unit:'', sourceText:'SKU-1 生产日期 下周', confidence:0.99 }],
    candidates:[], confirmations:[]
  }; } };
  const result = await structureReportText({ text:'SKU-1 生产日期 下周', source:'qianfan_ocr' }, { provider });
  assert.deepEqual(result.facts, []);
});

test('accepts a controlled metric alias when the full citation is independently checkable', async () => {
  const provider = { async structureReport() { return {
    facts:[{ id:'raw-revenue', scope:'华南', metric:'营业收入', value:9800, unit:'万元', sourceText:'华南 营收 9800 万元', confidence:0.99 }],
    candidates:[], confirmations:[]
  }; } };
  const result = await structureReportText({ text:'华南 营收 9800 万元', source:'qianfan_ocr' }, { provider });
  assert.equal(result.facts.length, 1);
  assert.equal(result.facts[0].id, 'report_fact_1');
});

test('server generates unique fact ids and remaps candidates away from duplicate model ids', async () => {
  const provider = { async structureReport() { return {
    facts:[
      { id:'duplicate', scope:'华南', metric:'营收', value:9800, unit:'万元', sourceText:'华南 营收 9800 万元', confidence:0.99 },
      { id:'duplicate', scope:'华北', metric:'营收', value:7200, unit:'万元', sourceText:'华北 营收 7200 万元', confidence:0.99 }
    ],
    candidates:[{ title:'区域差异', scope:'全国', kind:'anomaly', explanation:'需核对区域差异', relatedFactIds:['duplicate'] }],
    confirmations:[]
  }; } };
  const text = '华南 营收 9800 万元\n华北 营收 7200 万元';
  const result = await structureReportText({ text, source:'qianfan_ocr' }, { provider });
  assert.deepEqual(result.facts.map((fact) => fact.id), ['report_fact_1','report_fact_2']);
  assert.deepEqual(result.candidates[0].relatedFactIds, ['report_fact_1','report_fact_2']);
});

test('extracts independently checkable facts from DeepSeek OCR HTML tables when the AI structurer returns no facts', async () => {
  const text = [
    '<table><tr><td>区域</td><td>营业额（万元）</td><td>营业成本（万元）</td><td>毛利（万元）</td><td>毛利率</td><td>订单量（单）</td><td>客单价（元）</td></tr>',
    '<tr><td>华南</td><td>280</td><td>190</td><td>120</td><td>42.9%</td><td>3500</td><td>800</td></tr>',
    '<tr><td>华北</td><td>250</td><td>160</td><td>90</td><td>28.0%</td><td>2500</td><td>1000</td></tr>',
    '<tr><td>合计</td><td>1000</td><td>655</td><td>375</td><td>37.5%</td><td>11500</td><td>870</td></tr></table>'
  ].join('');
  const provider = { async structureReport() { return { facts:[], candidates:[], confirmations:[] }; } };

  const result = await structureReportText({ text, source:'qianfan_ocr' }, { provider });

  assert.equal(result.facts.length, 18);
  assert.deepEqual(
    result.facts.filter((fact) => fact.scope === '华南').map((fact) => [fact.metric, fact.value, fact.unit]),
    [
      ['营业额',280,'万元'], ['营业成本',190,'万元'], ['毛利',120,'万元'],
      ['毛利率',42.9,'%'], ['订单量',3500,'单'], ['客单价',800,'元']
    ]
  );
  assert.equal(result.facts.every((fact) => fact.source === 'qianfan_ocr_table'), true);
  assert.deepEqual(
    inspectReportFacts(result.facts).map((issue) => `${issue.scope}:${issue.title}`),
    [
      '华南:毛利计算错误', '华南:毛利率计算错误',
      '华北:毛利率计算错误',
      '合计:毛利计算错误', '合计:毛利率计算错误'
    ]
  );
});

test('uses deterministic HTML table facts when the AI structurer request fails', async () => {
  const text = '<table><tr><td>区域</td><td>营业额（万元）</td><td>营业成本（万元）</td><td>毛利（万元）</td><td>毛利率</td></tr><tr><td>华南</td><td>280</td><td>190</td><td>120</td><td>42.9%</td></tr></table>';
  const provider = { async structureReport() { throw new Error('upstream unavailable'); } };

  const result = await structureReportText({ text, source:'qianfan_ocr' }, { provider });

  assert.equal(result.facts.length, 4);
  assert.deepEqual(inspectReportFacts(result.facts).map((issue) => issue.title), ['毛利计算错误','毛利率计算错误']);
});
