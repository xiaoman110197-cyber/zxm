import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { parseWorkbook } from '../../src/audit/workbook.js';
import { auditWorkbook } from '../../src/audit/rules.js';

function buildWorkbookBuffer() {
  const wb = XLSX.utils.book_new();
  const orders = [
    {订单号:'A001', 营业额:100, 时间:'10:00', 客户:'张三', 备注:''},
    {订单号:'A002', 营业额:200, 时间:'', 客户:'', 备注:''},
    {订单号:'A002', 营业额:200, 时间:'', 客户:'', 备注:''}
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

test('does not report ordinary or sparsely populated optional cells as missing-value errors', () => {
  const audit = auditWorkbook(parseWorkbook(buildWorkbookBuffer()));
  assert.ok(audit.errors.some(e => e.type === 'duplicate_record' && e.sheet === '订单明细'));
  assert.equal(audit.errors.some(e => e.type === 'missing_value' && ['客户','备注','时间'].includes(e.field)), false);
});

test('reports a missing critical field only when the column is otherwise consistently populated', () => {
  const rows = Array.from({ length:10 }, (_, index) => ({
    订单号:`A${String(index + 1).padStart(3, '0')}`,
    营业额:index === 7 ? '' : 100 + index,
    备注:index === 7 ? '金额漏填' : ''
  }));
  const workbook = { sheets: [{ name:'订单明细', headers:['订单号','营业额','备注'], rows }] };
  const audit = auditWorkbook(workbook);
  assert.ok(audit.errors.some(e => e.type === 'missing_value' && e.field === '营业额' && e.row === 9));
});

test('paired summary fields still report a missing value even in a small sheet', () => {
  const workbook = { sheets: [{ name:'汇总', headers:['指标','数值'], rows:[{指标:'营业额', 数值:''}] }] };
  const audit = auditWorkbook(workbook);
  assert.ok(audit.errors.some(e => e.type === 'missing_value' && e.field === '数值'));
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

function workbookWithSheets(count) {
  const wb = XLSX.utils.book_new();
  for (let index = 0; index < count; index += 1) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['值'], [index]]), `表${index + 1}`);
  }
  return XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
}

test('rejects workbooks with more than 30 sheets', () => {
  assert.throws(() => parseWorkbook(workbookWithSheets(31)), /Sheet|工作表|30|上限/i);
});

test('rejects sheets wider than 200 columns', () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    Array.from({ length:201 }, (_, index) => `列${index + 1}`),
    Array.from({ length:201 }, (_, index) => index)
  ]), '超宽表');
  const buffer = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
  assert.throws(() => parseWorkbook(buffer), /列|column|200|上限/i);
});

test('rejects sheets with more than 50000 data rows', () => {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['值']]);
  sheet.A50002 = { t:'n', v:1 };
  sheet['!ref'] = 'A1:A50002';
  XLSX.utils.book_append_sheet(wb, sheet, '超长表');
  const buffer = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
  assert.throws(() => parseWorkbook(buffer), /行|row|50000|上限/i);
});

test('rejects workbook ranges above the 250000 cell budget', () => {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([['值']]);
  sheet.GR1251 = { t:'n', v:1 };
  sheet['!ref'] = 'A1:GR1251';
  XLSX.utils.book_append_sheet(wb, sheet, '超大范围');
  const buffer = XLSX.write(wb, { type:'buffer', bookType:'xlsx' });
  assert.throws(() => parseWorkbook(buffer), /单元格|cell|250000|上限/i);
});
