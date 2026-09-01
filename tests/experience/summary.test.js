import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeWorkbook } from '../../src/experience/summary.js';

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
