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

function reqFor(buffer = Buffer.from('original-image-bytes')) {
  return { method:'POST', body:{ file:{ name:'经营报表.png', contentBase64:buffer.toString('base64') } } };
}

const cloudText = [
  '华南大区 营收 9800 万元',
  '华南大区 营业成本 6100 万元',
  '华南大区 毛利率 85%'
].join('\n');

const facts = [
  { id:'r', scope:'华南大区', metric:'营收', value:9800, unit:'万元', sourceText:'华南大区 营收 9800 万元', confidence:0.99, source:'qianfan_ocr_ai' },
  { id:'c', scope:'华南大区', metric:'营业成本', value:6100, unit:'万元', sourceText:'华南大区 营业成本 6100 万元', confidence:0.99, source:'qianfan_ocr_ai' },
  { id:'m', scope:'华南大区', metric:'毛利率', value:85, unit:'%', sourceText:'华南大区 毛利率 85%', confidence:0.99, source:'qianfan_ocr_ai' }
];

test('image analysis returns a program-proven report error list and trusted structured facts', async () => {
  const original = Buffer.from('original-image-bytes');
  let ocrInput;
  const res = mockRes();
  await handleAnalyzeFileRequest(reqFor(original), res, {
    disableBurstGuard:true,
    parseBusinessDocument:imageParser('本地 OCR 仅作降级备用'),
    recognizeReportImage:async (input) => {
      ocrInput = input;
      return { available:true, provider:'qianfan', model:'deepseek-ocr', text:cloudText, failureCode:null, warning:null };
    },
    reportStructurer:async () => ({ facts, candidates:[], confirmations:[] })
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(ocrInput.buffer, original);
  assert.equal(ocrInput.mimeType, 'image/png');
  assert.equal(res.body.reportReview.summary.recognitionMode, 'cloud_ocr_deepseek');
  const issue = res.body.reportReview.issues.find((item) => item.title === '毛利率计算错误');
  assert.equal(issue.kind, 'calculation_error');
  assert.equal(issue.correctedValue, 37.76);
  assert.equal(res.body.reportReview.summary.provableCorrectionCount, 1);
  assert.equal(res.body.reportFacts.length, 3);
  assert.equal(res.body.reportFacts.every((item) => item.trusted === true), true);
});

test('AI claimed calculation error is not presented as a correct answer without program proof', async () => {
  const res = mockRes();
  await handleAnalyzeFileRequest(reqFor(), res, {
    disableBurstGuard:true,
    parseBusinessDocument:imageParser('仓储部 库存周转率 3.2'),
    recognizeReportImage:async () => ({ available:true, provider:'qianfan', model:'deepseek-ocr', text:'仓储部 库存周转率 3.2', failureCode:null, warning:null }),
    reportStructurer:async () => ({
      facts:[{ id:'x', scope:'仓储部', metric:'库存周转率', value:3.2, unit:'次', sourceText:'仓储部 库存周转率 3.2', confidence:0.99, source:'qianfan_ocr_ai' }],
      candidates:[{ title:'库存周转率计算错误', scope:'仓储部', kind:'calculation_error', explanation:'模型认为有问题', relatedFactIds:['x'] }],
      confirmations:[]
    })
  });
  const issue = res.body.reportReview.issues[0];
  assert.equal(issue.kind, 'needs_confirmation');
  assert.equal('correctedValue' in issue, false);
});

test('structured confirmation marks that fact untrusted and downgrades a dependent correction', async () => {
  const res = mockRes();
  await handleAnalyzeFileRequest(reqFor(), res, {
    disableBurstGuard:true,
    parseBusinessDocument:imageParser('本地 OCR 不参与正常模式硬结论'),
    recognizeReportImage:async () => ({ available:true, provider:'qianfan', model:'deepseek-ocr', text:cloudText, failureCode:null, warning:null }),
    reportStructurer:async () => ({
      facts,
      candidates:[],
      confirmations:[{
        id:'confirm:c', scope:'华南大区', metric:'营业成本', currentValue:6100, unit:'万元',
        reason:'这一行列关系需要人工核对', sourceText:'华南大区 营业成本 6100 万元'
      }]
    })
  });
  const issue = res.body.reportReview.issues.find((item) => item.title === '毛利率计算错误');
  assert.equal(issue.kind, 'needs_confirmation');
  assert.equal('correctedValue' in issue, false);
  assert.ok(res.body.reportReview.summary.confirmationCount >= 1);
  assert.equal(res.body.reportFacts.find((item) => item.id === 'c').trusted, false);
  assert.equal(res.body.reportFacts.find((item) => item.id === 'r').trusted, true);
});

test('cloud OCR failure is non-fatal when local OCR exists and returns explicit degraded warning', async () => {
  const res = mockRes();
  await handleAnalyzeFileRequest(reqFor(), res, {
    disableBurstGuard:true,
    parseBusinessDocument:imageParser('一些 OCR 文本'),
    recognizeReportImage:async () => ({ available:false, provider:null, model:null, text:'', failureCode:'OCR_TIMEOUT', warning:'云端识别超时' }),
    reportStructurer:async () => ({ facts:[], candidates:[], confirmations:[] })
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reportReview.summary.recognitionMode, 'local_ocr_degraded');
  assert.equal(res.body.reportReview.summary.completeReview, false);
  assert.equal(res.body.reportReview.summary.failureCode, 'OCR_TIMEOUT');
  assert.match(res.body.reportReview.summary.reviewWarning, /降级识别|关键数字需要核对/);
  assert.deepEqual(res.body.reportFacts, []);
});
