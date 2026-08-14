import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { signTrustToken } from '../../src/security/trust-token.js';
import { sourceDigest } from '../../src/security/source-digest.js';

const trustSecret = 'report-test-secret-with-enough-entropy';

function diagnosisToken(findings = [], digests = [sourceDigest(Buffer.from(sourceBase64(), 'base64'))]) {
  return signTrustToken('diagnosis', { findings, sourceDigests:digests }, { secret:trustSecret });
}

function mockRes() {
  return {
    statusCode:200, body:null, headers:{},
    status(code){ this.statusCode = code; return this; },
    setHeader(name, value){ this.headers[String(name).toLowerCase()] = value; },
    json(value){ this.body = value; return this; }
  };
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

test('report api rejects malformed Base64 source files', async () => {
  const handleReportRequest = await loadHandler();
  const res = mockRes();
  await handleReportRequest({ method:'POST', body:{ file:{ name:'bad.xlsx', contentBase64:'%%%bad%%%' }, audit:{}, findings:[] } }, res);
  assert.equal(res.statusCode, 422);
  assert.match(res.body.error, /无法读取|损坏|编码/);
});

test('report api rejects decoded source workbooks above 3 MB', async () => {
  const handleReportRequest = await loadHandler();
  const res = mockRes();
  const contentBase64 = Buffer.alloc(3 * 1024 * 1024 + 1, 0x61).toString('base64');
  await handleReportRequest({ method:'POST', body:{ file:{ name:'large.xlsx', contentBase64 }, audit:{}, findings:[] } }, res);
  assert.equal(res.statusCode, 413);
  assert.match(res.body.error, /3\s*MB|过大/);
});

test('report api rejects a missing or tampered diagnosis token', async () => {
  const handleReportRequest = await loadHandler();
  for (const token of [undefined, `${diagnosisToken().slice(0, -1)}x`]) {
    const res = mockRes();
    await handleReportRequest({ method:'POST', body:{
      file:{ name:'test.xlsx', contentBase64:sourceBase64() }, diagnosisToken:token
    } }, res, { trustSecret, disableBurstGuard:true });
    assert.equal(res.statusCode, 422);
    assert.match(res.body.error, /验证|诊断/);
  }
});

test('report api rejects a diagnosis token issued for a different workbook', async () => {
  const handleReportRequest = await loadHandler();
  const res = mockRes();
  await handleReportRequest({ method:'POST', body:{
    file:{ name:'test.xlsx', contentBase64:sourceBase64() },
    diagnosisToken:diagnosisToken([], [sourceDigest(Buffer.from('different-workbook'))])
  } }, res, { trustSecret, disableBurstGuard:true });
  assert.equal(res.statusCode, 422);
  assert.match(res.body.error, /当前文件|重新生成|验证/);
});

test('report api rejects a multi-source diagnosis token for a single-workbook report', async () => {
  const handleReportRequest = await loadHandler();
  const currentDigest = sourceDigest(Buffer.from(sourceBase64(), 'base64'));
  const res = mockRes();
  await handleReportRequest({ method:'POST', body:{
    file:{ name:'test.xlsx', contentBase64:sourceBase64() },
    diagnosisToken:diagnosisToken([], [currentDigest, sourceDigest(Buffer.from('another-workbook'))])
  } }, res, { trustSecret, disableBurstGuard:true });
  assert.equal(res.statusCode, 422);
  assert.match(res.body.error, /单文件|重新生成|验证/);
});

test('production report reports missing trust signing as 503 before workbook parsing', async () => {
  const handleReportRequest = await loadHandler();
  const res = mockRes();
  await handleReportRequest({ method:'POST', body:{
    file:{ name:'test.xlsx', contentBase64:sourceBase64() }, diagnosisToken:'untrusted'
  } }, res, { env:{}, requireTrustToken:true, trustSecret:'   ', disableBurstGuard:true });
  assert.equal(res.statusCode, 503);
  assert.match(res.body.error, /签名|配置/);
});

test('report api returns a real xlsx preserving original sheets and adding analysis sheets', async () => {
  const handleReportRequest = await loadHandler();
  const res = mockRes();
  const signedFinding = {
    title:'营业额汇总口径需核对', status:'confirmed', priority:'P0', evidence:['服务端签名诊断证据'],
    confidence:1, impact:'汇总数据不可信', action:'核对汇总公式和口径', metric:'营业额'
  };
  await handleReportRequest({ method:'POST', body:{
    file:{ name:'老板经营数据.xlsx', contentBase64:sourceBase64() },
    diagnosisToken:diagnosisToken([signedFinding]),
    audit:{ errors:[{ type:'forged_client_error', reason:'客户端伪造错误' }], anomalies:[], metrics:{ forged:999 } },
    findings:[{ title:'客户端伪造建议', status:'confirmed', priority:'P0', evidence:['forged'], confidence:1, impact:'x', action:'x', metric:'x' }]
  } }, res, { trustSecret, disableBurstGuard:true });
  assert.equal(res.statusCode, 200);
  assert.match(res.body.filename, /诊断报告.*\.xlsx$/);
  assert.equal(res.body.mimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const buffer = Buffer.from(res.body.contentBase64, 'base64');
  const result = XLSX.read(buffer, { type:'buffer' });
  for (const name of ['订单明细','汇总','诊断总览','错误清单','异常清单','关键指标','修正记录','经营建议']) {
    assert.ok(result.SheetNames.includes(name), `missing sheet: ${name}`);
  }
  const suggestions = XLSX.utils.sheet_to_json(result.Sheets['经营建议'], { defval:'' });
  const errors = XLSX.utils.sheet_to_json(result.Sheets['错误清单'], { defval:'' });
  assert.match(suggestions[0].证据, /服务端签名诊断证据/);
  assert.doesNotMatch(JSON.stringify(suggestions), /客户端伪造建议/);
  assert.doesNotMatch(JSON.stringify(errors), /forged_client_error|客户端伪造错误/);
});

test('report emits safe lifecycle events without the source filename', async () => {
  const handleReportRequest = await loadHandler();
  const events = [];
  const res = mockRes();
  await handleReportRequest({ method:'POST', body:{
    file:{ name:'秘密经营数据.xlsx', contentBase64:sourceBase64() }, diagnosisToken:diagnosisToken([])
  } }, res, {
    trustSecret, disableBurstGuard:true, requestId:'req-report-ops', emitOpsEvent:(event) => events.push(event)
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(events.map(({ event }) => event), ['request_started', 'stage_completed', 'request_completed']);
  assert.equal(events[1].stage, 'report-generation');
  assert.doesNotMatch(JSON.stringify(events), /秘密|经营数据|\.xlsx/);
});

test('uncertain corrections stay marked 待确认 in downloadable report', async () => {
  const handleReportRequest = await loadHandler();
  const res = mockRes();
  await handleReportRequest({ method:'POST', body:{
    file:{ name:'test.xlsx', contentBase64:sourceBase64() },
    diagnosisToken:diagnosisToken([])
  } }, res, { trustSecret, disableBurstGuard:true });
  const result = XLSX.read(Buffer.from(res.body.contentBase64, 'base64'), { type:'buffer' });
  const rows = XLSX.utils.sheet_to_json(result.Sheets['修正记录'], { defval:'' });
  assert.equal(rows[0].建议值, '待确认');
});

test('report api applies a route-scoped burst guard before workbook generation', async () => {
  const handleReportRequest = await loadHandler();
  const req = {
    method:'POST', headers:{ 'x-vercel-forwarded-for':'203.0.113.77' },
    body:{ file:{ name:'test.xlsx', contentBase64:sourceBase64() }, diagnosisToken:diagnosisToken([]) }
  };
  for (let index = 0; index < 10; index += 1) {
    const res = mockRes();
    await handleReportRequest(req, res, { trustSecret });
    assert.equal(res.statusCode, 200);
  }
  const blocked = mockRes();
  await handleReportRequest(req, blocked, { trustSecret });
  assert.equal(blocked.statusCode, 429);
  assert.match(blocked.body.error, /频繁|稍后/);
});
