import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { buildReportWorkbook } from '../../src/reports/workbook-report.js';

function sourceWorkbook() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { 订单号: 'A001', 营业额: 100 },
    { 订单号: 'A002', 营业额: 200 }
  ]), '订单明细');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([
    { 指标: '营业额', 数值: 300 }
  ]), '汇总');
  return wb;
}

test('preserves source sheets and adds all analysis sheets', () => {
  const source = sourceWorkbook();
  const before = XLSX.write(source, { type: 'buffer', bookType: 'xlsx' });
  const out = buildReportWorkbook({
    workbook: source,
    audit: { errors: [], anomalies: [], metrics: { revenue: 300 } },
    findings: []
  });
  assert.ok(Buffer.isBuffer(out));
  const result = XLSX.read(out, { type: 'buffer' });
  for (const name of ['订单明细','汇总','诊断总览','错误清单','异常清单','关键指标','修正记录','经营建议']) {
    assert.ok(result.SheetNames.includes(name), `missing sheet: ${name}`);
  }
  const after = XLSX.write(source, { type: 'buffer', bookType: 'xlsx' });
  assert.deepEqual(after, before, 'source workbook must not be mutated');
});

test('marks uncertain corrections as 待确认 and records correction provenance', () => {
  const out = buildReportWorkbook({
    workbook: sourceWorkbook(),
    audit: {
      errors: [{ type: 'cross_sheet_mismatch', sheet: '汇总', field: '营业额', originalValue: 350, suggestedValue: null, reason: '与订单明细合计不一致', confidence: 0.72 }],
      anomalies: [], metrics: { revenue: 300 }
    },
    findings: [{ status: 'probable', priority: 'P1', evidence: ['汇总营业额与明细不一致'], confidence: 0.72, action: '核对营业额口径', metric: '营业额' }]
  });
  const result = XLSX.read(out, { type: 'buffer' });
  const corrections = XLSX.utils.sheet_to_json(result.Sheets['修正记录'], { defval: '' });
  assert.equal(corrections.length, 1);
  assert.equal(corrections[0].原值, 350);
  assert.equal(corrections[0].建议值, '待确认');
  assert.equal(corrections[0].原因, '与订单明细合计不一致');
  assert.equal(corrections[0].置信度, 0.72);
});

test('writes deterministic suggested values when explicitly supplied', () => {
  const out = buildReportWorkbook({
    workbook: sourceWorkbook(),
    audit: { errors: [{ type: 'format', sheet: '订单明细', field: '营业额', originalValue: '100元', suggestedValue: 100, reason: '去除货币字符', confidence: 1 }], anomalies: [], metrics: {} },
    findings: []
  });
  const result = XLSX.read(out, { type: 'buffer' });
  const corrections = XLSX.utils.sheet_to_json(result.Sheets['修正记录'], { defval: '' });
  assert.equal(corrections[0].建议值, 100);
});
