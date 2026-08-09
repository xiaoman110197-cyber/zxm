import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseWorkbook } from '../../src/audit/workbook.js';
import { auditWorkbook } from '../../src/audit/rules.js';

function buildWorkbookBuffer() {
  const wb = XLSX.utils.book_new();
  const orders = [
    {订单号:'A001', 营业额:100, 客户:'张三'},
    {订单号:'A002', 营业额:200, 客户:''},
    {订单号:'A002', 营业额:200, 客户:''}
  ];
  const summary = [{指标:'营业额', 数值:999}];
  const costs = [{项目:'原料', 成本:120},{项目:'平台', 成本:30}];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(orders), '订单明细');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), '汇总');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(costs), '成本');
  return XLSX.write(wb, {type:'buffer', bookType:'xlsx'});
}

test('parses every sheet in a workbook', () => {
  const parsed = parseWorkbook(buildWorkbookBuffer());
  assert.deepEqual(parsed.sheets.map(s => s.name), ['订单明细','汇总','成本']);
  assert.equal(parsed.sheets[0].rows.length, 3);
});

test('detects duplicate records and missing values as data errors', () => {
  const parsed = parseWorkbook(buildWorkbookBuffer());
  const audit = auditWorkbook(parsed);
  assert.ok(audit.errors.some(e => e.type === 'duplicate_record' && e.sheet === '订单明细'));
  assert.ok(audit.errors.some(e => e.type === 'missing_value' && e.sheet === '订单明细' && e.field === '客户'));
});

test('detects cross-sheet revenue mismatch without classifying it as a business anomaly', () => {
  const parsed = parseWorkbook(buildWorkbookBuffer());
  const audit = auditWorkbook(parsed);
  const mismatch = audit.errors.find(e => e.type === 'cross_sheet_total_mismatch');
  assert.ok(mismatch);
  assert.equal(mismatch.expected, 500);
  assert.equal(mismatch.actual, 999);
  assert.equal(audit.anomalies.some(a => a.type === 'cross_sheet_total_mismatch'), false);
});
