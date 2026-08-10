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

test('file analysis records phase-level progress with request id for OCR debugging', async () => {
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
      parserDeps.onProgress?.({ phase:'ocr', percent:52, message:'正在初始化文字识别' });
      parserDeps.onProgress?.({ phase:'ocr', percent:58, message:'正在识别图片中的文字和数字' });
      return {
        document:{ name:'screen.png', type:'image', structured:false, confidence:0.9, warnings:[], text:'营业额 88' },
        workbook:null
      };
    }
  });

  assert.equal(res.statusCode, 200);
  assert.ok(logs.some((entry) => entry.includes('req-ocr-phase') && entry.includes('progress') && entry.includes('ocr') && entry.includes(52)), JSON.stringify(logs));
  assert.ok(logs.some((entry) => entry.includes('req-ocr-phase') && entry.includes('progress') && entry.includes('ocr') && entry.includes(58)), JSON.stringify(logs));
});
