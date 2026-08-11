import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeReportImage } from '../../src/report/vision.js';

const input = { name:'report.png', buffer:Buffer.from('x'), mimeType:'image/png', ocrText:'' };

function failureFetch({ status = 500, body = {} } = {}) {
  return async () => ({ ok:false, status, json:async () => body });
}

function transportError(code) {
  const error = new TypeError('fetch failed');
  error.cause = { code };
  return error;
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

test('trims surrounding whitespace from the configured API key before sending it', async () => {
  let authorization = '';
  const result = await analyzeReportImage(input, {
    apiKey:'  sk-test-key\n',
    fetchImpl:async (_url, options) => {
      authorization = options.headers.Authorization;
      return { ok:false, status:401, json:async () => ({}) };
    }
  });
  assert.equal(authorization, 'Bearer sk-test-key');
  assert.equal(result.failureCode, 'VISION_HTTP_401');
});

test('rejects control characters inside the API key before attempting a request', async () => {
  let called = false;
  const result = await analyzeReportImage(input, {
    apiKey:'sk-test\n-key',
    fetchImpl:async () => {
      called = true;
      return { ok:false, status:401, json:async () => ({}) };
    }
  });
  assert.equal(called, false);
  assert.equal(result.failureCode, 'VISION_REQUEST_CONFIG');
});

test('classifies DNS lookup failures separately', async () => {
  const result = await analyzeReportImage(input, {
    apiKey:'k',
    fetchImpl:async () => { throw transportError('ENOTFOUND'); }
  });
  assert.equal(result.failureCode, 'VISION_DNS_ERROR');
});

test('classifies connection timeouts separately from the overall request timeout', async () => {
  const result = await analyzeReportImage(input, {
    apiKey:'k',
    fetchImpl:async () => { throw transportError('UND_ERR_CONNECT_TIMEOUT'); }
  });
  assert.equal(result.failureCode, 'VISION_CONNECT_TIMEOUT');
});

test('classifies connection resets separately', async () => {
  const result = await analyzeReportImage(input, {
    apiKey:'k',
    fetchImpl:async () => { throw transportError('ECONNRESET'); }
  });
  assert.equal(result.failureCode, 'VISION_CONNECTION_RESET');
});

test('keeps unknown transport failures as a generic network error', async () => {
  const result = await analyzeReportImage(input, {
    apiKey:'k',
    fetchImpl:async () => { throw new TypeError('fetch failed'); }
  });
  assert.equal(result.failureCode, 'VISION_NETWORK_ERROR');
});
