import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAnalyzeFileRequest } from '../../api/analyze-file.js';

function mockRes() {
  return {
    statusCode:200,
    body:null,
    headers:{},
    status(code){ this.statusCode = code; return this; },
    setHeader(name,value){ this.headers[String(name).toLowerCase()] = value; },
    json(value){ this.body = value; return this; }
  };
}

function imageParser(text = '') {
  return async ({ name }) => ({
    document:{ name, source:{kind:'upload',name}, type:'image', structured:false, confidence:0.77, text, truncated:false, uncertainSegments:[], warnings:[] },
    workbook:null
  });
}

function reqFor() {
  return { method:'POST', body:{ file:{ name:'经营报表.png', contentBase64:Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1]).toString('base64') } } };
}

const structuredFacts = [
  { id:'r', scope:'华南大区', metric:'营收', value:9800, unit:'万元', sourceText:'华南大区 营收 9800 万元', confidence:0.99, source:'qianfan_ocr_ai' },
  { id:'c', scope:'华南大区', metric:'营业成本', value:6100, unit:'万元', sourceText:'华南大区 营业成本 6100 万元', confidence:0.99, source:'qianfan_ocr_ai' },
  { id:'m', scope:'华南大区', metric:'毛利率', value:85, unit:'%', sourceText:'华南大区 毛利率 85%', confidence:0.99, source:'qianfan_ocr_ai' }
];

const cloudText = [
  '华南大区 营收 9800 万元',
  '华南大区 营业成本 6100 万元',
  '华南大区 毛利率 85%'
].join('\n');

test('ordinary POST cloud OCR success routes through DeepSeek structuring and deterministic rules', async () => {
  const res = mockRes();
  let structureInput;
  const req = reqFor();
  assert.equal(req.query, undefined);
  await handleAnalyzeFileRequest(req, res, {
    disableBurstGuard:true,
    parseBusinessDocument:imageParser('本地 OCR 不应成为正常模式主证据'),
    recognizeReportImage:async () => ({
      available:true, provider:'qianfan', model:'deepseek-ocr', text:cloudText, failureCode:null, warning:null
    }),
    reportStructurer:async (input) => {
      structureInput = input;
      return { facts:structuredFacts, candidates:[], confirmations:[] };
    },
    visionOptions:{ apiKey:'' }
  });

  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.body.requestId, 'string');
  assert.equal(structureInput.source, 'qianfan_ocr');
  assert.equal(structureInput.degraded, false);
  assert.equal(res.body.reportReview.summary.recognitionMode, 'cloud_ocr_deepseek');
  assert.equal(res.body.reportReview.summary.completeReview, true);
  const issue = res.body.reportReview.issues.find((item) => item.title === '毛利率计算错误');
  assert.equal(issue.correctedValue, 37.76);
  assert.equal(res.body.reportFacts.every((fact) => fact.trusted === true), true);
});

test('ordinary POST cloud OCR failure preserves provider code in explicit degraded mode', async () => {
  const res = mockRes();
  let structureInput;
  const req = reqFor();
  assert.equal(req.query, undefined);
  await handleAnalyzeFileRequest(req, res, {
    disableBurstGuard:true,
    parseBusinessDocument:imageParser('华南大区 营收 9800 万元'),
    recognizeReportImage:async () => ({
      available:false, provider:null, model:null, text:'', failureCode:'OCR_HTTP_429', warning:'云端识别失败'
    }),
    reportStructurer:async (input) => {
      structureInput = input;
      return { facts:[{ id:'r', scope:'华南大区', metric:'营收', value:9800, unit:'万元', sourceText:'华南大区 营收 9800 万元', confidence:0.64, source:'local_ocr_ai' }], candidates:[], confirmations:[] };
    },
    visionOptions:{ apiKey:'' }
  });

  assert.equal(res.statusCode, 200);
  assert.equal(structureInput.source, 'local_ocr');
  assert.equal(structureInput.degraded, true);
  assert.equal(res.body.reportReview.summary.recognitionMode, 'local_ocr_degraded');
  assert.equal(res.body.reportReview.summary.completeReview, false);
  assert.equal(res.body.reportReview.summary.failureCode, 'OCR_HTTP_429');
  assert.match(res.body.reportReview.summary.reviewWarning, /降级识别|关键数字需要核对/);
  assert.match(res.body.reportReview.summary.reviewWarning, /OCR_HTTP_429/);
  assert.ok(res.body.reportReview.summary.confirmationCount >= 1);
});

test('cloud and local OCR both unavailable returns ocr_unavailable without fake zero-problem success', async () => {
  const res = mockRes();
  let structurerCalled = false;
  await handleAnalyzeFileRequest(reqFor(), res, {
    disableBurstGuard:true,
    parseBusinessDocument:imageParser('   '),
    recognizeReportImage:async () => ({
      available:false, provider:null, model:null, text:'', failureCode:'OCR_TIMEOUT', warning:'云端识别超时'
    }),
    reportStructurer:async () => { structurerCalled = true; return { facts:[], candidates:[], confirmations:[] }; },
    visionOptions:{ apiKey:'' }
  });

  assert.equal(res.statusCode, 200);
  assert.equal(structurerCalled, false);
  assert.equal(res.body.reportReview.summary.recognitionMode, 'ocr_unavailable');
  assert.equal(res.body.reportReview.summary.completeReview, false);
  assert.match(res.body.reportReview.summary.reviewWarning, /重新上传|更清晰/);
  assert.deepEqual(res.body.reportFacts, []);
});

