import test from 'node:test';
import assert from 'node:assert/strict';
import * as experienceSummary from '../../src/experience/summary.js';

const { summarizeWorkbook } = experienceSummary;

test('summarizes the latest business day from common Chinese headers', () => {
  const workbook = { sheets:[{ name:'预约明细', headers:['日期','客户','预约状态','金额','渠道','负责人','下次跟进','任务状态'], rows:[
    { 日期:'2026-09-01 10:00', 客户:'A', 预约状态:'已完成', 金额:'¥398', 渠道:'企微', 负责人:'小林', 下次跟进:'2026-09-01 18:00', 任务状态:'已完成' },
    { 日期:'2026-09-02 10:00', 客户:'B', 预约状态:'未到店', 金额:0, 渠道:'美团', 负责人:'小周', 下次跟进:'2026-09-02 12:00', 任务状态:'待处理' },
    { 日期:'2026-09-02 11:00', 客户:'C', 预约状态:'已完成', 金额:'688元', 渠道:'企微', 负责人:'小林', 下次跟进:'2026-09-03 12:00', 任务状态:'进行中' }
  ]}] };
  const summary = summarizeWorkbook(workbook);
  assert.equal(summary.period, '2026-09-02');
  assert.equal(summary.metrics.records, 2);
  assert.equal(summary.metrics.appointments, 2);
  assert.equal(summary.metrics.arrivals, 1);
  assert.equal(summary.metrics.completed, 1);
  assert.equal(summary.metrics.noShows, 1);
  assert.equal(summary.metrics.revenue, 688);
  assert.equal(summary.metrics.overdue, 1);
});

test('missing columns stay unavailable instead of becoming zero', () => {
  const workbook = { sheets:[{ name:'客户表', headers:['日期','客户','渠道'], rows:[{ 日期:'2026-09-02', 客户:'A', 渠道:'抖音' }] }] };
  const summary = summarizeWorkbook(workbook);
  assert.equal(summary.ok, true);
  assert.equal(summary.metrics.revenue, null);
  assert.equal(summary.metrics.completed, null);
  assert.equal(summary.metrics.overdue, null);
  assert.ok(summary.missing.includes('金额/营业额'));
  assert.ok(summary.warnings.some((item) => item.includes('无法计算营业额')));
});

test('chooses a detailed sheet instead of a summary sheet', () => {
  const workbook = { sheets:[
    { name:'汇总', headers:['指标','数值'], rows:[{ 指标:'营业额', 数值:999 }] },
    { name:'订单明细', headers:['日期','客户','状态','营业额'], rows:[{ 日期:'2026-09-02', 客户:'A', 状态:'已成交', 营业额:100 }, { 日期:'2026-09-02', 客户:'B', 状态:'已成交', 营业额:200 }] }
  ] };
  const summary = summarizeWorkbook(workbook);
  assert.equal(summary.usedSheet, '订单明细');
  assert.equal(summary.metrics.revenue, 300);
  assert.ok(summary.warnings.some((item) => item.includes('未自动跨表合并')));
});

test('ambiguous headers only affect calculations after the owner confirms mappings', () => {
  const workbook = { sheets:[{ name:'门店流水', headers:['发生日','客户称呼','进度口径','到账口径','来路口径','跟单人','下次处理点'], rows:[
    { 发生日:'2026-09-02', 客户称呼:'A', 进度口径:'已成交', 到账口径:'688元', 来路口径:'抖音', 跟单人:'小王', 下次处理点:'2026-09-01 18:00' }
  ]}] };
  const before = summarizeWorkbook(workbook);
  assert.equal(before.ok, false);

  const confirmedMappings = [
    { sheet:'门店流水', field:'date', header:'发生日' },
    { sheet:'门店流水', field:'customer', header:'客户称呼' },
    { sheet:'门店流水', field:'status', header:'进度口径' },
    { sheet:'门店流水', field:'amount', header:'到账口径' },
    { sheet:'门店流水', field:'channel', header:'来路口径' },
    { sheet:'门店流水', field:'owner', header:'跟单人' },
    { sheet:'门店流水', field:'due', header:'下次处理点' }
  ];
  const after = summarizeWorkbook(workbook, { confirmedMappings });
  assert.equal(after.ok, true);
  assert.equal(after.period, '2026-09-02');
  assert.equal(after.metrics.completed, 1);
  assert.equal(after.metrics.revenue, 688);
  assert.equal(after.metrics.overdue, 1);
  assert.equal(after.fields.amount, '到账口径');
});

test('V7 question context exposes only deterministic aggregates and never treats revenue as profit', () => {
  assert.equal(typeof experienceSummary.buildBusinessQuestionContext, 'function');
  const context = experienceSummary.buildBusinessQuestionContext({
    ok:true,
    usedSheet:'预约明细',
    period:'2026-09-02',
    fieldCoverage:78,
    missing:['成本/毛利率'],
    metrics:{ records:24, appointments:18, arrivals:12, completed:9, noShows:3, revenue:11860, overdue:5 },
    channels:[{ channel:'企微', records:10, revenue:5200 }],
    overdueOwners:[{ owner:'小王', overdue:3 }]
  }, { source:{ fileName:'经营.csv' } });
  assert.equal(context.available, true);
  assert.equal(context.facts.revenue, 11860);
  assert.equal(context.derived.arrivalRate, 66.7);
  assert.equal(context.derived.completionRate, 50);
  assert.equal(context.availability.profit, false);
  assert.ok(context.unavailable.includes('利润/毛利'));
  assert.equal(JSON.stringify(context).includes('客户明细'), false);
});
