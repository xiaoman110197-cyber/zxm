import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';

function mockRes() {
  return { statusCode: 200, body: null, status(code){ this.statusCode = code; return this; }, json(value){ this.body = value; return this; } };
}

function sourceBase64() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ 订单号:'A001', 营业额:100 }, { 订单号:'A002', 营业额:200 }]), '订单明细');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ 指标:'营业额', 数值:350 }]), '汇总');
  return XLSX.write(wb, { type:'buffer', bookType:'xlsx' }).toString('base64');
}

async function loadHandler() {
  const mod = await import('../../api/report.js');
  assert.equal(typeof mod.handleReportRequest, 'function');
  return mod.handleReportRequest;
}

test('report api rejects requests without original workbook', async () => {
  const handleReportRequest = await loadHandler();
  const res = mockRes();
  await handleReportRequest({ method:'POST', body:{ audit:{}, findings:[] } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /file|workbook|Excel/i);
});

test('report api rejects source workbooks above the 3 MB raw-file limit', async () => {
  const handleReportRequest = await loadHandler();
  const res = mockRes();
  const contentBase64 = Buffer.alloc(3 * 1024 * 1024 + 1, 0x61).toString('base64');
  await handleReportRequest({ method:'POST', body:{ file:{ name:'huge.xlsx', contentBase64 }, audit:{ errors:[], anomalies:[], metrics:{} }, findings:[] } }, res);
  assert.equal(res.statusCode, 413);
  assert.match(res.body.error, /3\s*MB|过大/);
});

test('report api rejects pathological findings counts before workbook generation', async () => {
  const handleReportRequest = await loadHandler();
  const res = mockRes();
  const findings = Array.from({ length:51 }, (_, i) => ({ title:`问题${i}`, status:'hypothesis', priority:'P2', evidence:['x'], confidence:0.2, impact:'x', action:'x', metric:'x' }));
  await handleReportRequest({ method:'POST', body:{ file:{ name:'test.xlsx', contentBase64:sourceBase64() }, audit:{ errors:[], anomalies:[], metrics:{} }, findings } }, res);
  assert.equal(res.statusCode, 413);
  assert.match(res.body.error, /过多|精简|限制/);
});

test('report api returns a real xlsx preserving original sheets and adding analysis sheets', async () => {
  const handleReportRequest = await loadHandler();
  const res = mockRes();
  await handleReportRequest({ method:'POST', body:{
    file:{ name:'老板经营数据.xlsx', contentBase64:sourceBase64() },
    audit:{ errors:[{ type:'cross_sheet_mismatch', sheet:'汇总', field:'营业额', originalValue:350, suggestedValue:null, reason:'与订单明细合计不一致', confidence:1 }], anomalies:[], metrics:{ revenue:300 } },
    findings:[{ title:'营业额汇总口径需核对', status:'confirmed', priority:'P0', evidence:['program:audit:cross_sheet_total_mismatch'], confidence:1, impact:'汇总数据不可信', action:'核对汇总公式和口径', metric:'营业额' }]
  } }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body.filename, /诊断报告.*\.xlsx$/);
  assert.equal(res.body.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const buffer = Buffer.from(res.body.contentBase64, 'base64');
  const result = XLSX.read(buffer, { type:'buffer' });
  for (const name of ['订单明细','汇总','诊断总览','错误清单','异常清单','关键指标','修正记录','经营建议']) {
    assert.ok(result.SheetNames.includes(name), `missing sheet: ${name}`);
  }
});

test('uncertain corrections stay marked 待确认 in downloadable report', async () => {
  const handleReportRequest = await loadHandler();
  const res = mockRes();
  await handleReportRequest({ method:'POST', body:{
    file:{ name:'test.xlsx', contentBase64:sourceBase64() },
    audit:{ errors:[{ type:'cross_sheet_mismatch', sheet:'汇总', field:'营业额', originalValue:350, suggestedValue:null, reason:'口径待核对', confidence:0.72 }], anomalies:[], metrics:{} },
    findings:[]
  } }, res);
  const result = XLSX.read(Buffer.from(res.body.contentBase64, 'base64'), { type:'buffer' });
  const rows = XLSX.utils.sheet_to_json(result.Sheets['修正记录'], { defval:'' });
  assert.equal(rows[0].建议值, '待确认');
});
