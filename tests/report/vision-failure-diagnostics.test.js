import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeReportImage } from '../../src/report/vision.js';

const input = { name:'report.png', buffer:Buffer.from('x'), mimeType:'image/png', ocrText:'' };

function failureFetch({ status = 500, body = {} } = {}) {
  return async () => ({ ok:false, status, json:async () => body });
}

test('classifies HTTP 400 without leaking provider body', async () => {
  const result = await analyzeReportImage(input, {
    apiKey:'secret-key',
    fetchImpl:failureFetch({ status:400, body:{ error:{ message:'sensitive provider detail' } } })
  });
  assert.equal(result.failureCode, 'VISION_HTTP_400');
  assert.match(result.warning, /VISION_HTTP_400/);
  assert.doesNotMatch(result.warning, /sensitive provider detail|secret-key/);
});

test('classifies HTTP 429 distinctly from other HTTP errors', async () => {
  const result = await analyzeReportImage(input, { apiKey:'k', fetchImpl:failureFetch({ status:429 }) });
  assert.equal(result.failureCode, 'VISION_HTTP_429');
});

test('classifies invalid JSON output', async () => {
  const result = await analyzeReportImage(input, {
    apiKey:'k',
    fetchImpl:async () => ({ ok:true, json:async () => ({ output_text:'not-json' }) })
  });
  assert.equal(result.failureCode, 'VISION_INVALID_JSON');
});

test('classifies empty model output', async () => {
  const result = await analyzeReportImage(input, {
    apiKey:'k',
    fetchImpl:async () => ({ ok:true, json:async () => ({ output:[] }) })
  });
  assert.equal(result.failureCode, 'VISION_EMPTY_OUTPUT');
});

test('classifies transport failures without pretending they are HTTP failures', async () => {
  const result = await analyzeReportImage(input, {
    apiKey:'k',
    fetchImpl:async () => { throw new TypeError('fetch failed'); }
  });
  assert.equal(result.failureCode, 'VISION_NETWORK_ERROR');
});
