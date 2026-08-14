import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAnalyzeFileRequest } from '../../api/analyze-file.js';

function mockStreamRes() {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    ended: false,
    status(code){ this.statusCode = code; return this; },
    setHeader(name, value){ this.headers[String(name).toLowerCase()] = value; },
    flushHeaders(){},
    write(value){ this.chunks.push(String(value)); return true; },
    end(value){ if (value) this.chunks.push(String(value)); this.ended = true; return this; },
    json(value){ this.body = value; this.ended = true; return this; }
  };
}

test('file analysis records safe OCR sub-stage progress with request id for debugging', async () => {
  const res = mockStreamRes();
  const logs = [];
  const req = {
    method:'POST',
    query:{ stream:'1' },
    body:{ file:{ name:'screen.png', contentBase64:Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1]).toString('base64') } }
  };

  await handleAnalyzeFileRequest(req, res, {
    requestId:'req-ocr-phase',
    logInfo:(...args) => logs.push(args),
    parseBusinessDocument: async (_input, parserDeps) => {
      parserDeps.onProgress?.({ phase:'ocr', stage:'language', percent:52, message:'正在加载中文和英文识别模型' });
      parserDeps.onProgress?.({ phase:'ocr', stage:'initializing', percent:52, message:'正在初始化文字识别' });
      parserDeps.onProgress?.({ phase:'ocr', stage:'recognizing', percent:58, message:'正在识别图片中的文字和数字' });
      return {
        document:{ name:'screen.png', type:'image', structured:false, confidence:0.9, warnings:[], text:'营业额 88' },
        workbook:null
      };
    }
  });

  assert.equal(res.statusCode, 200);
  assert.ok(logs.some((entry) => entry.includes('req-ocr-phase') && entry.includes('progress') && entry.includes('ocr') && entry.includes('language') && entry.includes(52)), JSON.stringify(logs));
  assert.ok(logs.some((entry) => entry.includes('req-ocr-phase') && entry.includes('progress') && entry.includes('ocr') && entry.includes('initializing') && entry.includes(52)), JSON.stringify(logs));
  assert.ok(logs.some((entry) => entry.includes('req-ocr-phase') && entry.includes('progress') && entry.includes('ocr') && entry.includes('recognizing') && entry.includes(58)), JSON.stringify(logs));
  assert.ok(logs.every((entry) => !entry.includes('营业额 88')), JSON.stringify(logs));
});

test('file analysis emits a safe lifecycle without filename or parsed content', async () => {
  const events = [];
  const res = mockStreamRes();
  await handleAnalyzeFileRequest({
    method:'POST', body:{ file:{ name:'秘密营业额.csv', contentBase64:Buffer.from('a,b\n1,2').toString('base64') } }
  }, res, {
    requestId:'req-file-ops', emitOpsEvent:(event) => events.push(event),
    parseBusinessDocument:async () => ({ document:{ type:'csv', name:'秘密营业额.csv', text:'营业额 999' }, workbook:null })
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(events.map(({ event }) => event), ['request_started', 'stage_completed', 'request_completed']);
  assert.equal(events[1].stage, 'parsing');
  assert.doesNotMatch(JSON.stringify(events), /秘密|营业额|\.csv/);
});

test('image analysis emits each named operations stage once', async () => {
  const events = [];
  const res = mockStreamRes();
  await handleAnalyzeFileRequest({
    method:'POST', body:{ file:{ name:'screen.png', contentBase64:Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1]).toString('base64') } }
  }, res, {
    requestId:'req-image-stages', emitOpsEvent:(event) => events.push(event),
    parseBusinessDocument:async () => ({ document:{ type:'image', name:'screen.png', text:'', recognitionDeferred:true }, workbook:null }),
    recognizeReportImage:async () => ({ available:true, provider:'test', model:'test-ocr', text:'营业额 999' }),
    reportStructurer:async () => ({ facts:[{ key:'revenue', label:'营业额', value:999, unit:'元', evidence:'营业额 999' }] })
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(events.filter(({ event }) => event === 'stage_completed').map(({ stage }) => stage), [
    'parsing', 'cloud-ocr', 'structuring', 'checking-rules'
  ]);
  assert.equal(events.at(0).event, 'request_started');
  assert.equal(events.at(-1).event, 'request_completed');
});
