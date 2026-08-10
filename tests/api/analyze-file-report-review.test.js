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

test('image analysis returns a program-proven report error list and trusted structured facts', async () => {
  const original = Buffer.from('original-image-bytes');
  let visionInput;
  const res = mockRes();
  await handleAnalyzeFileRequest(reqFor(original), res, {
    disableBurstGuard:true,
    parseBusinessDocument:imageParser('华南大区 营收 9800 万元 营业成本 6100 万元 毛利率 85%'),
    analyzeReportImage:async (input) => {
      visionInput = input;
      return {
        available:true, provider:'openai', model:'test-vision', warning:null, candidates:[],
        facts:[
          { id:'r', scope:'华南大区', metric:'营收', value:9800, unit:'万元', sourceText:'营收 9800', confidence:0.99, source:'vision' },
          { id:'c', scope:'华南大区', metric:'营业成本', value:6100, unit:'万元', sourceText:'营业成本 6100', confidence:0.99, source:'vision' },
          { id:'m', scope:'华南大区', metric:'毛利率', value:85, unit:'%', sourceText:'毛利率 85%', confidence:0.99, source:'vision' }
        ]
      };
    }
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(visionInput.buffer, original);
  assert.equal(visionInput.mimeType, 'image/png');
  const issue = res.body.reportReview.issues.find((item) => item.title === '毛利率计算错误');
  assert.equal(issue.kind, 'calculation_error');
  assert.equal(issue.correctedValue, 37.76);
  assert.equal(res.body.reportReview.summary.provableCorrectionCount, 1);
  assert.equal(res.body.reportFacts.length, 3);
  assert.equal(res.body.reportFacts.every((item) => item.trusted === true), true);
  assert.equal(res.body.reportFacts.find((item) => item.metric === '营收').value, 9800);
});

test('vision claimed calculation error is not presented as a correct answer without program proof', async () => {
  const res = mockRes();
  await handleAnalyzeFileRequest(reqFor(), res, {
    disableBurstGuard:true,
    parseBusinessDocument:imageParser('仓储部 库存周转率 3.2'),
    analyzeReportImage:async () => ({
      available:true, provider:'openai', model:'test', warning:null,
      facts:[{ id:'x', scope:'仓储部', metric:'库存周转率', value:3.2, unit:'次', sourceText:'库存周转率 3.2', confidence:0.99, source:'vision' }],
      candidates:[{ title:'库存周转率计算错误', scope:'仓储部', kind:'calculation_error', explanation:'模型认为有问题', relatedFactIds:['x'] }]
    })
  });
  const issue = res.body.reportReview.issues[0];
  assert.equal(issue.kind, 'needs_confirmation');
  assert.equal('correctedValue' in issue, false);
});

test('OCR and vision conflict marks that fact untrusted and downgrades dependent correction', async () => {
  const res = mockRes();
  await handleAnalyzeFileRequest(reqFor(), res, {
    disableBurstGuard:true,
    parseBusinessDocument:imageParser('华南大区 营收 9800 万元 营业成本 8100 万元 毛利率 85%'),
    analyzeReportImage:async () => ({
      available:true, provider:'openai', model:'test', warning:null, candidates:[],
      facts:[
        { id:'r', scope:'华南大区', metric:'营收', value:9800, unit:'万元', sourceText:'营收 9800', confidence:0.99, source:'vision' },
        { id:'c', scope:'华南大区', metric:'营业成本', value:6100, unit:'万元', sourceText:'营业成本 6100', confidence:0.99, source:'vision' },
        { id:'m', scope:'华南大区', metric:'毛利率', value:85, unit:'%', sourceText:'毛利率 85%', confidence:0.99, source:'vision' }
      ]
    })
  });
  const issue = res.body.reportReview.issues.find((item) => item.title === '毛利率计算错误');
  assert.equal(issue.kind, 'needs_confirmation');
  assert.equal('correctedValue' in issue, false);
  assert.ok(res.body.reportReview.summary.confirmationCount >= 1);
  assert.equal(res.body.reportFacts.find((item) => item.id === 'c').trusted, false);
  assert.equal(res.body.reportFacts.find((item) => item.id === 'r').trusted, true);
});

test('vision failure is non-fatal and returns an explicit review warning', async () => {
  const res = mockRes();
  await handleAnalyzeFileRequest(reqFor(), res, {
    disableBurstGuard:true,
    parseBusinessDocument:imageParser('一些 OCR 文本'),
    analyzeReportImage:async () => ({ available:false, provider:null, model:null, facts:[], candidates:[], warning:'视觉分析暂时失败，已使用文字识别继续检查' })
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reportReview.summary.visionAvailable, false);
  assert.match(res.body.reportReview.summary.visionWarning, /视觉分析/);
  assert.deepEqual(res.body.reportFacts, []);
});
