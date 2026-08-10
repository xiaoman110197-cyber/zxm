import test from 'node:test';
import assert from 'node:assert/strict';
import { handleAnalyzeFileStreamRequest } from '../../api/analyze-file-stream.js';

function mockStreamRes() {
  return {
    statusCode: 200,
    headers: {},
    chunks: [],
    ended: false,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    write(chunk) { this.chunks.push(String(chunk)); return true; },
    end(chunk = '') { if (chunk) this.chunks.push(String(chunk)); this.ended = true; return this; }
  };
}

function eventsOf(res) {
  return res.chunks.join('').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

test('streaming file api emits real stages before the final result', async () => {
  const res = mockStreamRes();
  const req = { method:'POST', body:{ file:{ name:'截图.png', contentBase64:'iVBORw0KGgo=' } } };
  await handleAnalyzeFileStreamRequest(req, res, {
    analyzeUploadedBusinessFile: async (_file, { onProgress }) => {
      onProgress({ stage:'validating', percent:20, message:'正在校验文件…' });
      onProgress({ stage:'ocr', percent:61, message:'正在识别图片中的文字和数字…' });
      onProgress({ stage:'auditing', percent:86, message:'正在检查数据质量…' });
      onProgress({ stage:'preparing', percent:94, message:'正在整理经营数据…' });
      return {
        document:{ name:'截图.png', type:'image', structured:false, confidence:0.88, warnings:[] },
        audit:{ errors:[], anomalies:[], metrics:{} },
        summary:{ fileType:'image', errorCount:0, anomalyCount:0, confidence:0.88 }
      };
    }
  });

  const events = eventsOf(res);
  assert.equal(res.headers['content-type'], 'application/x-ndjson; charset=utf-8');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(events.filter((event) => event.type === 'progress').map((event) => [event.stage,event.percent]), [
    ['validating',20], ['ocr',61], ['auditing',86], ['preparing',94]
  ]);
  assert.equal(events.at(-1).type, 'result');
  assert.equal(events.at(-1).result.document.type, 'image');
  assert.equal(res.ended, true);
});

test('streaming file api returns a user-safe error record and ends the stream', async () => {
  const res = mockStreamRes();
  const req = { method:'POST', body:{ file:{ name:'坏文件.png', contentBase64:'AA==' } } };
  await handleAnalyzeFileStreamRequest(req, res, {
    analyzeUploadedBusinessFile: async () => {
      const error = new Error('internal parser details');
      error.statusCode = 422;
      error.userMessage = '文件损坏、格式不匹配或内容无法解析';
      throw error;
    }
  });
  const events = eventsOf(res);
  assert.equal(events.at(-1).type, 'error');
  assert.equal(events.at(-1).status, 422);
  assert.equal(events.at(-1).error, '文件损坏、格式不匹配或内容无法解析');
  assert.equal(JSON.stringify(events).includes('internal parser details'), false);
  assert.equal(events.at(-1).detail, undefined);
  assert.equal(res.ended, true);
});