test('ordinary POST structuring failure preserves OCR mode and reports safe failure code', async () => {
  const res = mockRes();
  const req = reqFor();
  assert.equal(req.query, undefined);
  await handleAnalyzeFileRequest(req, res, {
    disableBurstGuard:true,
    parseBusinessDocument:imageParser('华南大区 营收 9800'),
    recognizeReportImage:async () => ({
      available:true, provider:'qianfan', model:'deepseek-ocr', text:cloudText, failureCode:null, warning:null
    }),
    reportStructurer:async () => { throw new Error('bad model JSON'); },
    visionOptions:{ apiKey:'' }
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reportReview.summary.recognitionMode, 'cloud_ocr_deepseek');
  assert.equal(res.body.reportReview.summary.completeReview, false);
  assert.equal(res.body.reportReview.summary.failureCode, 'REPORT_STRUCTURE_FAILED');
  assert.match(res.body.reportReview.summary.reviewWarning, /结构化|整理经营字段/);
  assert.deepEqual(res.body.reportFacts, []);
});

test('image analysis progress exposes cloud OCR, structuring and program check stages without raw business data', async () => {
  const res = mockRes();
  const progress = [];
  const logs = [];
  await handleAnalyzeFileRequest(reqFor(), res, {
    requestId:'req-deepseek-pipeline',
    disableBurstGuard:true,
    logInfo:(...args) => logs.push(args.join(' ')),
    onProgress:(event) => progress.push(event.stage || event.phase),
    parseBusinessDocument:imageParser('本地敏感营业额 123456'),
    recognizeReportImage:async () => ({
      available:true, provider:'qianfan', model:'deepseek-ocr', text:cloudText, failureCode:null, warning:null
    }),
    reportStructurer:async () => ({ facts:structuredFacts, candidates:[], confirmations:[] }),
    visionOptions:{ apiKey:'' }
  });

  const cloudIndex = progress.indexOf('cloud-ocr');
  const structureIndex = progress.indexOf('structuring');
  const checkIndex = progress.indexOf('checking-rules');
  assert.ok(cloudIndex >= 0, JSON.stringify(progress));
  assert.ok(structureIndex > cloudIndex, JSON.stringify(progress));
  assert.ok(checkIndex > structureIndex, JSON.stringify(progress));
  assert.ok(logs.every((line) => !line.includes('123456') && !line.includes('9800') && !line.includes('6100')), JSON.stringify(logs));
});

test('real parser never starts local OCR when cloud OCR succeeds', async () => {
  let localCalls = 0;
  const res = mockRes();
  await handleAnalyzeFileRequest(reqFor(), res, {
    disableBurstGuard:true,
    imageOcr:async () => { localCalls += 1; return { text:'本地文本', confidence:0.9, uncertainSegments:[] }; },
    recognizeReportImage:async () => ({ available:true, provider:'qianfan', model:'deepseek-ocr', text:cloudText }),
    reportStructurer:async () => ({ facts:structuredFacts, candidates:[], confirmations:[] })
  });

  assert.equal(res.statusCode, 200);
  assert.equal(localCalls, 0);
  assert.equal(res.body.document.text, cloudText);
  assert.equal(res.body.reportReview.summary.recognitionMode, 'cloud_ocr_deepseek');
});

test('real parser starts local OCR exactly once only after cloud OCR fails', async () => {
  let localCalls = 0;
  const res = mockRes();
  await handleAnalyzeFileRequest(reqFor(), res, {
    disableBurstGuard:true,
    imageOcr:async () => {
      localCalls += 1;
      return { text:'华南大区 营收 9800 万元', confidence:0.8, uncertainSegments:[] };
    },
    recognizeReportImage:async () => ({ available:false, failureCode:'OCR_HTTP_401_INVALID_APPID', text:'' }),
    reportStructurer:async () => ({
      facts:[{ id:'r', scope:'华南大区', metric:'营收', value:9800, unit:'万元', sourceText:'华南大区 营收 9800 万元', confidence:0.64 }],
      candidates:[], confirmations:[]
    })
  });

  assert.equal(res.statusCode, 200);
  assert.equal(localCalls, 1);
  assert.equal(res.body.document.text, '华南大区 营收 9800 万元');
  assert.equal(res.body.reportReview.summary.recognitionMode, 'local_ocr_degraded');
});

test('cloud OCR with zero valid structured facts is explicitly incomplete', async () => {
  const res = mockRes();
  await handleAnalyzeFileRequest(reqFor(), res, {
    disableBurstGuard:true,
    recognizeReportImage:async () => ({ available:true, provider:'qianfan', model:'deepseek-ocr', text:cloudText }),
    reportStructurer:async () => ({ facts:[], candidates:[], confirmations:[] })
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reportReview.summary.completeReview, false);
  assert.equal(res.body.reportReview.summary.failureCode, 'REPORT_STRUCTURE_EMPTY');
  assert.match(res.body.reportReview.summary.reviewWarning, /未形成|经营字段|核对/);
});
